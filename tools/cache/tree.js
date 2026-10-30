const fs = require('fs');
const path = require('path');
const { createEngine } = require('../../src/pobengine');
(async () => {
  const xml = fs.readFileSync(path.join(process.env.APPDATA, 'poe2-upgrade-checker', 'pob', 'main.xml'), 'utf8');
  const eng = createEngine({ log: () => {}, appPath: path.join(__dirname, '..', '..'), packaged: false });
  await eng.loadBuild(xml);
  const t0 = Date.now();
  const r = await eng.send({ cmd: 'passivetree' }, 120000);
  const size = JSON.stringify(r).length;
  console.log('ok', r.ok, 'nodes', (r.nodes || []).length, 'edges', (r.edges || []).length, 'groups', (r.groups || []).length, 'bytes', size, 'ms', Date.now() - t0);
  console.log('bounds', JSON.stringify(r.bounds), 'radii', r.radii && r.radii.length, 'angles', r.angles && r.angles.length);
  const alloc = (r.nodes || []).filter((n) => n[5] & 8);
  console.log('allocated', alloc.length, 'sample', JSON.stringify(alloc.slice(0, 3)));
  const ns = await eng.send({ cmd: 'nodestats', id: alloc[0] && alloc[0][0] }, 30000);
  console.log('node stats', JSON.stringify(ns).slice(0, 300));
  eng.stop();
})().catch((e) => { console.error(e); process.exit(1); });
