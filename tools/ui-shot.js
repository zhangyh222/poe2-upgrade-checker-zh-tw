#!/usr/bin/env node
'use strict';
// Screenshots one of the app's stat panels, so a change to the numbers or the wording can be
// looked at without clicking through the app. Start the app with remote debugging first:
//
//   dist\win-unpacked\"PoE2 Upgrade Checker.exe" --remote-debugging-port=9222
//   node tools/ui-shot.js CritChance
//   node tools/ui-shot.js CombinedDPS screenshots\dps.png
//   node tools/ui-shot.js --item item.txt screenshots\item.png   (Settings -> Check an item)
//
// It opens Settings -> Character, clicks the row that carries data-src="<stat>" (the same click
// that opens the floating panel) and saves the panel to screenshots\<stat>.png.

const fs = require('fs');
const path = require('path');
const { connect, sleep } = require('./cache/cdp');

const itemMode = process.argv[2] === '--item';
const stat = itemMode ? null : process.argv[2];
const itemFile = itemMode ? process.argv[3] : null;
const out = (itemMode ? process.argv[4] : process.argv[3]) || path.join('screenshots', `${itemMode ? 'item' : stat}.png`);
if (!itemMode && !stat) { console.error('usage: node tools/ui-shot.js <stat> [out.png] | --item <item.txt> [out.png]'); process.exit(1); }
if (itemMode && !itemFile) { console.error('usage: node tools/ui-shot.js --item <item.txt> [out.png]'); process.exit(1); }

async function capture(match, file) {
  const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  const page = list.find((x) => x.url.includes(match));
  if (!page) throw new Error(`no window matching "${match}" - is the panel open?`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const send = (method, params) => new Promise((res) => {
    const n = ++id;
    const onMsg = (e) => { const d = JSON.parse(e.data); if (d.id !== n) return; ws.removeEventListener('message', onMsg); res(d.result); };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send('Page.enable');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  ws.close();
  return fs.statSync(file).size;
}

(async () => {
  const { evalJs, close } = await connect('settings.html');
  if (itemMode) {
    const text = fs.readFileSync(itemFile, 'utf8');
    await evalJs("document.querySelector('[data-tab=test]').click()");
    await sleep(600);
    await evalJs(`(()=>{const t=document.querySelector('#testText');t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#testBtn').click();return 'ok'})()`);
    await sleep(3500); // a Path of Building verdict takes a moment
    console.log(`saved ${out} (${await capture('settings.html', out)} bytes)`);
    close();
    return;
  }
  await evalJs("document.querySelector('[data-tab=char]').click()");
  await sleep(5000); // the character page waits for Path of Building
  const clicked = await evalJs(`(()=>{const e=[...document.querySelectorAll('#charBody .has-src')].find(x=>x.dataset.src===${JSON.stringify(stat)});if(!e)return 'missing';e.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 'ok'})()`);
  if (clicked !== 'ok') throw new Error(`no row with data-src="${stat}" on the character page`);
  await sleep(3500);
  console.log(`saved ${out} (${await capture('panel.html', out)} bytes)`);
  close();
})().catch((e) => { console.error('FAILED ' + (e && e.message)); process.exit(1); });
