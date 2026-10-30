'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { parseItem } = require('../src/core/parser');
const { compare, score } = require('../src/core/scorer');
const { Store, DEFAULT_WEIGHTS } = require('../src/core/store');
const vm = require('vm');

const HELMET_NEW = `Item Class: Helmets
Rarity: Rare
Doom Visage
Expert Visored Helm
--------
Quality: +20% (augmented)
Armour: 312 (augmented)
--------
Requirements:
Level: 65
Str: 101
--------
Sockets: S
--------
Item Level: 79
--------
+12% to Cold Resistance (rune)
--------
+89 to maximum Life
+32% to Fire Resistance
+11% to all Elemental Resistances
+14 to Strength
12% reduced Attribute Requirements`;

const HELMET_OLD = `Item Class: Helmets\r
Rarity: Rare\r
Grim Crown\r
Visored Helm\r
--------\r
Armour: 180\r
--------\r
Item Level: 50\r
--------\r
+55 to maximum Life\r
+20% to Fire Resistance\r
+18% to Lightning Resistance`;

const ADVANCED_RING = `Item Class: Rings
Rarity: Rare
Storm Loop
Sapphire Ring
--------
Requirements:
Level: 40
--------
Item Level: 75
--------
{ Implicit Modifier }
+24(20-30)% to Cold Resistance (implicit)
--------
{ Prefix Modifier "Hale" (Tier: 4) — Life }
+62(55-69) to maximum Life
{ Suffix Modifier "of the Squall" (Tier: 3) — Elemental, Lightning, Resistance }
+30(26-30)% to Lightning Resistance
{ Suffix Modifier "of the Fox" — Attribute }
+12(9-15) to Strength and Dexterity`;

const WEAPON_2H = `Item Class: Two Hand Maces
Rarity: Rare
Brute Knell
Forge Maul
--------
Physical Damage: 100-160 (augmented)
Fire Damage: 20-40 (augmented)
Critical Hit Chance: 5.00%
Attacks per Second: 1.10
--------
Item Level: 70
--------
120% increased Physical Damage
Adds 20 to 40 Fire Damage
+40 to Strength`;

test('parses header, slot and properties', () => {
  const it = parseItem(HELMET_NEW);
  assert.equal(it.itemClass, 'Helmets');
  assert.equal(it.slot, 'Helmet');
  assert.equal(it.name, 'Doom Visage');
  assert.equal(it.baseType, 'Expert Visored Helm');
  assert.equal(it.itemLevel, 79);
  assert.equal(it.requiredLevel, 65);
  assert.equal(it.stats['[Base] Armour'], 312);
  assert.equal(it.stats['# to maximum Life'], 89);
});

test('expands all-res and sums rune + explicit', () => {
  const it = parseItem(HELMET_NEW);
  assert.equal(it.stats['#% to Fire Resistance'], 43);
  assert.equal(it.stats['#% to Cold Resistance'], 23);
  assert.equal(it.stats['#% to Lightning Resistance'], 11);
  assert.equal(it.stats['#% to all Elemental Resistances'], undefined);
  assert.equal(it.stats['#% increased Attribute Requirements'], -12);
});

test('handles CRLF and advanced (Ctrl+Alt+C) text', () => {
  assert.equal(parseItem(HELMET_OLD).stats['# to maximum Life'], 55);
  const ring = parseItem(ADVANCED_RING);
  assert.equal(ring.slot, 'Ring');
  assert.equal(ring.stats['# to maximum Life'], 62);
  assert.equal(ring.stats['#% to Cold Resistance'], 24);
  assert.equal(ring.stats['#% to Lightning Resistance'], 30);
  assert.equal(ring.stats['# to Strength'], 12);
  assert.equal(ring.stats['# to Dexterity'], 12);
});

test('plain copy: prefix/suffix and tier come from PoB affix data', () => {
  const it = parseItem(HELMET_NEW); // no { Prefix Modifier ... } headers
  const life = it.lines.find((l) => l.text === '+89 to maximum Life');
  assert.equal(life.affix.kind, 'prefix');
  assert.ok(life.affix.tier >= 1);
  assert.ok(it.affixes.inferred);
  assert.equal(it.affixes.openPrefix, 2);
  // the advanced copy keeps the game's own answer instead of guessing
  const ring = parseItem(ADVANCED_RING);
  assert.equal(ring.affixes.inferred, undefined);
  assert.ok(ring.lines.some((l) => l.affix && l.affix.tier));
});

test('weapon DPS and two-handed detection', () => {
  const w = parseItem(WEAPON_2H);
  assert.equal(w.slot, 'Weapon');
  assert.equal(w.twoHanded, true);
  assert.equal(w.stats['[Weapon] Physical DPS'], 143);
  assert.equal(w.stats['[Weapon] Elemental DPS'], 33);
  assert.equal(w.stats['[Weapon] Total DPS'], 176);
  assert.equal(w.stats['Adds # to # Fire Damage'], 30);
});

test('non-items and unsupported items', () => {
  assert.equal(parseItem('hello'), null);
  const cur = parseItem('Item Class: Stackable Currency\nRarity: Currency\nDivine Orb\n--------\nStack Size: 1/20');
  const unsupported = compare(cur, {}, DEFAULT_WEIGHTS);
  assert.equal(unsupported.ok, false);
  assert.deepEqual(unsupported.reason, {
    key: 'This item class ({0}) is not gear, so there is nothing to compare.',
    args: ['Stackable Currency'],
  });
  const markedItem = compare({ slot: 'Helmet', stats: {}, unidentified: true, corrupted: true }, {}, DEFAULT_WEIGHTS);
  assert.deepEqual(markedItem.notes.slice(0, 2), [
    { key: 'Item is unidentified – mods are hidden, so the score only covers its base.', kind: 'detail' },
    { key: 'Corrupted – it cannot be modified further.', kind: 'detail' },
  ]);
  const flask = parseItem('Item Class: Life Flasks\nRarity: Magic\nFlask\n--------\nItem Level: 10');
  assert.equal(flask.slot, 'Life Flask');
  const jewel = parseItem('Item Class: Jewels\nRarity: Rare\nA\nSapphire\n--------\nMinions deal 10% increased Damage');
  const r = compare(jewel, { 'Jewel 1': parseItem('Item Class: Jewels\nRarity: Rare\nB\nSapphire\n--------\nMinions deal 5% increased Damage') }, DEFAULT_WEIGHTS);
  assert.equal(r.targetSlot, 'Jewel 2'); // empty jewel slot first
});

test('compare helmet: upgrade', () => {
  const eq = { Helmet: parseItem(HELMET_OLD) };
  const r = compare(parseItem(HELMET_NEW), eq, DEFAULT_WEIGHTS);
  assert.equal(r.ok, true);
  assert.equal(r.verdict, 'upgrade');
  assert.ok(r.delta > 0);
  const life = r.rows.find((x) => x.key === '# to maximum Life');
  assert.equal(life.diff, 34);
  // reverse is a downgrade
  const back = compare(parseItem(HELMET_OLD), { Helmet: parseItem(HELMET_NEW) }, DEFAULT_WEIGHTS);
  assert.equal(back.verdict, 'downgrade');
});

test('ring replaces the weaker ring / fills empty ring', () => {
  const ring = parseItem(ADVANCED_RING);
  const weak = parseItem('Item Class: Rings\nRarity: Magic\nWeak Ring\n--------\n+10 to maximum Life');
  const strong = parseItem('Item Class: Rings\nRarity: Rare\nStrong\nRing\n--------\n+200 to maximum Life');
  const r = compare(ring, { 'Ring 1': strong, 'Ring 2': weak }, DEFAULT_WEIGHTS);
  assert.equal(r.targetSlot, 'Ring 2');
  assert.equal(r.verdict, 'upgrade');
  const r2 = compare(ring, { 'Ring 1': strong }, DEFAULT_WEIGHTS);
  assert.equal(r2.targetSlot, 'Ring 2');
  assert.equal(r2.verdict, 'new');
});

test('two-hander compared against weapon + offhand', () => {
  const oneH = parseItem('Item Class: One Hand Maces\nRarity: Rare\nA\nB\n--------\nPhysical Damage: 10-20\nAttacks per Second: 1.50\n--------\n+30 to maximum Life');
  const shield = parseItem('Item Class: Shields\nRarity: Rare\nS\nT\n--------\nArmour: 200\n--------\n+50 to maximum Life');
  const r = compare(parseItem(WEAPON_2H), { Weapon: oneH, Offhand: shield }, DEFAULT_WEIGHTS);
  assert.deepEqual(r.replacing, ['A', 'S']);
  const life = r.rows.find((x) => x.key === '# to maximum Life');
  assert.equal(life.oldValue, 80);
  assert.ok(r.notes.some((n) => /Two-handed/.test(typeof n === 'object' ? n.key : n)));
});

test('store persists and round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2uc-'));
  const s = new Store(dir);
  s.setWeight('# to maximum Life', 2);
  s.setWeight('#% to Chaos Resistance', 0);
  s.setEquipped('Helmet', parseItem(HELMET_OLD));
  const s2 = new Store(dir);
  assert.equal(s2.weights['# to maximum Life'], 2);
  assert.equal(s2.weights['#% to Chaos Resistance'], undefined);
  assert.equal(s2.equipped.Helmet.name, 'Grim Crown');
  assert.equal(score(s2.equipped.Helmet, { '# to maximum Life': 2 }), 110);
});

test('advanced-copy quirks: unscalable note, runic ward, fractured line', () => {
  const it = parseItem(`Item Class: Boots
Rarity: Rare
Oblivion Trail
Sorcerer Boots
--------
Energy Shield: 414 (augmented)
Runic Ward: 217 (augmented)
--------
+60(48-60) to maximum Energy Shield
35% increased Movement Speed
60% increased effect of Socketed Augment Items — Unscalable Value
Fractured Item`);
  assert.equal(it.stats['#% increased effect of Socketed Augment Items'], 60);
  assert.equal(it.stats['[Base] Runic Ward'], 217);
  assert.equal(it.stats['# to maximum Energy Shield'], 60);
  assert.equal(Object.keys(it.stats).some((k) => /Fractured/.test(k)), false);
});

test('copied item that is already equipped is flagged', () => {
  const h = parseItem(HELMET_OLD);
  const r = compare(parseItem(HELMET_OLD), { Helmet: h }, DEFAULT_WEIGHTS);
  assert.equal(r.isEquipped, true);
  assert.equal(r.verdict, 'equipped');
  const r2 = compare(parseItem(HELMET_NEW), { Helmet: h }, DEFAULT_WEIGHTS);
  assert.equal(r2.isEquipped, false);
});

test('suggested weights favour stats your gear stacks', () => {
  const { suggestWeights } = require('../src/core/autoweights');
  const eq = {
    Helmet: parseItem('Item Class: Helmets\nRarity: Rare\nA\nB\n--------\nEnergy Shield: 400\n--------\n+2 to Level of all Minion Skills\n+30 to Intelligence\n+10% to Fire Resistance (rune)'),
    Gloves: parseItem('Item Class: Gloves\nRarity: Rare\nC\nD\n--------\nEnergy Shield: 200\n--------\n+30 to Intelligence\n+40 to maximum Life'),
  };
  const s = suggestWeights(eq);
  const get = (k) => (s.find((x) => x.key === k) || {}).weight;
  assert.equal(get('# to Intelligence'), 1.5);       // 2 slots: 45 pts / 30
  assert.equal(get('# to maximum Life'), 0.75);      // 1 slot: 30 / 40
  assert.equal(get('# to Level of all Minion Skills'), 15);
  assert.equal(get('[Base] Energy Shield'), 0.13);   // 40 / 300 avg
  assert.equal(get('#% increased Energy Shield'), undefined);
  assert.equal(get('#% to Fire Resistance'), undefined); // rune only -> skipped
  const ig = suggestWeights(eq, (k) => k === '# to maximum Life');
  assert.equal(ig.find((x) => x.key === '# to maximum Life'), undefined);
});

test('gear score rates items for the Djinn Disciple build', () => {
  const { gearScore } = require('../src/core/gearscore');
  const helm = parseItem(`Item Class: Helmets
Rarity: Rare
Great Crown
Ancestral Tiara
--------
Energy Shield: 520
--------
+3 to Level of all Minion Skills
+42% to Cold Resistance
+40% to Fire Resistance
+90 to maximum Life
+30% to Chaos Resistance
80% increased Energy Shield`);
  const g = gearScore(helm, { build: 'djinn-varashta' });
  assert.ok(g.score >= 85, `great helm should be S, got ${g.score}`);
  assert.equal(g.grade, 'S');
  assert.deepEqual(g.wasted, []); // local ES% is part of the base, not wasted
  const junk = parseItem(`Item Class: Helmets
Rarity: Rare
Bad Hat
Ancestral Tiara
--------
Energy Shield: 150
--------
Adds 1 to 4 Physical Damage to Attacks
+10 to Strength
12% increased Stun Threshold`);
  const j = gearScore(junk, { build: 'djinn-varashta' });
  assert.ok(j.score < 30, `junk helm should be low, got ${j.score}`);
  assert.ok(j.missing.includes('Minion skill levels'));
  assert.equal(j.wasted.length, 2);
  // if you ignore resistances, a helm whose mods are mostly resistances is worth less to you
  const noRes = gearScore(helm, { build: 'djinn-varashta', ignore: (k) => /Resistance/.test(k) });
  assert.ok(noRes.score < g.score && noRes.score > 60, String(noRes.score));
  const boots = parseItem('Item Class: Boots\nRarity: Rare\nX\nY\n--------\nEnergy Shield: 100\n--------\n+30 to maximum Life');
  const b = gearScore(boots, { build: 'djinn-varashta', resNeed: { Fire: 0, Cold: 12, Lightning: 0 } });
  assert.equal(b.missing[0], 'Movement speed');
  assert.ok(b.resNote.every((n) => n && n.key && Array.isArray(n.args)));
  assert.equal(gearScore(parseItem('Item Class: Belts\nRarity: Unique\nMageblood\nHeavy Belt\n--------\n+50 to maximum Life')).unique, true);
});

test('character profiles keep gear, weights and build apart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2uc-prof-'));
  const s = new Store(dir);
  s.setEquipped('Helmet', parseItem(HELMET_OLD));
  s.setWeight('# to maximum Life', 5);
  s.setSetting('build', 'djinn-varashta');
  assert.equal(s.listProfiles().length, 1);
  const alt = s.createProfile('Alt witch');
  assert.equal(Object.keys(s.equipped).length, 0);
  assert.equal(s.weights['# to maximum Life'], 1); // defaults for a new character
  s.setEquipped('Gloves', parseItem(HELMET_OLD.replace('Helmets', 'Gloves')));
  s.switchProfile('main');
  assert.ok(s.equipped.Helmet && !s.equipped.Gloves);
  assert.equal(s.weights['# to maximum Life'], 5);
  const s2 = new Store(dir); // persisted
  assert.equal(s2.listProfiles().length, 2);
  s2.switchProfile(alt);
  assert.ok(s2.equipped.Gloves && !s2.equipped.Helmet);
  assert.equal(s2.deleteProfile(alt), true);
  assert.ok(s2.equipped.Helmet);
});

test('advanced copy: open prefixes / suffixes for crafting', () => {
  const it = parseItem(`Item Class: Gloves
Rarity: Rare
Doom Vise
Sorcerer Gloves
--------
Energy Shield: 280
--------
{ Prefix Modifier "Hale" (Tier: 3) — Life }
+33(33-41) to maximum Life
{ Prefix Modifier "Shining" (Tier: 2) — Defences, Energy Shield }
75(68-79)% increased Energy Shield
+20(18-22) to maximum Energy Shield
{ Suffix Modifier "of the Squall" (Tier: 3) — Elemental, Lightning, Resistance }
+39(36-40)% to Lightning Resistance`);
  assert.deepEqual(it.affixes, { known: true, prefixes: 2, suffixes: 1, openPrefix: 1, openSuffix: 2 });
  assert.equal(it.stats['# to maximum Energy Shield'], 20); // hybrid lines still read
  // a plain copy has no headers: the affixes are inferred, and marked as such
  assert.equal(parseItem(HELMET_OLD).affixes.inferred, true);
});

// A Chinese client copies the same item with Chinese labels and Chinese mod lines.
const WAND_ZH = `物品種類: 法杖
稀有度: 稀有
精魂 刀鋒
虹吸法杖
--------
需求: 等級 28, 23 智慧
--------
插槽: S
--------
物品等級: 38
--------
獲得等同於傷害8%的額外閃電傷害 (rune)
--------
賦予技能: 等級 10 力量抽取
--------
{ 前綴 "施暴"(階層：5) — 傷害,物理 }
增加64(55-64)%法術物理傷害
{ 前綴 "學徒的"(階層：8) — 傷害,法術 }
增加33(25-34)%法術傷害
{ 前綴 "綠寶石的"(階層：11) — 魔力 }
+11(10-14)最大魔力
{ 後綴 "折磨之"(階層：3) — 物理,法術,寶石 }
全部物理法術技能等級+3
{ 已工藝 後綴 "浩劫之"(階層：5) — 法術,暴擊 }
增加37(34-39)%法術暴擊率`;

test('Chinese item text is read as the English shape everything else expects', () => {
  const it = parseItem(WAND_ZH);
  assert.ok(it, 'a Chinese copy is still an item');
  assert.equal(it.itemClass, 'Wands');
  assert.equal(it.slot, 'Weapon');
  assert.equal(it.rarity, 'Rare');
  assert.equal(it.baseType, 'Siphoning Wand'); // the base type is what the trade site knows
  assert.equal(it.itemLevel, 38);
  assert.equal(it.requiredLevel, 28);
  // the mod lines are translated, so scoring and searches see the stats they know
  assert.equal(it.stats['#% increased Spell Physical Damage'], 64);
  assert.equal(it.stats['#% increased Spell Damage'], 33);
  assert.equal(it.stats['# to Level of all Physical Spell Skills'], 3);
  assert.equal(it.stats['Gain #% of Damage as Extra Lightning Damage'], 8);
  // flat mods keep their sign: Path of Building ignores "11 to maximum Mana" without the "+"
  assert.ok(/^\+11 to maximum Mana$/m.test(it.raw), it.raw);
  assert.equal(it.stats['# to maximum Mana'], 11);
  // the advanced-copy headers carry the tier, and a crafted suffix is still a suffix
  const byText = (re) => it.lines.find((l) => re.test(l.text));
  assert.equal(byText(/Spell Physical Damage/).affix.tier, 5);
  assert.equal(byText(/Critical Hit Chance for Spells/).affix.tier, 5);
  assert.equal(byText(/Critical Hit Chance for Spells/).affix.crafted, true);
  assert.equal(byText(/Critical Hit Chance for Spells/).tag, 'crafted');
  assert.deepEqual(it.affixes, { known: true, prefixes: 3, suffixes: 2, openPrefix: 0, openSuffix: 1 });
});

test('English item text is left exactly as it was', () => {
  const it = parseItem(HELMET_NEW);
  assert.equal(it.raw, HELMET_NEW.trim());
  assert.equal(it.stats['# to maximum Life'], 89);
});

test('zh-TW game data: names and stat lines, unknown text untouched', () => {
  const { translate, modKey } = require('../src/ui/gamedata');
  const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'zh-tw.json'), 'utf8'));
  for (const [en, zh] of [
    ['Shattering Palm', '粉碎之掌'],
    ['Hollow Focus Technique', '空無專注之技'],
    ['Martial Artist', '武術家'],
    ['Chaos Inoculation', '異靈之體'],
    // names the PO catalogs lack come from the Chinese Path of Building's own CSVs
    ['Mageblood', '魔血'],
    ['Heart of the Well', '水井之心'],
  ]) assert.strictEqual(translate(dict, en), zh);
  // stat lines: the numbers are put back into the Chinese template
  assert.strictEqual(translate(dict, '+89 to maximum Life'), '最大生命+89');
  assert.strictEqual(translate(dict, '+32% to Fire Resistance'), '+32%火焰抗性');
  assert.strictEqual(translate(dict, '12% increased Elemental Damage with Attacks'), '增加12%攻擊元素傷害');
  // the trade site writes "total" for pseudo stats and "#" for a value
  assert.strictEqual(translate(dict, '+#% total to Fire Resistance'), '#%火焰抗性');
  assert.strictEqual(translate(dict, '#% increased Cast Speed'), '增加#%施放速度');
  // unknown game text and our own strings stay as they are
  for (const s of ['Some Unreleased Skill', 'Item Class: Helmets', 'Gear score editor']) assert.strictEqual(translate(dict, s), s);
  assert.strictEqual(modKey('+89 to maximum Life'), '# to maximum Life');
  assert.strictEqual(modKey('{0:+d} to maximum Life'), '# to maximum Life');
});

test('language dictionaries translate UI keys only and preserve raw game text', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.js'), 'utf8');
  const sandbox = {
    window: {},
    navigator: { language: 'en' },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {},
  };
  vm.runInNewContext(source, sandbox);
  const i18n = sandbox.window.i18n;
  const changes = [];
  i18n.onChange((lang) => changes.push(lang));
  i18n.setLang('zh-CN');
  assert.deepStrictEqual(changes, ['zh-CN']);
  assert.strictEqual(i18n.t('Settings'), '设置');
  assert.strictEqual(i18n.t('Hotkey not registered.'), '快捷键尚未注册。');
  assert.strictEqual(i18n.t('Traditional Chinese (international / Taiwan)'), '繁体中文（国际服 / 台服）');
  assert.strictEqual(i18n.t('Minion summoner (ES) – e.g. Disciple of Varashta Djinns'), '召唤物流派（能量护盾），例如瓦拉什塔灵裔门徒');
  assert.strictEqual(i18n.t('Life & resistances (any build)'), '生命与抗性（通用流派）');
  assert.strictEqual(i18n.t('Energy Shield spellcaster (generic)'), '能量护盾法术流派（通用）');
  assert.strictEqual(i18n.t('Spell skill levels'), '法术技能等级');
  assert.strictEqual(i18n.t('everywhere {0}', 4), '所有部位 4');
  assert.strictEqual(i18n.t('Minion skill levels'), '召唤物技能等级');
  assert.strictEqual(i18n.t('Fire res'), '火焰抗性');
  assert.strictEqual(i18n.t('Weapon DPS'), '武器每秒伤害');
  const gearProfiles = require('../src/core/gearscore');
  for (const profile of gearProfiles.buildList()) {
    assert.notStrictEqual(i18n.t(profile.name), profile.name);
    assert.notStrictEqual(i18n.t(profile.summary), profile.summary);
    for (const stat of gearProfiles.buildStats(profile.id)) assert.notStrictEqual(i18n.t(stat.label), stat.label);
  }
  for (const key of ['Best for your build: rings', 'Best for your build: jewels', 'Best for your build: radius jewels', 'Power charges', 'fire / cold / lightning / chaos']) assert.notStrictEqual(i18n.t(key), key);
  for (const [source, expected] of [['Weapon', '武器'], ['Ring 1', '戒指 1'], ['Charm 1', '护符 1'], ['Jewel 6', '珠宝 6'], ['Fire', '火焰'], ['Chaos', '混沌'], ['Power charges', '暴击球']]) assert.strictEqual(i18n.t(source), expected);
  assert.strictEqual(i18n.t('fire / cold / lightning / chaos'), '火焰 / 冰冷 / 闪电 / 混沌');
  assert.strictEqual(i18n.t('Fire charges'), 'Fire charges'); // unknown game/stat text is not rewritten
  for (const [key, expected] of [
    ['Overall gear score', '总体装备评分'], ['Weapon swap, flasks, charms & jewels ({0} saved)', '武器切换、药剂、护符与珠宝（已保存 {0} 件）'],
    ['Imported {0} items.', '已导入 {0} 件物品。'], ['Imported your resistances.', '已导入你的抗性。'],
    ['Skills ({0})', '技能（{0}）'], ['Main skill', '主技能'], ['Resistances', '抗性'],
    ['Fire', '火焰'], ['Cold', '冰冷'], ['Lightning', '闪电'], ['Chaos', '混沌'],
    ['Custom search', '自订搜索'], ['Add a stat to the custom search', '向自订搜索添加属性'],
    ['Keep', '保留'], ['Yours', '你的'], ['Min', '最小'], ['Max', '最大'],
    ['Character level: {0}.', '角色等级：{0}。'], ['Imported {0} items.', '已导入 {0} 件物品。'],
    ['Imported your resistances.', '已导入你的抗性。'], ['Main skill', '主技能'], ['level', '等级'],
    ['Fire', '火焰'], ['Cold', '冰冷'], ['Lightning', '闪电'], ['Chaos', '混沌'],
    ['Minion skill levels', '召唤物技能等级'], ['Weapon DPS', '武器每秒伤害'],
    ['Spell skill levels', '法术技能等级'], ['Spell damage', '法术伤害'], ['Crit', '暴击'],
    ['Ally damage', '盟友伤害'], ['Minion damage', '召唤物伤害'], ['Fire res', '火焰抗性'],
    ['everywhere {0}', '所有部位 {0}'], ['Counts on (importance)', '计入（重要性）'],
    ['How much it matters', '重要程度'], ['Off', '关闭'], ['Added ✓', '已添加 ✓'], ['Saved ✓', '已保存 ✓'],
    ['Add a stat to the custom search', '向自订搜索添加属性'], ['Any item type', '任意物品类型'],
    ['Seen on my items', '我拷贝过的物品上'], ['No stats match.', '没有符合的属性。'],
    ['Search stats, e.g. energy shield, minion, spirit, cast speed…', '搜索属性，例如：能量护盾、召唤物、精魂、施放速度…'],
    ['Fire charges', 'Fire charges'],
    ['Gear score editor', '装备评分编辑器'], ['Ignored stats (Find upgrades page) are left out of the score.', '已忽略的词缀（寻找升级页面）不会纳入评分。'],
    ['Minion skill levels', '召唤物技能等级'],
  ]) assert.strictEqual(i18n.t(key), expected, `translation coverage: ${key}`);
  assert.strictEqual(i18n.t('Navigation pages'), '页面导航');
  assert.strictEqual(i18n.t('Price currency'), '价格货币');
  assert.strictEqual(i18n.t('Price check: {0}', 'Unique Name'), '价格查询：Unique Name');
  assert.strictEqual(i18n.t('Best for your build: rings'), '最适合你的戒指');
  assert.strictEqual(i18n.t('PoB has {0} res at {1}%, your character sheet {2}% – check PoB\'s Configuration (charms, buffs) and gear', 'fire', 50, 75), 'PoB 中的fire抗性为 50%，角色面板为 75%——请检查 PoB 设置（护符、增益）与装备。');
  for (const [key, args, expected] of [
    ['Imported {0} items.', [3], '已导入 3 件物品。'],
    ['Imported your resistances.', [], '已导入你的抗性。'],
    ['Imported character: {0}.', ['Witch'], '已导入角色：Witch。'],
    ['Character level: {0}.', [85], '角色等级：85。'],
    ['Path of Building could not check this build: {0}', ['engine error'], 'Path of Building 无法检查此 BD：engine error'],
  ]) assert.strictEqual(i18n.t(key, ...args), expected);
  assert.strictEqual(i18n.t('{0} res: you\'re already capped – it doesn\'t count.', 'Fire'), 'Fire抗性已达上限，不再计分。');
  assert.strictEqual(i18n.t('fire / cold / lightning / chaos'), '火焰 / 冰冷 / 闪电 / 混沌');
  for (const key of ['Fire Skill Gem', 'Item Class: Helmets\\nRarity: Rare\\n+35 to maximum Life', '+# to maximum Life']) assert.strictEqual(i18n.t(key), key);
  for (const key of ['Imported {0} items.', 'Imported your resistances.', 'Imported character: {0}.', 'Character level: {0}.', 'Best for your build: rings', 'Best for your build: jewels', 'Best for your build: radius jewels', '{0} res: you\'re already capped – it doesn\'t count.']) assert.notStrictEqual(i18n.t(key), key);

  assert.strictEqual(i18n.t('Pages'), '页面');
  assert.strictEqual(i18n.t('Price currency'), '价格货币');
  assert.strictEqual(i18n.t('Ring'), '戒指');
  assert.strictEqual(i18n.t('Weapon 2'), '武器 2');
  assert.strictEqual(i18n.t('Charm 1'), '护符 1');
  assert.strictEqual(i18n.t('everywhere {0}', 4), '所有部位 4');
  assert.strictEqual(i18n.t('Price check: {0}', 'Mageblood'), '价格查询：Mageblood');
  const itemText = 'Item Class: Helmets\\nRarity: Rare\\n+35 to maximum Life';
  assert.strictEqual(i18n.t(itemText), itemText);
  assert.strictEqual(i18n.t('# to maximum Life'), '# to maximum Life');
  i18n.setLangLocal('zh-TW');
  assert.strictEqual(i18n.t('Settings'), '設定');
  i18n.setLangLocal('en');
  assert.strictEqual(i18n.t('Settings'), 'Settings');
});

test('advanced copy: { Implicit Modifier } lines are implicits', () => {
  const it = parseItem('Item Class: Rings\nRarity: Rare\nEmpyrean Gyre\nIron Ring\n--------\nItem Level: 81\n--------\n{ Implicit Modifier }\nAdds 1 to 4 Physical Damage to Attacks\n--------\n{ Prefix Modifier "Sapphire" (Tier: 2) — Mana }\n+56(55-64) to maximum Mana\n{ Suffix Modifier "of the Sage" (Tier: 1) — Attribute }\n+31(31-33) to Intelligence');
  assert.strictEqual(it.lines.find((l) => /Physical/.test(l.text)).tag, 'implicit');
  assert.strictEqual(it.lines.find((l) => /Mana/.test(l.text)).tag, 'explicit');
});

test('Mageblood Legacies become stats, with the duplicate bonus', () => {
  const { parseItem } = require('../src/core/parser');
  const base = "Item Class: Belts\nRarity: Unique\nMageblood\nUtility Belt\n--------\nItem Level: 80\n--------\nHas 3 Charm Slots\n20% of Flask Recovery applied Instantly\n--------\nLegacy of Bismuth\nLegacy of Sulphur\nLegacy of Quicksilver\nLegacy of Jade\nAll Mage's Legacies have 50% increased effect per duplicate Mage's Legacy you have\n--------\nRivers of power coursed through their veins.";
  const a = parseItem(base);
  assert.strictEqual(a.stats['#% to Cold Resistance'], 45);
  assert.strictEqual(a.stats['#% increased Movement Speed'], 30);
  assert.ok(a.lines.some((l) => l.text === 'Legacy of Jade'));
  const b = parseItem(base.replace('Legacy of Jade', 'Legacy of Ruby').replace('Legacy of Sulphur', 'Legacy of Ruby'));
  assert.strictEqual(b.legacies.duplicates, 1);
  assert.strictEqual(b.stats['#% to Fire Resistance'], 45 * 1.5 + 60 * 1.5);
  assert.strictEqual(b.stats['#% to Maximum Fire Resistance'], 7.5);
});

test('re-copying the same item does not move your resistance totals', () => {
  const R = require('../src/core/resists');
  const old = { name: 'Mageblood', baseType: 'Utility Belt', stats: {} };
  const neu = { name: 'Mageblood', baseType: 'Utility Belt', stats: { '#% to Cold Resistance': 45 } };
  let rec = R.snapshot({ cold: 112 }, { Belt: old }, 'pob');
  rec = R.rebase(rec, old, neu);
  assert.strictEqual(R.live(rec, { Belt: neu }).cold, 112);
  const ruby = { name: 'X', stats: { '#% to Maximum Fire Resistance': 5 } };
  assert.strictEqual(R.live(R.snapshot({ fire: 80 }, {}, 'game'), { Belt: ruby }).caps.fire, 80);
});

test('reminder text and unique flavour text are not stats', () => {
  const adv = parseItem(['Item Class: Body Armours', 'Rarity: Rare', 'Grim Coat', "Expert Hexer's Robe", '--------', 'Energy Shield: 300', '--------',
    '{ Suffix Modifier "of the Ice" (Tier: 1) }', '+2% to Maximum Cold Resistance', '(Maximum Resistances cannot be raised above 90%)',
    '{ Prefix Modifier "Tough" }', '+40 to maximum Life', '(reminder text that runs', 'over 2 lines)'].join('\n'));
  assert.deepEqual(Object.keys(adv.stats).sort(), ['# to maximum Life', '#% to Maximum Cold Resistance', '[Base] Energy Shield']);
  const helm = parseItem(['Item Class: Helmets', 'Rarity: Unique', 'Crown of Eyes', 'Velvet Cap', '--------', 'Energy Shield: 60', '--------', '+20 to maximum Mana',
    'Increases and Reductions to Spell damage also apply to Attacks', '--------', 'An eye for an eye', 'and 1000 more for the rest', '--------', 'Corrupted'].join('\n'));
  assert.deepEqual(Object.keys(helm.stats).sort(), ['# to maximum Mana', '[Base] Energy Shield']);
  assert.equal(helm.corrupted, true);
  // a unique's last mod block (no flavour, e.g. from the trade site) is kept
  const amu = parseItem(['Item Class: Amulets', 'Rarity: Unique', 'X', 'Gold Amulet', '--------', '+15 to Dexterity (implicit)', '--------', '+100 to maximum Life', 'Cannot be Frozen'].join('\n'));
  assert.equal(amu.stats['# to maximum Life'], 100);
  // Mageblood with flavour text still gets its Legacies
  const mb = parseItem(['Item Class: Belts', 'Rarity: Unique', 'Mageblood', 'Rawhide Belt', '--------', 'Has 3 Charm Slots (implicit)', '--------', 'Legacy of Ruby', '--------', 'Rivers of power flow', 'through the veins of the ancient Vaal.'].join('\n'));
  assert.equal(mb.stats['#% to Fire Resistance'], 60);
});

test('gear score: a downside on a wanted stat costs points', () => {
  const { gearScore } = require('../src/core/gearscore');
  const mk = (chaos) => parseItem(['Item Class: Body Armours', 'Rarity: Rare', 'A', 'B', '--------', 'Armour: 500', '--------', '+80 to maximum Life', '+30% to Fire Resistance', ...(chaos ? [chaos] : [])].join('\n'));
  const none = gearScore(mk(null), {}); const neg = gearScore(mk('-20% to Chaos Resistance'), {});
  assert.ok(neg.score < none.score, `${neg.score} < ${none.score}`);
  assert.equal(neg.penalties[0].label, 'Chaos res');
  assert.ok(neg.penalties[0].points < 0);
  assert.ok(gearScore(mk('-500% to Chaos Resistance'), {}).score >= 0);
});
