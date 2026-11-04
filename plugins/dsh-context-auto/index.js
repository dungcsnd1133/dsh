import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { positiveTokens, routeKey, settingsOperation, targetPolicy, tokenBudget, validateTarget } from './policy.js';

export const ENTRY_ID = 'context-auto-threshold';
export const Config = z.object({
  modelInputTokens: z.dict(z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)).default({}).volatile(),
  modelInputCaps: z.dict(z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)).default({}).volatile(),
});
const remoteInitializers = [];

export class ContextAutoThreshold extends TypertRemoteService {
  static inject = ['settings', 'tools', 'llm', 'sessionController'];
  static Config = Config;
  constructor(ctx, config) {
    super(ctx, 'contextAutoThreshold');
    for (const initialize of remoteInitializers) initialize.call(this);
    this.config = config;
    this.modelCache = new Map();
    ctx.on('settings/document-updated', () => this.modelCache.clear());
    ctx.on('agent/request', async ({ agent, signal }, next) => {
      const proposal = await next();
      const backend = this.backendFor(agent);
      if (!backend?.config) return proposal;
      try {
        const target = validateTarget(proposal);
        const model = await this.resolveModel(target, signal);
        const budget = this.budgetFor(targetPolicy(backend.config, target), model, target);
        return { ...proposal, maxTokens: budget.outputTokens };
      } catch (error) {
        if (signal.aborted) throw error;
        ctx.logger.warn(`context-auto: output MAX unavailable: ${error.message}`);
        return proposal;
      }
    });
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'context_token_budget',
      description: 'Read, set, or reset input token budget for an exact provider/model. Output defaults to MAX within the remaining context. Applies across conversations on the next safe step; does not compact immediately.',
      parameters: {
        action: { type: 'string', enum: ['read', 'set', 'reset'], required: true },
        provider: { type: 'string' }, model: { type: 'string' }, inputTokens: { type: 'integer' },
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
      execute: async (args, execution) => {
        if (!execution.agent) throw new Error('This operation requires a conversation.');
        const current = execution.agent.options ?? execution.agent.session.requestHeader()?.config;
        return { text: JSON.stringify(await this.operate({ action: args.action, sessionId: execution.agent.id, provider: args.provider ?? current?.provider, model: args.model ?? current?.model, inputTokens: args.inputTokens }, execution.signal)) };
      },
    })), 'context-auto: token budget tool');
  }
  values() {
    const value = this.config.modelInputTokens;
    return typeof value?.get === 'function' ? value.get() ?? {} : value ?? {};
  }
  backendFor(agent) {
    return this.ctx.get('agentPresets')?.serviceFor?.(agent, 'compaction') ?? this.ctx.get('compaction');
  }
  async resolveModel(target, signal) {
    const key = routeKey(target);
    const cached = this.modelCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.model;
    const model = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal);
    let maxOutput = model.defaultMaxTokens;
    let outputLimitSource = maxOutput === undefined ? undefined : 'configured-default';
    let contextWindow = model.context?.contextWindow;
    const namespace = this.ctx.settings.describe().find(row => row.value?.providers && Object.hasOwn(row.value.providers, target.provider));
    if (namespace) {
      const provider = namespace.value.providers[target.provider];
      const configured = provider.models?.find(row => row.id === target.model);
      if (configured?.maxTokens !== undefined) {
        maxOutput = configured.maxTokens;
        outputLimitSource = 'configured-model';
      } else if (maxOutput === undefined && provider.defaultMaxTokens !== undefined) {
        maxOutput = provider.defaultMaxTokens;
        outputLimitSource = 'configured-default';
      }
      try {
        const catalog = await this.ctx.llm.discoverModels(namespace.ns, { provider: target.provider, baseURL: provider.baseUrl ?? provider.baseURL, api: provider.api }, signal);
        const found = catalog.find(row => row.id === target.model);
        if (found?.maxTokens !== undefined) { maxOutput = found.maxTokens; outputLimitSource = 'provider'; }
        contextWindow ??= found?.contextWindow;
      } catch (error) { if (signal?.aborted) throw error; }
    }
    const resolved = { ...model, context: { contextWindow: positiveTokens(contextWindow, 'Model context window') }, defaultMaxTokens: positiveTokens(maxOutput, 'Known model output capacity'), outputLimitSource };
    this.modelCache.set(key, { model: resolved, expires: Date.now() + 60_000 });
    return resolved;
  }
  budgetFor(policy, model, target) {
    const key = routeKey(target), values = this.values();
    const caps = this.config.modelInputCaps;
    const inputCap = (typeof caps?.get === 'function' ? caps.get() : caps)?.[key];
    const budgetModel = inputCap === undefined ? model : { ...model, context: { ...model.context, maxInputTokens: inputCap } };
    return { ...tokenBudget(policy, budgetModel, Object.hasOwn(values, key) ? values[key] : undefined), outputLimitSource: model.outputLimitSource };
  }
  async compactionInputs(policy, model, target, signal) {
    try {
      const resolved = await this.resolveModel(target, signal);
      const budget = this.budgetFor(policy, { ...resolved, context: model.context }, target);
      return { policy: { ...policy, thresholdRatio: 1 }, inputTokens: budget.inputTokens, reservedCompletionTokens: budget.outputTokens };
    } catch (error) {
      if (signal?.aborted) throw error;
      return undefined;
    }
  }
  // Same validated operation for native popup RPC and agent tool. The Gateway
  // owns authentication and remote access decisions for this namespace.
  async operate(request, signal) {
    if (!request || !['read', 'set', 'reset'].includes(request.action)) throw new Error('Invalid token budget action.');
    if (typeof request.sessionId !== 'string' || !request.sessionId || request.sessionId.length > 300) throw new Error('A conversation is required.');
    const target = validateTarget(request);
    const result = await this.ctx.sessionController.resolveAgent(request.sessionId);
    if (result.error) throw result.error;
    const backend = this.backendFor(result.agent);
    if (!backend?.config) throw new Error('This conversation has no native compaction backend.');
    const policy = targetPolicy(backend.config, target);
    const model = await this.resolveModel(target, signal);
    const descriptor = this.ctx.settings.describe().find(row => row.ns === ENTRY_ID || row.ns.endsWith(':' + ENTRY_ID));
    if (!descriptor) throw new Error('Token budget settings are unavailable.');
    if (request.action !== 'read') {
      const candidate = request.action === 'reset' ? undefined : positiveTokens(request.inputTokens, 'Input token limit');
      const budget = this.budgetFor(policy, model, target);
      if (candidate !== undefined && (candidate < budget.minInputTokens || candidate > budget.maxInputTokens)) throw new Error(`Input token limit must be between ${budget.minInputTokens} and ${budget.maxInputTokens}.`);
      try {
        await this.ctx.settings.mutate(descriptor.ns, [settingsOperation(target, candidate ?? null)], request.expectedRevision ?? descriptor.revision);
      } catch (error) {
        if (error.code === 'SETTINGS_CONFLICT') throw new RemoteError('context-auto/settings-conflict', error.message, { expected: error.expected ?? null, actual: error.actual ?? null }, { cause: error });
        throw error;
      }
    }
    const latest = this.ctx.settings.describe().find(row => row.ns === descriptor.ns);
    return { target, budget: this.budgetFor(policy, model, target), revision: latest.revision, writable: this.ctx.settings.writable, nativeAutoEnabled: backend.config.auto !== false, scope: 'profile/exact-model', starts: 'next-safe-step' };
  }
}

// Public decorator initializer contract, without compiler-injected descriptors.
Remote('operate')(ContextAutoThreshold.prototype.operate, { kind: 'method', name: 'operate', private: false, static: false, addInitializer: fn => remoteInitializers.push(fn) });
export default ContextAutoThreshold;
