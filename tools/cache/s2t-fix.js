// one-off: convert Simplified leftovers inside the Traditional (zh) dictionary
const fs = require('fs');
const read = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
const phrases = new Map();
for (const line of read('tools/cache/TSPhrases.txt')) {
  const [k, v] = line.split('\t');
  if (k && v) phrases.set(k, v.split(' ')[0]);
}
const chars = new Map();
for (const line of read('tools/cache/TSCharacters.txt')) {
  const [k, v] = line.split('\t');
  if (k && v) chars.set(k, v.split(' ')[0]);
}
const conv = (s) => {
  let out = '';
  for (let i = 0; i < s.length;) {
    let hit = null;
    for (const len of [4, 3, 2]) {
      const part = s.slice(i, i + len);
      if (phrases.has(part)) { hit = [part, phrases.get(part)]; break; }
    }
    if (hit) { out += hit[1]; i += hit[0].length; continue; }
    const ch = s[i];
    out += chars.has(ch) ? chars.get(ch) : ch;
    i++;
  }
  return out;
};

const file = 'src/i18n.js';
const src = fs.readFileSync(file, 'utf8');
const start = src.indexOf('  const zh = {');
const end = src.indexOf('\n  };', start);
let changed = 0;
const body = src.slice(start, end).replace(/^(\s*"((?:[^"\\]|\\.)*)"\s*:\s*")((?:[^"\\]|\\.)*)(")/gm, (m, a, k, v, d) => {
  const next = conv(v);
  if (next !== v) { changed++; return a + next + d; }
  return m;
});
fs.writeFileSync(file, src.slice(0, start) + body + src.slice(end));
console.log('values converted:', changed);
