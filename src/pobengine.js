'use strict';

// Runs Path of Building's calculations in a child process (pob/server.lua inside PoB's own
// LuaJIT, hosted by pobhost.exe on Windows; on Linux the bundled LuaJIT runs it directly) and asks it what an item would change on your build.
//
//   const eng = createEngine({ log, appPath, resourcesPath, packaged })
//   await eng.loadBuild(xml)            -> { className, ascendancy, level, mainSkill, stats }
//   await eng.evalItems([{ slot, text }]) -> [{ ok, slot, before, after } | { ok:false, error }]
//
// The process starts on first use, is restarted if it dies, and is stopped after a while
// without requests to give the memory back.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { createOperationQueue } = require('./core/operation-queue');
const { StaleCalculationError } = require('./core/calculation-context');

function createEngine({ log = () => {}, appPath, resourcesPath, packaged }) {
  const base = packaged ? path.join(resourcesPath, 'pob') : path.join(appPath, 'vendor', 'pob');
  const serverLua = packaged ? path.join(resourcesPath, 'pob', 'server.lua') : path.join(appPath, 'pob', 'server.lua');
  const srcDir = path.join(base, 'src');
  const runtimeDir = path.join(base, 'runtime');

  let proc = null; let ready = null; let buf = ''; let nextId = 1;
  const waiting = new Map();
  const operations = createOperationQueue();
  let buildXml = null; let buildInfo = null; let loading = null;
  let readyInfo = null; // { version } from the engine's ready handshake
  // the pinned source revision (vendor/pob/.pob-version): PoB's own version string
  // still says 0.23.x on the dev branch, so the fingerprint needs the commit too
  let pinnedRef = null;
  try { pinnedRef = fs.readFileSync(path.join(base, '.pob-version'), 'utf8').trim() || null; } catch (_) { /* packaged build: not shipped */ }
  let idleTimer = null;
  let lastError = null;

  function hostCommand() {
    // paths relative to PoB's src folder (the working directory): Lua opens files with ANSI paths,
    // which breaks on Windows user names outside the system code page
    const script = path.relative(srcDir, serverLua);
    if (process.env.POB_LUAJIT) return { cmd: process.env.POB_LUAJIT, args: [script] }; // dev/test on Linux
    if (process.platform === 'win32') return { cmd: path.join(runtimeDir, 'pobhost.exe'), args: [script] };
    if (process.platform === 'linux') return { cmd: path.join(runtimeDir, 'linux', 'luajit'), args: [script], moduleDir: path.join(runtimeDir, 'linux') };
    return null;
  }

  function available() {
    const h = hostCommand();
    return !!(h && fs.existsSync(h.cmd) && fs.existsSync(path.join(srcDir, 'HeadlessWrapper.lua')) && fs.existsSync(serverLua));
  }

  function failAll(err) {
    for (const [, w] of waiting) { clearTimeout(w.timer); w.reject(err); }
    waiting.clear();
  }

  let failedAt = 0;
  function start() {
    if (ready) return ready;
    // don't keep trying (and waiting) when it just failed to start
    if (failedAt && Date.now() - failedAt < 10 * 60000) return Promise.reject(new Error('Path of Building failed to start: ' + (lastError || 'unknown error')));
    const h = hostCommand();
    if (!available()) return Promise.reject(new Error('The Path of Building engine is not installed with this copy of the app.'));
    ready = new Promise((resolve, reject) => {
      const t0 = Date.now();
      log('pob: starting the Path of Building engine');
      const me = spawn(h.cmd, h.args, {
        cwd: srcDir, windowsHide: true,
        env: (() => { const rt = path.relative(srcDir, runtimeDir); return { ...process.env, POBHOST_DIR: process.env.POBHOST_DIR || (h.moduleDir ? path.relative(srcDir, h.moduleDir) : rt), POB_LUA_PATH: [path.join(rt, 'lua', '?.lua'), path.join(rt, 'lua', '?', 'init.lua')].join(';') }; })(),
      });
      proc = me;
      proc.stdin.on('error', (err) => log('pob: ' + err.message));
      let started = false;
      const startTimer = setTimeout(() => { if (!started) { lastError = 'Path of Building took too long to start' + (errTail ? ': ' + errTail.trim().split('\n').slice(-4).join(' | ') : ''); log('pob: ' + lastError); reject(new Error(lastError)); stop(); } }, 90000);
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        if (proc !== me) return;
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
          if (!line.startsWith('@@')) continue;
          let msg; try { msg = JSON.parse(line.slice(2)); } catch (_) { continue; }
          if (msg.ready === false) { lastError = String(msg.error || 'unknown error').split('\n').filter(Boolean).slice(0, 4).join(' | '); log('pob: Path of Building could not start: ' + lastError); clearTimeout(startTimer); reject(new Error('Path of Building could not start: ' + lastError)); continue; }
          if (msg.ready) { started = true; readyInfo = { version: msg.version || null }; clearTimeout(startTimer); log(`pob: engine ready (PoB ${msg.version || '?'}, ${Date.now() - t0} ms)`); resolve(msg); continue; }
          const w = waiting.get(msg.id);
          if (w) { waiting.delete(msg.id); clearTimeout(w.timer); w.resolve(msg); }
        }
      });
      let errTail = '';
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (d) => { errTail = (errTail + d).slice(-2000); });
      proc.on('error', (err) => { lastError = err.message; log('pob: could not start: ' + err.message); if (!started) reject(err); });
      proc.on('exit', (code) => {
        log(`pob: engine stopped (${code})${code || !started ? ': ' + errTail.trim().split('\n').slice(-6).join(' | ') : ''}`);
        if (code && !started) { lastError = errTail.trim().split('\n').slice(-1)[0] || `exit ${code}`; reject(new Error('Path of Building failed to start: ' + lastError)); }
        if (proc !== me) return; // an engine we already stopped; a new one may be running
        failAll(new Error('The Path of Building engine stopped.'));
        proc = null; ready = null; buf = ''; buildInfo = null;
      });
    });
    ready.catch(() => { ready = null; failedAt = Date.now(); });
    return ready;
  }

  // forget the engine straight away, so a request right after starts a new one instead of
  // writing to one that's quitting
  function stop() {
    if (!proc) return;
    const p = proc;
    proc = null; ready = null; buf = ''; buildInfo = null;
    failAll(new Error('The Path of Building engine stopped.'));
    try { p.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n'); } catch (_) {}
    setTimeout(() => { try { p.kill(); } catch (_) {} }, 1500);
  }
  // a new build or a manual retry gets a fresh start instead of the 10-minute wait after a failure
  function resetFailure() { failedAt = 0; }

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { log('pob: idle, stopping the engine'); stop(); }, 20 * 60000);
    if (idleTimer.unref) idleTimer.unref();
  }

  async function request(obj, timeoutMs = 60000) {
    await start();
    touch();
    // after a restart or a gear/build change: (re)load first, until the loaded build is the current one
    if (obj.cmd !== 'load' && obj.cmd !== 'equip') {
      for (let i = 0; i < 3 && buildXml && (!buildInfo || infoGen !== gen); i++) await (loading || loadBuild(buildXml));
    }
    if (!proc) throw new Error('The Path of Building engine stopped.');
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Path of Building did not answer in time.')); }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ ...obj, id }) + '\n');
    });
  }

  // overrides: [{ slot, text }] items you copied in game, put into PoB's build after loading it
  let overrides = [];
  let gen = 0; let infoGen = -1; // which build/gear version is loaded
  function loadBuild(xml, over) {
    if (xml !== buildXml) failedAt = 0;
    if (xml !== buildXml || over) gen++;
    buildXml = xml;
    if (over) overrides = over;
    buildInfo = null;
    const myGen = gen;
    // An in-flight load must not borrow overrides from a newly selected build.
    const requestedOverrides = overrides.map((item) => ({ ...item }));
    const requestedWeaponSet = weaponSet;
    const p = request({ cmd: 'load', xml }, 120000).then(async (r) => {
      if (!r.ok) throw new Error(r.error || 'Path of Building could not load the build.');
      r.pobGear = r.gear;
      if (requestedOverrides.length) {
        const e = await request({ cmd: 'equip', items: requestedOverrides }, 60000);
        if (!e.ok) throw new Error(e.error || 'Path of Building could not apply the equipped items.');
        e.pobGear = r.gear; e.pobStats = r.stats; r = e;
      }
      if (myGen === gen) { buildInfo = r; infoGen = myGen; } // a newer build came in meanwhile: that one wins
      // the build's XML carries its own weapon set; the one the app is showing wins (0: follow the build)
      const target = requestedWeaponSet || (r.weaponSwap ? 2 : 1);
      if (myGen === gen && target !== (r.weaponSwap ? 2 : 1)) {
        const s = await request({ cmd: 'weaponset', set: target }, 60000);
        if (!s.ok) throw new Error(s.error || 'Path of Building could not restore the weapon set.');
        r = { ...r, ...s }; buildInfo = r;
      }
      return r;
    }).finally(() => { if (loading === p) loading = null; });
    loading = p;
    return p;
  }
  // remember a build without starting the engine yet (it loads on first use)
  function setBuild(xml, over, desiredWeaponSet) {
    if (xml !== buildXml) failedAt = 0;
    if (desiredWeaponSet !== undefined) weaponSet = desiredWeaponSet === 2 ? 2 : desiredWeaponSet === 1 ? 1 : 0;
    buildXml = xml; overrides = over || []; buildInfo = null; gen++;
  }
  function kill() { if (proc) { try { proc.kill(); } catch (_) {} } }

  async function evalItems(items) {
    if (!buildXml) throw new Error('No Path of Building build loaded.');
    const r = await request({ cmd: 'eval', items }, 30000 + items.length * 3000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not compare the items.');
    return r.results;
  }

  // PoB's own weighted trade search for a slot
  async function makeQuery(opts) {
    if (!buildXml) throw new Error('No Path of Building build loaded.');
    const r = await request({ cmd: 'query', ...opts }, 180000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not build a search.');
    return r;
  }

  // PoE2 builds carry two weapon sets; PoB works on one at a time, so remember the one the app is
  // showing (0 = whatever the build itself says) and put the engine back on it after every (re)load.
  let weaponSet = 0;
  function setWeaponSet(n) {
    weaponSet = n === 2 ? 2 : 1;
    return request({ cmd: 'weaponset', set: weaponSet }, 60000).then((r) => {
      if (r.ok && buildInfo) buildInfo = { ...buildInfo, ...r };
      return r;
    });
  }

  async function sheet() {
    if (!buildXml) return null;
    const r = await request({ cmd: 'sheet' }, 60000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not read the character.');
    return r;
  }
  async function ensureLoaded() {
    if (!buildXml) return null;
    for (let i = 0; i < 3 && (!buildInfo || infoGen !== gen); i++) await (loading || loadBuild(buildXml));
    if (!buildInfo || infoGen !== gen) throw new StaleCalculationError();
    return buildInfo;
  }
  // Only this unqueued facade is passed to transaction callbacks. Calling the
  // public queued API from inside a transaction would wait on its own lease.
  const setWeaponSetValue = (n) => { weaponSet = n === 2 ? 2 : n === 1 ? 1 : 0; };
  const session = Object.freeze({ ensureLoaded, evalItems, makeQuery, setWeaponSet, setWeaponSetValue, sheet, send: request });
  function transaction(action, options = {}) {
    const version = gen;
    return operations.run(async () => {
      if (version !== gen) throw new StaleCalculationError();
      const previousWeaponSet = weaponSet;
      try {
        const result = await action(session);
        if (options.signal && options.signal.aborted) {
          const error = new Error('Calculation cancelled.'); error.name = 'AbortError'; throw error;
        }
        if (version !== gen) throw new StaleCalculationError();
        return result;
      } catch (err) {
        // A timeout or partial mutation leaves the engine uncertain. Stop this
        // process; the next operation reloads XML + overrides + selected set.
        buildInfo = null; infoGen = -1;
        if (version === gen) weaponSet = previousWeaponSet;
        stop();
        throw err;
      }
    }, options);
  }

  const engineVersion = () => {
    const v = (readyInfo && readyInfo.version) || null;
    if (pinnedRef && v) return `${v}+${pinnedRef.slice(0, 7)}`;
    return pinnedRef || v;
  };

  // Try several build documents against one engine, one after another, and put
  // the active build back afterwards. Trials are not "transactions": each one
  // loads a different XML, so the queue is held for the whole run.
  //
  // The restore is eager on purpose. A PoB build whose XML carries no ItemSet
  // keeps the item set it already had, and `weaponset` flips that set on the
  // build rather than on a copy - so "reload it lazily and it will be fine" is
  // how a trial leaks its weapon set into the page the user is looking at.
  // A failed trial, or a failed restore, leaves the engine unknown: stop it.
  async function trialDocuments(docs, options = {}) {
    if (!Array.isArray(docs) || !docs.length) throw new Error('No build documents to try.');
    return operations.run(async () => {
      const before = {
        xml: buildXml, overrides: overrides.slice(), weaponSet,
        // the set the engine is actually calculating on right now (0 = follow the build)
        effectiveSet: weaponSet || (buildInfo && buildInfo.weaponSwap ? 2 : 1),
      };
      let result;
      try {
        const results = [];
        for (const doc of docs) {
          if (options.signal && options.signal.aborted) { const e = new Error('Calculation cancelled.'); e.name = 'AbortError'; throw e; }
          if (!doc || typeof doc.xml !== 'string') throw new Error('Every trial needs a build document.');
          setBuild(doc.xml, doc.overrides || []);
          await ensureLoaded();
          const wanted = doc.weaponSet === 2 ? 2 : 1;
          const switched = await setWeaponSet(wanted);
          if (!switched || !switched.ok) throw new Error(switched && switched.error ? switched.error : 'Path of Building could not switch the weapon set.');
          results.push({ ok: true, sheet: await sheet() });
        }
        result = results;
      } catch (err) {
        buildInfo = null; infoGen = -1; stop();
        throw err;
      }
      try {
        await restore(before);
      } catch (err) {
        buildInfo = null; infoGen = -1; stop();
        const failure = new Error('The build could not be restored after the trial: ' + (err && err.message ? err.message : String(err)));
        failure.code = 'TRIAL_RESTORE_FAILED';
        throw failure;
      }
      return result;
    }, options);
  }

  // put the document, its overrides and the weapon set back, and prove it
  async function restore(before) {
    if (!before.xml) { buildXml = null; overrides = []; weaponSet = 0; gen++; buildInfo = null; infoGen = -1; return; }
    setBuild(before.xml, before.overrides);
    weaponSet = before.weaponSet;
    await ensureLoaded();
    const nowSet = buildInfo && buildInfo.weaponSwap ? 2 : 1;
    if (nowSet !== before.effectiveSet) {
      const switched = await setWeaponSet(before.effectiveSet);
      if (!switched || !switched.ok) throw new Error(switched && switched.error ? switched.error : 'weapon set restore failed');
    }
    // keep "follow the build" behaviour for later loads, now that this one is back
    if (!before.weaponSet) weaponSet = 0;
  }

  return {
    available, start, stop, resetFailure, setBuild, transaction,
    version: engineVersion, trialDocuments,
    loadBuild: (xml, over) => { setBuild(xml, over === undefined ? overrides : over); return transaction((engine) => engine.ensureLoaded()); },
    evalItems: (items) => transaction((engine) => engine.evalItems(items)),
    makeQuery: (opts) => transaction((engine) => engine.makeQuery(opts)),
    setWeaponSet: (n) => transaction((engine) => engine.setWeaponSet(n)),
    setWeaponSetValue,
    weaponSet: () => weaponSet,
    kill, sheet: () => transaction((engine) => engine.sheet()),
    ensureLoaded: () => transaction((engine) => engine.ensureLoaded()),
    hasBuild: () => !!buildXml,
    info: () => buildInfo,
    lastError: () => lastError,
    send: (obj, timeoutMs) => transaction((engine) => engine.send(obj, timeoutMs)),
    paths: { base, srcDir, runtimeDir, serverLua },
  };
}

module.exports = { createEngine };
