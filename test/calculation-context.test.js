'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCalculationContext } = require('../src/core/calculation-context');
const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

test('late calculations are rejected after character or generation changes, including away and back', async () => {
  let identity = { profileId: 'A', revision: 1 };
  const contexts = createCalculationContext(() => identity);
  const token = contexts.capture();
  const gate = deferred();
  const result = contexts.run(token, () => gate.promise);
  identity = { profileId: 'B', revision: 2 };
  identity = { profileId: 'A', revision: 3 };
  gate.resolve({ damage: 100 });
  await assert.rejects(result, { code: 'STALE_CALCULATION' });
  assert.equal(contexts.isCurrent(token), false);
  assert.equal(contexts.isCurrent({ ...token }), false);
});

test('settings snapshots cannot be changed through the captured token', () => {
  const state = { priorities: { keepDmg: true } };
  const contexts = createCalculationContext(() => state);
  const token = contexts.capture();
  assert.throws(() => { token.priorities.keepDmg = false; }, TypeError);
  state.priorities.keepDmg = false;
  assert.equal(token.priorities.keepDmg, true);
  assert.equal(contexts.isCurrent(token), false);
});

function judgeHarness() {
  const gate = deferred();
  const identity = { profileId: 'A', revision: 1, priorities: { keepDmg: true } };
  let judges = 0;
  const sandbox = {
    pobOn: () => true, pobWeights: () => ({ priorities: { keepDmg: true } }),
    pobContext: createCalculationContext(() => identity),
    pobEngine: () => ({ evalItems: () => gate.promise }), SLOT_GROUPS: {},
    pobVerdict: { SLOT_TO_POB: { Gloves: 'Gloves' }, judge: () => { judges++; return { score: 10 }; }, best: (x) => x[0] },
  };
  vm.createContext(sandbox);
  const start = main.indexOf('async function pobJudge('), end = main.indexOf('// can Path of Building judge', start);
  vm.runInContext(main.slice(start, end), sandbox);
  return { sandbox, identity, gate, judges: () => judges };
}

test('actual item comparison does not score a response using a different character', async () => {
  const h = judgeHarness();
  const result = h.sandbox.pobJudge([{ item: { slot: 'Gloves', raw: 'item' }, slot: 'Gloves' }]);
  h.identity.profileId = 'B'; h.identity.revision++;
  h.gate.resolve([{ ok: true, before: {}, after: {} }]);
  await assert.rejects(result, { code: 'STALE_CALCULATION' });
  assert.equal(h.judges(), 0);
});

test('actual item comparison preserves successful results and their context', async () => {
  const h = judgeHarness();
  const result = h.sandbox.pobJudge([{ item: { slot: 'Gloves', raw: 'item' }, slot: 'Gloves' }]);
  h.gate.resolve([{ ok: true, before: {}, after: {} }]);
  const r = await result;
  assert.equal(r[0].score, 10); assert.equal(r.context.profileId, 'A'); assert.equal(h.judges(), 1);
});

test('changing protection settings while comparing discards the old verdict', async () => {
  const h = judgeHarness();
  const result = h.sandbox.pobJudge([{ item: { slot: 'Gloves', raw: 'item' }, slot: 'Gloves' }]);
  h.identity.priorities.keepDmg = false;
  h.gate.resolve([{ ok: true, before: {}, after: {} }]);
  await assert.rejects(result, { code: 'STALE_CALCULATION' });
  assert.equal(h.judges(), 0);
});

test('weapon switch response cannot write a main-skill setting into another character', async () => {
  const gate = deferred(), handlers = {}, settings = { weaponSet: 1 };
  const store = { data: { activeProfile: 'A' }, settings, setSetting: (k, v) => { settings[k] = v; } };
  const sandbox = {
    store, pobSheetGen: 1, pobOn: () => true, log: () => {},
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    pobQueries: new Map(), pobLastSheet: new Map(), pobLastSources: new Map(), pobLastSummary: new Map(), statPanels: new Map(),
    pobEngine: () => {
      const engine = { ensureLoaded: async () => {}, setWeaponSet: () => gate.promise, sheet: async () => ({ skills: [{ main: true, key: 'skill' }] }) };
      return { transaction: (action) => action(engine) };
    },
  };
  sandbox.pobContext = createCalculationContext(() => ({ profileId: store.data.activeProfile, revision: sandbox.pobSheetGen, weaponSet: settings.weaponSet }));
  vm.createContext(sandbox);
  const start = main.indexOf("ipcMain.handle('pob:weaponSet'"), end = main.indexOf("ipcMain.handle('pob:status'", start);
  vm.runInContext(main.slice(start, end), sandbox);
  const result = handlers['pob:weaponSet'](null, 2);
  await new Promise((r) => setImmediate(r));
  store.data.activeProfile = 'B'; sandbox.pobSheetGen++;
  gate.resolve({ ok: true });
  assert.equal((await result).ok, false);
  assert.equal(settings.skillWeaponSets, undefined);
});

test('actual character sheet handler cannot save old quality or cache into a new character', async () => {
  const gate = deferred(), handlers = {};
  const store = { data: { activeProfile: 'A' }, settings: {}, equipped: { Gloves: { quality: 5 } }, save: () => { throw Error('stale request wrote store'); } };
  const sandbox = {
    store, pobSheetGen: 1,
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    pobOn: () => true, pobXml: () => 'xml', liveResists: () => null,
    pobEngine: () => {
      const engine = { ensureLoaded: async () => {}, sheet: () => gate.promise };
      return { available: () => true, transaction: (action) => action(engine) };
    },
    alignWeaponSetToMain: async () => sandbox.pobContext.capture(), log: () => {},
  };
  sandbox.pobContext = createCalculationContext(() => ({ profileId: store.data.activeProfile, revision: sandbox.pobSheetGen }));
  vm.createContext(sandbox);
  const start = main.indexOf('const pobLastSheet = new Map();'), end = main.indexOf('// The passive tree for', start);
  vm.runInContext(main.slice(start, end), sandbox);
  const result = handlers['pob:sheet'](null, false);
  // Let ensureLoaded and alignment settle before completing the delayed sheet.
  await new Promise((r) => setImmediate(r));
  store.data.activeProfile = 'B'; sandbox.pobSheetGen++;
  gate.resolve({ gearInfo: { Gloves: { quality: 20 } } });
  const r = await result;
  assert.equal(r.stale, true); assert.equal(r.sheet, null);
  assert.equal(store.equipped.Gloves.quality, 5);
  assert.equal(vm.runInContext('pobLastSheet.size', sandbox), 0);
});
