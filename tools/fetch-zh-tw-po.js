'use strict';
// Downloads Path of Building's zh_TW translation catalogs (skills, passives, items,
// stats) from the PathOfBuilding-PoE2-i18n project into tools/cache/po, where
// tools/make-zh-tw-data.js turns them into src/data/zh-tw.json.
//
//   node tools/fetch-zh-tw-po.js
//
// Uses the GitHub API (the raw.githubusercontent.com host is blocked on some networks).

const fs = require('fs');
const path = require('path');

// Two sources: the PO catalogs, and the CSVs of the Chinese Path of Building
// (PoeCharm2), which add unique item and base type names.
const REPO = 'woolkingx/PathOfBuilding-PoE2-i18n';
const FILES = ['skills', 'passives', 'items', 'stats'];
const DIR = path.join(__dirname, 'cache', 'po');
const PC2_REPO = 'Chuanhsing/PoeCharm2';
const PC2_FILES = ['Uniques.txt.csv', 'Items_Armour.txt.csv', 'Items_Weapons.txt.csv', 'Items_Accessories.txt.csv', 'Items_Jewels.txt.csv', 'Items_Gems.txt.csv', 'Gems_data.txt.csv', 'tree_dn.csv'];
const PC2_DIR = path.join(__dirname, 'cache', 'pc2');

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const tree = await (await fetch(`https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`)).json();
  for (const name of FILES) {
    const file = `locale/zh_TW/LC_MESSAGES/${name}.po`;
    const node = (tree.tree || []).find((x) => x.path === file);
    if (!node) { console.error(`not in ${REPO}: ${file}`); process.exitCode = 1; continue; }
    const blob = await (await fetch(`https://api.github.com/repos/${REPO}/git/blobs/${node.sha}`)).json();
    const buf = Buffer.from(blob.content, 'base64');
    fs.writeFileSync(path.join(DIR, `${name}.po`), buf);
    console.log(`${file} (${(buf.length / 1024).toFixed(0)} kB)`);
  }
  fs.mkdirSync(PC2_DIR, { recursive: true });
  const pc2Tree = await (await fetch(`https://api.github.com/repos/${PC2_REPO}/git/trees/HEAD?recursive=1`)).json();
  for (const name of PC2_FILES) {
    const file = `Data/Translate/zh-rTW/${name}`;
    const node = (pc2Tree.tree || []).find((x) => x.path === file);
    if (!node) { console.error(`not in ${PC2_REPO}: ${file}`); process.exitCode = 1; continue; }
    const blob = await (await fetch(`https://api.github.com/repos/${PC2_REPO}/git/blobs/${node.sha}`)).json();
    const buf = Buffer.from(blob.content, 'base64');
    fs.writeFileSync(path.join(PC2_DIR, name), buf);
    console.log(`${file} (${(buf.length / 1024).toFixed(0)} kB)`);
  }
})();
