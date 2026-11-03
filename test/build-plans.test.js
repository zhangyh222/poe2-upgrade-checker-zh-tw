'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBuildRepository } = require('../src/core/build-repository');

const xml = '<PathOfBuilding2><Build level="90"/></PathOfBuilding2>';
const other = '<PathOfBuilding2><Build level="91"/></PathOfBuilding2>';
const doc = { xml, overrides: [], weaponSet: 1 };

async function fixture(action) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poe-build-plans-'));
  try { await action(directory, createBuildRepository(directory)); }
  finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('a plan keeps the build it was saved from, even after the build moves on', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  const plan = await repo.savePlan('main', 'Fast mapper');
  assert.equal(plan.sourceRevision, 1);
  await repo.putCurrent('main', { ...doc, xml: other }, 1);
  const plans = await repo.listPlans('main');
  assert.equal(plans.length, 1);
  assert.equal(plans[0].name, 'Fast mapper');
  assert.equal((await repo.listPlans('other-character')).length, 0);
  // adopting the plan goes back to the saved document, as a new revision
  const adopted = await repo.adoptPlan(plan.id, 2);
  assert.equal(adopted.revision, 3);
  assert.equal(adopted.document.xml, xml);
  assert.equal(adopted.restoredFrom.plan, plan.id);
  // revision 1 was kept when the build moved to 2, and 2 is kept when the plan lands
  assert.deepEqual((await repo.history('main')).map((h) => h.revision).sort(), [1, 2]);
}));

test('a plan adoption on a moved build is refused instead of overwriting it', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  const plan = await repo.savePlan('main', 'P');
  await createBuildRepository(dir).putCurrent('main', { ...doc, xml: other }, 1);
  await assert.rejects(repo.adoptPlan(plan.id, 1), { code: 'REVISION_CONFLICT' });
  assert.equal((await repo.getCurrent('main')).document.xml, other);
}));

test('plans can be listed and deleted', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  const a = await repo.savePlan('main', 'A');
  const b = await repo.savePlan('main', 'B');
  assert.deepEqual((await repo.listPlans('main')).map((p) => p.name).sort(), ['A', 'B']);
  await repo.deletePlan(a.id);
  assert.deepEqual((await repo.listPlans('main')).map((p) => p.id), [b.id]);
  await assert.rejects(repo.deletePlan(a.id), { code: 'PLAN_NOT_FOUND' });
}));

test('history lists previous builds and can bring one back', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  await repo.putCurrent('main', { ...doc, xml: other }, 1);
  const history = await repo.history('main');
  assert.deepEqual(history.map((h) => h.revision), [1]);
  const restored = await repo.restoreHistory('main', 1, 2);
  assert.equal(restored.revision, 3);
  assert.equal(restored.document.xml, xml);
  assert.equal(restored.restoredFrom.history, 1);
  // the build we just left is itself kept, so a restore can be undone
  assert.deepEqual((await repo.history('main')).map((h) => h.revision).sort(), [1, 2]);
}));

test('restoring a version that is no longer kept is an error, not a guess', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  await assert.rejects(repo.restoreHistory('main', 99, 1), { code: 'HISTORY_NOT_FOUND' });
  await assert.rejects(repo.restoreHistory('main', 1, 0), { code: 'HISTORY_NOT_FOUND' });
}));
