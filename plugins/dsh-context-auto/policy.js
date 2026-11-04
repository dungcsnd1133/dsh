export function validateTarget(target) {
  if (!target || !['provider', 'model'].every(key => typeof target[key] === 'string' && target[key].trim() && target[key].length <= 300)) throw new Error('Select a provider and model first.');
  return { provider: target.provider, model: target.model };
}
export function routeKey(target) {
  const { provider, model } = validateTarget(target);
  return JSON.stringify([provider, model]);
}
export function positiveTokens(value, label = 'Token limit') {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}
export function targetPolicy(config, target) {
  const override = config.modelPolicies?.find(row => row.provider === target.provider && row.model === target.model) ?? {};
  const policy = { ...config, ...override };
  if (override.retainTokens !== undefined) delete policy.retainRatio;
  else if (override.retainRatio !== undefined) delete policy.retainTokens;
  return policy;
}
// MAX output means the largest valid output allowance after the selected input
// budget and native headroom. No model capacity is enlarged.
export function tokenBudget(policy, model, requestedInput) {
  const contextWindow = positiveTokens(model.context?.contextWindow, 'Model context window');
  const modelMaxOutput = positiveTokens(model.defaultMaxTokens, 'Model output capacity');
  const headroomTokens = policy.headroomTokens;
  if (!Number.isSafeInteger(headroomTokens) || headroomTokens < 0) throw new Error('Invalid native compaction headroom.');
  const maxInputTokens = Math.min(contextWindow - headroomTokens - 1,
    model.context?.maxInputTokens === undefined ? Number.MAX_SAFE_INTEGER : positiveTokens(model.context.maxInputTokens, 'Model input capacity'));
  let minInputTokens;
  if (policy.retainTokens !== undefined) minInputTokens = positiveTokens(policy.retainTokens, 'Retained tail') + 1;
  else {
    const ratio = policy.retainRatio;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) throw new Error('Invalid native retained-tail ratio.');
    minInputTokens = Math.floor(Math.max(0, ratio * (contextWindow - modelMaxOutput), ratio * headroomTokens / (1 - ratio))) + 1;
  }
  if (minInputTokens > maxInputTokens) throw new Error('Model capacity cannot fit the native retained tail, output and compaction headroom.');
  // Preserve the model's full output allowance by default when it fits.
  // Explicit input preferences may trade output capacity for more input.
  const defaultOutputTokens = Math.min(modelMaxOutput, contextWindow - headroomTokens - minInputTokens);
  const defaultAvailableTokens = contextWindow - defaultOutputTokens;
  const defaultInputTokens = Math.max(minInputTokens, Math.min(maxInputTokens,
    defaultAvailableTokens - headroomTokens, Math.floor(defaultAvailableTokens * policy.thresholdRatio)));
  if (requestedInput !== undefined) positiveTokens(requestedInput, 'Input token limit');
  const inputTokens = Math.max(minInputTokens, Math.min(maxInputTokens, requestedInput ?? defaultInputTokens));
  const outputTokens = Math.min(modelMaxOutput, contextWindow - inputTokens - headroomTokens);
  return { contextWindow, modelMaxOutput, headroomTokens, minInputTokens, maxInputTokens, defaultInputTokens, inputTokens, outputTokens, requestedInput: requestedInput ?? null, adjusted: requestedInput !== undefined && inputTokens !== requestedInput, outputMode: 'max' };
}
export function settingsOperation(target, inputTokens) {
  const path = ['modelInputTokens', routeKey(target)];
  return inputTokens === null ? { op: 'unset', path } : { op: 'set', path, value: positiveTokens(inputTokens, 'Input token limit') };
}
