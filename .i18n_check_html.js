'use strict';
const fs = require('fs');

// Extract data-i18n* attribute values from an HTML file (with entity decoding),
// so we can confirm every static UI string has an English key in all language dictionaries.
function extractHtmlKeys(src) {
  const attrs = ['data-i18n', 'data-i18n-html', 'data-i18n-title', 'data-i18n-placeholder', 'data-i18n-aria-label', 'data-i18n-alt'];
  const keys = [];
  const re = new RegExp('(?:' + attrs.map((a) => a.replace(/[-]/g, '\\-')).join('|') + ')\\s*=\\s*"(.*?)"', 'g');
  let m;
  while ((m = re.exec(src))) {
    let v = m[1];
    v = v.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n').replace(/&rsquo;/g, '’').replace(/&nbsp;/g, ' ');
    if (v) keys.push(v);
  }
  return keys;
}

function extractDictKeys(src, name) {
  const start = src.indexOf(`  const ${name} = {`);
  if (start < 0) throw new Error(`Missing dictionary: ${name}`);
  const end = src.indexOf('\n  };', start);
  if (end < 0) throw new Error(`Unclosed dictionary: ${name}`);
  const keys = new Set();
  for (const m of src.slice(start, end).matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)) {
    keys.add(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n'));
  }
  return keys;
}

const htmlFiles = ['src/ui/settings.html', 'src/ui/results.html', 'src/ui/popup.html'];
const missingScripts = [];
for (const file of htmlFiles) {
  const src = fs.readFileSync(file, 'utf8');
  for (const match of src.matchAll(/<script\s+src="([^"]+)"/g)) {
    const target = require('path').resolve(require('path').dirname(file), match[1]);
    if (!fs.existsSync(target)) missingScripts.push(`${file} -> ${match[1]}`);
  }
}
const i18nSrc = fs.readFileSync('src/i18n.js', 'utf8');
const dictionaries = { zh: extractDictKeys(i18nSrc, 'zh'), zhCN: extractDictKeys(i18nSrc, 'zhCN') };
const allUsed = new Set();
for (const f of htmlFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const k of extractHtmlKeys(src)) allUsed.add(k);
}
const normalize = (k) => k.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
let failed = false;
console.log('HTML distinct keys used:', allUsed.size);
for (const [name, dict] of Object.entries(dictionaries)) {
  const missing = [...allUsed].map(normalize).filter((k) => !dict.has(k)).sort();
  console.log(`${name} dictionary keys:`, dict.size);
  console.log(`${name} missing HTML keys:`, missing.length);
  for (const k of missing) console.log('  - ' + JSON.stringify(k));
  if (missing.length) failed = true;
}
console.log('Broken local script references:', missingScripts.length);
for (const file of missingScripts) console.log('  - ' + file);
if (failed || missingScripts.length) process.exitCode = 1;
