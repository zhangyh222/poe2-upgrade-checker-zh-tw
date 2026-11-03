#!/usr/bin/env node
'use strict';
// Passive node search with path cost, against a real build:
//
//   POB_BUILD=F:\testbd.txt POB_QUERY="energy shield" node tools/pob-nodes.js
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('../src/pobengine');
const pob = require('../src/core/pob');

const file = process.env.POB_BUILD;
const query = process.env.POB_QUERY || 'energy shield';
if (!file) {
  console.log('skipped: set POB_BUILD to a Path of Building export (code or XML) to search a real tree.');
  process.exit(0);
}
const raw = fs.readFileSync(file, 'utf8').trim();
const xml = raw.startsWith('<') ? raw : pob.decodeCode(raw);
const eng = createEngine({ log: (m) => console.log(m), appPath: path.join(__dirname, '..'), packaged: false });

(async () => {
  if (!eng.available()) throw new Error('engine files missing (run node tools/get-pob.js first)');
  await eng.loadBuild(xml, []);
  const t0 = Date.now();
  const r = await eng.searchNodes(query, 10);
  if (!r || !r.ok) throw new Error('search failed: ' + (r && r.error));
  console.log(`"${query}": ${r.total} nodes in ${Date.now() - t0} ms`);
  for (const n of r.nodes) {
    console.log(`${n.allocated ? '*' : ' '} ${n.name} [${n.type}] set ${n.weaponSet} cost ${n.cost == null ? 'unreachable' : n.cost} — ${(n.stats[0] || '').slice(0, 60)}`);
  }
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => eng.kill());
