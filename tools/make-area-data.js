'use strict';
// Builds src/data/areas-zh-tw.json: English area name -> Traditional Chinese, scraped from
// poe2db.tw's act pages (the same client language Path of Building exports). The quest sources in
// the stat panels read like "Act 1:Ogham Manor"; this maps the area half.
//
//   node tools/make-area-data.js [--fetch]
//
// --fetch downloads the act pages into tools/cache/areas first (needs network).

const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, 'cache', 'areas');
const OUT = path.join(__dirname, '..', 'src', 'data', 'areas-zh-tw.json');
const PAGES = ['Act_1', 'Act_2', 'Act_3', 'Act_4', 'Act_5', 'Interlude'];

const norm = (s) => String(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');

async function fetchPages() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const p of PAGES) {
    const file = path.join(CACHE, p + '.html');
    if (fs.existsSync(file) && fs.statSync(file).size > 10000) continue;
    const res = await fetch(`https://poe2db.tw/tw/${p}`);
    if (!res.ok) { console.log(`${p}: ${res.status}, skipped`); continue; }
    fs.writeFileSync(file, await res.text());
    console.log(`${p}: ${fs.statSync(file).size} bytes`);
  }
}

function build() {
  const map = {};
  for (const p of PAGES) {
    const file = path.join(CACHE, p + '.html');
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const re = /href="(?:\/tw\/)?([A-Za-z0-9_]+)">([^<]{1,60})</g;
    let m;
    while ((m = re.exec(html))) {
      const zh = m[2].trim();
      if (!zh || /^[\x00-\x7f]+$/.test(zh)) continue; // English rows tell us nothing
      const en = m[1].replace(/_+$/, '').replace(/_/g, ' ');
      const k = norm(en);
      if (k && !map[k]) map[k] = zh;
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({ v: 1, source: 'poe2db.tw/tw act pages', areas: map }, null, 0) + '\n');
  console.log(`areas: ${Object.keys(map).length} -> ${path.relative(process.cwd(), OUT)}`);
}

(async () => {
  if (process.argv.includes('--fetch')) await fetchPages();
  build();
})().catch((e) => { console.error(e.message); process.exit(1); });
