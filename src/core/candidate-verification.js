'use strict';

// "Is this market listing better for me?" is answered in one place, because two
// surfaces answering it differently is how the same item looks good in the gear
// panel and bad in the results window. The chain is: engine trial -> condition
// layers -> the popup's verdict. This module owns the order and the status words;
// the caller supplies the engine and the rule objects.
//
// The status vocabulary is deliberately small and honest:
//   pass / fail      - the conditions decided it
//   unverified       - nothing was checked (no item text, no conditions, engine
//                      refusal). A refusal is never silently turned into a pass.

function summarizeVerdict(j) {
  if (!j) return null;
  return {
    score: j.score,
    verdict: j.verdict,
    breaks: (j.breaks || []).length,
    dpsPct: j.dps ? j.dps.pct : null,
  };
}

async function verifyCandidates(input) {
  const {
    candidates = [],
    conditions = [],
    evaluate,
    evaluateGuards,
    overall,
    judge = null,
  } = input || {};
  if (typeof evaluate !== 'function') throw new Error('verifyCandidates needs an evaluate function.');
  const noConditions = !conditions.length;
  const out = [];

  for (const candidate of candidates) {
    if (!candidate || !candidate.text) {
      out.push({ ...candidate, status: 'unverified', reason: 'no item text' });
      continue;
    }
    try {
      const trial = await evaluate(candidate.text);
      if (!trial || !trial.ok) {
        out.push({
          ...candidate,
          status: 'unverified',
          reason: (trial && trial.error) || 'the engine could not read this item',
        });
        continue;
      }
      const rows = typeof evaluateGuards === 'function'
        ? evaluateGuards(conditions, trial.before, trial.after)
        : [];
      let verdict = null;
      if (typeof judge === 'function') {
        // a missing verdict is not a failure: the conditions already answered
        try { verdict = summarizeVerdict(judge(trial.before, trial.after)); } catch (_) { /* keep null */ }
      }
      out.push({
        ...candidate,
        status: noConditions ? 'unverified' : (typeof overall === 'function' ? overall(rows) : 'unverified'),
        guards: rows,
        before: trial.before,
        after: trial.after,
        verdict,
        reason: noConditions ? 'no conditions set' : null,
      });
    } catch (err) {
      out.push({ ...candidate, status: 'unverified', reason: (err && err.message) || String(err) });
    }
  }
  return out;
}

module.exports = { verifyCandidates, summarizeVerdict };
