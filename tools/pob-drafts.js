#!/usr/bin/env node
'use strict';
// Trial several build documents in one real engine run, then show the active
// build was put back. Run with the bundled engine: node tools/pob-drafts.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { createEngine } = require('../src/pobengine');

const eng = createEngine({ log: (m) => console.log(m), appPath: path.join(__dirname, '..'), packaged: false });
const XML = '<?xml version="1.0" encoding="UTF-8"?><PathOfBuilding2><Build level="90" className="Sorceress" ascendClassName="None" mainSocketGroup="1"/></PathOfBuilding2>';
const SHIELD = 'Item Class: Shields\nRarity: Rare\nDraft Guard\nSplintered Tower Shield\n--------\nItem Level: 80\n--------\n+30% to Cold Resistance';

(async () => {
  if (!eng.available()) throw new Error('engine files missing (run node tools/get-pob.js first)');
  // the build the app is editing; the trials must leave it in place
  const base = await eng.loadBuild(XML, []);
  assert.ok(base && base.ok, 'the active build should load');
  const before = (await eng.sheet()).stats.ColdResistTotal;

  const trials = await eng.trialDocuments([
    { xml: XML, overrides: [], weaponSet: 1 },
    { xml: XML, overrides: [{ slot: 'Weapon 2 Swap', text: SHIELD }], weaponSet: 2 },
  ]);
  assert.equal(trials.length, 2);
  assert.equal(trials[0].sheet.weaponSwap, false);
  assert.equal(trials[1].sheet.weaponSwap, true, 'the second trial should be calculated on weapon set 2');
  assert.equal(trials[1].sheet.stats.ColdResistTotal - trials[0].sheet.stats.ColdResistTotal, 30);

  // nothing of the trials may leak into the build the app owns
  const restored = await eng.ensureLoaded();
  assert.ok(restored, 'the active build should be loaded again after the trials');
  const after = (await eng.sheet()).stats.ColdResistTotal;
  assert.equal(after, before);
  // the app had no explicit set preference before the trials (0 = follow the build)
  assert.equal(eng.weaponSet(), 0);
  assert.equal((await eng.sheet()).weaponSwap, false);
  console.log(`Draft trials OK: set1 ${trials[0].sheet.stats.ColdResistTotal}, set2 ${trials[1].sheet.stats.ColdResistTotal}, restored ${after} (PoB ${eng.version()})`);
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => eng.kill());
