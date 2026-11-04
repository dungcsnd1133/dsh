import { pathToFileURL } from 'node:url';
import { runtime } from './runtime.mjs';
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@deepseek-ai/')) return nextResolve(pathToFileURL(runtime.resolve(specifier)).href, context);
  return nextResolve(specifier, context);
}
