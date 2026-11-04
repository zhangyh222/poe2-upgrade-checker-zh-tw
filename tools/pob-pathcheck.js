#!/usr/bin/env node
'use strict';
// Passive-path validation against a real tree and a real build:
//
//   POB_BUILD=F:\poe-assistant\test-builds\caster.txt node tools/pob-pathcheck.js
//
// The walk Path of Building traces to an unallocated notable must come back "ok",
// and the same walk with one node removed must come back "invalid" (it skips a node).
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('../src/pobengine');
const { validatePath } = require('../src/core/passive-path');
const pob = require('../src/core/pob');

const file = process.env.POB_BUILD;
if (!file) {
  console.log('skipped: set POB_BUILD to a Path of Building export (code or XML) to check a real tree.');
  process.exit(0);
}
const raw = fs.readFileSync(file, 'utf8').trim();
const xml = raw.startsWith('<') ? raw : pob.decodeCode(raw);
const eng = createEngine({ log: (m) => console.log(m), appPath: path.join(__dirname, '..'), packaged: false });

(async () => {
  if (!eng.available()) throw new Error('engine files missing (run node tools/get-pob.js first)');
  const info = await eng.loadBuild(xml, []);
  const tree = await eng.send({ cmd: 'passivetree' }, 120000);
  if (!tree || !tree.ok) throw new Error('no passive tree');

  const allocated = (tree.nodes || []).filter((n) => n[4] & 8).length;
  console.log('allocated nodes in this build:', allocated, '| tree nodes:', (tree.nodes || []).length);

  // a notable that is not allocated yet and is still reachable: tracing it gives a
  // walk with a real cost. Some notables sit behind a jewel or another class and
  // trace nothing, so try a few instead of trusting the first one.
  const candidates = (tree.nodes || []).filter((n) => (n[4] & 1) && !(n[4] & 8)).slice(0, 60);
  console.log('build ascendancy:', JSON.stringify(info.ascendancy || ''));
  let legal = null; let flagged = null;
  for (const n of candidates) {
    const w = await eng.nodePath(n[0]);
    const p = (w && w.ok && w.path) || [];
    if (!p.length) continue;
    const ids = p.map((x) => x.id);
    const v = validatePath({ tree, path: ids, ascendancy: info.ascendancy || '' });
    if (v.status === 'ok' && !legal) {
      legal = { name: n[3], ids, v };
      console.log('legal walk |', JSON.stringify(n[3]), '| points', ids.length, '| status', v.status);
    }
    if (v.status !== 'ok' && !flagged) {
      flagged = { name: n[3], ids, v };
      console.log('flagged walk |', JSON.stringify(n[3]), '| points', ids.length, '| status', v.status, JSON.stringify(v.reasons));
      const skip = ids.filter((_, i) => i !== Math.floor(ids.length / 2));
      const bad = validatePath({ tree, path: skip, ascendancy: info.ascendancy || '' });
      console.log('  same walk with one node removed | status', bad.status, JSON.stringify(bad.reasons));
    }
    if (legal && flagged) break;
  }
  if (!legal) console.log('note: no legal walk among the first', candidates.length, 'notables (build may have no room left)');

  const empty = validatePath({ tree, path: [] });
  console.log('empty route | status', empty.status, JSON.stringify(empty.reasons));

  eng.stop();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
