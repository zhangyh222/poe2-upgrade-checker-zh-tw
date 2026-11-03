'use strict';

// Draft trials for the build service.
//
// The repository (build-repository.js) decides *when* a draft may be adopted: it
// needs a validation callback that returns engine evidence. This module is that
// callback plus the small business surface around it:
//
//   const drafts = createBuildDrafts({ repository, engine });
//   await drafts.start('main');                 // draft of the current build
//   await drafts.trial(draftId);                // evidence, persisted nowhere
//   await drafts.adopt(draftId, 1, 1);          // re-validates, then persists
//
// What "pass" means here is deliberately narrow: both documents loaded in the
// same engine and both produced numbers. Engine failures, missing numbers and
// untried cases are "unverified" — never "pass", because a build that was
// never calculated must not be adopted as if it had been.

const crypto = require('node:crypto');

function failure(code, message) { const e = new Error(message); e.code = code; return e; }

const sha = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);

// the numbers a draft has to keep comparable; anything PoB did not report stays absent
const METRICS = [
  'FullDPS', 'CombinedDPS', 'TotalDPS', 'MinionDPS', 'AverageHit',
  'TotalEHP', 'Life', 'EnergyShield', 'Mana', 'Ward',
  'Spirit', 'SpiritUnreserved', 'Armour', 'Evasion',
];

function metricsOf(sheet) {
  const stats = (sheet && sheet.stats) || {};
  const out = {};
  for (const key of METRICS) {
    const value = Number(stats[key]);
    if (Number.isFinite(value)) out[key] = value;
  }
  out.skills = Array.isArray(sheet && sheet.skills) ? sheet.skills.length : null;
  return out;
}

function dpsOf(metrics) {
  return metrics.FullDPS || metrics.MinionDPS || metrics.CombinedDPS || metrics.TotalDPS || 0;
}

function pct(from, to) {
  if (!(from > 0) || to == null) return null;
  return Math.round(((to - from) / from) * 1000) / 10;
}

function createBuildDrafts({ repository, engine }) {
  if (!repository) throw failure('REPOSITORY_REQUIRED', 'A build repository is required.');
  if (!engine || typeof engine.trialDocuments !== 'function') throw failure('ENGINE_REQUIRED', 'An engine that can try build documents is required.');

  function fingerprint(baseDocument, draftDocument) {
    const version = typeof engine.version === 'function' ? engine.version() : null;
    return `pob:${version || 'unknown'}|${sha(baseDocument.xml)}|${sha(draftDocument.xml)}`;
  }

  // Both documents in one engine run: the base first, so a draft that cannot be
  // loaded at all is reported against a build that did load.
  async function trialPair(baseDocument, draftDocument, options = {}) {
    const engineFingerprint = fingerprint(baseDocument, draftDocument);
    const checkedAt = new Date().toISOString();
    let sheets;
    try {
      sheets = await engine.trialDocuments([baseDocument, draftDocument], options);
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      return { status: 'unverified', reason: 'engine did not finish: ' + (err && err.message ? err.message : String(err)), engineFingerprint, checkedAt };
    }
    // the engine reports each document as { ok, sheet }; accept a bare sheet too
    const unwrap = (x) => (x && x.sheet ? x.sheet : x);
    const baseSheet = unwrap((sheets || [])[0]);
    const draftSheet = unwrap((sheets || [])[1]);
    if (!baseSheet || !draftSheet) {
      return { status: 'unverified', reason: 'engine returned no character sheet for one of the documents', engineFingerprint, checkedAt };
    }
    if (!baseSheet.ok || !draftSheet.ok) {
      return { status: 'unverified', reason: 'engine reported the build as not loaded', engineFingerprint, checkedAt };
    }
    const base = metricsOf(baseSheet);
    const draft = metricsOf(draftSheet);
    const evidence = { engineFingerprint, checkedAt, base, draft,
      delta: { dpsPct: pct(dpsOf(base), dpsOf(draft)), ehpPct: pct(base.TotalEHP, draft.TotalEHP) } };
    // PoB modelled neither side: this is missing data, not a failed build
    if (dpsOf(base) === 0 && dpsOf(draft) === 0 && base.TotalEHP == null && draft.TotalEHP == null) {
      return { ...evidence, status: 'unverified', reason: 'Path of Building reported no damage or defences for either side' };
    }
    // the base dealt damage and the draft deals none: a real, reproduced loss
    if (dpsOf(base) > 0 && dpsOf(draft) === 0) {
      return { ...evidence, status: 'fail', reason: 'the draft loses all of the build\'s damage' };
    }
    return { ...evidence, status: 'pass' };
  }

  async function current(characterId) {
    const record = await repository.getCurrent(characterId);
    if (!record) throw failure('BUILD_NOT_FOUND', 'No current build for this character.');
    return record;
  }

  return {
    // start a draft from the character's current document
    async start(characterId) { return repository.createDraft(characterId); },

    // evidence only: nothing is written, so a failed trial can be repeated
    async trial(draftId, options = {}) {
      const draft = await repository.getDraft(draftId);
      if (!draft) throw failure('DRAFT_NOT_FOUND', 'Draft not found.');
      const base = await repository.getCurrent(draft.characterId);
      if (!base) throw failure('BUILD_NOT_FOUND', 'No current build for this character.');
      return { draft, baseRevision: base.revision, evidence: await trialPair(base.document, draft.document, options) };
    },

    // adopts only when the engine evidence passes; the repository re-checks both
    // revisions under its lock, so a stale draft cannot overwrite a newer build
    async adopt(draftId, draftRevision, currentRevision, options = {}) {
      return repository.adoptDraft(draftId, draftRevision, currentRevision,
        (document, baseDocument) => trialPair(baseDocument, document, options));
    },

    // what the caller hands to the engine after an adoption
    async engineDocument(characterId) {
      const record = await current(characterId);
      return { ...record.document, revision: record.revision, validation: record.validation || null };
    },

    current,
  };
}

module.exports = { createBuildDrafts, metricsOf, dpsOf };
