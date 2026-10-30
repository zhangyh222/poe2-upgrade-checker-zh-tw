'use strict';
const fs = require('fs');

// Extract translation keys used via t('...') / t("...") from a JS source file,
// respecting escape sequences inside the string literal.
function extractTKeys(src) {
  const keys = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    // find next "t(" that is preceded by non-identifier char
    if (src[i] === 't' && src[i + 1] === '(') {
      const prev = src[i - 1];
      const isIdent = prev && /[A-Za-z0-9_$.]/.test(prev);
      if (!isIdent) {
        let j = i + 2;
        // skip whitespace
        while (j < n && /\s/.test(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          j++;
          let key = '';
          let ok = false;
          while (j < n) {
            const c = src[j];
            if (c === '\\') { key += c + src[j + 1]; j += 2; continue; }
            if (c === q) { ok = true; break; }
            key += c; j++;
          }
          if (ok) keys.push(key);
          i = j + 1;
          continue;
        }
      }
    }
    i++;
  }
  return keys;
}

// Check each Chinese dictionary separately: a key in one language must not mask a gap in another.
function extractDictKeys(src, name) {
  const start = src.indexOf(`  const ${name} = {`);
  if (start < 0) throw new Error(`Missing dictionary: ${name}`);
  const end = src.indexOf('\n  };', start);
  if (end < 0) throw new Error(`Unclosed dictionary: ${name}`);
  const keys = new Set();
  for (const m of src.slice(start, end).matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)) {
    keys.add(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  }
  return keys;
}

const uiFiles = ['src/ui/render.js', 'src/ui/results.js', 'src/ui/character.js', 'src/ui/picker.js', 'src/ui/settings.js', 'src/ui/popup.js'];
const i18nSrc = fs.readFileSync('src/i18n.js', 'utf8');
const dictionaries = { zh: extractDictKeys(i18nSrc, 'zh'), zhCN: extractDictKeys(i18nSrc, 'zhCN') };
const allUsed = new Set();
for (const f of uiFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const k of extractTKeys(src)) allUsed.add(k);
}
const normalize = (k) => k.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
let failed = false;
for (const [name, dict] of Object.entries(dictionaries)) {
  const missing = [...allUsed].map(normalize).filter((k) => !dict.has(k)).sort();
  console.log(`${name} dictionary keys:`, dict.size);
  console.log(`${name} missing t() literal keys:`, missing.length);
  for (const k of missing) console.log('  - ' + JSON.stringify(k));
  if (missing.length) failed = true;
}
if (failed) process.exitCode = 1;
