#!/usr/bin/env node
'use strict';
// Writes the item modifier pool with derived tiers (T1 = highest item level in its
// group) to a JSON file. The data comes from the pinned Path of Building, so it
// matches the engine's own numbers instead of a second source.
//
//   node tools/affix-tiers.js                        -> vendor/pob/affix-tiers-Item.json
//   node tools/affix-tiers.js Jewel                 -> ...-Jewel.json
//   node tools/affix-tiers.js Item "movement speed" -> only matching groups
//   node tools/affix-tiers.js Item "" out.json
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('../src/pobengine');

const kind = process.argv[2] || 'Item';
const filter = process.argv[3] || '';
const out = process.argv[4] || path.join(__dirname, '..', 'vendor', 'pob', `affix-tiers-${kind}${filter ? '-filtered' : ''}.json`);
const eng = createEngine({ log: (m) => console.log(m), appPath: path.join(__dirname, '..'), packaged: false });

(async () => {
  if (!eng.available()) throw new Error('engine files missing (run node tools/get-pob.js first)');
  const t0 = Date.now();
  const r = await eng.affixTiers(kind, filter);
  if (!r || !r.ok) throw new Error('tier export failed: ' + (r && r.error));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ kind: r.kind, count: r.count, groups: r.groups }, null, 1));
  const size = fs.statSync(out).size;
  const tiers = r.groups.reduce((n, g) => n + g.tiers.length, 0);
  console.log(`${r.kind}: ${r.count} groups, ${tiers} tiers -> ${out} (${Math.round(size / 1024)} KB, ${Date.now() - t0} ms)`);
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => eng.kill());
