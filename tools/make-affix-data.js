// Build src/data/affixes.json from the Path of Building files bundled in vendor/pob.
//
// PoB knows every rare affix: name, prefix/suffix, tier group, ilvl and the bases it
// can roll on (Bases/*.lua `tags`). That is the same data the game uses, so a plain
// Ctrl+C item - which never says which affix a line is - can still be labelled.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'vendor', 'pob', 'src', 'Data');
const OUT = path.join(ROOT, 'src', 'data', 'affixes.json');

// ---------- lua table -> JS ----------
// The generated files are plain Lua tables: strings, numbers, nested { } and [n] = v.
function parseLuaValue(src, i) {
  while (/\s/.test(src[i])) i++;
  if (src[i] === '{') {
    i++;
    const obj = {};
    const arr = [];
    let isArray = true;
    for (;;) {
      while (/\s|,/.test(src[i])) i++;
      if (src[i] === '}') {
        if (isArray) return { value: arr, next: i + 1 };
        // a Lua table can hold both named fields and bare values (mod stat lines)
        arr.forEach((v, n) => { obj[n] = v; });
        return { value: obj, next: i + 1 };
      }
      let key = null;
      if (src[i] === '[') {
        let j = i + 1;
        let k = '';
        while (src[j] !== ']') k += src[j++];
        i = j + 1;
        while (/\s/.test(src[i])) i++;
        if (src[i] !== '=') throw new Error('bad key at ' + i);
        i++;
        key = /^"?-?\d+"?$/.test(k.trim()) ? Number(k.replace(/"/g, '')) : k.replace(/^"|"$/g, '');
      } else {
        const ident = /^[A-Za-z_]\w*/.exec(src.slice(i));
        if (ident && /^\s*=/.test(src.slice(i + ident[0].length))) {
          key = ident[0];
          i += ident[0].length;
          while (/\s/.test(src[i])) i++;
          i++; // =
        }
      }
      const parsed = parseLuaValue(src, i);
      i = parsed.next;
      if (key === null) {
        arr.push(parsed.value);
      } else {
        isArray = false;
        obj[key] = parsed.value;
      }
    }
  }
  if (src[i] === '"') {
    let j = i + 1;
    let out = '';
    while (src[j] !== '"') {
      if (src[j] === '\\') { out += src[j + 1]; j += 2; } else out += src[j++];
    }
    return { value: out, next: j + 1 };
  }
  const num = /^-?\d+(?:\.\d+)?/.exec(src.slice(i));
  if (num) return { value: Number(num[0]), next: i + num[0].length };
  const word = /^[A-Za-z_]\w*/.exec(src.slice(i));
  if (word) return { value: word[0] === 'true' ? true : word[0] === 'false' ? false : word[0], next: i + word[0].length };
  throw new Error('unexpected ' + JSON.stringify(src.slice(i, i + 20)));
}

// "return { ... }" (ModItem.lua) or "local itemBases = { ... }" / itemBases["x"] = {...}
function parseTableFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(/^--.*$/gm, '');
  const ret = src.indexOf('return {');
  if (ret >= 0) return parseLuaValue(src, src.indexOf('{', ret)).value;
  // Bases files: a run of assignments sharing one table
  const out = {};
  const re = /itemBases\["((?:[^"\\]|\\.)*)"\]\s*=\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const start = src.indexOf('{', m.index + m[0].length - 1);
    const parsed = parseLuaValue(src, start);
    out[m[1].replace(/\\"/g, '"')] = parsed.value;
    re.lastIndex = parsed.next;
  }
  return out;
}

// ---------- bases: name -> slot type + tags ----------
const bases = {};
for (const file of fs.readdirSync(path.join(DATA, 'Bases'))) {
  if (!file.endsWith('.lua')) continue;
  const table = parseTableFile(path.join(DATA, 'Bases', file));
  for (const [name, base] of Object.entries(table)) {
    if (!base || typeof base !== 'object' || !base.type) continue;
    const tags = Object.keys(base.tags || {}).filter((k) => base.tags[k]);
    bases[name] = { type: base.type, tags };
  }
}

// ---------- mods: prefix/suffix with the bases they can spawn on ----------
const rawMods = parseTableFile(path.join(DATA, 'ModItem.lua'));
// numbers in a stat line, as [min, max] pairs: "(10-19)" is a roll range, "5" is fixed
const valueRanges = (s) => {
  const out = [];
  const re = /\((-?[\d.]+)-(-?[\d.]+)\)|(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(String(s)))) {
    if (m[1] !== undefined) out.push([Number(m[1]), Number(m[2])]);
    else out.push([Number(m[3]), Number(m[3])]);
  }
  return out;
};

const normLine = (s) =>
  String(s)
    .replace(/\(-?[\d.]+--?[\d.]+\)/g, '#') // (10-19) ranges
    .replace(/-?\d+(?:\.\d+)?/g, '#')       // plain numbers
    .replace(/\s+/g, ' ')
    .trim();

const mods = [];
if (process.env.DBG) console.error('raw', Object.keys(rawMods).length, JSON.stringify(Object.entries(rawMods)[0]).slice(0,300));
for (const [id, mod] of Object.entries(rawMods)) {
  if (!mod || (mod.type !== 'Prefix' && mod.type !== 'Suffix')) continue;
  const statLines = [];
  for (let i = 0; mod[i] !== undefined; i++) if (typeof mod[i] === 'string') statLines.push(mod[i]);
  if (!statLines.length) continue;
  const keys = [];
  const weightKey = mod.weightKey || [];
  const weightVal = mod.weightVal || [];
  for (let i = 0; i < weightKey.length; i++) if (Number(weightVal[i]) > 0) keys.push(weightKey[i]);
  // The full (tag, weight) list, in the game's order: the first tag that matches the item decides,
  // and a 0 there means "never on this kind of item" (a boot can't roll the tiers a helmet can).
  const w = [];
  for (let i = 0; i < weightKey.length; i++) w.push([weightKey[i], Number(weightVal[i]) || 0]);
  // essence mods roll no weight at all: they only appear on an item you used an essence on
  const isEssence = mod.affix === 'Essences';
  if (!keys.length && !isEssence) continue;
  mods.push({
    id,
    t: mod.type === 'Prefix' ? 'p' : 's',
    n: mod.affix || '',
    g: mod.group || id,
    l: Number(mod.level) || 1,
    k: keys,
    w,
    ...(isEssence ? { e: 1 } : {}),
    s: statLines.map((line) => ({ text: line, key: normLine(line), v: valueRanges(line) })),
  });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ bases, mods }));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`bases ${Object.keys(bases).length}, mods ${mods.length} (p ${mods.filter((m) => m.t === 'p').length} / s ${mods.filter((m) => m.t === 's').length}), ${kb} kB`);
