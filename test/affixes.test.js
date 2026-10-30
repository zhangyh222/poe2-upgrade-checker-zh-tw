'use strict';

// Regression tests for the affix inference (src/core/affixes.js). Everything here is a case that
// went wrong once:
//   - a hybrid affix printing two lines looked like two affixes (body armour "four prefixes")
//   - a boot was given a tier a boot cannot roll (weight 0 in the game's spawn table)
//   - the game adding two affixes into one line ("254% increased Physical Damage")
//   - case differences between the game's text and Path of Building's templates
const test = require('node:test');
const assert = require('node:assert');

const { infer, lineKey } = require('../src/core/affixes');
const { parseItem } = require('../src/core/parser');
const { mods } = require('../src/data/affixes.json');

const BODY = `Item Class: Body Armours
Rarity: Rare
Vortex Cloak
Slipstrike Vest
--------
Item Level: 82
--------
40% increased Armour, Evasion and Energy Shield (enchant)
10% increased Movement Speed when on Full Life (enchant)
--------
Evasion: 3240
106% increased Evasion Rating
+81 to Evasion Rating
41% increased Evasion Rating
+44% to Fire Resistance
+45% to Cold Resistance
Gain Deflection Rating equal to 24% of Evasion Rating
+296 to Evasion Rating
--------
Corrupted
`;

const WEAPON = `Item Class: Bows
Rarity: Rare
Soul Nock
Warmonger Bow
--------
Item Level: 83
--------
+1 Suffix Modifier allowed (enchant)
20% increased Physical Damage (enchant)
--------
+5% to Critical Hit Chance
254% increased Physical Damage
+186 to Accuracy Rating
+25% to Critical Damage Bonus
+4 to Level of all Projectile Skills
+198% Surpassing chance to fire an additional Arrow
Adds 37 to 63 Physical Damage
`;

const BOOTS = `Item Class: Boots
Rarity: Rare
Chimeric Span
Daggerfoot Shoes
--------
Energy Shield: 178
--------
Item Level: 83
--------
5% increased Movement Speed (enchant)
--------
Evasion: 574
+76 to Evasion Rating
+24 to maximum Energy Shield
35% increased Movement Speed
98% increased Evasion and Energy Shield
+44% to Cold Resistance
+15 to Spirit
Gain Deflection Rating equal to 22% of Evasion Rating
`;

const MOD_BY_ID = new Map(mods.map((m) => [m.id, m]));

function build(raw) {
  const item = parseItem(raw);
  assert.ok(item, 'item should parse');
  infer(item);
  assert.ok(item.affixes && item.affixes.known, 'affixes should be inferred');
  return item;
}

// every affix id that actually got used, with the lines it owns
function used(item) {
  const map = new Map();
  for (const line of item.lines) {
    const a = line.affix;
    if (!a || !a.id || !a.t) continue;
    if (!map.has(a.id)) map.set(a.id, { affix: a, lines: [] });
    map.get(a.id).lines.push(line);
  }
  return map;
}

function counts(item) {
  const map = used(item);
  let prefixes = 0;
  let suffixes = 0;
  for (const { affix } of map.values()) {
    if (affix.t === 'p') prefixes += 1;
    else if (affix.t === 's') suffixes += 1;
  }
  return { prefixes, suffixes };
}

test('lineKey folds case and numbers', () => {
  assert.equal(lineKey('+44% to Fire Resistance'), lineKey('+12% to fire resistance'));
  assert.equal(lineKey('15% increased Movement Speed (enchant)'), lineKey('9% increased movement speed'));
});

test('a hybrid affix owns two lines but counts as one prefix', () => {
  const item = build(BODY);
  const map = used(item);
  assert.deepEqual(counts(item), { prefixes: 3, suffixes: 3 });
  assert.equal(item.affixes.prefixes, 3);
  assert.equal(item.affixes.openPrefix, 0);

  // "41% increased Evasion Rating" and "+81 to Evasion Rating" are one affix
  const antelope = [...map.values()].find((x) => x.lines.length === 2);
  assert.ok(antelope, 'one affix should own two lines');
  assert.equal(antelope.affix.name, "Antelope's");
  assert.equal(antelope.affix.tier, 1);
  assert.equal(new Set(antelope.lines.map((l) => l.affix.tier)).size, 1, 'both lines share the tier');
});

test('a boot is only offered the tiers a boot can roll', () => {
  const item = build(BOOTS);
  const map = used(item);
  for (const line of item.lines) {
    if (!line.affix || line.affix.kind !== 'prefix') continue;
    if (!/Evasion Rating and maximum Energy Shield|maximum Energy Shield and/.test(line.text)) continue;
  }
  const hybrid = [...map.values()].find((x) => x.affix.name === "Cherub's");
  assert.ok(hybrid, 'the boots evasion/energy shield hybrid should be found');
  assert.equal(hybrid.affix.tier, 1, 'for boots this group has four tiers, so +76/+24 is the top one');
  assert.equal(hybrid.lines.length, 2);
});

test('two affixes the game adds into one line are split apart', () => {
  const item = build(WEAPON);
  const merged = item.lines.find((l) => l.affix && l.affix.merged);
  assert.ok(merged, 'the 254% line should be recognised as two affixes');
  assert.equal(merged.affix.name, 'Merciless');
  assert.equal(merged.affix.tier, 1);

  const second = merged.affix.merged[0];
  assert.equal(second.name, "Dictator's");
  assert.equal(second.tier, 1);
  // 254 = 175..179 + 75..79
  assert.deepEqual(second.range, [75, 79]);
  assert.deepEqual(second.splitRange, [175, 179]);

  // the accuracy line belongs to the same hybrid
  const acc = item.lines.find((l) => /Accuracy Rating/.test(l.text));
  assert.equal(acc.affix.id, second.id);
  assert.equal(acc.affix.tier, second.tier);

  assert.deepEqual(counts(item), { prefixes: 3, suffixes: 3 });
});

test('the tier counts and open slots match what was written', () => {
  for (const raw of [BODY, WEAPON, BOOTS]) {
    const item = build(raw);
    const c = counts(item);
    assert.equal(item.affixes.prefixes, c.prefixes);
    assert.equal(item.affixes.suffixes, c.suffixes);
    assert.ok(c.prefixes <= 3, 'a rare has at most 3 prefixes');
    assert.ok(c.suffixes <= 3, 'a rare has at most 3 suffixes');
    assert.equal(item.affixes.openPrefix, 3 - c.prefixes);
  }
});

test('every placed affix has rolls inside its own tier', () => {
  for (const raw of [BODY, WEAPON, BOOTS]) {
    const item = build(raw);
    for (const map of used(item).values()) {
      for (const line of map.lines) {
        const a = line.affix;
        if (!a.tier || a.beyond) continue; // out-of-range lines are allowed to exceed it
        if (line.affix.merged) continue; // a line two affixes add up to can't be checked one by one
        const mod = MOD_BY_ID.get(a.id);
        assert.ok(mod, `${a.id} should be in the affix data`);
        const nums = (line.text.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        for (const stat of mod.s) {
          if (stat.K !== lineKey(line.text)) continue;
          if (stat.v.length !== nums.length) continue;
          stat.v.forEach(([, max], i) => {
            assert.ok(nums[i] <= max + 0.51,
              `${line.text} rolls ${nums[i]} but ${a.id} tier ${a.tier} tops out at ${max}`);
          });
        }
      }
    }
  }
});

test('spawn weights are kept so a slot can be excluded', () => {
  // a boot can't roll the tiers a helmet can: the game lists boots with weight 0 in that row
  const bootHybrid = mods.find((m) => m.id === 'LocalBaseEvasionRatingAndEnergyShield8___');
  assert.ok(bootHybrid.w.length > 0);
  const gloves = bootHybrid.w.find(([tag]) => tag === 'boots');
  assert.ok(gloves && gloves[1] === 0, 'the game excludes boots from this tier');
  // and the key list only holds the tags it may actually spawn on
  assert.ok(!bootHybrid.k.includes('boots'));
});

const MAGIC = `Item Class: Rings
Rarity: Magic
Thirsty Loop
Gold Ring
--------
Item Level: 40
--------
+20 to maximum Life
+15% to Fire Resistance
`;

const BOGUS = `Item Class: Rings
Rarity: Rare
Bogus Ring
Gold Ring
--------
Item Level: 40
--------
+1234 to a Stat That Does Not Exist
`;

test('a magic item gets one prefix and one suffix', () => {
  const item = build(MAGIC);
  const map = used(item);
  assert.equal(map.size, 2);
  assert.deepEqual(counts(item), { prefixes: 1, suffixes: 1 });
  assert.equal(item.affixes.openPrefix, 0);
  assert.equal(item.affixes.openSuffix, 0);
});

test('lines nothing matches are still labelled, not dropped', () => {
  const item = build(BOGUS);
  assert.equal(item.affixes.prefixes, 0);
  assert.equal(item.affixes.suffixes, 0);
  assert.equal(item.affixes.openPrefix, 3);
  const line = item.lines.find((l) => /Does Not Exist/.test(l.text));
  assert.ok(line && line.affix, 'the line keeps an affix entry');
  assert.equal(line.affix.kind, 'unknown');
  assert.equal(line.affix.reason, 'missing');
});

test('only lines that really add up are split', () => {
  const body = build(BODY);
  const boots = build(BOOTS);
  for (const item of [body, boots]) {
    const merged = item.lines.filter((l) => l.affix && l.affix.merged);
    assert.equal(merged.length, 0, 'these items have no added-up line');
  }
});

const RING = `Item Class: Rings
Rarity: Rare
Spirit Spiral
Gold Ring
--------
Item Level: 80
--------
15% increased Rarity of Items found (implicit)
--------
Adds 30 to 50 Cold damage to Attacks
Adds 4 to 99 Lightning damage to Attacks
+14% to all Elemental Resistances
+37% to Lightning Resistance
+15% to Chaos Resistance
16% increased Rarity of Items found
`;

test('a line that fits either side takes the side that is still open', () => {
  // "increased Rarity of Items found" is a prefix and a suffix in the data. Taken as a suffix it
  // would push one resistance out; taken as a prefix everything fits.
  const item = build(RING);
  assert.deepEqual(counts(item), { prefixes: 3, suffixes: 3 });
  const rarity = item.lines.find((l) => l.tag === 'explicit' && /Rarity of Items found/.test(l.text));
  assert.equal(rarity.affix.kind, 'prefix');
  const suffixes = item.lines.filter((l) => l.affix && l.affix.kind === 'suffix');
  assert.equal(suffixes.length, 3);
  assert.ok(!item.lines.some((l) => l.affix && l.affix.kind === 'unknown'), 'nothing left over');
});
