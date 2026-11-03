'use strict';

// The trade site lists the same item once per seller. For "which item should I
// wear" that is noise: one unique sold ten times is one candidate whose price is
// the cheapest listing. Duplicates are counted, not discarded silently, so the
// panel can say "also 9 others" — the price column is only meaningful with it.

function keyOf(candidate) {
  return `${String(candidate && candidate.name || '').toLowerCase()}|${String(candidate && candidate.baseType || '').toLowerCase()}`;
}

// keepe the first (the list arrives price-sorted) and count the rest per key
function dedupeCandidates(list) {
  const seen = new Map();
  const out = [];
  for (const candidate of list || []) {
    const key = keyOf(candidate);
    const hit = seen.get(key);
    if (hit) { hit.listings += 1; continue; }
    const kept = { ...candidate, listings: 1 };
    seen.set(key, kept);
    out.push(kept);
  }
  return out;
}

module.exports = { dedupeCandidates, keyOf };
