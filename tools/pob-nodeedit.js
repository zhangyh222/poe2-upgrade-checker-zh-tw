#!/usr/bin/env node
'use strict';
// Allocate then deallocate one passive node against a real build, and check the
// tree really went back:
//
//   POB_BUILD=F:\poe-assistant\test-builds\caster.txt node tools/pob-nodeedit.js
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('../src/pobengine');
const pob = require('../src/core/pob');

const file = process.env.POB_BUILD;
if (!file) {
  console.log('skipped: set POB_BUILD to a Path of Building export (code or XML).');
  process.exit(0);
}
const raw = fs.readFileSync(file, 'utf8').trim();
const xml = raw.startsWith('<') ? raw : pob.decodeCode(raw);
const eng = createEngine({ log: (m) => console.log(m), appPath: path.join(__dirname, '..'), packaged: false });

const allocatedCount = (tree) => (tree.nodes || []).filter((n) => n[4] & 8).length;

(async () => {
  if (!eng.available()) throw new Error('engine files missing (run node tools/get-pob.js first)');
  await eng.loadBuild(xml, []);
  const before = await eng.send({ cmd: 'passivetree' }, 120000);
  const base = allocatedCount(before);
  console.log('allocated before:', base);

  // a node next to something already allocated, so allocation is a legal step
  const allocatedIds = new Set((before.nodes || []).filter((n) => n[4] & 8).map((n) => n[0]));
  let target = null;
  for (const [a, b] of before.edges || []) {
    if (allocatedIds.has(a) && !allocatedIds.has(b)) { target = b; break; }
    if (allocatedIds.has(b) && !allocatedIds.has(a)) { target = a; break; }
  }
  if (!target) throw new Error('no unallocated neighbour to try');

  const added = await eng.send({ cmd: 'allocatenodes', nodes: [target] }, 120000);
  if (!added || !added.ok) throw new Error('allocate failed: ' + ((added && added.error) || 'unknown'));
  const afterAdd = await eng.send({ cmd: 'passivetree' }, 120000);
  const n1 = allocatedCount(afterAdd);
  console.log('allocated after adding', target, ':', n1, '(added', added.added, ')');

  const removed = await eng.send({ cmd: 'deallocatenodes', nodes: [target] }, 120000);
  if (!removed || !removed.ok) throw new Error('deallocate failed: ' + ((removed && removed.error) || 'unknown'));
  const afterRemove = await eng.send({ cmd: 'passivetree' }, 120000);
  const n2 = allocatedCount(afterRemove);
  console.log('allocated after removing', target, ':', n2, '(removed', removed.removed, ')');

  const ok = n1 === base + 1 && n2 === base;
  console.log(ok ? 'OK: allocate and deallocate both move the tree back to where it started' : 'FAIL: the tree did not return to its starting size');
  eng.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
