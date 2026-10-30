#!/usr/bin/env node
'use strict';
// Clears what a previous run of the app saved: the Path of Building build imported into it and
// the pathofexile.com sign-in (cookies), so a freshly packaged build starts like a first install.
// Looks in both places the app has used: the profile folder (local runs) and the -data folder
// next to the installed app (see src/datadir.js).
//
// Run by `npm run dist` / build-exe.bat only - testing locally (`npm start`,
// test-build.bat) keeps the data, so you stay signed in between runs.
//
//   node tools/clean-app-data.js             show what would be deleted, delete nothing
//   node tools/clean-app-data.js --yes       delete it
//   node tools/clean-app-data.js --yes --keep-settings
//                                            only the Path of Building folder, the sign-in
//                                            cookies and the trade cache; settings, gear and
//                                            hotkeys are kept
//
// Close the app first: Windows keeps the files locked while it runs.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA_DIR_NAME } = require('../src/datadir');

// app.getName() comes from package.json: "name" here (productName only lives under "build")
const NAMES = ['poe2-upgrade-checker', 'PoE2 Upgrade Checker'];
// one of these must be inside the folder before anything is deleted, so a typo can't wipe
// an unrelated folder that happens to share the name
const MARKERS = ['poe2-upgrade-checker.json', 'poe2-upgrade-checker.log', 'Partitions', 'pob'];

const args = new Set(process.argv.slice(2));
const yes = args.has('--yes');
const keepSettings = args.has('--keep-settings');

function baseDir() {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

// Every folder the app may have written to: the profile folder (local runs and older installs)
// and, for installed builds, the "<install folder>-data" folder next to the install folder.
function candidates(base) {
  const list = NAMES.map((n) => path.join(base, n));
  const roots = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs'),
      process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)
    : [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), 'Applications'), os.homedir()];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === DATA_DIR_NAME) { list.push(path.join(root, e.name)); continue; }
      if (e.name.endsWith('-data')) continue;
      // the install folder itself: the data lives in "<its name>-data" beside it
      if (fs.existsSync(path.join(root, e.name, 'PoE2 Upgrade Checker.exe'))) list.push(path.join(root, e.name + '-data'));
    }
  }
  if (process.env.POE2UC_DATA_DIR) list.push(path.resolve(process.env.POE2UC_DATA_DIR));
  return [...new Set(list.map((p) => path.resolve(p)))];
}

function sizeOf(p) {
  let bytes = 0; let files = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      try { bytes += fs.statSync(f).size; files++; } catch (_) { /* locked files: skip */ }
    }
  };
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return { bytes: st.size, files: 1 };
    walk(p);
  } catch (_) { /* ignore */ }
  return { bytes, files };
}

const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';

const base = baseDir();

const targets = [];
for (const dir of candidates(base)) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
  const has = MARKERS.filter((m) => fs.existsSync(path.join(dir, m)));
  if (!has.length) { console.log(`Skipping ${dir}: it does not look like this app's folder.`); continue; }
  targets.push(dir);
}

if (!targets.length) {
  console.log(`No saved app data in ${base} - nothing to clear.`);
  process.exit(0);
}

let failed = false;
for (const dir of targets) {
  const items = keepSettings
    ? ['pob', 'Partitions', 'trade-cache.json'].map((n) => path.join(dir, n)).filter((p) => fs.existsSync(p))
    : [dir];
  for (const item of items) {
    const { bytes, files } = sizeOf(item);
    const label = path.relative(dir, item) || ('everything in ' + path.basename(dir));
    if (!yes) { console.log(`Would delete ${label} (${files} files, ${mb(bytes)}): ${item}`); continue; }
    try {
      fs.rmSync(item, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      console.log(`Deleted ${label} (${files} files, ${mb(bytes)}).`);
    } catch (err) {
      failed = true;
      console.error(`Could not delete ${item}: ${err.message}`);
      console.error('Close PoE2 Upgrade Checker (and any Path of Building window it started) and try again.');
    }
  }
}

if (!yes) {
  console.log('\nNothing was deleted. Run again with --yes to delete it.');
  process.exit(0);
}
if (!failed) {
  console.log(keepSettings
    ? '\nDone. The next start asks for a Path of Building build and a sign-in again; settings and gear are kept.'
    : '\nDone. The next start behaves like a first install.');
}
process.exit(failed ? 1 : 0);
