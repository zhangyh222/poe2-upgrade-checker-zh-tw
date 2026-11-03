'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createEngine } = require('../src/pobengine');
const engine = createEngine({ appPath: path.join(__dirname, '..'), packaged: false });
const xml = '<PathOfBuilding2><Build level="90" className="Sorceress" ascendClassName="None" mainSocketGroup="1"/></PathOfBuilding2>';
const glove = 'Item Class: Gloves\nRarity: Rare\nAudit Glove\nVaal Gloves\n--------\nItem Level: 80\n--------\n+10% to Cold Resistance';
function gate() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
(async () => {
  await engine.loadBuild(xml, []);
  const baseline = (await engine.sheet()).stats.ColdResistTotal;
  const entered = gate(), release = gate(), order = [];
  const a = engine.transaction(async (session) => {
    order.push('A-start'); await session.ensureLoaded(); entered.resolve();
    await release.promise; await session.sheet(); order.push('A-finish');
  });
  await entered.promise;
  const b = engine.transaction(async (session) => { order.push('B-start'); return session.sheet(); });
  await new Promise((r) => setImmediate(r)); assert.deepEqual(order, ['A-start']);
  release.resolve(); await Promise.all([a, b]); assert.deepEqual(order, ['A-start', 'A-finish', 'B-start']);

  // A partial mutation is followed by an error. The next public read must
  // restart from the document, rather than silently reuse the mutated process.
  await assert.rejects(engine.transaction(async (session) => {
    await session.send({ cmd: 'equip', items: [{ slot: 'Gloves', text: glove }] });
    throw Error('simulated failure after mutation');
  }), /simulated failure/);
  assert.equal((await engine.sheet()).stats.ColdResistTotal, baseline);

  const controller = new AbortController();
  await assert.rejects(engine.transaction(async (session) => {
    await session.setWeaponSet(2); controller.abort();
  }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal((await engine.sheet()).weaponSwap, false);

  const started = gate(), unblock = gate();
  const active = engine.transaction(async () => { started.resolve(); await unblock.promise; });
  await started.promise;
  let executed = false;
  const queued = engine.transaction(async () => { executed = true; });
  // Attach both handlers before unblocking to avoid unhandled rejection races.
  const activeCheck = assert.rejects(active, { code: 'STALE_CALCULATION' });
  const queuedCheck = assert.rejects(queued, { code: 'STALE_CALCULATION' });
  engine.setBuild(xml.replace('level="90"', 'level="91"'), []);
  unblock.resolve(); await Promise.all([activeCheck, queuedCheck]); assert.equal(executed, false);
  assert.equal((await engine.ensureLoaded()).level, 91);
  // A's temporary alignment must not override B's explicit view preference.
  await engine.setWeaponSet(1);
  engine.setBuild(xml, [], 2);
  assert.equal((await engine.sheet()).weaponSwap, true);
  engine.setBuild(xml, [], 0);
  assert.equal(engine.weaponSet(), 0);
  await engine.sheet();
  assert.equal(engine.weaponSet(), 0);
  console.log('Transaction regressions passed: exclusive lease, partial-failure recovery, cancellation restoration, obsolete queued work.');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => engine.kill());
