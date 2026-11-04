import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { menuLayout, patchSource, plan } from './patch-client.mjs';

test('phone menu fits above composer and exposes full width', () => {
  const result = menuLayout({right:330,top:710}, {width:248,height:360}, {left:0,top:0,width:390,height:844}, true);
  assert.equal(result.width, 366);
  assert.equal(result.left, 12);
  assert.ok(result.top + 360 < 710);
});

test('keyboard and Safari panning keep every menu edge in visible viewport', () => {
  for (const viewport of [
    {left:0,top:0,width:390,height:350},
    {left:0,top:220,width:390,height:320},
    {left:15,top:100,width:320,height:220},
  ]) {
    const result = menuLayout({right:360,top:730}, {width:366,height:360}, viewport, true);
    assert.ok(result.left >= viewport.left + 12);
    assert.ok(result.top >= viewport.top + 12);
    assert.ok(result.left + result.width <= viewport.left + viewport.width - 12);
    assert.ok(result.top + result.maxHeight <= viewport.top + viewport.height - 12);
    assert.ok(result.maxHeight > 100);
  }
});

test('desktop keeps natural menu width and anchor placement', () => {
  const result = menuLayout({right:900,top:600}, {width:248,height:360}, {left:0,top:0,width:1280,height:800}, false);
  assert.equal(result.left, 652);
  assert.equal(result.top, 232);
  assert.equal(result.width, undefined);
  assert.equal(result.maxWidth, 420);
});

const fixturePath = process.env.DSH_MODEL_MENU_FIXTURE;
test('exact shipped bundle parses, reapplication is unchanged and unknown edits are refused', {skip:!fixturePath}, () => {
  const source = fs.readFileSync(fixturePath, 'utf8');
  const patched = patchSource(source);
  new vm.Script(patched);
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'dsh-menu-'));
  const dir = path.join(root,'@deepseek-ai/dsh-client-ui-model-selection');
  fs.mkdirSync(path.join(dir,'lib'),{recursive:true});
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({version:'0.2.1-rc.5'}));
  const file = path.join(dir,'lib/client.js');
  fs.writeFileSync(file,source);
  const first = plan(root);
  assert.equal(first.next,patched);
  fs.writeFileSync(first.backup,source);
  fs.writeFileSync(file,patched);
  assert.equal(plan(root).current,plan(root).next);
  fs.appendFileSync(file,'\n// unexpected change');
  assert.throws(()=>plan(root),/Concurrent/);
});
