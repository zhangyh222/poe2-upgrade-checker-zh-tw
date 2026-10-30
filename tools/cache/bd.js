const fs = require('fs');
const path = require('path');
const { createEngine } = require('../../src/pobengine');
(async () => {
  const xml = fs.readFileSync(path.join(process.env.APPDATA, 'poe2-upgrade-checker', 'pob', 'main.xml'), 'utf8');
  const eng = createEngine({ log: (m) => console.error(m), appPath: path.join(__dirname, '..', '..'), packaged: false });
  await eng.loadBuild(xml);
  const out = await eng.send({ cmd: 'dbgbreakdown' }, 60000);
  console.log('hasEnv', out.hasEnv, 'hasCalcsEnv', out.hasCalcsEnv);
  for (const k of ['FireResist','Life','Armour','EnergyShield','TotalDPS']) {
    const e=(out.calcsPlayer||[]).find(x=>x.k===k);
    console.log('== '+k); console.log(e?JSON.stringify(e.sample,null,1):'missing');
  }
  console.log('source prefixes: ' + (out.prefixes||[]).join('  '));
  console.log('tree sources: ' + JSON.stringify(out.sampleSources||[]));
  console.log('damage/resist mods sample');
  console.log((Array.isArray(out.mods)?out.mods:[]).slice(0,40).map(m=>JSON.stringify(m)).join('\n'));
  eng.stop();
})();
