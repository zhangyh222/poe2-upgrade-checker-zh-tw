'use strict';

// The three layers of "must still be true after the swap":
//
//   global   – the character: resistances, attribute requirements, key mechanisms
//   slot     – one equipment slot (weapon conditions also name a weapon set)
//   search   – this query only, e.g. "this time I may trade life for damage"
//
// A temporary condition may ask for something extra, but it may not quietly undo a
// global or slot condition: that is the "don't lower the bar silently" rule. This
// module is the model and the evaluation; storage is the caller's business.

const LAYERS = ['global', 'slot', 'search'];
const OPS = ['min', 'max', 'keep'];

function failure(code, message) { const e = new Error(message); e.code = code; return e; }

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Which number a condition talks about. `key` is how it appears in PoB's stats and
// in the app's own before/after maps.
const METRICS = {
  life: { label: 'Life', read: (s) => num(s.Life) },
  energyShield: { label: 'Energy Shield', read: (s) => num(s.EnergyShield) },
  ehp: { label: 'Effective HP', read: (s) => num(s.TotalEHP) },
  dps: { label: 'DPS', read: (s) => num(s.FullDPS) || num(s.CombinedDPS) || num(s.TotalDPS) || num(s.MinionDPS) },
  fireRes: { label: 'Fire resistance', read: (s) => num(s.FireResistTotal) != null ? num(s.FireResistTotal) : num(s.FireResist) },
  coldRes: { label: 'Cold resistance', read: (s) => num(s.ColdResistTotal) != null ? num(s.ColdResistTotal) : num(s.ColdResist) },
  lightningRes: { label: 'Lightning resistance', read: (s) => num(s.LightningResistTotal) != null ? num(s.LightningResistTotal) : num(s.LightningResist) },
  chaosRes: { label: 'Chaos resistance', read: (s) => num(s.ChaosResistTotal) != null ? num(s.ChaosResistTotal) : num(s.ChaosResist) },
  armour: { label: 'Armour', read: (s) => num(s.Armour) },
  evasion: { label: 'Evasion', read: (s) => num(s.Evasion) },
  spirit: { label: 'Spirit', read: (s) => num(s.Spirit) },
  str: { label: 'Strength', read: (s) => num(s.Str) },
  dex: { label: 'Dexterity', read: (s) => num(s.Dex) },
  int: { label: 'Intelligence', read: (s) => num(s.Int) },
  movementSpeed: { label: 'Movement speed', read: (s) => num(s.MovementSpeedMod) },
};

function cleanCondition(input, layer) {
  if (!input || typeof input !== 'object') throw failure('INVALID_CONDITION', 'A condition must be an object.');
  const metric = String(input.metric || '');
  if (!METRICS[metric]) throw failure('UNKNOWN_METRIC', `Unknown metric "${metric}".`);
  const op = String(input.op || 'keep');
  if (!OPS.includes(op)) throw failure('INVALID_CONDITION', `Unknown comparison "${op}".`);
  const value = input.value == null ? null : num(input.value);
  if (op !== 'keep' && value == null) throw failure('INVALID_CONDITION', 'A min/max condition needs a value.');
  const id = String(input.id || `${layer}:${metric}${input.slot ? '@' + input.slot : ''}`);
  return {
    id, layer, metric, op, value,
    unit: input.unit === 'percent' ? 'percent' : 'number',
    slot: input.slot ? String(input.slot) : null,
    weaponSet: input.weaponSet === 1 || input.weaponSet === 2 ? input.weaponSet : 0,
    label: input.label ? String(input.label) : null,
    locked: layer !== 'search', // only the temporary layer is allowed to be loose
  };
}

// Two inherited rules for the same metric: keep the stricter one. A plain threshold
// beats "keep", two thresholds of the same direction keep the higher bar.
function pickStricter(a, b) {
  if (a.op !== b.op) {
    if (a.op === 'keep') return b;
    if (b.op === 'keep') return a;
    return a; // min vs max on one metric: no ordering, keep the first
  }
  if (a.op === 'min') return (a.value >= b.value) ? a : b;
  if (a.op === 'max') return (a.value <= b.value) ? a : b;
  return a;
}

// Merge layers into the effective list. A temporary condition may add a requirement
// or tighten one, but it may not loosen an inherited one: that becomes a conflict,
// reported to the caller instead of silently resolved.
function mergeGuards({ global = [], slot = [], search = [], slotName = null } = {}) {
  const layers = {
    global: global.map((c) => cleanCondition(c, 'global')),
    // the slot layer only speaks for the slot being compared (or for all of them)
    slot: slot.map((c) => cleanCondition(c, 'slot')).filter((c) => !c.slot || !slotName || c.slot === slotName),
    search: search.map((c) => cleanCondition(c, 'search')),
  };
  const key = (c) => `${c.metric}|${c.weaponSet}`;
  const inherited = new Map();
  for (const c of [...layers.global, ...layers.slot]) {
    const prev = inherited.get(key(c));
    inherited.set(key(c), prev ? { condition: pickStricter(prev.condition, c), sources: [...prev.sources, c] } : { condition: c, sources: [c] });
  }
  const conflicts = [];
  const searchOnly = [];
  for (const c of layers.search) {
    const entry = inherited.get(key(c));
    if (!entry) { searchOnly.push(c); continue; }
    const base = entry.condition;
    if (base.op === 'keep') {
      if (c.op !== 'keep') conflicts.push({ metric: c.metric, reason: 'the temporary condition replaces an inherited "keep" requirement', inherited: base, temporary: c });
      continue; // "keep" stays
    }
    if (c.op !== base.op) {
      conflicts.push({ metric: c.metric, reason: 'the temporary condition uses a different comparison', inherited: base, temporary: c });
      continue;
    }
    const looser = base.op === 'min' ? c.value < base.value : c.value > base.value;
    if (looser) conflicts.push({ metric: c.metric, reason: 'the temporary condition is looser than the inherited one', inherited: base, temporary: c });
    else if (c.value !== base.value) entry.condition = c; // stricter: it becomes the bar
  }
  const effective = [...[...inherited.values()].map((e) => e.condition), ...searchOnly];
  return { effective, conflicts, layers };
}

// before/after are the same shape PoB returns from getMiscCalculator (and the app's
// summary): evaluate every condition, one status each.
function evaluateGuards(guards, before, after, options = {}) {
  const set = options.weaponSet || 0;
  return (guards.effective || []).map((c) => {
    const metric = METRICS[c.metric];
    const from = metric.read(before || {});
    const to = metric.read(after || {});
    // a condition bound to a weapon set only applies while that set is being compared
    if (c.weaponSet && set && c.weaponSet !== set) {
      return { ...c, status: 'unverified', reason: 'condition belongs to weapon set ' + c.weaponSet, before: from, after: to };
    }
    if (to == null) {
      return { ...c, status: 'unverified', reason: 'Path of Building did not report ' + metric.label, before: from, after: to };
    }
    let status;
    if (c.op === 'keep') status = from == null ? 'unverified' : (to + 1e-9 >= from ? 'pass' : 'fail');
    else if (c.op === 'min') status = to + 1e-9 >= c.value ? 'pass' : 'fail';
    else status = to - 1e-9 <= c.value ? 'pass' : 'fail';
    return { ...c, status, before: from, after: to, delta: from == null ? null : to - from };
  });
}

// The search-level result: any fail is a fail; no fail but unverified is unverified.
function overall(results) {
  if (!results.length) return 'pass';
  if (results.some((r) => r.status === 'fail')) return 'fail';
  if (results.some((r) => r.status === 'unverified')) return 'unverified';
  return 'pass';
}

module.exports = { METRICS, LAYERS, mergeGuards, evaluateGuards, overall, cleanCondition };
