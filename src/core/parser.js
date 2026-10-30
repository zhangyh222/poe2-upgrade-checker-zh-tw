'use strict';

// Parses the text PoE2 puts on the clipboard when you hover an item and press
// Ctrl+C (or Ctrl+Alt+C for the advanced version with mod tiers).
//
// Output:
// {
//   itemClass, rarity, name, baseType, slot, twoHanded,
//   itemLevel, requiredLevel, corrupted, unidentified,
//   stats: { "<template>": number, ... },   // what gets scored
//   lines: [ { text, key, value, tag } ]    // for display
// }

const { slotForClass, isTwoHanded } = require('./slots');
const { infer } = require('./affixes');
const { toEnglish } = require('./localize');

const SEPARATOR = /^-{4,}\s*$/;
const NUM = /[+-]?\d+(?:\.\d+)?/g;
const TAG = /\s*\((implicit|rune|enchant|crafted|fractured|desecrated|augmented|unmet|veiled|mutated)\)\s*$/i;

const SKIP_LINE = [
  /^Requirements:?$/i, /^Requires\b/i, /^Level:/i, /^Str:/i, /^Dex:/i, /^Int:/i,
  /^Item Level:/i, /^Sockets:/i, /^Quality\b/i, /^Corrupted$/i, /^Unidentified$/i,
  /^Mirrored$/i, /^Note:/i, /^Rarity:/i, /^Item Class:/i, /^Stack Size:/i,
  /^Waystone Tier:/i, /^Unmodifiable$/i, /^Sanctified$/i, /^Twice Corrupted$/i,
];

// Base properties shown at the top of armour / weapon / shield items.
const PROPERTY_KEYS = {
  'armour': '[Base] Armour',
  // the game prints "Evasion: 496" on some items and "Evasion Rating: 496" on others
  'evasion': '[Base] Evasion Rating',
  'evasion rating': '[Base] Evasion Rating',
  'energy shield': '[Base] Energy Shield',
  'block chance': '[Base] Block Chance',
  'chance to block': '[Base] Block Chance',
  'spirit': '[Base] Spirit',
  'runic ward': '[Base] Runic Ward',
};

// Mods that really mean several stats at once. Expanded so you only have to
// weight e.g. Fire Resistance once and "all Elemental Resistances" counts too.
const RES = { fire: 'Fire', cold: 'Cold', lightning: 'Lightning', chaos: 'Chaos' };
const ATTR = { strength: 'Strength', dexterity: 'Dexterity', intelligence: 'Intelligence' };

function expand(key, value) {
  if (/^#% to all Elemental Resistances$/i.test(key)) {
    return ['Fire', 'Cold', 'Lightning'].map((e) => [`#% to ${e} Resistance`, value]);
  }
  let m = key.match(/^#% to (Fire|Cold|Lightning|Chaos) and (Fire|Cold|Lightning|Chaos) Resistances$/i);
  if (m) return [m[1], m[2]].map((e) => [`#% to ${RES[e.toLowerCase()]} Resistance`, value]);
  if (/^# to all Attributes$/i.test(key)) {
    return Object.values(ATTR).map((a) => [`# to ${a}`, value]);
  }
  m = key.match(/^# to (Strength|Dexterity|Intelligence) and (Strength|Dexterity|Intelligence)$/i);
  if (m) return [m[1], m[2]].map((a) => [`# to ${ATTR[a.toLowerCase()]}`, value]);
  return [[key, value]];
}

// Turn "+32% to Cold Resistance" into { key: "#% to Cold Resistance", value: 32 }.
function modToStat(text) {
  const nums = text.match(NUM);
  if (!nums) return null;
  let values = nums.map(Number);
  let key = text.replace(NUM, '#').replace(/\s+/g, ' ').trim();

  // "Adds 10 to 20 Fire Damage" -> average of the range
  let value;
  if (values.length === 2 && /# to #/.test(key)) value = (values[0] + values[1]) / 2;
  else value = values[0];

  // Normalise opposite wordings so they net against each other.
  if (/\breduced\b/i.test(key)) { key = key.replace(/\breduced\b/i, 'increased'); value = -Math.abs(value); }
  if (/\bless\b/i.test(key)) { key = key.replace(/\bless\b/i, 'more'); value = -Math.abs(value); }

  return { key, value };
}

function avgRanges(str) {
  // "20-38 (augmented), 5-9" -> sum of the averages of each range
  let total = 0;
  for (const m of str.matchAll(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/g)) {
    total += (Number(m[1]) + Number(m[2])) / 2;
  }
  return total;
}

// Mageblood's Mage's Legacies: each is a fixed always-on bonus (named after a PoE1 flask).
// Values from the community wikis (exiletown, urgametips) – the item text names the Legacy only.
// A Legacy you have twice applies once, but every duplicate raises the effect of all of them
// by the belt's "increased effect per duplicate" roll.
const LEGACY_LINE = /^Legacy of (Amethyst|Basalt|Bismuth|Diamond|Gold|Granite|Jade|Quicksilver|Ruby|Sapphire|Silver|Stibnite|Sulphur|Topaz)$/i;
const LEGACIES = {
  amethyst: [['#% to Chaos Resistance', 45]],
  basalt: [['#% increased Armour', 150]],
  bismuth: [['#% to all Elemental Resistances', 45]],
  diamond: [['#% increased Critical Hit Chance', 75]],
  gold: [['#% increased Rarity of Items found', 45]],
  granite: [['# to Armour', 2000]],
  jade: [['# to Evasion Rating', 2000]],
  quicksilver: [['#% increased Movement Speed', 30]],
  ruby: [['#% to Fire Resistance', 60], ['#% to Maximum Fire Resistance', 5]],
  sapphire: [['#% to Cold Resistance', 60], ['#% to Maximum Cold Resistance', 5]],
  silver: [['#% increased Skill Speed', 30]],
  stibnite: [['#% increased Evasion Rating', 150]],
  sulphur: [['#% increased Damage', 60]],
  topaz: [['#% to Lightning Resistance', 60], ['#% to Maximum Lightning Resistance', 5]],
};
function applyLegacies(item, names, add) {
  const dupKey = Object.keys(item.stats).find((k) => /increased effect per duplicate Mage's Legacy/i.test(k));
  const perDup = dupKey ? Number(item.stats[dupKey]) || 0 : 0;
  const unique = [...new Set(names)];
  const dups = names.length - unique.length;
  const mult = 1 + (perDup / 100) * dups;
  item.legacies = { names: unique, duplicates: dups, effect: mult };
  for (const n of unique) for (const [k, v] of LEGACIES[n] || []) add(k, Math.round(v * mult * 10) / 10);
}

// Lines that only carry information: they never hold a mod.
const META_LINE = /^(Corrupted|Unidentified|Mirrored|Unmodifiable|Sanctified|Twice Corrupted|Note:.*|Sockets:.*|Item Level:.*)$/i;
// Prose: a flavour-text line starts lower case or with a quote, or ends with punctuation. Mod lines don't.
const PROSE = /^[a-z"'“‘«]|[.,;:!?"'”’»…]$/;

// A unique's flavour text is its last block of text: plain prose with no mod tags, no advanced-copy
// headers and no Mage's Legacies, after at least one other block.
function flavourBlock(blocks, rarity) {
  if (!/unique/i.test(rarity || '')) return -1;
  let last = -1; let content = 0;
  blocks.forEach((b, i) => {
    if (i === 0) return;
    if (b.some((l) => !META_LINE.test(l))) { last = i; content++; }
  });
  if (last < 0 || content < 2) return -1;
  const lines = blocks[last].filter((l) => !META_LINE.test(l));
  if (lines.some((l) => l.startsWith('{') || TAG.test(l) || LEGACY_LINE.test(l) || /^[A-Za-z ]+:\s/.test(l))) return -1;
  return lines.some((l) => PROSE.test(l)) ? last : -1;
}

function parseItem(raw) {
  if (typeof raw !== 'string') return null;
  // A Chinese client copies the same layout with Chinese labels and mod lines; turn that into
  // the English shape everything else here (scoring, trade search, Path of Building) expects.
  const text = (toEnglish(raw) || raw).replace(/\r\n?/g, '\n').trim();
  if (!/^Item Class:/i.test(text)) return null;

  const blocks = [];
  let cur = [];
  for (const line of text.split('\n')) {
    if (SEPARATOR.test(line)) { blocks.push(cur); cur = []; }
    else if (line.trim()) cur.push(line.trim());
  }
  blocks.push(cur);

  const header = blocks[0] || [];
  const item = {
    raw: text, // the game's own text, for Path of Building
    itemClass: null, rarity: null, name: null, baseType: null,
    slot: null, twoHanded: false, itemLevel: null, requiredLevel: null,
    corrupted: false, unidentified: false, stats: {}, lines: [],
  };

  const names = [];
  for (const line of header) {
    let m;
    if ((m = line.match(/^Item Class:\s*(.+)$/i))) item.itemClass = m[1].trim();
    else if ((m = line.match(/^Rarity:\s*(.+)$/i))) item.rarity = m[1].trim();
    else names.push(line);
  }
  item.name = names[0] || null;
  item.baseType = names[1] || names[0] || null;
  // a magic item's only name line includes its affixes ("Hale Gold Ring of the Whelpling"), and
  // normal items can be "Superior …": neither is a base type the trade site knows
  const rarLower = String(item.rarity || '').toLowerCase();
  if (!names[1] && rarLower === 'magic') item.baseType = null;
  if (item.baseType && rarLower === 'normal') item.baseType = item.baseType.replace(/^Superior /, '');
  item.slot = slotForClass(item.itemClass);
  item.twoHanded = isTwoHanded(item.itemClass);

  const add = (key, value) => {
    for (const [k, v] of expand(key, value)) {
      item.stats[k] = (item.stats[k] || 0) + v;
    }
  };

  // Advanced copy ({ Prefix Modifier ... } headers) tells us how many affixes
  // are used, so we can say how many are still open for crafting.
  let prefixes = 0; let suffixes = 0; let sawHeaders = false;

  const legacies = []; // Mageblood: "Legacy of Bismuth" lines

  // Weapon damage bits, collected from the property block.
  let phys = 0, ele = 0, chaos = 0, aps = 0, crit = 0;

  const flavour = flavourBlock(blocks, item.rarity);

  blocks.slice(1).forEach((block, bi) => {
    if (bi + 1 === flavour) {
      // flavour text: keep only the lines that matter (Corrupted etc.)
      if (block.some((l) => /^Corrupted$/i.test(l))) item.corrupted = true;
      if (block.some((l) => /^Unidentified$/i.test(l))) item.unidentified = true;
      return;
    }
    // in advanced text the header line says what kind of mod follows; the line itself has no tag
    let headerTag = null;
    // Advanced copy names the affix: { Prefix Modifier "Hale" (Tier: 3) — Life }
    let headerAffix = null;
    let inReminder = false;
    block.forEach((line) => {
      // reminder text, "(Maximum Resistances cannot be raised above 90%)", is never a mod;
      // it can run over several lines
      if (inReminder) { if (/\)\s*$/.test(line)) inReminder = false; return; }
      if (line.startsWith('(')) {
        if (!/\)\s*$/.test(line)) inReminder = true;
        return;
      }
      // Advanced (Ctrl+Alt+C) descriptor lines like { Prefix Modifier "Hale" (Tier: 3) }
      if (line.startsWith('{')) {
        sawHeaders = true;
        // "{ Crafted Suffix Modifier \"X\" (Tier: 5) — … }" is a real affix too
        const affix = line.match(/^\{\s*(?:(Crafted|Fractured|Desecrated)\s+)?(Prefix|Suffix)\s+Modifier\s+"([^"]*)"(?:\s*\(Tier:\s*(\d+)\))?(?:\s*[—–-]\s*(.+?))?\s*\}$/i);
        headerAffix = affix ? {
          kind: affix[2].toLowerCase(),
          name: affix[3],
          tier: affix[4] ? Number(affix[4]) : null,
          group: (affix[5] || '').trim() || null,
          crafted: !!(affix[1] && /crafted/i.test(affix[1])),
        } : null;
        if (/(Crafted\s+)?Prefix Modifier/i.test(line)) prefixes++;
        else if (/(Crafted\s+)?Suffix Modifier/i.test(line)) suffixes++;
        headerTag = /Implicit Modifier/i.test(line) ? 'implicit'
          : /Enchant/i.test(line) ? 'enchant'
          : /Rune Modifier|Augment/i.test(line) ? 'rune'
          : /Fractured/i.test(line) ? 'fractured'
          : /Desecrated/i.test(line) ? 'desecrated'
          : /Crafted/i.test(line) ? 'crafted'
          : 'explicit';
        return;
      }
      // Advanced text puts mod ranges in brackets: +89(80-99) to maximum Life
      const clean = line.replace(/\((-?\d+(?:\.\d+)?)[-–](-?\d+(?:\.\d+)?)\)/g, '')
        .replace(/\s+[—–-]+\s*Unscalable Value\s*$/i, ''); // advanced-copy note

      let m;
      if ((m = clean.match(/^Quality:\s*\+?(\d+(?:\.\d+)?)/i))) { item.quality = Number(m[1]); item.lines.push({ text: line, key: null, value: null, tag: 'prop' }); return; }
      if ((m = clean.match(/^Item Level:\s*(\d+)/i))) { item.itemLevel = Number(m[1]); item.lines.push({ text: line, key: null, value: null, tag: 'prop' }); return; }
      if ((m = clean.match(/^Level:\s*(\d+)/i))) { item.requiredLevel = Number(m[1]); item.lines.push({ text: line, key: null, value: null, tag: 'req' }); return; }
      if ((m = clean.match(/^Requires:?\s*Level\s*(\d+)/i))) { item.requiredLevel = Number(m[1]); item.lines.push({ text: line, key: null, value: null, tag: 'req' }); return; }
      if (/^Corrupted$/i.test(clean)) { item.corrupted = true; item.lines.push({ text: line, key: null, value: null, tag: 'flag' }); return; }
      if (/^Unidentified$/i.test(clean)) { item.unidentified = true; item.lines.push({ text: line, key: null, value: null, tag: 'flag' }); return; }
      // lines that are shown in the game's tooltip but never scored: keep them in
      // order so the item can be drawn the way the game draws it
      if (SKIP_LINE.some((r) => r.test(clean))) {
        if (/^Requirements:?$/i.test(clean) || /^(Requires|Level|Str|Dex|Int):/i.test(clean)) item.lines.push({ text: line, key: null, value: null, tag: 'req' });
        else if (/^(Quality|Sockets|Item Level|Stack Size|Waystone Tier)\b/i.test(clean)) item.lines.push({ text: line, key: null, value: null, tag: 'prop' });
        else if (/^(Corrupted|Unidentified|Mirrored|Unmodifiable|Sanctified|Twice Corrupted)$/i.test(clean)) item.lines.push({ text: line, key: null, value: null, tag: 'flag' });
        return;
      }

      // "Key: value" property lines
      const prop = clean.match(/^([A-Za-z ]+):\s*(.+)$/);
      if (prop) {
        const pk = prop[1].trim().toLowerCase();
        const pv = prop[2].replace(TAG, '');
        if (PROPERTY_KEYS[pk]) {
          const n = pv.match(NUM);
          if (n) {
            const key = PROPERTY_KEYS[pk];
            add(key, Number(n[0]));
            item.lines.push({ text: line, key, value: Number(n[0]), tag: 'base' });
          }
          return;
        }
        if (pk === 'physical damage') { phys += avgRanges(pv); return; }
        if (pk === 'elemental damage' || /^(fire|cold|lightning) damage$/.test(pk)) { ele += avgRanges(pv); return; }
        if (pk === 'chaos damage') { chaos += avgRanges(pv); return; }
        if (pk === 'attacks per second') { aps = Number((pv.match(NUM) || [0])[0]); return; }
        if (pk === 'critical hit chance' || pk === 'critical strike chance') {
          crit = Number((pv.match(NUM) || [0])[0]); return;
        }
        // Other "X: Y" lines (Grants Skill, Reload Time, etc.) are shown but not scored.
        item.lines.push({ text: line, key: null, value: null, tag: 'info' });
        return;
      }

      const tagMatch = clean.match(TAG);
      const tag = tagMatch ? tagMatch[1].toLowerCase() : (headerTag || 'explicit');
      const modText = clean.replace(TAG, '').replace(TAG, '').trim();
      const leg = modText.match(LEGACY_LINE);
      if (leg) {
        legacies.push(leg[1].toLowerCase());
        item.lines.push({ text: line, key: null, value: null, tag });
        return;
      }
      const stat = modToStat(modText);
      if (!stat) {
        // Text-only mods have no stat to score but are still part of the item: unique jewels say
        // "Allocates Versatile Arms" or "Passives in Radius of Resonance can be Allocated…", and
        // dropping those left the jewel with nothing in its tooltip.
        item.lines.push({ text: line, key: null, value: null, tag });
        return;
      }
      add(stat.key, stat.value);
      item.lines.push({ text: line, key: stat.key, value: stat.value, tag, ...(headerAffix ? { affix: headerAffix } : {}) });
    });
  });

  if (legacies.length) applyLegacies(item, legacies, add);

  const rar = String(item.rarity || '').toLowerCase();
  if (sawHeaders && (rar === 'rare' || rar === 'magic')) {
    const max = rar === 'rare' ? (item.slot === 'Jewel' ? 2 : 3) : 1; // rare jewels: 2 prefixes, 2 suffixes
    item.affixes = {
      known: true, prefixes, suffixes,
      openPrefix: item.corrupted ? 0 : Math.max(0, max - prefixes),
      openSuffix: item.corrupted ? 0 : Math.max(0, max - suffixes),
    };
  } else {
    // plain copy: no affix headers, so work the prefix/suffix out from PoB's affix table
    item.affixes = { known: false };
    infer(item);
  }

  if (aps > 0) {
    const r = (x) => Math.round(x * 10) / 10;
    item.stats['[Weapon] Physical DPS'] = r(phys * aps);
    item.stats['[Weapon] Elemental DPS'] = r(ele * aps);
    if (chaos) item.stats['[Weapon] Chaos DPS'] = r(chaos * aps);
    item.stats['[Weapon] Total DPS'] = r((phys + ele + chaos) * aps);
    if (crit) item.stats['[Weapon] Critical Hit Chance'] = crit;
    item.stats['[Weapon] Attacks per Second'] = aps;
  }

  return item;
}

module.exports = { parseItem, modToStat, expand, LEGACIES };
