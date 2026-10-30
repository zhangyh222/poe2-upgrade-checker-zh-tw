const fs = require('fs');
const path = require('path');
const { createEngine } = require('../../src/pobengine');
(async () => {
  const xml = fs.readFileSync(path.join(process.env.APPDATA, 'poe2-upgrade-checker', 'pob', 'main.xml'), 'utf8');
  const eng = createEngine({ log: (m) => console.error(m), appPath: path.join(__dirname, '..', '..'), packaged: false });
  await eng.loadBuild(xml);
  for (const stat of ['FireResist', 'Life', 'Armour', 'Spirit', 'TotalDPS']) {
    const r = await eng.send({ cmd: 'sources', stat }, 30000);
    console.log('== ' + stat, 'total', r.total, 'ok', r.ok, r.error || '', r.dbg ? JSON.stringify(r.dbg) : '');
    console.log('  steps:', JSON.stringify(r.steps));
    console.log((r.groups || []).slice(0, 12).map((g) => `  ${g.kind} ${g.name || ''} flat=${g.flat} inc=${g.inc} more=${JSON.stringify(g.more)}`).join('\n'));
  }
  eng.stop();
})().catch((e) => { console.error(e); process.exit(1); });
