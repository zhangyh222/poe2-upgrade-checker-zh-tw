'use strict';
// Game data in Traditional Chinese.
//
// The app's own UI text lives in src/i18n.js; this deals with the OTHER kind of
// string: names and stat lines that come out of Path of Building and the trade
// site (skill gems, passives, ascendancies, base and unique item names, mods).
// Those are translated with PoB's own zh_TW catalogs, packed into
// src/data/zh-tw.json by tools/make-zh-tw-data.js:
//
//   names:  "Shattering Palm"        -> "粉碎之掌"        (exact match)
//   mods:   "#% increased Cast Speed" -> "增加{0}%施放速度" (template)
//
// A stat line is matched by turning its numbers into "#" on both sides, so
// "+89 to maximum Life" finds "{0:+d} to maximum Life", and the numbers are put
// back into the Chinese template. Anything the catalogs don't know stays in
// English rather than being guessed at.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.gameDataCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // numbers, rolls in brackets and {0}/{0:+d} placeholders all become "#"
  function modKey(s) {
    return String(s)
      .replace(/\(-?[\d.]+--?[\d.]+\)/g, '#')
      .replace(/\{[0-9]+(?::[^}]*)?\}/g, '#')
      .replace(/\btotal\s+/gi, '')
      .replace(/[−–]/g, '-')
      .replace(/-?\d+(?:\.\d+)?/g, '#')
      .replace(/\+#/g, '#')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // what to put into the template, in order: the text's own numbers, or the "#"
  // the trade site uses as its placeholder
  function tokensOf(s) {
    return [...String(s).matchAll(/-?\d+(?:\.\d+)?|#/g)].map((m) => m[0]);
  }

  function fill(tpl, tokens) {
    let ok = true;
    let auto = 0;
    const out = tpl.replace(/\{(\d*)(?::([^}]*))?\}/g, (m, i, fmt, offset, whole) => {
      // bare "{}" takes the numbers in order, "{0}" names one
      const v = tokens[i === '' ? auto++ : Number(i)];
      if (v === undefined) { ok = false; return ''; }
      if (v === '#') return '#';
      const num = Number(v);
      if (!Number.isFinite(num)) { ok = false; return v; }
      if (!/d/.test(fmt || '')) return v;
      // "每個角色等級 +{0:+d} 閃避值" already carries the sign
      const signed = /\+/.test(fmt) && whole[offset - 1] !== '+';
      return (signed && num >= 0 ? '+' : '') + Math.round(num);
    });
    return ok ? out : null;
  }

  // PoB tags a stat line with where it came from ("30% increased ... (enchant)")
  const TAG = /\s*\((enchant|implicit|crafted|fractured|desecrated|rune|local)\)\s*$/i;
  const TAG_TEXT = { local: '（本地）', enchant: '（附魔）', implicit: '（內建）', crafted: '（工藝）', fractured: '（裂界）', desecrated: '（褻瀆）', rune: '（符文）' };

  // keystone stat lines, matched loosely (case, punctuation and spacing ignored): PoB's catalogs
  // leave most of them untranslated and the game wraps some over several lines
  function lineKey(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // dict: { names: {en: zh}, mods: {key: template}, keystoneLines: {key: zh} }
  function translate(dict, s) {
    if (!dict || typeof s !== 'string' || !s) return s;
    const exact = dict.names && dict.names[s];
    if (exact) return exact;
    const tag = s.match(TAG);
    const body = tag ? s.slice(0, tag.index) : s;
    const suffix = tag ? ' ' + TAG_TEXT[tag[1].toLowerCase()] : '';
    const fixed = dict.keystoneLines && dict.keystoneLines[lineKey(body)];
    if (fixed) return fixed + suffix;
    // "Notable/Small Passive Skills in Radius also grant <stat>": the catalogs only
    // carry some of the inner stats, so build the sentence around a translated one
    const radius = body.match(/^(Notable|Small) Passive Skills in Radius also grant (.+)$/);
    if (radius) {
      const inner = dict.mods && dict.mods[modKey(radius[2])];
      const filledInner = inner && fill(inner, tokensOf(radius[2]));
      if (filledInner) {
        const head = radius[1] === 'Notable' ? '範圍內核心天賦也會賦予' : '範圍內小天賦也會賦予';
        return head + filledInner + suffix;
      }
    }
    // The catalogs key templates three ways ("{0}%…", "{}%…", and some entries that keep their own
    // roll range "(35-50)%…"). Prefer a real template; a literal keeps its baked-in range.
    const hashKey = modKey(body);
    const tokens = tokensOf(body);
    for (const key of [hashKey.replace(/#/g, '{0}'), hashKey.replace(/#/g, '{}'), hashKey]) {
      const tpl = dict.mods && dict.mods[key];
      if (!tpl) continue;
      const filled = fill(tpl, tokens);
      if (filled != null) return filled + suffix;
    }
    // "+3 to Level of all Ember Fusillade Skills": the catalogs carry that sentence for whole
    // categories ("all Fire Skills") but not for one skill, whose name they do have. Built in the
    // same shape as the category lines ("+3全部火焰技能等級").
    const allSkills = body.match(/^\+?(\d+(?:\.\d+)?) to Level of all (.+?) Skills$/i);
    if (allSkills) {
      const nm = dict.names && dict.names[allSkills[2]];
      if (nm) return `+${allSkills[1]}全部${nm}技能等級` + suffix;
    }
    return s;
  }

  return { modKey, tokensOf, fill, translate, lineKey };
});

// ---- browser side: load the catalog once, hand the UI gdName() / gdText() ----
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function () {
    const core = window.gameDataCore;
    let dict = null;
    let loading = null;
    // Simplified Chinese UI still shows game data in Traditional Chinese (PoB's own terms)
    const LANGS = ['zh-TW', 'zh-CN'];

    function active() {
      return !!(window.i18n && LANGS.includes(window.i18n.getLang()));
    }

    // English names stay English in the other languages; game data is never
    // machine-translated, only looked up. Some catalog entries keep PoB's rich text
    // ("[Jewel|珠寶]插槽"), so only the readable half is returned.
    function gdName(s) {
      if (!dict || !active() || typeof s !== 'string' || !s) return s;
      const v = (dict.names && dict.names[s]) || s;
      return v.replace(/\[[^\]|]*\|([^\]]+)\]/g, '$1');
    }

    // "Energy Shield: 559" and friends: a property line, not a mod
    const PROPERTY = /^(Energy Shield|Armour|Evasion(?: Rating)?|Ward|Spirit|Quality|Sockets|Item Level|Stack Size|Requires|Level):\s*(.*)$/i;
    // PoB and the game text keep wiki-style links in some lines: "[ItemDefences|物品閃避值]" is
    // really "物品閃避值", and "[Totem圖騰]" is "圖騰"
    const stripRich = (x) => String(x)
      .replace(/\[([^\]|]*)\|([^\]]+)\]/g, '$2')
      .replace(/\[([^\]]+)\]/g, (m, inner) => {
        const zh = inner.match(/[\u4e00-\u9fff][\u4e00-\u9fff0-9%（）\s]*/);
        return zh ? zh[0].trim() : inner;
      });
    // area names, keyed the same way tools/make-area-data.js writes them: lowercase letters and
    // digits only, leading "The" dropped ("The Khari Crossing" = "Khari Crossing")
    const areaKey = (s) => String(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
    function gdArea(s) {
      if (!dict || !dict.areas || !active() || typeof s !== 'string' || !s) return s;
      return dict.areas[areaKey(s)] || s;
    }
    // labels inside an item tooltip are game text: always Traditional, even in a Simplified UI
    const tw = (s) => (window.i18n && window.i18n.tIn ? window.i18n.tIn('zh-TW', s) : s);

    function gdText(s) {
      if (!dict || !active() || typeof s !== 'string' || !s) return s;
      const prop = s.match(PROPERTY);
      if (prop && window.i18n) {
        const label = tw(prop[1]);
        if (label !== prop[1]) {
          // "Requires: Level 75, 59 Str, 59 Int" keeps its numbers, translates the words
          const words = /^Requires$/i.test(prop[1]) ? translateWords(prop[2]) : prop[2];
          return `${label}: ${words}`;
        }
      }
      if (/^Requires?:/i.test(s)) return translateWords(s);
      if (/^(Corrupted|Unidentified|Mirrored|Unmodifiable|Sanctified|Twice Corrupted)$/i.test(s)) return tw(s);
      // jewels that allocate a passive: "Allocates Versatile Arms" -> 配置 萬能雙手
      const alloc = s.match(/^Allocates (.+?)$/i);
      if (alloc && window.gdName) {
        const nm = window.gdName(alloc[1].trim());
        if (nm !== alloc[1].trim()) return `${tw('Allocates')} ${nm}`;
      }
      // jewels that free up a whole radius: "Passives in Radius of Hollow Palm Technique can be
      // Allocated without being connected to your tree" (the passive's name is the variable;
      // the parser joins the wrapped lines without a space, hence \s*)
      const radiusOf = s.replace(/\s+/g, ' ').trim()
        .match(/^Passives in Radius of (.+?) can be Allocated\s*without being connected to your tree$/i);
      if (radiusOf) {
        const nm = window.gdName ? window.gdName(radiusOf[1].trim()) : radiusOf[1].trim();
        return `天賦樹中在${nm}範圍內未連結的天賦仍然可以配置`;
      }
      // passives that grant a skill: translate the label and the skill's own name
      const granted = s.match(/^Grants Skill:\s*(?:Level\s*\d+\s*)?(.+)$/i);
      if (granted && window.i18n) {
        const label = tw('Grants Skill');
        const name = core.translate(dict, granted[1]);
        if (label !== 'Grants Skill') return `${label}: ${name}`;
      }
      return stripRich(core.translate(dict, s));
    }

    // requirement lines: translate the words the game uses, keep the numbers
    function translateWords(s) {
      if (!window.i18n) return s;
      return s.replace(/\b(Requires|Level|Str|Dex|Int|Strength|Dexterity|Intelligence)\b/g, (w) => tw(w));
    }

    function load() {
      if (dict) return Promise.resolve(dict);
      if (loading) return loading;
      if (!window.api || !window.api.gameDict) return Promise.resolve(null);
      loading = window.api.gameDict()
        .then((d) => {
          dict = d || null;
          // pages re-render on a language-change notification: reuse it so the
          // names that were drawn in English before the catalog arrived are redrawn
          if (dict && window.i18n) window.i18n.setLangLocal(window.i18n.getLang());
          return dict;
        })
        .catch(() => null);
      return loading;
    }

    window.gdName = gdName;
    window.gdText = gdText;
    window.gdArea = gdArea;
    window.gameData = { load, ready: load(), get loaded() { return !!dict; } };
    if (window.i18n && window.i18n.onChange) window.i18n.onChange(() => { if (active()) load(); });
  })();
}
