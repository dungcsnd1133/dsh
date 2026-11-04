import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// rc.5 accepts only explicit OpenAI/Anthropic protocol overrides. The built-in
// Google provider supplies its native protocol when no override is present.
const rootAt = process.argv.indexOf('--root');
const profileAt = process.argv.indexOf('--profile');
if (rootAt < 0 || profileAt < 0) throw new Error('Pass --root <runtime node_modules> --profile <cordis.patch.yml>');
const root = path.resolve(process.argv[rootAt + 1]);
const file = path.resolve(process.argv[profileAt + 1]);
const require = createRequire(path.join(root, '@deepseek-ai/dsh-llm-pi-ai/package.json'));
const yaml = require('yaml');
const adapterDir = path.join(root, '@deepseek-ai/dsh-llm-pi-ai');
const manifest = JSON.parse(fs.readFileSync(path.join(adapterDir, 'package.json'), 'utf8'));
if (manifest.version !== '0.2.1-rc.5') throw new Error('Unsupported adapter version');
const { Config, supportedProtocols } = await import(pathToFileURL(path.join(adapterDir, 'lib/index.js')).href);
const original = fs.readFileSync(file, 'utf8');
const document = yaml.parseDocument(original);
if (document.errors.length) throw new Error('Profile YAML is invalid');
const rows = document.toJS();
const index = rows.findIndex(row => row.id === 'llm-pi-ai');
if (index < 0) throw new Error('Missing llm-pi-ai entry');
const config = rows[index].config;
const google = config?.providers?.google;
if (!google) throw new Error('Missing Google provider; no changes made');
if (google.api !== undefined && google.api !== 'google-generative-ai') throw new Error('Unexpected Google protocol; no changes made');
const changed = google.api === 'google-generative-ai' && !supportedProtocols().includes(google.api);
if (changed) {
  delete google.api;
  document.deleteIn([index, 'config', 'providers', 'google', 'api']);
}
// Validate every route before touching the saved profile. Do not log config or
// credentials, and preserve the native Google auth and all model definitions.
Config(config);
if (changed && process.argv.includes('--apply')) {
  if (fs.readFileSync(file, 'utf8') !== original) throw new Error('Profile changed during repair');
  const backup = file + '.before-google-api-repair';
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  const temporary = file + '.google-api-repair.tmp';
  fs.writeFileSync(temporary, document.toString(), { mode: fs.statSync(file).mode });
  fs.renameSync(temporary, file);
}
console.log(JSON.stringify({ repair: 'google-native-protocol', valid: true, changed,
  applied: process.argv.includes('--apply'), providers: Object.keys(config.providers) }));
