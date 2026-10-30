'use strict';
const fs = require('fs');
const { connect, sleep } = require('./cdp');

async function shot(urlPart, file) {
  const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  const p = list.find((x) => x.url.includes(urlPart));
  if (!p) throw new Error('no target ' + urlPart);
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((res) => { ws.onopen = res; });
  const r = await new Promise((resolve) => {
    ws.addEventListener('message', function h(e) {
      const d = JSON.parse(e.data);
      if (d.id !== 1) return;
      ws.removeEventListener('message', h);
      resolve(d.result || d.error);
    });
    ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
  });
  ws.close();
  if (!r || !r.data) throw new Error('screenshot failed');
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
}

(async () => {
  const list0 = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  const main = list0.find((x) => x.url.includes('settings.html'));
  const wsMain = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((res) => { wsMain.onopen = res; });
  wsMain.send(JSON.stringify({ id: 1, method: 'Page.reload' }));
  await sleep(3500);
  wsMain.close();

  const { evalJs, close } = await connect('settings.html');
  await evalJs("document.querySelector('.tabs button[data-tab=char]').click()");
  await sleep(5000);
  console.log('click', await evalJs(`(()=>{const e=[...document.querySelectorAll('#charBody .has-src')].find(x=>x.dataset.src==='FireMaximumHitTaken');if(!e)return 'missing';e.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 'ok'})()`));
  await sleep(2500);
  const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  console.log('panels:', list.filter((x) => x.url.includes('panel.html')).map((x) => x.url.split('?')[1]));
  await shot('panel.html?stat=FireMaximumHitTaken', 'tools/cache/maxhit-panel.png');
  await shot('settings.html', 'tools/cache/maxhit-main.png');
  // open Life from inside the max hit panel
  const p2 = await connect('panel.html?stat=FireMaximumHitTaken');
  console.log('inner', await p2.evalJs(`(()=>{const e=document.querySelector('#root .src-in[data-src=Life]');if(!e)return 'missing';e.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 'ok'})()`));
  await sleep(2500);
  const list2 = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  console.log('panels now:', list2.filter((x) => x.url.includes('panel.html')).map((x) => x.url.split('?')[1]));
  await shot('panel.html?stat=Life', 'tools/cache/maxhit-life.png');
  p2.close();
  close();
})().catch((e) => { console.error(e); process.exit(1); });
