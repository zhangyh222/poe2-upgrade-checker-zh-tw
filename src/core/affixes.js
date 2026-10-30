'use strict';

// Which affix (prefix / suffix) a rare or magic item line came from, and at what tier.
//
// The game only says that in the advanced copy (Ctrl+Alt+C): "{ Prefix Modifier "Hale"
// (Tier: 2) — Life }". A plain Ctrl+C gives just the mod line, so we work it out the way
// Path of Building does internally: match the line against PoB's own affix table, keep the
// affixes that can actually roll on this base at this item level, and take the best match.
// Tiers count from the highest item level in the affix group, which is the game's numbering.
//
// Data: src/data/affixes.json, generated from vendor/pob by tools/make-affix-data.js.

const { bases, mods } = require('../data/affixes.json');

// Bumped when the inference gets better, so gear saved by an older build is worked out again.
const VERSION = 3;

// "Evasion: 496" used to be kept as a plain info line, which left the base without its
// evasion tag (and hid every affix that needs it, e.g. "% increased Evasion and Energy Shield").
const BASE_LINE = [
  [/^Armour:\s*(\d+)/i, '[Base] Armour'],
  [/^Evasion(?: Rating)?:\s*(\d+)/i, '[Base] Evasion Rating'],
  [/^Energy Shield:\s*(\d+)/i, '[Base] Energy Shield'],
  [/^Ward:\s*(\d+)/i, '[Base] Ward'],
  [/^Spirit:\s*(\d+)/i, '[Base] Spirit'],
];
function fixBaseLines(item) {
  for (const line of item.lines || []) {
    if (line.key && line.tag === 'base') continue;
    const text = String(line.text || '');
    for (const [re, key] of BASE_LINE) {
      const m = re.exec(text);
      if (!m) continue;
      line.key = key;
      line.value = Number(m[1]);
      line.tag = 'base';
      break;
    }
  }
}

// Same normalisation as the generator: numbers and (a-b) ranges become "#". Case is folded too:
// the game and Path of Building disagree on capitalisation often enough ("to Maximum Life" vs
// "to maximum Life") that a case-sensitive lookup silently loses whole affixes.
function lineKey(text) {
  return String(text)
    .replace(/\s*\((?:implicit|rune|enchant|crafted|fractured|desecrated|augmented|local)\)\s*$/i, '')
    .replace(/\(-?[\d.]+--?[\d.]+\)/g, '#')
    .replace(/-?\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// stat line -> the mods that can produce it, so a lookup doesn't scan all 1,600
const byLine = new Map();
for (const mod of mods) {
  for (const stat of mod.s) {
    const key = lineKey(stat.key);
    stat.K = key; // folded key, so comparisons never depend on capitalisation
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(mod);
  }
}

// Some lines exist as both a prefix and a suffix (a ring's "increased Rarity of Items found" does).
// Which side a line takes matters: the wrong pick blocks the affixes on that side that have
// nowhere else to go.
const lineSides = new Map();
for (const mod of mods) {
  for (const stat of mod.s) {
    if (!lineSides.has(stat.K)) lineSides.set(stat.K, new Set());
    lineSides.get(stat.K).add(mod.t);
  }
}
const twoSided = (mod) => mod.s.some((stat) => (lineSides.get(stat.K) || { size: 1 }).size > 1);

// the numbers on an actual line, compared against the affix's roll range
function numbersOf(text) {
  return (String(text).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}
// Only the upper bound of a roll range decides the tier: tiers are separated by their maxima and
// an item's quality can push a number above what the minimum of its tier would allow, so a value
// counts for a tier as long as it does not go over that tier's top.
function inRange(line, ranges) {
  const nums = numbersOf(line);
  if (nums.length !== ranges.length) return false;
  return ranges.every(([, max], i) => nums[i] <= max + 0.51);
}
// How much headroom a roll leaves under a tier's maxima. The tightest tier wins, so a low roll is
// attributed to the low tier it really sits in instead of to the top one.
function slackOf(line, ranges) {
  const nums = numbersOf(line);
  if (nums.length !== ranges.length) return Infinity;
  return ranges.reduce((sum, [, max], i) => sum + (max - nums[i]), 0);
}
// A newer league can roll above the highest tier Path of Building knows (or an item's quality
// boosts a mod's numbers): attribute it to that top tier and say so, instead of leaving the line
// without a prefix/suffix at all. Some numbers may still sit inside the tier's range.
function aboveRange(line, ranges) {
  const nums = numbersOf(line);
  if (nums.length !== ranges.length) return false;
  return ranges.some(([, max], i) => nums[i] > max + 0.51);
}

// A base's tags say which affix pools it draws from ("helmet", "str_armour", "ring" ...).
// The affix data carries a tag list per base type; fall back to a slot keyword.
const CLASS_TAGS = {
  Helmets: ['helmet'], 'Body Armours': ['body_armour'], Gloves: ['gloves'], Boots: ['boots'],
  Shields: ['shield'], Quivers: ['quiver'], Rings: ['ring'], Amulets: ['amulet'], Belts: ['belt'],
  Jewels: ['jewel'], 'Life Flasks': ['flask'], 'Mana Flasks': ['flask'], Charms: ['charm'],
  Wands: ['wand'], Staves: ['staff'], Quarterstaves: ['warstaff'], Bows: ['bow'],
  Crossbows: ['crossbow'], Sceptres: ['sceptre'], Spears: ['spear'], Maces: ['mace'],
  Axes: ['axe'], Swords: ['sword'], Daggers: ['dagger'], Claws: ['claw'], Flails: ['flail'],
  Foci: ['focus'], Traps: ['trap'],
};

const ARMOUR_SLOTS = new Set(['Helmets', 'Body Armours', 'Gloves', 'Boots', 'Shields']);
const WEAPON_SLOTS = new Set([
  'Wands', 'Staves', 'Quarterstaves', 'Bows', 'Crossbows', 'Sceptres', 'Spears',
  'Maces', 'Axes', 'Swords', 'Daggers', 'Claws', 'Flails', 'Traps',
]);

// New league bases ("Expert Visored Helm") aren't in the bundled PoB yet: match the
// longest known base name the item's base type ends with.
const BASE_NAMES = Object.keys(bases).sort((a, b) => b.length - a.length);
function findBase(name) {
  if (!name) return null;
  if (bases[name]) return bases[name];
  const hit = BASE_NAMES.find((candidate) => name.endsWith(candidate));
  return hit ? bases[hit] : null;
}

function tagsFor(item) {
  const tags = new Set(CLASS_TAGS[item.itemClass] || []);
  const base = findBase(item.baseType);
  if (base) for (const tag of base.tags) tags.add(tag);

  if (ARMOUR_SLOTS.has(item.itemClass)) {
    tags.add('armour');
    // armour / evasion / energy shield stand for strength / dexterity / intelligence
    const has = (key) => (item.lines || []).some((l) => l.key === key);
    const str = has('[Base] Armour');
    const dex = has('[Base] Evasion Rating');
    const int = has('[Base] Energy Shield');
    const family = str && dex && int ? 'str_dex_int_armour'
      : str && dex ? 'str_dex_armour'
      : str && int ? 'str_int_armour'
      : dex && int ? 'dex_int_armour'
      : str ? 'str_armour' : dex ? 'dex_armour' : int ? 'int_armour' : null;
    if (family) tags.add(family);
  } else if (WEAPON_SLOTS.has(item.itemClass)) {
    tags.add('weapon');
    tags.add(item.twoHanded ? 'two_hand_weapon' : 'one_hand_weapon');
  }
  tags.add('default');
  return tags;
}

// Whether an affix can roll on this item, the way the game decides it: walk the affix's
// (tag, weight) list in order and take the first tag the item has — a weight of 0 there means
// "never on this kind of item". That is why a boot's tiers are numbered differently from a
// helmet's: the boot only has the lower half of the same group.
function weightOf(mod, tags) {
  if (mod.e) return 1; // essence mods: no spawn weight, they come from an essence
  if (Array.isArray(mod.w) && mod.w.length) {
    for (const [tag, w] of mod.w) if (tags.has(tag)) return Number(w) || 0;
    return 0;
  }
  return mod.k.some((k) => tags.has(k)) ? 1 : 0;
}

// The game's tier numbering inside a group: T1 is the highest item level that this item can roll.
const groupTiers = new Map();
function tierOf(mod, tags) {
  const key = `${mod.t}:${mod.g}:${[...tags].sort().join(',')}`;
  let list = groupTiers.get(key);
  if (!list) {
    const inGroup = mods.filter((m) => m.t === mod.t && m.g === mod.g && weightOf(m, tags) > 0);
    inGroup.sort((a, b) => b.l - a.l);
    list = new Map(inGroup.map((m, i) => [m.id, i + 1]));
    groupTiers.set(key, list);
  }
  return list.get(mod.id) || null;
}

// Jewels, flasks and charms take their mods from a table the bundled data doesn't carry (they
// aren't in ModItem.lua), so every line would come out as "no data". Don't guess at all.
const UNSUPPORTED = /jewel|flask|charm/i;
function maxAffixes(item) {
  if (UNSUPPORTED.test(String(item.slot || '')) || UNSUPPORTED.test(String(item.itemClass || ''))) return 0;
  const rar = String(item.rarity || '').toLowerCase();
  if (rar === 'magic') return 1;
  if (rar === 'rare') return 3;
  return 0;
}

// Fills in item.affixes and per-line line.affix for a plain (non-advanced) copy.
// Advanced copies already carry the game's own answer, so they're left alone.
function infer(item) {
  if (!item || !Array.isArray(item.lines)) return item;
  // advanced copies (Ctrl+Alt+C) carry the game's own answer and are never touched; anything this
  // code inferred is redone every time, so a fix to the matching shows up without a data migration
  if (item.affixes && item.affixes.known && !item.affixes.inferred) return item;
  if (item.affixes && item.affixes.inferred) {
    for (const l of item.lines) if (l.affix && l.affix.inferred) delete l.affix;
    item.affixes = null;
  }
  fixBaseLines(item);
  const max = maxAffixes(item);
  if (!max) return item;

  const explicit = item.lines.filter((l) => l.tag === 'explicit' && l.text);
  if (!explicit.length) return item;

  const tags = tagsFor(item);
  const ilvl = item.itemLevel || 0;
  const present = new Set(explicit.map((l) => lineKey(l.text)));
  const picked = new Map(); // group+type -> { mod, lines }

  // Every line of a mod has to be on the item (hybrid affixes have two), it has to be
  // able to roll on this base, and its ilvl can't be above the item's.
  const eligible = new Set();
  const beyond = new Set();
  const topLevel = (mod) => Math.max(...mods.filter((m) => m.t === mod.t && m.g === mod.g && weightOf(m, tags) > 0).map((m) => m.l));
  const linesFor = (stat) => explicit.filter((l) => lineKey(l.text) === stat.K);
  // the same line text can appear twice on one item ("106% increased Evasion Rating" from the
  // local affix and "41%…" from a global one), so a mod only needs *a* line that fits its roll
  const lineFits = (stat, inside) => linesFor(stat).some((l) => inside(l.text, stat.v || []));
  for (const line of explicit) {
    for (const mod of byLine.get(lineKey(line.text)) || []) {
      if (mod.l > ilvl) continue;
      if (!weightOf(mod, tags)) continue;
      if (!mod.s.every((stat) => present.has(stat.K))) continue;
      if (!mod.s.every((stat) => lineFits(stat, inRange))) continue;
      eligible.add(mod);
    }
  }
  // Which lines a known tier already explains. Tracked per line, not per text: an item can carry
  // the same text twice and only one of the two may sit inside a tier.
  const explained = new Set();
  for (const mod of eligible) {
    for (const stat of mod.s) {
      for (const l of linesFor(stat)) if (inRange(l.text, stat.v || [])) explained.add(l);
    }
  }
  // The game collapses two prefixes that raise the same stat into one line: Soul Nock's
  // "254% increased Physical Damage" is really the 170-179% tier plus the 75-79% half of a hybrid
  // that also gives accuracy (the "+186 to Accuracy Rating" further down). Look for that before
  // calling a roll "above the data": a leftover line plus another line that a two-stat affix
  // explains, with some split of the number landing on a tier of each.
  const merges = [];
  const mergedLines = new Set();
  const mergedPartners = new Set();
  const mergeSeats = { p: 0, s: 0 };
  for (const line of explicit) {
    if (explained.has(line)) continue;
    const key = lineKey(line.text);
    const nums = numbersOf(line.text);
    if (nums.length !== 1) continue;
    const value = nums[0];
    for (const hybrid of byLine.get(key) || []) {
      if (hybrid.s.length < 2 || hybrid.l > ilvl || !weightOf(hybrid, tags)) continue;
      const own = hybrid.s.find((st) => st.K === key);
      const others = hybrid.s.filter((st) => st.K !== key);
      if (!own || own.v.length !== 1) continue;
      if (!others.every((st) => present.has(st.K))) continue;
      // the hybrid's other half has to be a line that sits inside one of its tiers
      const partner = others.map((st) => ({
        stat: st,
        line: explicit.find((l) => lineKey(l.text) === st.K && inRange(l.text, st.v || [])),
      }));
      if (partner.some((p) => !p.line)) continue;
      const h = own.v[0];
      // ... and some roll of the hybrid's own half has to leave the rest on a tier of the plain affix
      let hit = null;
      for (const plain of byLine.get(key) || []) {
        if (plain.s.length !== 1 || plain.g === hybrid.g) continue;
        if (plain.t !== hybrid.t) continue; // a prefix never adds up with a suffix
        if (plain.l > ilvl || !weightOf(plain, tags)) continue;
        const r = plain.s[0].v && plain.s[0].v[0];
        if (!r) continue;
        const lo = Math.max(h[0], value - r[1]);
        const hi = Math.min(h[1], value - r[0]);
        if (lo > hi + 0.5) continue;
        hit = { plain, lo, hi };
        break;
      }
      if (!hit) continue;
      // the pair takes two seats on its side, so it can't be added to a side that is already full
      if (mergeSeats[hit.plain.t] + 2 > max) continue;
      mergeSeats[hit.plain.t] += 2;
      merges.push({ line, hybrid, partner, plain: hit.plain, ownRange: [hit.lo, hit.hi] });
      mergedLines.add(line);
      for (const p of partner) mergedPartners.add(p.line);
      break;
    }
  }

  // A newer league can roll above the highest tier Path of Building knows. Only when no known
  // tier covers the line at all, attribute it to the group's top tier and say so.
  for (const line of explicit) {
    if (explained.has(line) || mergedLines.has(line)) continue;
    for (const mod of byLine.get(lineKey(line.text)) || []) {
      if (mod.l > ilvl) continue;
      if (!weightOf(mod, tags)) continue;
      if (mod.l !== topLevel(mod)) continue;
      if (!mod.s.every((stat) => present.has(stat.K))) continue;
      if (!mod.s.every((stat) => lineFits(stat, aboveRange))) continue;
      eligible.add(mod);
      beyond.add(mod.id);
    }
  }

  // hybrids first (their two lines have to be claimed together), then the tightest tier that still
  // holds the roll: with only the maxima compared, a small roll fits every higher tier as well, so
  // the roll has to go to the tier whose top it sits closest under
  const tightness = (mod) => mod.s.reduce((sum, stat) => {
    const ranges = stat.v || [];
    const fits = linesFor(stat).map((l) => slackOf(l.text, ranges)).filter((s) => s >= -0.51);
    return fits.length ? sum + Math.min(...fits) : Infinity;
  }, 0);
  // hybrids first, then the affixes that only fit one side (they have nowhere else to go), then the
  // tightest tier: with only the maxima compared a small roll fits every higher tier as well
  const ranked = [...eligible].sort((a, b) => b.s.length - a.s.length
    || Number(twoSided(a)) - Number(twoSided(b))
    || tightness(a) - tightness(b)
    || b.l - a.l);
  // each stat line belongs to one affix. Grouping by affix group instead dropped real mods: a body
  // armour can carry "106% increased Evasion Rating" and "41% increased Evasion Rating" (local and
  // global reads the same in the item text) and both are worth showing.
  const owner = new Map();
  // Each side only has `max` seats. The same text can exist as a prefix and as a suffix (a ring's
  // "increased Rarity of Items found" does), so a candidate for a full side is skipped rather than
  // taking the seat of one that has nowhere else to go.
  const seats = { p: 0, s: 0 };
  for (const m of merges) { seats[m.plain.t] += 1; seats[m.hybrid.t] += 1; }
  for (const mod of ranked) {
    if (seats[mod.t] >= max) continue;
    const used = [];
    for (const stat of mod.s) {
      const ranges = stat.v || [];
      // a line the merged pair already accounts for isn't free for another affix
      const free = linesFor(stat).filter((l) => !owner.has(l) && !mergedPartners.has(l));
      const bySlack = (x, y) => slackOf(x.text, ranges) - slackOf(y.text, ranges);
      // a roll over the tier's top only belongs to the mod that was marked as out-of-range
      const over = beyond.has(mod.id) ? free.filter((l) => aboveRange(l.text, ranges)).sort(bySlack)[0] : null;
      // never fall back to "any free line": a line that fits no tier of this affix belongs to a
      // different one ("106% increased Evasion Rating" is not the 27-42% mod)
      const hit = free.filter((l) => inRange(l.text, ranges)).sort(bySlack)[0] || over;
      if (!hit) break;
      used.push(hit);
    }
    if (used.length !== mod.s.length) continue; // a hybrid needs a free line for each of its stats
    for (const line of used) owner.set(line, mod);
    seats[mod.t] += 1;
    picked.set(picked.size, { mod, lines: used });
  }

  // A rare item has at most 3 prefixes and 3 suffixes: keep the highest tiers.
  // an essence mod has a fixed roll and no tier ladder, so no tier and no "over the top tier" mark
  const withTier = [...picked.values()].map((entry) => ({
    ...entry,
    tier: entry.mod.e ? null : tierOf(entry.mod, tags),
    beyond: !entry.mod.e && beyond.has(entry.mod.id),
  }));
  const prefixes = withTier.filter((e) => e.mod.t === 'p').sort((a, b) => (a.tier || 99) - (b.tier || 99) || b.mod.l - a.mod.l).slice(0, max);
  const suffixes = withTier.filter((e) => e.mod.t === 's').sort((a, b) => (a.tier || 99) - (b.tier || 99) || b.mod.l - a.mod.l).slice(0, max);

  // the merged pairs first: one line carries two affixes, the partner line belongs to the hybrid
  const kindOf = (mod) => (mod.t === 'p' ? 'prefix' : 'suffix');
  for (const m of merges) {
    // what the plain affix's own roll must have been: the line minus the hybrid's half
    const shown = numbersOf(m.line.text)[0];
    m.line.affix = {
      kind: kindOf(m.plain),
      t: m.plain.t,
      id: m.plain.id,
      name: m.plain.n,
      tier: tierOf(m.plain, tags),
      group: m.plain.g,
      inferred: true,
      // the game adds the two rolls together on one line: keep what the item says and how it splits
      merged: [{
        kind: kindOf(m.hybrid),
        t: m.hybrid.t,
        id: m.hybrid.id,
        name: m.hybrid.n,
        tier: tierOf(m.hybrid, tags),
        group: m.hybrid.g,
        range: m.ownRange,
        splitRange: [shown - m.ownRange[1], shown - m.ownRange[0]],
        total: shown,
      }],
    };
    for (const p of m.partner) {
      p.line.affix = {
        kind: kindOf(m.hybrid),
        t: m.hybrid.t,
        id: m.hybrid.id,
        name: m.hybrid.n,
        tier: tierOf(m.hybrid, tags),
        group: m.hybrid.g,
        inferred: true,
        // this line belongs to the hybrid whose other roll was folded into the line above
        ofMerged: { range: m.ownRange, from: m.line.text },
      };
    }
  }

  for (const entry of [...prefixes, ...suffixes]) {
    for (const line of entry.lines) {
      if (line.affix) continue;
      line.affix = {
        // an essence mod has a fixed roll and no tier ladder; say where it came from instead
        kind: entry.mod.e ? 'essence' : entry.mod.t === 'p' ? 'prefix' : 'suffix',
        t: entry.mod.t,
        id: entry.mod.id,
        name: entry.mod.n,
        tier: entry.tier,
        group: entry.mod.g,
        inferred: true,
        ...(entry.beyond ? { beyond: true } : {}),
      };
    }
  }

  // no early return when nothing matched: every explicit line still gets an "unknown" badge, so a
  // bad data patch shows up as "no data" instead of as an item with no mods at all
  // explicit lines the bundled affix data doesn't know (an older PoB, or a mod the game added):
  // mark them so an empty badge reads as "no data" rather than a bug. A line we did match but
  // couldn't place had its side already full (3 prefixes / 3 suffixes).
  for (const line of explicit) {
    if (line.affix) continue;
    // why is it not placed? the data has no version of this line for this base (new Marksman
    // mods), it has one but the roll is outside every tier (a roll above the data, or a quality
    // boosted value), or it matched and its side was already full
    const key = lineKey(line.text);
    const cands = (byLine.get(key) || []).filter((m) => m.l <= ilvl && weightOf(m, tags) > 0);
    const reason = !cands.length ? 'missing'
      : cands.some((m) => m.s.some((stat) => stat.K === key && inRange(line.text, stat.v || []))) ? 'overflow'
        : 'range';
    line.affix = { kind: 'unknown', inferred: true, reason };
  }
  // count what was actually written, not what the ranking hoped to write: one affix can own
  // several lines (a hybrid) and a merged pair owns two, and the two must not be counted twice
  const counted = { p: new Set(), s: new Set() };
  for (const line of item.lines) {
    const a = line.affix;
    if (a && a.id && a.t) counted[a.t].add(a.id);
  }
  item.affixes = {
    known: true,
    inferred: true,
    v: VERSION,
    prefixes: counted.p.size,
    suffixes: counted.s.size,
    openPrefix: item.corrupted ? 0 : Math.max(0, max - counted.p.size),
    openSuffix: item.corrupted ? 0 : Math.max(0, max - counted.s.size),
  };
  return item;
}

module.exports = { infer, lineKey, tagsFor };
