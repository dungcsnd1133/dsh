import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runtime, nativePackageRoot } from './runtime.mjs';
import { routeKey, settingsOperation, targetPolicy, tokenBudget } from '../policy.js';
import { plan, applyPlan } from '../patch-native.mjs';
import { ContextAutoThreshold, Config } from '../index.js';
import { remoteMethods, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol';
import { SettingsConflictError } from '@deepseek-ai/dsh-settings';
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway';

const z = runtime('@deepseek-ai/schemastery');
const target = { provider: 'provider-a', model: 'model-a' };
const basePolicy = { thresholdRatio: .8, headroomTokens: 65_536, retainRatio: .16, auto: true };
const model = { ...target, context: { contextWindow: 500_000 }, defaultMaxTokens: 500_000 };
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-context-auto-test-'));
test.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
for (const [folder, name, file] of [['_deepseek-ai_dsh-client-ui-conversation', 'dsh-client-ui-conversation', 'client.js'], ['_deepseek-ai_dsh-compaction-basic', 'dsh-compaction-basic', 'index.js']]) {
  const dest = path.join(fixture, '@deepseek-ai', name);
  fs.mkdirSync(path.join(dest, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(nativePackageRoot('@deepseek-ai/' + name), 'package.json'), path.join(dest, 'package.json'));
  fs.copyFileSync(path.join(nativePackageRoot('@deepseek-ai/' + name), 'lib', file), path.join(dest, 'lib', file));
  const backup = path.join(dest, 'lib', file + '.before-context-auto');
  if (fs.existsSync(backup)) fs.unlinkSync(backup);
}
test('exact native patch is idempotent, reversible, and refuses concurrent changes', () => {
  const original = plan(fixture); applyPlan(original);
  assert.ok(plan(fixture).every(row => row.current === row.next));
  for (const row of original) new vm.Script(fs.readFileSync(row.file, 'utf8').replace(/^import .*;$/gm, '').replace(/^export .*;$/gm, ''));
  fs.appendFileSync(original[0].file, '\n// unrelated change\n');
  assert.throws(() => plan(fixture), /Concurrent modification/);
  fs.writeFileSync(original[0].file, original[0].next);
  applyPlan(plan(fixture, true)); assert.ok(plan(fixture).every(row => row.current !== row.next));
  applyPlan(plan(fixture));
});
test('schema stores absolute integers, and provider/model keys do not collide', () => {
  for (const tokens of [1, 128_000, 262_144]) assert.doesNotThrow(() => Config({ modelInputTokens: { [routeKey(target)]: tokens } }));
  for (const tokens of [0, -1, 1.5, NaN, '128000']) assert.throws(() => Config({ modelInputTokens: { [routeKey(target)]: tokens } }));
  assert.notEqual(routeKey({ provider: 'a/b', model: 'c' }), routeKey({ provider: 'a', model: 'b/c' }));
});
test('MAX output shares context with input and preserves compaction reserve', () => {
  const budget = tokenBudget(basePolicy, model, 128_000);
  assert.equal(budget.inputTokens, 128_000);
  assert.equal(budget.outputTokens, 306_464);
  assert.equal(budget.inputTokens + budget.outputTokens + budget.headroomTokens, 500_000);
  assert.equal(tokenBudget(basePolicy, model, 256_000).outputTokens, 178_464);
  const smallOutput = tokenBudget(basePolicy, { ...model, defaultMaxTokens: 32_768 }, 128_000);
  assert.equal(smallOutput.outputTokens, 32_768);
  assert.ok(smallOutput.inputTokens > Math.floor((500_000 - smallOutput.outputTokens) * .16));
});
test('all supported input values fit native retention; stale limits clamp and invalid capacity refuses', () => {
  for (const output of [1, 32_768, 128_000, 500_000]) {
    const meta = { ...model, defaultMaxTokens: output }, initial = tokenBudget(basePolicy, meta);
    for (const input of [initial.minInputTokens, initial.minInputTokens + 1, 128_000, initial.maxInputTokens]) {
      const budget = tokenBudget(basePolicy, meta, input);
      assert.ok(budget.inputTokens > Math.floor((500_000 - budget.outputTokens) * .16));
      assert.ok(budget.inputTokens + budget.outputTokens + 65_536 <= 500_000);
    }
  }
  assert.equal(tokenBudget(basePolicy, model, 999_999).adjusted, true);
  assert.throws(() => tokenBudget(basePolicy, { ...model, defaultMaxTokens: undefined }), /output capacity/);
  assert.throws(() => tokenBudget(basePolicy, { ...model, context: { contextWindow: 65_536 } }), /cannot fit/);
  const exact = targetPolicy({ ...basePolicy, modelPolicies: [{ ...target, retainTokens: 24_000 }] }, target);
  assert.equal(exact.retainRatio, undefined); assert.equal(tokenBudget(exact, model).minInputTokens, 24_001);
});

test('default input preserves full model output instead of collapsing MAX to one token', () => {
  const capacity = { context: { contextWindow: 262_144 }, defaultMaxTokens: 32_768 };
  const budget = tokenBudget(basePolicy, capacity);
  assert.equal(budget.outputTokens, 32_768);
  assert.ok(budget.inputTokens + budget.outputTokens + budget.headroomTokens <= 262_144);
  assert.equal(budget.requestedInput, null);
  const shared = tokenBudget(basePolicy, model);
  assert.equal(shared.inputTokens, shared.minInputTokens);
  assert.equal(shared.inputTokens + shared.outputTokens + shared.headroomTokens, 500_000);
});
function nativeRuntime() {
  const sandbox = { z, CompactionEngine: class {}, SessionSeq: value => value, deepFreeze: Object.freeze, toolPairingBalancedBefore: () => true, assertNever: () => { throw new Error('Unexpected trigger'); } };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(fixture, '@deepseek-ai/dsh-compaction-basic/lib/index.js'), 'utf8');
  vm.runInContext(source.replace(/^import .*;$/gm, '').replace(/^export .*;$/gm, '') + '\nthis.native = { resolveConfig, resolveTargetPolicy, resolveCompactSpec, BasicCompactionEngine };', sandbox);
  return sandbox.native;
}
test('patched native pressure method triggers at exact token count, including non-round limits', async () => {
  const native = nativeRuntime(), config = native.resolveConfig({});
  for (const input of [128_000, 128_001, 256_000, 262_144]) for (const delta of [-1, 0]) {
    let calls = 0, measured = input + delta;
    const session = { seq: 4, surface: { nodes: [0, 1, 2, 3] }, eventAt: seq => ({ seq, type: seq === 0 ? 'system/message' : 'user/message', data: {} }), requestHeader: () => ({ config: { ...target, maxTokens: 500_000 } }) };
    const engine = {
      config,
      ctx: {
        tokenMeter: { measure: () => ({ totalTokens: measured, nodes: [0, 1, 2, 3].map(seq => ({ seq, tokens: 100_000 })) }) },
        llm: { resolveModelInfo: async () => model },
        get: key => key === 'contextAutoThreshold' ? { compactionInputs: async policy => {
          const budget = tokenBudget(policy, model, input);
          return { policy: { ...policy, thresholdRatio: 1 }, inputTokens: budget.inputTokens, reservedCompletionTokens: budget.outputTokens };
        } } : undefined,
      },
      compactRegion: async (start, end) => { calls++; assert.equal(start, 1); assert.ok(end >= start); measured = 20_000; return {}; },
    };
    await native.BasicCompactionEngine.prototype.compactIfNeeded.call(engine, { session }, 'pressure', new AbortController().signal);
    assert.equal(calls, delta === 0 ? 1 : 0, `input=${input},delta=${delta}`);
  }
});
function serviceFixture() {
  let values = {}, revision = 1;
  const events = {}, calls = [], tools = [];
  const ctx = {
    reflect: { provide() {} }, logger: { warn() {} },
    on: (name, fn) => { events[name] = fn; }, effect: fn => fn(),
    get: key => key === 'compaction' ? { config: basePolicy } : undefined,
    tools: { register: tool => { tools.push(tool); return () => {}; } },
    sessionController: { resolveAgent: async () => ({ agent: { id: 'session-1' } }) },
    llm: { resolveModelInfo: async () => model },
    settings: {
      writable: true,
      describe: () => [{ ns: 'context-auto-threshold', revision, value: { modelInputTokens: values } }],
      mutate: async (ns, ops, expected) => {
        if (expected !== revision) throw new SettingsConflictError(ns, expected, revision);
        calls.push({ ns, ops, expected });
        for (const op of ops) { if (op.op === 'set') values[op.path[1]] = op.value; else delete values[op.path[1]]; }
        revision++;
      },
    },
  };
  const service = new ContextAutoThreshold(ctx, { modelInputTokens: { get: () => values } });
  return { service, events, calls, tools };
}
test('popup and agent share validation, persistence, exact-model isolation and revision checks', async () => {
  const { service, calls } = serviceFixture(), request = { sessionId: 'session-1', ...target };
  const saved = await service.operate({ ...request, action: 'set', inputTokens: 128_000, expectedRevision: 1 });
  assert.equal(saved.budget.inputTokens, 128_000); assert.equal(saved.budget.outputTokens, 306_464);
  assert.deepEqual(calls[0].ops, [settingsOperation(target, 128_000)]);
  await assert.rejects(service.operate({ ...request, action: 'set', inputTokens: 128_001, expectedRevision: 1 }), error => remoteErrorOf(error)?.code === 'context-auto/settings-conflict' && error.details.actual === 2);
  await assert.rejects(service.operate({ ...request, action: 'set', inputTokens: 999_999 }), /between/);
  const other = await service.operate({ ...request, model: 'other', action: 'read' });
  assert.equal(other.budget.requestedInput, null);
  const reset = await service.operate({ ...request, action: 'reset' });
  assert.equal(reset.budget.requestedInput, null);
});

test('missing advertised model output uses the configured bound and reports its source', async () => {
  const { service } = serviceFixture();
  service.ctx.llm.resolveModelInfo = async () => ({ ...model, defaultMaxTokens: undefined });
  const describe = service.ctx.settings.describe;
  service.ctx.settings.describe = () => [...describe(), { ns: 'llm-config', value: { providers: { [target.provider]: { defaultMaxTokens: 32_768, models: [{ id: target.model }] } } } }];
  service.ctx.llm.discoverModels = async () => [{ id: target.model }];
  const fallback = await service.resolveModel(target);
  assert.equal(fallback.defaultMaxTokens, 32_768);
  assert.equal(fallback.outputLimitSource, 'configured-default');
  service.modelCache.clear();
  service.ctx.llm.discoverModels = async () => [{ id: target.model, maxTokens: 131_072 }];
  const advertised = await service.resolveModel(target);
  assert.equal(advertised.defaultMaxTokens, 131_072);
  assert.equal(advertised.outputLimitSource, 'provider');
});
test('published input ceiling is shared by popup, writes and native compaction', async () => {
  const { service } = serviceFixture();
  service.ctx.llm.resolveModelInfo = async () => ({ ...target, context: { contextWindow: 1_050_000 }, defaultMaxTokens: 128_000 });
  service.config.modelInputCaps = { get: () => ({ [routeKey(target)]: 922_000 }) };
  const request = { sessionId: 'session-1', ...target };
  const read = await service.operate({ ...request, action: 'read' });
  assert.equal(read.budget.contextWindow, 1_050_000);
  assert.equal(read.budget.maxInputTokens, 922_000);
  assert.equal(read.budget.outputTokens, 128_000);
  await assert.rejects(service.operate({ ...request, action: 'set', inputTokens: 922_001 }), /between/);
  const saved = await service.operate({ ...request, action: 'set', inputTokens: 922_000 });
  const compact = await service.compactionInputs(basePolicy, { context: { contextWindow: 1_050_000 } }, target);
  assert.equal(compact.inputTokens, saved.budget.inputTokens);
  assert.equal(compact.reservedCompletionTokens, saved.budget.outputTokens);
  assert.equal(saved.budget.outputTokens, 62_464);
  const other = await service.operate({ ...request, model: 'other', action: 'read' });
  assert.equal(other.budget.maxInputTokens, 984_463);
});

test('million-token metadata replaces fallback in native and popup budgets', async () => {
  for (const [contextWindow, defaultMaxTokens] of [[1_000_000, 393_216], [1_000_000, 131_072], [1_048_576, 65_536]]) {
    const { service } = serviceFixture();
    const capacity = { ...target, context: { contextWindow }, defaultMaxTokens };
    service.ctx.llm.resolveModelInfo = async () => capacity;
    const read = await service.operate({ sessionId: 'session-1', ...target, action: 'read' });
    const compact = await service.compactionInputs(basePolicy, capacity, target);
    assert.equal(read.budget.contextWindow, contextWindow);
    assert.equal(read.budget.outputTokens, defaultMaxTokens);
    assert.equal(compact.inputTokens, read.budget.inputTokens);
    assert.equal(compact.reservedCompletionTokens, defaultMaxTokens);
    assert.equal(read.budget.requestedInput, null);
  }
});

test('real agent request middleware defaults output to MAX without changing frozen proposal', async () => {
  const { service, events } = serviceFixture();
  await service.operate({ action: 'set', sessionId: 'session-1', ...target, inputTokens: 128_000 });
  const proposal = Object.freeze({ ...target, maxTokens: 10_000, reasoningEffort: 'high' });
  let nextCalls = 0;
  const result = await events['agent/request']({ agent: { id: 'session-1' }, signal: new AbortController().signal }, async () => { nextCalls++; return proposal; });
  assert.equal(nextCalls, 1); assert.equal(result.maxTokens, 306_464); assert.equal(result.reasoningEffort, 'high'); assert.equal(proposal.maxTokens, 10_000);
});
test('Gateway source mode exposes only the shared token operation with JSON request and cancellation', () => {
  const { service } = serviceFixture(), markers = remoteMethods(service);
  assert.equal(markers.length, 1); assert.equal(markers[0].method, 'operate');
  const descriptor = TypertGatewayService.prototype.srcDescriptor.call({ ctx: { typert: { lookups: { definitions: () => [] } } } }, { service, namespace: 'contextAutoThreshold', serviceKey: 'contextAutoThreshold' }, markers[0], 'operate', 'contextAutoThreshold/operate');
  assert.equal(descriptor.parameters[0].wire, 'request');
  assert.equal(descriptor.cancellation.parameter, 'signal');
});

test('popup slider saves token counts, updates MAX preview, rejects invalid input and ignores stale model responses', async () => {
  let module, component, cursor = 0, effects = [], route = target, values = {}, revision = 1, delayed;
  const hooks = [], calls = [], same = (a, b) => a?.length === b?.length && a.every((value, i) => value === b[i]);
  const React = {
    Fragment: 'fragment', createElement: (type, props, ...children) => typeof type === 'function' ? type(props) : { type, props: props ?? {}, children: children.flat(Infinity) },
    useState(initial) { const i = cursor++; hooks[i] ??= { value: initial }; return [hooks[i].value, value => { hooks[i].value = value; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; }, useId() { return 'id-' + cursor++; },
    useCallback(fn, deps) { const i = cursor++; if (!same(hooks[i]?.deps, deps)) hooks[i] = { deps, fn }; return hooks[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!same(hooks[i]?.deps, deps)) { const previous = hooks[i]; hooks[i] = { deps }; effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  const reply = request => ({ target: request, budget: tokenBudget(basePolicy, model, values[routeKey(request)]), revision, writable: true, nativeAutoEnabled: true });
  const fetch = async (_url, init) => {
    const request = JSON.parse(init.body).payload.args.request;
    let value;
    if (request.action === 'read' && delayed) value = await delayed;
    else {
      if (request.action !== 'read') {
        calls.push(request);
        if (request.expectedRevision !== revision) return { ok: true, json: async () => ({ result: { ok: false, error: { code: 'context-auto/settings-conflict', message: 'Settings changed elsewhere.' } } }) };
        values[routeKey(request)] = request.inputTokens; revision++;
      }
      value = reply(request);
    }
    return { ok: true, json: async () => ({ result: { ok: true, value } }) };
  };
  vm.runInNewContext(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: value => { module = value; } } }, fetch, URL, crypto: { randomUUID: () => 'test-id' }, document: { baseURI: 'https://dsh.example/' } });
  module.factory(() => React).apply({ locale: { register: () => () => {}, bind: () => (key, params) => key + (params ? JSON.stringify(params) : '') }, effect: fn => fn(), slots: { inject: (_name, fn) => fn(), register: (options, entry) => { assert.equal(options.name, 'conversation.context.controls'); component = entry; return () => {}; } } });
  const render = () => { cursor = 0; const tree = component({ useProjection: () => ({ next: route }), sessionId: 'session-1' }); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree; };
  const walk = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(walk)];
  const input = (tree, type) => walk(tree).find(node => node.type === 'input' && node.props.type === type);
  const button = (tree, text) => walk(tree).find(node => node.type === 'button' && node.children.includes(text));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  render(); await flush(); let tree = render();
  input(tree, 'range').props.onChange({ target: { value: '128000' } }); assert.equal(calls.length, 0);
  tree = render(); assert.equal(input(tree, 'number').props.value, '128000');
  assert.ok(walk(tree).some(node => node.type === 'p' && node.children.some(text => typeof text === 'string' && text.startsWith('outputHint') && /306.?464/.test(text))));
  button(tree, 'save').props.onClick(); await flush(); tree = render();
  assert.equal(calls[0].inputTokens, 128_000); assert.ok(walk(tree).some(node => node.props.role === 'status' && node.children.includes('saved')));
  revision++; values[routeKey(target)] = 200_000;
  input(tree, 'number').props.onChange({ target: { value: '256000' } }); tree = render();
  button(tree, 'save').props.onClick(); await flush(); tree = render();
  assert.equal(input(tree, 'number').props.value, '200000');
  assert.ok(walk(tree).some(node => node.props.role === 'alert' && node.children.includes('conflict')));
  assert.equal(values[routeKey(target)], 200_000);
  input(tree, 'number').props.onChange({ target: { value: '-1' } }); tree = render(); assert.equal(button(tree, 'save').props.disabled, true);
  let release; delayed = new Promise(resolve => { release = resolve; });
  route = { ...target, model: 'old-model' }; render(); delayed = undefined;
  route = { ...target, model: 'new-model' }; render(); await flush();
  release(reply({ ...target, model: 'old-model' })); await flush(); tree = render();
  assert.equal(input(tree, 'number').props.value, '12484');
  assert.ok(walk(tree).some(node => node.type === 'p' && node.children.some(text => typeof text === 'string' && text.includes('new-model'))));
});
