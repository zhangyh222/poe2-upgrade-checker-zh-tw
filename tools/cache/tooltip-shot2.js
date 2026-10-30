'use strict';
// dev: put one equipped item's tooltip on screen and capture just that window
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
  const c = await connect('settings.html');
  const slot = process.argv[2] || 'Helmet';
  const file = process.argv[3] || 'tools/cache/affix-split.png';
  const text = await c.evalJs(`(() => {
    const b = document.getElementById('tipbox'); if (b) b.remove();
    return window.api.getState().then((st) => {
      const box = document.createElement('div');
      box.id = 'tipbox';
      box.style.cssText = 'position:fixed;left:40px;top:30px;z-index:99999;background:#0d0b09;padding:10px;border:1px solid #3a332c;border-radius:6px';
      box.innerHTML = window.itemTooltipHtml(st.equipped['${slot}']);
      document.body.appendChild(box);
      return box.innerText.slice(0, 120);
    });
  })()`);
  console.log(typeof text === 'string' ? text : JSON.stringify(text).slice(0, 200));
  await sleep(600);
  await shot('settings.html', file);
  c.close();
  console.log('shot ok');
})().catch((e) => { console.error(e); process.exit(1); });
