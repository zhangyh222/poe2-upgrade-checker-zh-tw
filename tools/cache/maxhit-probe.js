'use strict';
// dev probe: what PoB's own max-hit breakdown looks like through our sources command
const path = require('path');
const { createEngine } = require('../../src/pobengine');

const eng = createEngine({ log: () => {}, appPath: path.join(__dirname, '..', '..'), packaged: false });
const XML = '<?xml version="1.0" encoding="UTF-8"?><PathOfBuilding2><Build level="90" className="Sorceress" ascendClassName="None" mainSocketGroup="1"/></PathOfBuilding2>';

(async () => {
  await eng.loadBuild(XML);
  for (const stat of ['PhysicalMaximumHitTaken', 'FireMaximumHitTaken']) {
    const r = await eng.send({ cmd: 'sources', stat }, 60000);
    console.log('=== ' + stat + ' ===');
    console.log(JSON.stringify(r, null, 1).slice(0, 4000));
  }
  eng.kill();
  process.exit(0);
})().catch((e) => { console.error('FAILED', e); eng.kill(); process.exit(1); });
