'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyCandidates } = require('../src/core/candidate-verification');

const okTrial = async () => ({ ok: true, before: { dps: 100 }, after: { dps: 110 } });

test('a candidate with no item text is unverified, not skipped', async () => {
  const out = await verifyCandidates({
    candidates: [{ id: 1 }, { id: 2, text: '' }],
    conditions: [{ id: 'c' }],
    evaluate: okTrial,
    evaluateGuards: () => [{ ok: true }],
    overall: () => 'pass',
  });
  assert.deepEqual(out.map((c) => c.status), ['unverified', 'unverified']);
  assert.deepEqual(out.map((c) => c.reason), ['no item text', 'no item text']);
  assert.equal(out[0].id, 1); // the candidate row survives, so the page can still show it
});

test('no conditions means nothing was checked, so nothing can pass', async () => {
  const out = await verifyCandidates({
    candidates: [{ id: 1, text: 'item' }],
    conditions: [],
    evaluate: okTrial,
    evaluateGuards: () => [],
    overall: () => 'pass', // even a permissive overall() must not be trusted here
  });
  assert.equal(out[0].status, 'unverified');
  assert.equal(out[0].reason, 'no conditions set');
});

test('an engine refusal stays a refusal and keeps its reason', async () => {
  const out = await verifyCandidates({
    candidates: [{ id: 1, text: 'item' }],
    conditions: [{ id: 'c' }],
    evaluate: async () => ({ ok: false, error: 'Path of Building is busy' }),
    evaluateGuards: () => [],
    overall: () => 'pass',
  });
  assert.equal(out[0].status, 'unverified');
  assert.equal(out[0].reason, 'Path of Building is busy');
});

test('a throwing engine is a per-candidate unverified, not a dead batch', async () => {
  const out = await verifyCandidates({
    candidates: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }],
    conditions: [{ id: 'c' }],
    evaluate: async (text) => { if (text === 'a') throw new Error('engine died'); return { ok: true, before: {}, after: {} }; },
    evaluateGuards: () => [],
    overall: () => 'pass',
  });
  assert.equal(out[0].status, 'unverified');
  assert.equal(out[0].reason, 'engine died');
  assert.equal(out[1].status, 'pass');
});

test('the condition verdict is what decides pass or fail', async () => {
  const out = await verifyCandidates({
    candidates: [{ id: 1, text: 'item' }],
    conditions: [{ id: 'c' }],
    evaluate: okTrial,
    evaluateGuards: () => [{ ok: true }, { ok: false }],
    overall: (rows) => (rows.every((r) => r.ok) ? 'pass' : 'fail'),
  });
  assert.equal(out[0].status, 'fail');
  assert.equal(out[0].guards.length, 2);
});

test('the popup verdict rides along when there is one, and its absence is not a failure', async () => {
  const withVerdict = await verifyCandidates({
    candidates: [{ id: 1, text: 'item' }],
    conditions: [{ id: 'c' }],
    evaluate: okTrial,
    evaluateGuards: () => [],
    overall: () => 'pass',
    judge: () => ({ score: 1.2, verdict: 'better', breaks: [1, 2], dps: { pct: 4.5 } }),
  });
  assert.deepEqual(withVerdict[0].verdict, { score: 1.2, verdict: 'better', breaks: 2, dpsPct: 4.5 });

  const throwingJudge = await verifyCandidates({
    candidates: [{ id: 1, text: 'item' }],
    conditions: [{ id: 'c' }],
    evaluate: okTrial,
    evaluateGuards: () => [],
    overall: () => 'pass',
    judge: () => { throw new Error('no weights'); },
  });
  assert.equal(throwingJudge[0].verdict, null);
  assert.equal(throwingJudge[0].status, 'pass');
});
