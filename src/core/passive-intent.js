'use strict';

// "Find passives that give energy shield" is not one thing. A player asking for it
// usually means one of: more maximum shield, a bigger % roll, faster recharge, or a
// shorter delay before recharge starts. Mixing them up is how a suggestion looks
// right and plays wrong, so every match is tagged with what it actually does.

const RULES = [
  { key: 'maxShield', re: /\bmaximum energy shield\b/i },
  { key: 'rechargeRate', re: /energy shield recharge rate|faster start of energy shield recharge|recharge rate/i },
  { key: 'rechargeDelay', re: /recharge delay|starts? recharging (?:sooner|faster)/i },
  { key: 'esPercent', re: /\b(?:increased|reduced|more|less) energy shield\b/i },
  { key: 'spirit', re: /\bspirit\b/i },
  { key: 'life', re: /\bmaximum life\b/i },
  { key: 'resistances', re: /\b(?:fire|cold|lightning|chaos) resistance\b|\ball elemental resistances\b/i },
];

// the categories a node belongs to, in a stable order
function classify(texts) {
  const text = (Array.isArray(texts) ? texts : [texts]).filter(Boolean).join(' \n ');
  const out = [];
  for (const rule of RULES) if (rule.re.test(text)) out.push(rule.key);
  // "increased Energy Shield Recharge Rate" must not also count as a % shield roll
  return out.filter((k) => !(k === 'esPercent' && (out.includes('rechargeRate') || out.includes('rechargeDelay'))));
}

// the phrase a player would use for a category, for grouping the result list
const LABELS = {
  maxShield: 'maximum energy shield',
  esPercent: 'increased energy shield %',
  rechargeRate: 'recharge rate',
  rechargeDelay: 'recharge delay',
  spirit: 'spirit',
  life: 'life',
  resistances: 'resistances',
};

module.exports = { classify, LABELS };
