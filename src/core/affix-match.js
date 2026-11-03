'use strict';

// Which affix (and which tier of it) an item line comes from.
//
// The engine's tier index keeps the mod text as the game writes it, e.g.
// "+(34-36) to Strength"; an item line says "+35 to Strength". Comparing those
// means comparing the shape, not the numbers: every number becomes "#" and the
// tier whose band contains the roll wins. Two tiers can share a shape (different
// bands), so the value decides; if it fits none, the line is "unknown tier"
// rather than a guess.

const { band, positionInBand } = require('./mod-text');

function normalize(text) {
  return String(text == null ? '' : text)
    // a roll is "(34-36)" or "35": both become one "#", and the parentheses go
    .replace(/-?\d+(?:\.\d+)?(?:\s*[-–]\s*-?\d+(?:\.\d+)?)?/g, '#')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// one roll out of a line, for comparing against a band
function firstValue(text) {
  const m = String(text == null ? '' : text).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// index: groups from the engine (each tier has {text, tier, level, ...})
function createMatcher(groups) {
  const byShape = new Map();
  for (const g of groups || []) {
    for (const t of g.tiers || []) {
      const shape = normalize(t.text);
      if (!shape) continue;
      if (!byShape.has(shape)) byShape.set(shape, []);
      byShape.get(shape).push({ group: g.group, type: g.type, tier: t.tier, text: t.text, level: t.level, band: band(t.text) });
    }
  }
  return {
    // the best candidate for one item line, or null when nothing matches
    match(line) {
      const shape = normalize(line);
      const candidates = byShape.get(shape);
      if (!candidates || !candidates.length) return null;
      const value = firstValue(line);
      const fitting = candidates.filter((c) => c.band && value != null && value >= c.band.min - 1e-9 && value <= c.band.max + 1e-9);
      const pick = fitting[0] || candidates[0];
      return {
        group: pick.group, type: pick.type, tier: pick.tier, level: pick.level,
        band: pick.band,
        // how sure this is: the roll fitted exactly one tier, several, or none
        confidence: fitting.length === 1 ? 'exact' : fitting.length > 1 ? 'ambiguous' : 'range-only',
        position: fitting.length === 1 ? positionInBand(pick.text, value) : null,
      };
    },
  };
}

module.exports = { normalize, firstValue, createMatcher };
