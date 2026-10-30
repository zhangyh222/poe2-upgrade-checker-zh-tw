'use strict';

// Where the app keeps its data: gear, weights, the imported PoB build, the trade-site sign-in.
//
// Installed builds keep it in a sibling folder next to the install folder
// (C:\...\Programs\poe2-upgrade-checker -> C:\...\Programs\poe2-upgrade-checker-data), so the data
// sits with the program and is easy to find, back up or wipe. Not inside the install folder: the
// Windows installer runs the old uninstaller on every update, which deletes the whole install
// folder (electron-builder's uninstaller.nsh: RMDir /r $INSTDIR).
//
// Falls back to the usual profile folder (app.getPath('userData')) when that place can't be
// written, e.g. an all-users install in Program Files. Local runs (npm start) keep using the
// profile folder, so testing leaves nothing next to the repo.

const fs = require('fs');
const path = require('path');

const DATA_DIR_NAME = 'poe2-upgrade-checker-data';

// The folder that holds everything; null means "use the profile folder Electron picked".
// opts: packaged (app.isPackaged), execPath (process.execPath), portableDir
// (PORTABLE_EXECUTABLE_DIR), appImage (APPIMAGE), envDir (POE2UC_DATA_DIR), platform
function pickDataDir(opts = {}) {
  const platform = opts.platform || process.platform;
  const envDir = opts.envDir;
  if (envDir) return tryUse(path.resolve(envDir));

  if (!opts.packaged) return null; // npm start / tests: leave the profile folder alone

  const execPath = opts.execPath || process.execPath;
  // portable .exe: the file sits wherever the user put it, so the data folder goes beside it
  if (opts.portableDir) return tryUse(path.join(opts.portableDir, DATA_DIR_NAME));
  // AppImage: process.execPath is inside the read-only mount; the real file is in $APPIMAGE
  if (platform === 'linux' && opts.appImage) return tryUse(path.join(path.dirname(opts.appImage), DATA_DIR_NAME));

  const installDir = path.dirname(execPath);
  if (!installDir || installDir === path.dirname(installDir)) return null;
  return tryUse(path.join(path.dirname(installDir), path.basename(installDir) + '-data'));
}

function tryUse(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return dir;
  } catch (_) {
    return null; // read-only place: the caller keeps the profile folder
  }
}

// Anything an older version left in the profile folder comes along, so updating doesn't look like
// a fresh install: gear, build, sign-in and settings are kept.
// copy: true leaves the source in place (the portable .exe shouldn't take the data away from an
// installed copy on the same machine).
const MOVES = [
  'poe2-upgrade-checker.json', 'pob', 'Partitions', 'trade-cache.json',
  'poe2uc-keys.ps1', 'poe2uc-keys.py', 'poe2-upgrade-checker.log',
];

function migrate(from, to, opts = {}) {
  const marker = 'poe2-upgrade-checker.json';
  if (!from || !to) return [];
  if (path.resolve(from) === path.resolve(to)) return [];
  if (!fs.existsSync(path.join(from, marker))) return []; // nothing saved yet
  if (fs.existsSync(path.join(to, marker))) return []; // already in use: never overwrite
  const moved = [];
  for (const rel of MOVES) {
    const src = path.join(from, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(to, rel);
    if (opts.copy) {
      try { fs.cpSync(src, dst, { recursive: true }); moved.push(rel); } catch (_) { /* leave it */ }
      continue;
    }
    try {
      fs.renameSync(src, dst); // same drive: instant
      moved.push(rel);
    } catch (_) {
      try {
        fs.cpSync(src, dst, { recursive: true });
        fs.rmSync(src, { recursive: true, force: true });
        moved.push(rel);
      } catch (_) { /* leave it: better a copy in the profile than a broken start */ }
    }
  }
  return moved;
}

module.exports = { pickDataDir, migrate, DATA_DIR_NAME };
