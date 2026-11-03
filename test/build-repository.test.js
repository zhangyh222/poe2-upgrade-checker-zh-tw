'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBuildRepository } = require('../src/core/build-repository');
const xml = '<PathOfBuilding2><Build level="90"/></PathOfBuilding2>';
const doc = { xml, overrides: [], weaponSet: 1 };
const validated = async () => ({ status: 'pass', engineFingerprint: 'fixture-engine' });
async function fixture(action) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poe-build-repo-'));
  try { await action(directory, createBuildRepository(directory)); }
  finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  }
}
test('draft changes are isolated, adoption persists across repository restart', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0);
  const d = await repo.createDraft('main');
  const changed = await repo.updateDraft(d.id, 1, { ...doc, weaponSet: 2 });
  assert.equal((await repo.getCurrent('main')).document.weaponSet, 1);
  const adopted = await repo.adoptDraft(d.id, changed.revision, 1, validated);
  assert.equal(adopted.revision, 2);
  assert.equal((await createBuildRepository(dir).getCurrent('main')).document.weaponSet, 2);
  await assert.rejects(repo.updateDraft(d.id, 2, doc), { code: 'DRAFT_CLOSED' });
}));
test('an old draft cannot overwrite an externally advanced current revision', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0); const d = await repo.createDraft('main');
  await createBuildRepository(dir).putCurrent('main', { ...doc, weaponSet: 2 }, 1);
  await assert.rejects(repo.adoptDraft(d.id, 1, 2, validated), { code: 'REVISION_CONFLICT' });
  assert.equal((await repo.getCurrent('main')).document.weaponSet, 2);
  assert.equal((await repo.getDraft(d.id)).status, 'editing');
}));
test('failed, unknown or throwing validation leaves persisted state unchanged', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0); const d = await repo.createDraft('main');
  const file = path.join(dir, 'builds-v1.json'), before = await fs.readFile(file, 'utf8');
  for (const status of ['fail', 'unverified']) await assert.rejects(repo.adoptDraft(d.id, 1, 1, async () => ({ status })), { code: 'DRAFT_NOT_VALIDATED' });
  await assert.rejects(repo.adoptDraft(d.id, 1, 1, async () => { throw Error('engine stopped'); }), /engine stopped/);
  await assert.rejects(repo.adoptDraft(d.id, 1, 1), { code: 'VALIDATION_REQUIRED' });
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.equal((await fs.readdir(dir)).some((name) => name.endsWith('.lock')), false);
}));
test('another repository writer cannot enter while validation holds the lease', () => fixture(async (dir, repo) => {
  await repo.putCurrent('main', doc, 0); const d = await repo.createDraft('main');
  let release, started; const held = new Promise((r) => { release = r; }), entered = new Promise((r) => { started = r; });
  const adoption = repo.adoptDraft(d.id, 1, 1, async () => { started(); await held; return validated(); });
  await entered;
  try { await assert.rejects(createBuildRepository(dir).putCurrent('main', doc, 1), { code: 'REPOSITORY_BUSY' }); }
  finally { release(); await adoption; }
  assert.equal((await repo.getCurrent('main')).revision, 2);
}));
test('corrupt storage is never silently replaced by defaults', () => fixture(async (dir, repo) => {
  const file = path.join(dir, 'builds-v1.json'); await fs.writeFile(file, '{broken');
  await assert.rejects(repo.putCurrent('main', doc, 0), SyntaxError);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
}));
test('reserved map keys cannot become characters', () => fixture(async (_, repo) => {
  await assert.rejects(repo.putCurrent('__proto__', doc, 0), { code: 'INVALID_ARGUMENT' });
  assert.equal(await repo.getCurrent('constructor'), null);
}));
