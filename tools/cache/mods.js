const fs = require('fs');
const path = require('path');
const { createEngine } = require('../../src/pobengine');
(async () => {
  const xml = fs.readFileSync(path.join(process.env.APPDATA, 'poe2-upgrade-checker', 'pob', 'main.xml'), 'utf8');
  const eng = createEngine({ log: () => {}, appPath: path.join(__dirname, '..', '..'), packaged: false });
  await eng.loadBuild(xml);
  const r = await eng.send({ cmd: 'modnames' }, 30000);

  for (const e of (r.names||[])) {
    if (/Resist/.test(e.name) && !/Totem|Max$/.test(e.name)) {
      console.log(e.name + ' x' + e.count + '  ' + e.sample.join(' | '));
    }
  }
  eng.stop();
})().catch((e) => { console.error(e); process.exit(1); });
