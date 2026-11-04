import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const VERSION = '0.2.1-rc.5';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const PATCHES = [
  {
    name: '@deepseek-ai/dsh-client-ui-conversation', file: 'lib/client.js',
    hash: 'cfbd9fd95b0509f7c93a22a62a67ebc10481c8eda611704ea50c2e195b9a5a69',
    replacements: [
      ['function ContextMeter({ useProjection, t })', 'function ContextMeter({ useProjection, t, renderSlot, sessionId })'],
      ['children: [variant === "composer" && input !== void 0 && sessionId !== void 0 ? renderSlot("conversation.composer.dock", {}) : null, activity ? null : (0, react_jsx_runtime.jsx)(ContextMeter, {\n\t\t\t\t\t\t\tuseProjection,\n\t\t\t\t\t\t\tt', 'children: [variant === "composer" && input !== void 0 && sessionId !== void 0 ? renderSlot("conversation.composer.dock", {}) : null, activity ? null : (0, react_jsx_runtime.jsx)(ContextMeter, {\n\t\t\t\t\t\t\tuseProjection,\n\t\t\t\t\t\t\trenderSlot,\n\t\t\t\t\t\t\tsessionId,\n\t\t\t\t\t\t\tt'],
      ['\t\t\t\t\t\t})\n\t\t\t\t\t]\n\t\t\t\t}), document.body)]', '\t\t\t\t\t\t}),\n\t\t\t\t\t\trenderSlot("conversation.context.controls", { sessionId, contextWindow: context.contextWindow, usedTokens: context.usedTokens })\n\t\t\t\t\t]\n\t\t\t\t}), document.body)]'],
      ['\t\t\t\t\t"conversation.composer.dock": {', '\t\t\t\t\t"conversation.context.controls": {\n\t\t\t\t\t\tkind: "list",\n\t\t\t\t\t\tscope: "session"\n\t\t\t\t\t},\n\t\t\t\t\t"conversation.composer.dock": {'],
    ],
  },
  {
    name: '@deepseek-ai/dsh-compaction-basic', file: 'lib/index.js',
    hash: 'b7ac52f20a36430cf01a66b3a36f23a48ffdb22708d714dbe1fff541b5df4ec5',
    replacements: [[
      'const spec = resolveCompactSpec(policy, info.context.contextWindow, reservedCompletionTokens(agent, info.defaultMaxTokens));',
      'const budgetInputs = await this.ctx.get("contextAutoThreshold")?.compactionInputs(policy, info, target, signal);\n\t\tconst nativeSpec = resolveCompactSpec(budgetInputs?.policy ?? policy, info.context.contextWindow, budgetInputs?.reservedCompletionTokens ?? reservedCompletionTokens(agent, info.defaultMaxTokens));\n\t\tconst spec = budgetInputs === void 0 ? nativeSpec : deepFreeze({ ...nativeSpec, thresholdTokens: Math.min(nativeSpec.thresholdTokens, budgetInputs.inputTokens) });',
    ]],
  },
];

export function patchedSource(original, patch) {
  let value = original;
  for (const [before, after] of patch.replacements) {
    if (value.split(before).length !== 2) throw new Error(`Expected one exact anchor in ${patch.name}: ${before.slice(0, 70)}`);
    value = value.replace(before, after);
  }
  return value;
}

// Resolve and verify both files before writing either. Unknown versions or
// changes made by another task are refused. The package's original version is
// intentionally preserved and its exact unmodified bytes are backed up.
export function plan(root, restore = false) {
  return PATCHES.map(patch => {
    const dir = path.join(root, ...patch.name.split('/'));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (manifest.version !== VERSION) throw new Error(`Refusing ${patch.name}@${manifest.version}; expected ${VERSION}`);
    const file = path.join(dir, patch.file);
    const current = fs.readFileSync(file, 'utf8');
    const backup = file + '.before-context-auto';
    const original = fs.existsSync(backup) ? fs.readFileSync(backup, 'utf8') : current;
    if (sha(original) !== patch.hash) throw new Error(`Original source hash differs: ${patch.name}`);
    const modified = patchedSource(original, patch);
    if (current !== original && current !== modified) throw new Error(`Concurrent modification: ${patch.name}`);
    return { file, backup, original, current, next: restore ? original : modified, name: patch.name };
  });
}

export function applyPlan(changes) {
  const applied = [];
  try {
    for (const change of changes) {
      if (change.current === change.next) continue;
      if (!fs.existsSync(change.backup)) fs.writeFileSync(change.backup, change.original, { flag: 'wx' });
      fs.writeFileSync(change.file, change.next);
      applied.push(change);
    }
  } catch (error) {
    for (const change of applied.reverse()) fs.writeFileSync(change.file, change.current);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rootAt = process.argv.indexOf('--root');
  if (rootAt < 0 || !process.argv[rootAt + 1]) throw new Error('Pass --root <runtime node_modules>. Dry run by default; --apply writes; --restore --apply reverts.');
  const changes = plan(path.resolve(process.argv[rootAt + 1]), process.argv.includes('--restore'));
  if (process.argv.includes('--apply')) applyPlan(changes);
  console.log(JSON.stringify({ applied: process.argv.includes('--apply'), files: changes.map(row => ({ name: row.name, changed: row.current !== row.next })) }, null, 2));
}
