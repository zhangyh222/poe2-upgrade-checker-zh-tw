'use strict';
const fs = require('fs');
const { connect, sleep } = require('./cdp');

async function shot(urlPart, file) {
  const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  const p = list.find((x) => x.url.includes(urlPart));
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
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
}

(async () => {
  const { evalJs, close } = await connect('settings.html');
  console.log(await evalJs(`(()=>{const h=[...document.querySelectorAll('#charBody h3')].find(x=>x.textContent.includes('最大单次承受伤害'));if(!h)return 'missing';h.scrollIntoView({block:'center'});return h.closest('.card-p').innerText.slice(0,300)})()`));
  await sleep(600);
  // hover the Fire row so the bubble shows the formula
  console.log('hover', await evalJs(`(()=>{const e=[...document.querySelectorAll('#charBody .has-src')].find(x=>x.dataset.src==='FireMaximumHitTaken');if(!e)return 'missing';e.dispatchEvent(new MouseEvent('mouseenter'));return 'ok'})()`));
  await sleep(1800);
  await shot('settings.html', 'tools/cache/maxhit-hover.png');
  close();
})().catch((e) => { console.error(e); process.exit(1); });
