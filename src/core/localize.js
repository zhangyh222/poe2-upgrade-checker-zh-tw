'use strict';

// Item text from a Chinese game client, turned into the English shape the parser knows.
//
// The clipboard text is laid out the same in every language; only the labels differ:
//
//   物品種類: 法杖               -> Item Class: Wands
//   稀有度: 稀有                 -> Rarity: Rare
//   需求: 等級 28, 23 智慧       -> Requires: Level 28, 23 Int
//   物品等級: 38                -> Item Level: 38
//   增加64(55-64)%法術物理傷害   -> 64% increased Spell Physical Damage
//
// Mod lines are translated back through PoB's own zh_TW catalog - the same one the UI uses
// to show English mods in Chinese - so the rest of the app keeps working on the English
// text it expects: scoring weights, trade search, and the build handed to Path of Building.
// Lines the catalog doesn't know are kept as they are rather than guessed at.

const { modKey } = require('../ui/gamedata');
const dict = require('../data/zh-tw.json');

// "物品種類:" (traditional) or "物品种类:" (simplified)
const HEADER = /^(?:物品種類|物品种类)\s*[:：]\s*(.*)$/;
const SEPARATOR = /^-{4,}\s*$/;
const RANGE = /\((-?\d+(?:\.\d+)?)[-–](-?\d+(?:\.\d+)?)\)/g;

const RARITY = {
  普通: 'Normal',
  魔法: 'Magic',
  稀有: 'Rare',
  傳奇: 'Unique',
  唯一: 'Unique',
  通貨: 'Currency',
  宝石: 'Gem',
  寶石: 'Gem',
};

// The class names the parser and the slot table expect. Weapons are matched by the word
// inside ("Wands" contains "wand"), so the game's own class names are what we want here.
const CLASS_ZH = {
  法杖: 'Wands',
  權杖: 'Sceptres',
  單手劍: 'One Hand Swords',
  雙手劍: 'Two Hand Swords',
  單手斧: 'One Hand Axes',
  雙手斧: 'Two Hand Axes',
  單手錘: 'One Hand Maces',
  雙手錘: 'Two Hand Maces',
  弓: 'Bows',
  十字弓: 'Crossbows',
  長杖: 'Staves',
  長矛: 'Spears',
  匕首: 'Daggers',
  爪: 'Claws',
  連枷: 'Flails',
  節杖: 'Quarterstaves',
  頭部: 'Helmets',
  頭盔: 'Helmets',
  胸甲: 'Body Armours',
  手套: 'Gloves',
  鞋子: 'Boots',
  靴子: 'Boots',
  腰帶: 'Belts',
  項鍊: 'Amulets',
  戒指: 'Rings',
  盾: 'Shields',
  法器: 'Foci',
  箭袋: 'Quivers',
  珠寶: 'Jewels',
  護符: 'Charms',
  生命藥劑: 'Life Flasks',
  魔力藥劑: 'Mana Flasks',
  // simplified spellings, for a client set to 简体中文
  头盔: 'Helmets',
  头部: 'Helmets',
  腰带: 'Belts',
  项链: 'Amulets',
  护符: 'Charms',
  珠宝: 'Jewels',
  权杖: 'Sceptres',
  单手剑: 'One Hand Swords',
  双手剑: 'Two Hand Swords',
  单手斧: 'One Hand Axes',
  双手斧: 'Two Hand Axes',
  单手锤: 'One Hand Maces',
  双手锤: 'Two Hand Maces',
  长杖: 'Staves',
  长矛: 'Spears',
  节杖: 'Quarterstaves',
  生命药剂: 'Life Flasks',
  魔力药剂: 'Mana Flasks',
};

const ATTR = { 力量: 'Str', 敏捷: 'Dex', 智慧: 'Int' };

const FLAG = {
  已汙染: 'Corrupted',
  已污染: 'Corrupted',
  未鑑定: 'Unidentified',
  未鉴定: 'Unidentified',
  已複製: 'Mirrored',
  已复制: 'Mirrored',
  無法修改: 'Unmodifiable',
};

// ---- the catalogs, indexed the other way round ----
let nameIndex = null;
function names() {
  if (nameIndex) return nameIndex;
  nameIndex = new Map();
  for (const [en, zh] of Object.entries(dict.names || {})) {
    if (zh && !nameIndex.has(zh)) nameIndex.set(zh, en);
  }
  return nameIndex;
}

let modIndex = null;
let modBag = null;
function mods() {
  if (modIndex) return modIndex;
  modIndex = new Map();
  modBag = new Map();
  for (const [en, zh] of Object.entries(dict.mods || {})) {
    const shape = modKey(String(zh).replace(RANGE, ''));
    if (!modIndex.has(shape)) modIndex.set(shape, en);
    // the same sentence with the number in another place ("+3 全部…等級" vs "{0:+d}全部…等級")
    const bag = shape.replace(/#/g, '');
    const count = (shape.match(/#/g) || []).length;
    if (!modBag.has(bag)) modBag.set(bag, []);
    modBag.get(bag).push({ en, count });
  }
  return modIndex;
}

function templateOf(line) {
  const clean = String(line).replace(RANGE, '');
  const shape = modKey(clean);
  mods();
  let en = modIndex.get(shape);
  if (!en) {
    // numbers moved: only accept the match when it is the only candidate of that shape
    const bag = shape.replace(/#/g, '');
    const count = (shape.match(/#/g) || []).length;
    const cand = (modBag.get(bag) || []).filter((c) => c.count === count);
    if (cand.length === 1) en = cand[0].en;
  }
  return en ? { en, clean } : null;
}

function fillNumbers(template, text) {
  const nums = String(text).match(/-?\d+(?:\.\d+)?/g) || [];
  let i = 0;
  const out = template.replace(/#/g, () => (i < nums.length ? nums[i++] : '#'));
  return out.includes('#') ? null : out;
}

// "增加64(55-64)%法術物理傷害" -> "64% increased Spell Physical Damage"
function translateMod(line) {
  const src = String(line).trim();
  const hit = templateOf(src);
  if (!hit) return null;
  let en = fillNumbers(hit.en, hit.clean);
  if (!en) return null;
  // Flat mods are written "+42 to maximum Life" in English, and Path of Building only reads them
  // with the sign: without it the whole line is skipped and the stat is missing from the build.
  if (/^[+＋]/.test(src) && !/^[+＋]/.test(en)) en = '+' + en;
  return en;
}

function translateName(text) {
  const t = String(text).trim();
  const hit = names().get(t);
  return hit || t;
}

// { 前綴 "施暴"(階層：5) — 傷害,物理 }  ->  { Prefix Modifier "施暴" (Tier: 5) — 傷害,物理 }
// { 已工藝 後綴 "浩劫之"(階層：5) — … }  ->  { Crafted Suffix Modifier "浩劫之" (Tier: 5) — … }
function descriptor(line) {
  const body = line.replace(/^\{/, '').replace(/\}$/, '').trim();
  const name = (body.match(/["“]([^"”]+)["”]/) || [])[1] || null;
  const tier = Number((body.match(/階層\s*[:：]\s*(\d+)/) || body.match(/阶层\s*[:：]\s*(\d+)/) || [])[1]) || null;
  const group = (body.match(/[—–]\s*(.+)$/) || [])[1] || null;
  const crafted = /已工藝|已加工|已工艺/.test(body);
  const kind = /後綴|后缀/.test(body) ? 'Suffix'
    : /前綴|前缀/.test(body) ? 'Prefix'
      : /內建|固有/.test(body) ? 'Implicit'
        : /附魔/.test(body) ? 'Enchant'
          : /符文/.test(body) ? 'Rune'
            : /破裂|裂界/.test(body) ? 'Fractured'
              : /褻瀆|亵渎/.test(body) ? 'Desecrated' : null;
  if (!kind) return null;
  const label = (kind === 'Prefix' || kind === 'Suffix') && crafted ? `Crafted ${kind} Modifier` : `${kind} Modifier`;
  return `{ ${label}${name ? ` "${name}"` : ''}${tier ? ` (Tier: ${tier})` : ''}${group ? ` — ${group}` : ''} }`;
}

function requirements(value) {
  // "等級 28, 23 智慧" -> "Level 28, 23 Int"
  let out = String(value).replace(/等級|等级/g, 'Level');
  for (const [zh, en] of Object.entries(ATTR)) out = out.split(zh).join(en);
  return out.replace(/[，]/g, ',').trim();
}

function grantsSkill(value) {
  // "等級 10 力量抽取" -> "Level 10 Power Siphon"
  const m = String(value).match(/^(?:等級|等级)\s*(\d+)\s*(.+)$/);
  if (!m) return translateName(value);
  return `Level ${m[1]} ${translateName(m[2])}`;
}

// The whole clipboard text, in English. Returns null when it isn't a Chinese item copy.
function toEnglish(raw) {
  if (typeof raw !== 'string') return null;
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.find((l) => l.trim());
  const head = first && first.trim().match(HEADER);
  if (!head) return null;

  const out = [];
  let inHeader = true;
  for (const original of lines) {
    const line = original.trim();
    if (!line) { out.push(''); continue; }
    if (SEPARATOR.test(line)) { out.push('--------'); inHeader = false; continue; }

    if (inHeader) {
      const m = line.match(HEADER);
      if (m) { out.push(`Item Class: ${CLASS_ZH[m[1].trim()] || m[1].trim()}`); continue; }
      const r = line.match(/^稀有度\s*[:：]\s*(.*)$/);
      if (r) { out.push(`Rarity: ${RARITY[r[1].trim()] || r[1].trim()}`); continue; }
      // the item's name, then its base type: the base is what the trade site and PoB know
      out.push(translateName(line));
      continue;
    }

    if (line.startsWith('{')) {
      const d = descriptor(line);
      out.push(d || line);
      continue;
    }
    const prop = line.match(/^([^:：]+)\s*[:：]\s*(.*)$/);
    if (prop) {
      const key = prop[1].trim();
      const value = prop[2].trim();
      if (/^(需求|需求)$/.test(key)) { out.push(`Requires: ${requirements(value)}`); continue; }
      if (/^插槽$/.test(key)) { out.push(`Sockets: ${value}`); continue; }
      if (/^(物品等級|物品等级)$/.test(key)) { out.push(`Item Level: ${value}`); continue; }
      if (/^品質$|^品质$/.test(key)) { out.push(`Quality: ${value}`); continue; }
      if (/^賦予技能$|^赋予技能$/.test(key)) { out.push(`Grants Skill: ${grantsSkill(value)}`); continue; }
      if (/^(經驗值|经验值|堆疊數量|堆叠数量)$/.test(key)) { out.push(`${key}: ${value}`); continue; }
    }
    if (FLAG[line]) { out.push(FLAG[line]); continue; }

    // a mod: translated when the catalog knows it, otherwise left in Chinese. The trailing
    // "(rune)" / "(implicit)" marker belongs to the mod but not to the sentence, so it is split
    // off before the lookup and put back afterwards.
    const tag = line.match(/\s*\((implicit|rune|enchant|crafted|fractured|desecrated|augmented)\)\s*$/i);
    const body = tag ? line.slice(0, tag.index) : line;
    const english = translateMod(body);
    out.push(english ? english + (tag ? ` (${tag[1]})` : '') : line);
  }
  return out.join('\n');
}

function isLocalized(raw) {
  if (typeof raw !== 'string') return false;
  const first = raw.replace(/\r\n?/g, '\n').split('\n').find((l) => l.trim());
  return !!(first && HEADER.test(first.trim()));
}

module.exports = { toEnglish, isLocalized, translateMod, translateName, descriptor };
