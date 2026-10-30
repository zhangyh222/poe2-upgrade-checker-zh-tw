'use strict';

// Tests for where the app keeps its data (src/datadir.js): a "-data" folder next to the install
// folder for installed builds, beside the .exe for the portable one, and the profile folder as a
// fallback when that place can't be written (all-users install in Program Files).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { pickDataDir, migrate, DATA_DIR_NAME } = require('../src/datadir');

function tmp(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `poe2uc-${name}-`));
  return dir;
}

test('local runs and tests keep the profile folder', () => {
  assert.equal(pickDataDir({ packaged: false, execPath: 'C:\\dev\\app.exe' }), null);
});

test('installed build: "<install folder>-data" next to the install folder, never inside it', () => {
  const root = tmp('installed');
  const install = path.join(root, 'Programs', 'poe2-upgrade-checker');
  fs.mkdirSync(install, { recursive: true });
  const dir = pickDataDir({ packaged: true, execPath: path.join(install, 'PoE2 Upgrade Checker.exe'), platform: 'win32' });
  assert.equal(dir, path.join(root, 'Programs', 'poe2-upgrade-checker-data'));
  assert.ok(fs.existsSync(dir));
  // the install folder stays untouched: it is deleted on every update
  assert.equal(fs.readdirSync(install).length, 0);
});

test('portable .exe: the data folder goes beside it', () => {
  const usb = tmp('portable');
  const dir = pickDataDir({ packaged: true, portableDir: usb, execPath: path.join(usb, 'PoE2-Upgrade-Checker-Portable.exe'), platform: 'win32' });
  assert.equal(dir, path.join(usb, DATA_DIR_NAME));
});

test('AppImage: uses the real file, not the read-only mount', () => {
  const home = tmp('appimage');
  const dir = pickDataDir({
    packaged: true, platform: 'linux',
    execPath: '/tmp/.mount_PoE2Up/resources/app.asar', appImage: path.join(home, 'PoE2-Upgrade-Checker.AppImage'),
  });
  assert.equal(dir, path.join(home, DATA_DIR_NAME));
});

test('an explicit POE2UC_DATA_DIR wins (for testing next to a build)', () => {
  const custom = path.join(tmp('env'), 'somewhere');
  assert.equal(pickDataDir({ packaged: false, envDir: custom }), custom);
});

test('a read-only place falls back to the profile folder instead of failing to start', () => {
  const root = tmp('readonly');
  const install = path.join(root, 'poe2-upgrade-checker');
  fs.mkdirSync(install, { recursive: true });
  fs.writeFileSync(path.join(root, 'poe2-upgrade-checker-data'), 'not a folder'); // blocks mkdir
  assert.equal(pickDataDir({ packaged: true, execPath: path.join(install, 'PoE2 Upgrade Checker.exe') }), null);
});

test('updating moves gear, build, sign-in and settings over from the profile folder', () => {
  const profile = tmp('profile');
  const data = tmp('data');
  fs.writeFileSync(path.join(profile, 'poe2-upgrade-checker.json'), '{"settings":{}}');
  fs.mkdirSync(path.join(profile, 'pob'));
  fs.writeFileSync(path.join(profile, 'pob', 'main.xml'), '<PathOfBuilding2/>');
  fs.mkdirSync(path.join(profile, 'Partitions', 'poe', 'Network'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Partitions', 'poe', 'Network', 'Cookies'), 'c');
  fs.writeFileSync(path.join(profile, 'trade-cache.json'), '{}');
  fs.mkdirSync(path.join(profile, 'Cache')); // Electron cache: not worth moving

  const moved = migrate(profile, data);

  assert.deepEqual(moved.sort(), ['Partitions', 'pob', 'poe2-upgrade-checker.json', 'trade-cache.json']);
  assert.equal(fs.readFileSync(path.join(data, 'pob', 'main.xml'), 'utf8'), '<PathOfBuilding2/>');
  assert.ok(fs.existsSync(path.join(data, 'Partitions', 'poe', 'Network', 'Cookies')));
  assert.ok(!fs.existsSync(path.join(profile, 'poe2-upgrade-checker.json')));
  assert.ok(fs.existsSync(path.join(profile, 'Cache')), 'caches stay behind');
});

test('never overwrites data the new folder already has', () => {
  const profile = tmp('profile2');
  const data = tmp('data2');
  fs.writeFileSync(path.join(profile, 'poe2-upgrade-checker.json'), '{"old":true}');
  fs.writeFileSync(path.join(data, 'poe2-upgrade-checker.json'), '{"new":true}');
  assert.deepEqual(migrate(profile, data), []);
  assert.equal(fs.readFileSync(path.join(data, 'poe2-upgrade-checker.json'), 'utf8'), '{"new":true}');
});

test('a copy leaves the profile folder alone (portable run beside an installed copy)', () => {
  const profile = tmp('profile4');
  const data = tmp('data4');
  fs.writeFileSync(path.join(profile, 'poe2-upgrade-checker.json'), '{"settings":{}}');
  const copied = migrate(profile, data, { copy: true });
  assert.deepEqual(copied, ['poe2-upgrade-checker.json']);
  assert.ok(fs.existsSync(path.join(profile, 'poe2-upgrade-checker.json')), 'still there for the installed copy');
  assert.ok(fs.existsSync(path.join(data, 'poe2-upgrade-checker.json')));
});

test('nothing saved yet: no move', () => {
  const profile = tmp('profile3');
  const data = tmp('data3');
  fs.mkdirSync(path.join(profile, 'Cache'));
  assert.deepEqual(migrate(profile, data), []);
  assert.deepEqual(fs.readdirSync(data), []);
});
