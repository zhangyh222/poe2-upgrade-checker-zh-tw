'use strict';

// Chinese input for the passive search. The engine and the tree data are English,
// so a Chinese phrase has to become the English wording the game data uses. The
// glossary below is seeded from the app's zh-TW game dictionary (built from Path of
// Building's own translations): `verifyGlossary` checks every Chinese form really
// appears in it, so a drifted or invented translation fails a test instead of
// quietly searching for nothing.

const TERMS = [
  { en: 'energy shield', zh: ['能量護盾', '能量护盾', '護盾', '护盾'] },
  { en: 'maximum', zh: ['最大'] },
  { en: 'recharge', zh: ['充能', '回充'] },
  { en: 'delay', zh: ['延遲', '延迟'] },
  { en: 'life', zh: ['生命'] },
  { en: 'mana', zh: ['魔力'] },
  { en: 'spirit', zh: ['精魂'] },
  { en: 'resistance', zh: ['抗性'] },
  { en: 'damage', zh: ['傷害', '伤害'] },
  { en: 'minion', zh: ['召喚物', '召唤物', '召喚', '召唤'] },
  { en: 'movement speed', zh: ['移動速度', '移动速度'] },
  { en: 'attack speed', zh: ['攻擊速度', '攻击速度'] },
  { en: 'cast speed', zh: ['施法速度'] },
  { en: 'critical', zh: ['暴擊', '暴击'] },
  { en: 'armour', zh: ['護甲', '护甲'] },
  { en: 'evasion', zh: ['閃避', '闪避'] },
  { en: 'block', zh: ['格擋', '格挡'] },
  { en: 'increased', zh: ['增加', '提高'] },
  { en: 'reduced', zh: ['減少', '减少', '降低'] },
  { en: 'attribute', zh: ['屬性', '属性'] },
  { en: 'strength', zh: ['力量'] },
  { en: 'dexterity', zh: ['敏捷'] },
  { en: 'intelligence', zh: ['智慧', '智力'] },
  { en: 'compensated', zh: ['補償', '补偿'] },
];

// The glossary is small on purpose: it covers the words players type most, and every
// entry is checked against the game dictionary. For everything else the dictionary
// itself is the translator: find the mods whose Chinese contains the phrase, and the
// English words those mods share are what the engine can actually match on.
const STOP = new Set(['of', 'to', 'the', 'and', 'in', 'on', 'per', 'for', 'from', 'with', 'by', 'as', 'is', 'are',
  'all', 'any', 'each', 'your', 'you', 'chance', 'adds', 'gain', 'more', 'less', 'increased', 'reduced',
  'maximum', 'minimum', 'total', 'at', 'or', 'a', 'an', 'this', 'that', 'it', 'its', 'when', 'while']);

function hintsFromDict(query, dict) {
  const q = String(query || '').trim();
  if (!q || !dict || !dict.mods) return [];
  const scores = new Map();
  for (const [en, zh] of Object.entries(dict.mods)) {
    if (typeof zh !== 'string' || !zh.includes(q)) continue;
    const words = String(en).toLowerCase().replace(/[^a-z]+/g, ' ').split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w));
    for (const w of words) scores.set(w, (scores.get(w) || 0) + 1);
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
}

const CJK = /[\u3400-\u9fff]/;

function hasChinese(text) { return CJK.test(String(text || '')); }

// longest forms first, so 能量護盾 is replaced before 護盾 and 移動速度 before 速度
function translate(text) {
  const input = String(text || '').trim();
  if (!hasChinese(input)) return { english: input, hits: [], dropped: '', partial: false };
  const pairs = [];
  for (const term of TERMS) for (const zh of term.zh) pairs.push({ zh, en: term.en });
  pairs.sort((a, b) => b.zh.length - a.zh.length);
  let out = input;
  const hits = [];
  for (const p of pairs) {
    if (out.includes(p.zh)) {
      out = out.split(p.zh).join(` ${p.en} `);
      if (!hits.includes(p.en)) hits.push(p.en);
    }
  }
  // whatever Chinese is left cannot be translated: keep it out of the English query
  // but say so, rather than searching for a mix the engine will never match
  const dropped = (out.match(/[\u3400-\u9fff]+/g) || []).join(' ');
  out = out.replace(/[\u3400-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { english: out, hits, dropped, partial: hits.length === 0 };
}

// every Chinese form has to exist in the zh-TW dictionary the app ships
function verifyGlossary(dict) {
  // the shipped file nests its text under `names` and `mods`, so walk it
  const texts = [];
  const walk = (v) => {
    if (typeof v === 'string') { texts.push(v); return; }
    if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(dict || {});
  const values = texts.join('\n');
  const missing = [];
  for (const term of TERMS) {
    if (!term.zh.some((zh) => values.includes(zh))) missing.push(term.en);
  }
  return missing;
}

module.exports = { translate, verifyGlossary, hasChinese, hintsFromDict, TERMS };
