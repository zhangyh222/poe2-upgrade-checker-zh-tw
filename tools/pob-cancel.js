#!/usr/bin/env node
'use strict';
// Cancelling a running calculation kills the engine, because Path of Building's Lua
// cannot be interrupted. This checks the two things that follow: the work rejects,
// and the next request still gets a correct answer from a fresh engine.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createEngine } = require('../src/pobengine');

const eng = createEngine({ log: (m) => console.log(m), appPath: path.join(__dirname, '..'), packaged: false });
const XML = '<?xml version="1.0" encoding="UTF-8"?><PathOfBuilding2><Build level="90" className="Sorceress" ascendClassName="None" mainSocketGroup="1"/></PathOfBuilding2>';
// enough work that the cancel lands while it is still running
const many = Array.from({ length: 2000 }, () => ({ xml: XML, overrides: [], weaponSet: 1 }));

(async () => {
  if (!eng.available()) throw new Error('engine files missing (run node tools/get-pob.js first)');
  await eng.loadBuild(XML, []);
  const before = (await eng.sheet()).stats.Life;

  const controller = new AbortController();
  const trial = eng.trialDocuments(many, { signal: controller.signal });
  await new Promise((r) => setTimeout(r, 120)); // let it get started
  controller.abort();
  eng.stop(); // what the app does when the user presses cancel
  const outcome = await trial.then(() => 'finished', (err) => err.name || err.message || 'failed');
  console.log('trial outcome:', outcome);
  assert.notEqual(outcome, 'finished', 'the cancelled trial must not report a result');

  // the next request must not inherit anything from the cancelled run
  await eng.loadBuild(XML, []);
  const after = (await eng.sheet()).stats.Life;
  assert.equal(after, before, 'a fresh engine should calculate the same build again');
  console.log(`cancel OK: engine stopped, next load is correct (Life ${before} -> ${after})`);
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => eng.kill());
