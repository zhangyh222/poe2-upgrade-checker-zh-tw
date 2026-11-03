'use strict';

// Old builds kept "which weapon set each skill belongs to" in this app's settings
// (`skillWeaponSets`, keyed `profileId|skillKey`). Newer Path of Building keeps it
// on the skill itself in the build XML. This is the one-time translation: for every
// mark that still names a skill the build actually has, produce a set1/set2 edit.
//
// A key that matches nothing is not dropped silently: it goes back to the caller as
// leftover, so it can be reported (the player changed a gem and the old key is gone)
// or retried, but it is never guessed onto a different skill.

const VALUES = { '1': [true, false], '2': [false, true], '12': [true, true] };

function skillKeys(skills) {
  const map = new Map();
  for (const s of skills || []) {
    if (!s || s.key == null || s.id == null) continue;
    if (!map.has(s.key)) map.set(s.key, s);
  }
  return map;
}

// entries: { 'profileId|skillKey': '1'|'2'|'12' }, returns what to change and what cannot be
function planMigration(entries, profileId, skills) {
  const byKey = skillKeys(skills);
  const edits = [];
  const resolved = []; // nothing to write: the build already decides this skill's set
  const leftover = {};
  const seen = new Set();
  for (const [rawKey, value] of Object.entries(entries || {})) {
    const at = String(rawKey).indexOf('|');
    if (at < 0) { leftover[rawKey] = value; continue; }
    const owner = String(rawKey).slice(0, at);
    if (owner !== profileId) continue; // another character's mark: not ours to move
    const skillKey = String(rawKey).slice(at + 1);
    const want = VALUES[String(value)];
    if (!want) { leftover[rawKey] = value; continue; }
    const skill = byKey.get(skillKey);
    if (!skill) { leftover[rawKey] = value; continue; }
    if (seen.has(skill.id)) { leftover[rawKey] = value; continue; }
    seen.add(skill.id);
    // a skill socketed in a weapon slot takes its set from that weapon: the old
    // manual mark cannot win there, and the build already carries the answer
    if (skill.locked) { resolved.push({ id: skill.id, key: skillKey, label: skill.label || null, reason: 'weapon slot' }); continue; }
    edits.push({ id: skill.id, key: skillKey, set1: want[0], set2: want[1], label: skill.label || null });
  }
  return { edits, resolved, leftover };
}

module.exports = { planMigration, VALUES };
