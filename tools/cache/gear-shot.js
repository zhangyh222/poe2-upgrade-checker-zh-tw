const fs = require('fs');
const { connect, sleep } = require('./cdp');
(async () => {
  const { evalJs, close } = await connect('settings.html');
  await evalJs("document.querySelector('#tipshot') && document.querySelector('#tipshot').remove()");
  await evalJs("document.querySelector('[data-tab=gear]').click()"); await sleep(1200);
  const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  const page = list.find((x) => x.url.includes('settings.html'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => { ws.onopen = res; });
  let id = 0;
  const send = (method, params) => new Promise((res) => {
    const n = ++id;
    const onMsg = (e) => { const d = JSON.parse(e.data); if (d.id !== n) return; ws.removeEventListener('message', onMsg); res(d.result); };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send('Page.enable');
  await send('Page.bringToFront').catch(() => {});
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('tools/cache/gear-shot.png', Buffer.from(shot.data, 'base64'));
  console.log('saved', fs.statSync('tools/cache/gear-shot.png').size);
  console.log((await evalJs("document.querySelector('#slots tr:nth-child(2)').innerText")).slice(0, 400));
  close(); ws.close();
})().catch((e) => { console.error(e); process.exit(1); });
