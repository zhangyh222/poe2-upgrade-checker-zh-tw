'use strict';

// Item modifier text carries its roll as "(34-36)" (a range) or as a plain number
// ("+5"). Tiers from the engine keep that text, so this is how a tier's range and
// an item's actual roll are compared.

const RANGE = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g;
const NUMBER = /-?\d+(?:\.\d+)?/g;

// every (min-max) range in the text, left to right
function ranges(text) {
  const out = [];
  const s = String(text == null ? '' : text);
  let m;
  RANGE.lastIndex = 0;
  while ((m = RANGE.exec(s))) {
    const min = Number(m[1]); const max = Number(m[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) out.push({ min: Math.min(min, max), max: Math.max(min, max) });
  }
  return out;
}

// the tier's value band: its first range, or the first plain number
function band(text) {
  const r = ranges(text);
  if (r.length) return r[0];
  const nums = String(text == null ? '' : text).match(NUMBER);
  if (!nums || !nums.length) return null;
  const v = Number(nums[0]);
  return Number.isFinite(v) ? { min: v, max: v } : null;
}

// where a roll sits in its tier, 0 (worst end) .. 1 (best end); null when the
// roll is missing or outside the band (a wrong tier guess, not a 0)
function positionInBand(text, value) {
  const b = band(text);
  const v = Number(value);
  if (!b || !Number.isFinite(v)) return null;
  if (v < b.min - 1e-9 || v > b.max + 1e-9) return null;
  if (b.max === b.min) return 1;
  return (v - b.min) / (b.max - b.min);
}

module.exports = { ranges, band, positionInBand };
