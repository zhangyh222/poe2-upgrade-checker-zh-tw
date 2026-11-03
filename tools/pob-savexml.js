#!/usr/bin/env node
'use strict';
// The build round-trips through Path of Building's own save: load -> savexml ->
// load the saved XML -> same numbers. Path of Building's SaveDB needs a build with
// skill groups (it walks each tab's lists), so this needs a real build:
//
//   POB_BUILD=F:\testbd.txt node tools/pob-savexml.js      (an export code or XML file)
//   node tools/pob-savexml.js                              (skips: none given)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('../src/pobengine');
const pob = require('../src/core/pob');

const file = process.env.POB_BUILD;
if (!file) {
  console.log('skipped: set POB_BUILD to a Path of Building export (code or XML) to run the round trip.');
  process.exit(0);
}
const raw = fs.readFileSync(file, 'utf8').trim();
const xml = raw.startsWith('<') ? raw : pob.decodeCode(raw);
const eng = createEngine({ log: (m) => console.log(m), appPath: path.join(__dirname, '..'), packaged: false });
const stats = (s) => ({ life: s.stats.Life, es: s.stats.EnergyShield, ehp: s.stats.TotalEHP, dps: s.stats.FullDPS || s.stats.CombinedDPS || s.stats.TotalDPS });

(async () => {
  if (!eng.available()) throw new Error('engine files missing (run node tools/get-pob.js first)');
  const loaded = await eng.loadBuild(xml, []);
  assert.ok(loaded && loaded.ok, 'the build should load');
  const before = stats(await eng.sheet());
  const sheet = await eng.sheet();
  assert.ok(sheet.skills.length > 0, 'the build should have skills for the round trip to mean anything');

  const saved = await eng.send({ cmd: 'savexml' }, 120000);
  assert.ok(saved && saved.ok, 'save failed: ' + (saved && saved.error));
  assert.match(saved.xml, /<PathOfBuilding2/, 'the export should be a PoB2 build');
  console.log(`exported ${saved.xml.length} chars, ${(saved.xml.match(/<Skill\b/g) || []).length} skill groups, ${(saved.xml.match(/set1="/g) || []).length} set attributes`);

  await eng.loadBuild(saved.xml, []);
  const after = stats(await eng.sheet());
  assert.deepEqual(after, before, 'the exported build should calculate the same');
  console.log(`round trip OK (PoB ${eng.version()}): ${JSON.stringify(before)}`);
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => eng.kill());
