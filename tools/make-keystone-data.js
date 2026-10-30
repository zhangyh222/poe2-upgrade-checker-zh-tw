'use strict';
// Builds src/data/keystones-zh-tw.json: the stat lines of every keystone, English -> Traditional
// Chinese. PoB's own zh_TW catalogs leave most of these untranslated (empty msgstr), so the lines
// come from poe2db's per-keystone pages, which carry the Chinese text in og:description.
//
//   node tools/make-keystone-data.js [--fetch]
//
// The keystone names come from tools/cache/keystones.txt (one per line; written from the app's
// own passive tree). --fetch downloads the pages into tools/cache/keystones first.

const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, 'cache', 'keystones');
const LIST = path.join(__dirname, 'cache', 'keystones.txt');
const OUT = path.join(__dirname, '..', 'src', 'data', 'keystones-zh-tw.json');

const slug = (name) => name.replace(/'/g, '').replace(/\s+/g, '_');
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
// poe2db pages carry wiki links and list bullets: "[ItemDefences|物品閃避值]" is really "物品閃避值"
const clean = (s) => String(s).replace(/^[•·]\s*/, '')
  .replace(/\[[^\]|]*\|([^\]]+)\]/g, '$1').replace(/\[([^\]]+)\]/g, '$1').trim();

function descriptions(html) {
  const m = html.match(/<meta property="og:description" content="([^"]*)"/);
  if (!m) return [];
  return m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .split('\n').map((s) => s.trim()).filter(Boolean);
}

async function fetchPages(names) {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const name of names) {
    for (const lang of ['tw', 'us']) {
      const file = path.join(CACHE, `${lang}_${slug(name)}.html`);
      if (fs.existsSync(file) && fs.statSync(file).size > 2000) continue;
      const res = await fetch(`https://poe2db.tw/${lang}/${slug(name)}`);
      if (!res.ok) { console.log(`${lang} ${name}: ${res.status}`); continue; }
      fs.writeFileSync(file, await res.text());
    }
  }
}

function build(names) {
  const map = {};
  let pairs = 0; let skipped = 0;
  for (const name of names) {
    const twFile = path.join(CACHE, `tw_${slug(name)}.html`);
    const usFile = path.join(CACHE, `us_${slug(name)}.html`);
    if (!fs.existsSync(twFile) || !fs.existsSync(usFile)) { skipped++; continue; }
    const tw = descriptions(fs.readFileSync(twFile, 'utf8'));
    const us = descriptions(fs.readFileSync(usFile, 'utf8'));
    if (!tw.length || tw.length !== us.length) { console.log(`${name}: ${us.length} en / ${tw.length} zh, skipped`); skipped++; continue; }
    us.forEach((en, i) => { map[norm(en)] = clean(tw[i]); pairs++; });
  }
  // a few lines the Chinese page keeps as one sentence (see tools/cache/keystones-overrides.json)
  const overridesFile = path.join(__dirname, 'cache', 'keystones-overrides.json');
  if (fs.existsSync(overridesFile)) {
    const extra = JSON.parse(fs.readFileSync(overridesFile, 'utf8'));
    for (const [en, zh] of Object.entries(extra)) map[norm(en)] = zh;
  }
  if (!pairs) {
    console.error('no cached pages: run `node tools/make-keystone-data.js --fetch` (the file was left alone)');
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify({ v: 1, source: 'poe2db.tw keystone pages', lines: map }, null, 0) + '\n');
  console.log(`keystones: ${names.length}, lines: ${Object.keys(map).length} (${pairs} scraped), skipped: ${skipped} -> ${path.relative(process.cwd(), OUT)}`);
}

(async () => {
  const names = fs.readFileSync(LIST, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  if (process.argv.includes('--fetch')) await fetchPages(names);
  build(names);
})().catch((e) => { console.error(e.message); process.exit(1); });
