'use strict';
// Builds src/data/zh-tw.json from Path of Building's zh_TW translation catalogs
// (locale/zh_TW/LC_MESSAGES/{skills,passives,items,stats}.po, from the
// PathOfBuilding-PoE2-i18n project). The result is a lookup the UI uses to show
// game data — skill, passive, ascendancy and item names, and stat lines — in
// Traditional Chinese, while the app's own UI strings stay in src/i18n.js.
//
//   node tools/make-zh-tw-data.js [<po dir>]
//
// PO dir defaults to tools/cache/po; run tools/fetch-zh-tw-po.js first.

const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, 'cache', 'po');
// PoeCharm2 (the Chinese Path of Building for PoE2) ships more item and mod
// translations than the PO catalogs: it fills the gaps (unique names, map mods).
const PC2 = path.join(__dirname, 'cache', 'pc2');
const OUT = path.join(__dirname, '..', 'src', 'data', 'zh-tw.json');

// msgid/msgstr pairs, with "..." continuation lines and the header entry dropped.
function parsePO(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const out = [];
  let id = null; let str = null; let cur = null;
  const flush = () => { if (id !== null && str !== null) out.push([id, str]); id = null; str = null; cur = null; };
  for (const line of txt.split('\n')) {
    if (line.startsWith('msgid "')) { flush(); id = line.slice(7, -1); cur = 'id'; }
    else if (line.startsWith('msgstr "')) { str = line.slice(8, -1); cur = 'str'; }
    else if (line.startsWith('"') && cur) { const v = line.slice(1, -1); if (cur === 'id') id += v; else str += v; }
    else if (!line.trim()) flush();
  }
  flush();
  return out.filter(([i]) => i);
}

// Same shape for live text and catalog ids: numbers, rolls in brackets and
// {0}/{0:+d} placeholders all become "#", so "+89 to maximum Life" finds the
// catalog's "{0:+d} to maximum Life". The trade site's pseudo totals ("+#% total
// to Fire Resistance") drop the word "total" to match the plain mod.
function modKey(s) {
  return String(s)
    .replace(/\(-?[\d.]+--?[\d.]+\)/g, '#')
    .replace(/\{[0-9]+(?::[^}]*)?\}/g, '#')
    .replace(/\btotal\s+/gi, '')
    .replace(/[−–]/g, '-')
    .replace(/[-+]?\d+(?:\.\d+)?/g, '#')
    .replace(/\+#/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

const names = {};
const mods = {};
const counts = {};
for (const file of ['skills', 'passives', 'items', 'stats']) {
  const p = path.join(SRC, `${file}.po`);
  if (!fs.existsSync(p)) { console.error(`missing ${p} – run tools/fetch-zh-tw-po.js`); process.exit(1); }
  let used = 0;
  for (const [id, str] of parsePO(p)) {
    if (!str || !str.trim()) continue;
    if (str.trim() === id.trim()) continue; // catalog still holds the English text
    if (file === 'stats') {
      // stat lines are matched as templates: keep the ones with a placeholder or exact wording
      const key = modKey(id);
      if (key && !mods[key]) { mods[key] = str; used++; }
    } else if (!names[id]) { names[id] = str; used++; }
  }
  counts[file] = used;
}

// ---- PoeCharm2 CSVs: fill in what the catalogs don't have ----
// "English","Chinese" pairs; the first column wins when both know a name.
function parseCSV(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const rows = [];
  let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (quoted) {
      if (c === '"') { if (txt[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

let pc2 = 0;
if (fs.existsSync(PC2)) {
  for (const file of ['Uniques.txt.csv', 'Items_Armour.txt.csv', 'Items_Weapons.txt.csv', 'Items_Accessories.txt.csv', 'Items_Jewels.txt.csv', 'Items_Gems.txt.csv', 'Gems_data.txt.csv', 'tree_dn.csv']) {
    const p = path.join(PC2, file);
    if (!fs.existsSync(p)) continue;
    for (const [en, zh] of parseCSV(p)) {
      if (!en || !zh || !zh.trim() || en === zh) continue;
      if (!names[en]) { names[en] = zh; pc2++; }
    }
  }
  // statDescriptions.csv holds every stat description (5.4 MB): the extra stat
  // lines it would add are worth ~200 more matches and quadruple the file, so the
  // mod tables stay with the PO catalogs and only the names come from here.
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ v: 1, source: 'PathOfBuilding-PoE2-i18n (zh_TW)', names, mods }));
const size = fs.statSync(OUT).size;
console.log(`names ${Object.keys(names).length}, mods ${Object.keys(mods).length} (${counts.skills} skills / ${counts.passives} passives / ${counts.items} items / ${counts.stats} stats, +${pc2} from PoeCharm2)`);
console.log(`wrote ${OUT} (${(size / 1048576).toFixed(2)} MB)`);
