import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Coordinates are relative to the layout viewport, including the visible
// viewport offset Safari reports while its keyboard is open.
export function menuLayout(rect, menu, viewport, compact) {
  const margin = 12;
  const maxWidth = Math.max(0, Math.min(420, viewport.width - margin * 2));
  const maxHeight = Math.max(0, Math.min(360, viewport.height - margin * 2));
  const width = compact ? Math.min(420, maxWidth) : Math.min(menu.width, maxWidth);
  const height = Math.min(menu.height, maxHeight);
  const left = Math.max(viewport.left + margin,
    Math.min(rect.right - width, viewport.left + viewport.width - width - margin));
  const top = Math.max(viewport.top + margin,
    Math.min(rect.top - height - 8, viewport.top + viewport.height - height - margin));
  return { left, top, maxWidth, maxHeight, minWidth: Math.min(240, maxWidth),
    ...(compact ? { width } : {}) };
}

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Model menu patch anchor changed: ' + before.slice(0, 65));
  return source.replace(before, after);
}

export function patchSource(source) {
  let next = replaceOnce(source, 'function ModelSelect({ locked, available, directory, load, select, t, renderSlot }) {',
    menuLayout.toString().replace('function menuLayout(', 'function dshModelMenuLayout(') +
    '\nfunction ModelSelect({ locked, available, directory, load, select, t, renderSlot }) {');
  next = replaceOnce(next, 'if (pane === "model" && showSearch) {\n\t\t\t\t\t\tsearchRef.current?.focus();',
    'if (pane === "model" && showSearch && !window.matchMedia("(pointer: coarse), (max-width: 640px)").matches) {\n\t\t\t\t\t\tsearchRef.current?.focus();');
  const start = next.indexOf('\t\t\t\t\tconst MARGIN = 12;', next.indexOf('function ModelSelect('));
  const endAnchor = '\n\t\t\t\t};\n\t\t\t\tplace();';
  const end = next.indexOf(endAnchor, start);
  if (start < 0 || end < 0) throw new Error('Missing placement block');
  next = next.slice(0, start) + `const viewport = window.visualViewport;
      setMenuPos(dshModelMenuLayout(rect, {
        width: menuRef.current?.offsetWidth ?? 0,
        height: menuRef.current?.offsetHeight ?? 0
      }, {
        left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight
      }, window.matchMedia("(pointer: coarse), (max-width: 640px)").matches));` + next.slice(end);
  next = replaceOnce(next, 'window.addEventListener("resize", place);\n\t\t\t\tconst menu = menuRef.current;',
    'window.addEventListener("resize", place);\n\t\t\t\tconst visualViewport = window.visualViewport;\n\t\t\t\tvisualViewport?.addEventListener("resize", place);\n\t\t\t\tvisualViewport?.addEventListener("scroll", place);\n\t\t\t\tconst menu = menuRef.current;');
  next = replaceOnce(next, 'window.removeEventListener("resize", place);\n\t\t\t\t};',
    'window.removeEventListener("resize", place);\n\t\t\t\t\tvisualViewport?.removeEventListener("resize", place);\n\t\t\t\t\tvisualViewport?.removeEventListener("scroll", place);\n\t\t\t\t};');
  // Keep the native design tokens and enlarge touch targets; 16px prevents
  // Safari from zooming the entire page when search is explicitly tapped.
  const mobileCSS = '@media(pointer:coarse),(max-width:640px){._7KE1Ra_menu ._7KE1Ra_search input{font-size:16px}._7KE1Ra_menu ._7KE1Ra_option,._7KE1Ra_menu ._7KE1Ra_cell{min-height:44px;height:auto}}';
  next = replaceOnce(next, 'const css = "._7KE1Ra_root', 'const css = "' + mobileCSS + '._7KE1Ra_root');
  return next;
}

export function plan(root) {
  const dir = path.join(root, '@deepseek-ai/dsh-client-ui-model-selection');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (manifest.version !== '0.2.1-rc.5') throw new Error('Unsupported model picker version: ' + manifest.version);
  const file = path.join(dir, 'lib/client.js');
  const backup = file + '.before-mobile-model-menu';
  const current = fs.readFileSync(file, 'utf8');
  const original = fs.existsSync(backup) ? fs.readFileSync(backup, 'utf8') : current;
  const originalHash = crypto.createHash('sha256').update(original).digest('hex');
  if (originalHash !== EXPECTED_HASH) throw new Error('Unknown model picker bytes; refusing to overwrite');
  const next = patchSource(original);
  const currentHash = crypto.createHash('sha256').update(current).digest('hex');
  const initialHotPatch = '200af6ce304ad3306411c8b77405235d1d8e9b1d15608bec591eb4676cdff39b';
  if (current !== original && current !== next && currentHash !== initialHotPatch) throw new Error('Concurrent model picker change');
  return { file, backup, current, original, next };
}

const EXPECTED_HASH = '18f6e74e203d50f66c8e30552d52e070d06941514cb0e72b149683c092a3ba2a';
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.argv[process.argv.indexOf('--root') + 1];
  if (!process.argv.includes('--root') || !root) throw new Error('Pass --root <runtime node_modules>');
  const change = plan(root);
  if (process.argv.includes('--apply') && change.current !== change.next) {
    if (!fs.existsSync(change.backup)) fs.writeFileSync(change.backup, change.original, { flag: 'wx' });
    const staged = change.file + '.mobile.tmp';
    fs.writeFileSync(staged, change.next);
    fs.renameSync(staged, change.file);
  }
  console.log(JSON.stringify({ patch: 'mobile-model-menu', changed: change.current !== change.next, applied: process.argv.includes('--apply') }));
}
