'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createOperationQueue } = require('./operation-queue');
const clone = (x) => JSON.parse(JSON.stringify(x));
function failure(code, message) { const e = new Error(message); e.code = code; return e; }
function documentOf(input) {
  if (!input || typeof input.xml !== 'string' || !/^\s*(?:<\?xml[^>]*>\s*)?<PathOfBuilding2[\s>]/.test(input.xml) || !/<\/PathOfBuilding2>\s*$/.test(input.xml)) throw failure('INVALID_BUILD', 'A complete PoB2 XML document is required.');
  const overrides = input.overrides || [];
  if (!Array.isArray(overrides) || overrides.some((x) => !x || typeof x.slot !== 'string' || typeof x.text !== 'string')) throw failure('INVALID_BUILD', 'Invalid equipment overrides.');
  const weaponSet = input.weaponSet == null ? 0 : input.weaponSet;
  if (![0, 1, 2].includes(weaponSet)) throw failure('INVALID_BUILD', 'Invalid weapon set.');
  return clone({ xml: input.xml, overrides, weaponSet });
}

// This repository is separate from the legacy character store. Every mutation
// re-reads under a filesystem lock, then atomically replaces one JSON document.
// A failed write never publishes mutated in-memory state to another operation.
function createBuildRepository(directory) {
  const file = path.join(directory, 'builds-v1.json'), lock = file + '.lock';
  const queue = createOperationQueue();
  async function read() {
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (data.schemaVersion !== 1 || ['current', 'drafts', 'plans', 'history'].some((k) => !data[k] || typeof data[k] !== 'object' || Array.isArray(data[k]))) throw failure('INVALID_REPOSITORY', 'Unsupported or incomplete build repository.');
      return data;
    } catch (e) {
      if (e.code === 'ENOENT') return { schemaVersion: 1, current: {}, drafts: {}, plans: {}, history: {} };
      throw e; // Never overwrite an unreadable or corrupt repository with defaults.
    }
  }
  async function mutate(action) {
    return queue.run(async () => {
      await fs.mkdir(directory, { recursive: true });
      let handle;
      try { handle = await fs.open(lock, 'wx'); } catch (e) { if (e.code === 'EEXIST') throw failure('REPOSITORY_BUSY', 'Another writer holds the build repository lock.'); throw e; }
      const tmp = file + '.' + randomUUID() + '.tmp';
      try {
        const data = await read(), result = await action(data);
        await fs.writeFile(tmp, JSON.stringify(data, null, 2));
        await fs.rename(tmp, file);
        return clone(result);
      } finally {
        try { await fs.unlink(tmp).catch((e) => { if (e.code !== 'ENOENT') throw e; }); }
        finally { await handle.close().finally(() => fs.unlink(lock)); }
      }
    });
  }
  function own(map, id) { return Object.hasOwn(map, id) ? map[id] : null; }
  function current(data, id) { const r = own(data.current, id); if (!r) throw failure('BUILD_NOT_FOUND', 'No current build for this character.'); return r; }
  function draft(data, id, revision) {
    const d = own(data.drafts, id);
    if (!d) throw failure('DRAFT_NOT_FOUND', 'Draft not found.');
    if (d.status !== 'editing') throw failure('DRAFT_CLOSED', 'Draft is already adopted.');
    if (d.revision !== revision) throw failure('REVISION_CONFLICT', 'Draft changed since it was read.');
    return d;
  }
  return {
    async getCurrent(characterId) { return clone(own((await read()).current, characterId)); },
    async getDraft(draftId) { return clone(own((await read()).drafts, draftId)); },
    putCurrent(characterId, input, expectedRevision) {
      if (typeof characterId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(characterId) || ['__proto__', 'constructor', 'prototype'].includes(characterId) || !Number.isInteger(expectedRevision) || expectedRevision < 0) return Promise.reject(failure('INVALID_ARGUMENT', 'Character and expected revision are required.'));
      const document = documentOf(input);
      return mutate((data) => {
        const previous = own(data.current, characterId);
        if ((previous?.revision || 0) !== expectedRevision) throw failure('REVISION_CONFLICT', 'Current build changed since it was read.');
        if (previous) (data.history[characterId] ||= []).push(clone(previous));
        data.history[characterId] = (data.history[characterId] || []).slice(-30);
        return (data.current[characterId] = { characterId, revision: expectedRevision + 1, document, updatedAt: new Date().toISOString() });
      });
    },
    createDraft(characterId) {
      return mutate((data) => {
        const base = current(data, characterId), id = randomUUID();
        return (data.drafts[id] = { id, characterId, baseRevision: base.revision, revision: 1, document: clone(base.document), status: 'editing', updatedAt: new Date().toISOString() });
      });
    },
    updateDraft(draftId, expectedRevision, input) {
      const document = documentOf(input);
      return mutate((data) => { const d = draft(data, draftId, expectedRevision); d.document = document; d.revision++; d.updatedAt = new Date().toISOString(); return d; });
    },
    // ---- saved plans: a named snapshot of the current build ----
    savePlan(characterId, name) {
      return mutate((data) => {
        const base = current(data, characterId);
        const id = randomUUID();
        const plan = {
          id, characterId, name: String(name || 'Plan').slice(0, 80),
          document: clone(base.document), sourceRevision: base.revision,
          savedAt: new Date().toISOString(),
        };
        data.plans[id] = plan;
        return plan;
      });
    },
    async listPlans(characterId) {
      const data = await read();
      return Object.values(data.plans)
        .filter((p) => p && p.characterId === characterId)
        .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))
        .map((p) => ({ id: p.id, name: p.name, sourceRevision: p.sourceRevision, savedAt: p.savedAt, weaponSet: p.document.weaponSet }));
    },
    deletePlan(planId) {
      return mutate((data) => {
        if (!own(data.plans, planId)) throw failure('PLAN_NOT_FOUND', 'Plan not found.');
        delete data.plans[planId];
        return true;
      });
    },
    // adopting a plan is a normal new revision, so the build it replaced stays in history
    adoptPlan(planId, expectedCurrentRevision) {
      return mutate((data) => {
        const plan = own(data.plans, planId);
        if (!plan) throw failure('PLAN_NOT_FOUND', 'Plan not found.');
        const base = current(data, plan.characterId);
        if (base.revision !== expectedCurrentRevision) throw failure('REVISION_CONFLICT', 'Current build changed since it was read.');
        (data.history[plan.characterId] ||= []).push(clone(base));
        data.history[plan.characterId] = data.history[plan.characterId].slice(-30);
        return (data.current[plan.characterId] = {
          characterId: plan.characterId, revision: base.revision + 1,
          document: clone(plan.document), restoredFrom: { plan: plan.id, name: plan.name },
          updatedAt: new Date().toISOString(),
        });
      });
    },

    // ---- history: the previous builds, newest first ----
    async history(characterId) {
      const data = await read();
      const list = data.history[characterId] || [];
      return list.slice().reverse().map((r) => ({ revision: r.revision, updatedAt: r.updatedAt, weaponSet: r.document && r.document.weaponSet }));
    },
    restoreHistory(characterId, revision, expectedCurrentRevision) {
      return mutate((data) => {
        const list = data.history[characterId] || [];
        const entry = list.find((r) => r.revision === revision);
        if (!entry) throw failure('HISTORY_NOT_FOUND', 'That build version is no longer kept.');
        const base = current(data, characterId);
        if (base.revision !== expectedCurrentRevision) throw failure('REVISION_CONFLICT', 'Current build changed since it was read.');
        list.push(clone(base));
        data.history[characterId] = list.slice(-30);
        return (data.current[characterId] = {
          characterId, revision: base.revision + 1, document: clone(entry.document),
          restoredFrom: { history: revision }, updatedAt: new Date().toISOString(),
        });
      });
    },

    discardDraft(draftId, expectedRevision) {
      return mutate((data) => {
        const d = draft(data, draftId, expectedRevision);
        d.status = 'discarded'; d.updatedAt = new Date().toISOString();
        return d;
      });
    },
    adoptDraft(draftId, expectedDraftRevision, expectedCurrentRevision, validate) {
      return mutate(async (data) => {
        const d = draft(data, draftId, expectedDraftRevision), base = current(data, d.characterId);
        if (base.revision !== expectedCurrentRevision || base.revision !== d.baseRevision) throw failure('REVISION_CONFLICT', 'The draft baseline no longer matches the current build.');
        if (typeof validate !== 'function') throw failure('VALIDATION_REQUIRED', 'Draft adoption requires engine validation.');
        const evidence = await validate(clone(d.document), clone(base.document));
        if (evidence?.status !== 'pass' || typeof evidence.engineFingerprint !== 'string' || !evidence.engineFingerprint) throw failure('DRAFT_NOT_VALIDATED', 'Draft is failed or unverified.');
        (data.history[d.characterId] ||= []).push(clone(base));
        data.history[d.characterId] = data.history[d.characterId].slice(-30);
        data.current[d.characterId] = { characterId: d.characterId, revision: base.revision + 1, document: clone(d.document), validation: clone(evidence), updatedAt: new Date().toISOString() };
        d.status = 'adopted'; d.adoptedRevision = base.revision + 1;
        return data.current[d.characterId];
      });
    },
  };
}
module.exports = { createBuildRepository };
