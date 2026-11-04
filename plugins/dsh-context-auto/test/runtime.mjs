import { createRequire } from 'node:module';
import path from 'node:path';
const local = createRequire(import.meta.url);
export const runtime = createRequire(process.env.DSH_TEST_RUNTIME_PACKAGE
  ? path.resolve(process.env.DSH_TEST_RUNTIME_PACKAGE)
  : local.resolve('@deepseek-ai/dsh/package.json'));
export const nativePackageRoot = name => process.env.DSH_TEST_NATIVE_ROOT
  ? path.join(process.env.DSH_TEST_NATIVE_ROOT, ...name.split('/'))
  : path.dirname(runtime.resolve(name + '/package.json'));
