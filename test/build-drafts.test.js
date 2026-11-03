'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBuildRepository } = require('../src/core/build-repository');
const { createBuildDrafts } = require('../src/core/build-drafts');

const xml = '<PathOfBuilding2><Build level="90"/></PathOfBuilding2>';
const other = '<PathOfBuilding2><Build level="91"/></PathOfBuilding2>';
const doc = { xml, overrides: [], weaponSet: 1 };
const sheet = (stats) => ({ ok: true, stats, skills: [{ id: 1 }] });
const busy = () => sheet({ FullDPS: 1000, TotalEHP: 5000, Life: 2000 });
const weaker = () => sheet({ FullDPS: 800, TotalEHP: 5000, Life: 2000 });
const noDamage = () => sheet({ FullDPS: 0, TotalEHP: 5000, Life: 2000 });

// the engine loads the base first, then the draft, so the order is (base, draft)
function engine(sheets, { fail = null } = {}) {
  return {
    version: () => 'v0.9-test',
    trialDocuments: async (docs) => {
      if (fail) throw fail;
      // the engine reports each document as { ok, sheet }
      return docs.map((_, i) => ({ ok: true, sheet: sheets[i] }));
    },
  };
}

async function fixture(action) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poe-build-drafts-'));
  try { await action(directory, createBuildRepository(directory)); }
  finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('a draft that the engine calculates can be adopted with its evidence', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  const drafts = createBuildDrafts({ repository: repo, engine: engine([busy(), weaker()]) });
  const d = await drafts.start('main');
  assert.equal(d.baseRevision, 1);

  const result = await drafts.trial(d.id);
  assert.equal(result.evidence.status, 'pass');
  assert.equal(result.evidence.delta.dpsPct, -20);
  assert.match(result.evidence.engineFingerprint, /^pob:v0\.9-test\|/);

  const adopted = await drafts.adopt(d.id, 1, 1);
  assert.equal(adopted.revision, 2);
  assert.equal(adopted.validation.status, 'pass');
  assert.equal((await repo.getDraft(d.id)).status, 'adopted');
  // persisted, not just in memory
  assert.equal((await createBuildRepository(dir).getCurrent('main')).revision, 2);
}));

test('engine failure is unverified, never an adoption', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  const drafts = createBuildDrafts({ repository: repo, engine: engine([], { fail: new Error('engine stopped') }) });
  const d = await drafts.start('main');
  const trial = await drafts.trial(d.id);
  assert.equal(trial.evidence.status, 'unverified');
  assert.match(trial.evidence.reason, /engine did not finish: engine stopped/);
  await assert.rejects(drafts.adopt(d.id, 1, 1), { code: 'DRAFT_NOT_VALIDATED' });
  assert.equal((await repo.getCurrent('main')).revision, 1);
}));

test('a draft that loses all damage is a failure', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  const drafts = createBuildDrafts({ repository: repo, engine: engine([busy(), noDamage()]) });
  const d = await drafts.start('main');
  const trial = await drafts.trial(d.id);
  assert.equal(trial.evidence.status, 'fail');
  assert.equal(trial.evidence.delta.dpsPct, -100);
  await assert.rejects(drafts.adopt(d.id, 1, 1), { code: 'DRAFT_NOT_VALIDATED' });
}));

test('two sides PoB never modelled are unverified, not a pass', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  const drafts = createBuildDrafts({ repository: repo, engine: engine([sheet({}), sheet({})]) });
  const d = await drafts.start('main');
  const trial = await drafts.trial(d.id);
  assert.equal(trial.evidence.status, 'unverified');
  assert.match(trial.evidence.reason, /no damage or defences/);
}));

test('a draft whose base moved cannot be adopted on the old revision', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  const drafts = createBuildDrafts({ repository: repo, engine: engine([busy(), busy()]) });
  const d = await drafts.start('main');
  await createBuildRepository(dir).putCurrent('main', { ...doc, xml: other }, 1);
  await assert.rejects(drafts.adopt(d.id, 1, 2), { code: 'REVISION_CONFLICT' });
  assert.equal((await repo.getCurrent('main')).document.xml, other);
}));

test('cancellation is not turned into evidence', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  const abort = new Error('Calculation cancelled.');
  abort.name = 'AbortError';
  const drafts = createBuildDrafts({ repository: repo, engine: engine([], { fail: abort }) });
  const d = await drafts.start('main');
  await assert.rejects(drafts.trial(d.id), { name: 'AbortError' });
  assert.equal((await repo.getDraft(d.id)).status, 'editing');
}));

test('a bare sheet from the engine is accepted as well', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  const bare = { version: () => 'v0.9-test', trialDocuments: async () => [busy(), weaker()] };
  const drafts = createBuildDrafts({ repository: repo, engine: bare });
  const d = await drafts.start('main');
  const trial = await drafts.trial(d.id);
  assert.equal(trial.evidence.status, 'pass');
  assert.equal(trial.evidence.delta.dpsPct, -20);
}));

test('the adopted document is what the engine should load next', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  const drafts = createBuildDrafts({ repository: repo, engine: engine([busy(), busy()]) });
  const d = await drafts.start('main');
  await drafts.adopt(d.id, 1, 1);
  const next = await drafts.engineDocument('main');
  assert.equal(next.revision, 2);
  assert.equal(next.xml, xml);
  assert.equal(next.validation.status, 'pass');
}));
