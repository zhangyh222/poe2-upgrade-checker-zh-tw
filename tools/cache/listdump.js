const fs = require('fs');
const path = require('path');
const { createEngine } = require('../../src/pobengine');
(async () => {
  const xml = fs.readFileSync(path.join(process.env.APPDATA, 'poe2-upgrade-checker', 'pob', 'main.xml'), 'utf8');
  const eng = createEngine({ log: () => {}, appPath: path.join(__dirname, '..', '..'), packaged: false });
  await eng.loadBuild(xml);
  const r = await eng.send({ cmd: 'listdump', names: ['Life', 'Armour', 'FireResist', 'ElementalResist', 'EnergyShield'] }, 30000);
  for (const e of r.lists || []) console.log('== ' + e.name + ' x' + e.count + '\n  ' + e.sample.join('\n  '));
  eng.stop();
})().catch((e) => { console.error(e); process.exit(1); });
