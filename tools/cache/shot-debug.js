const fs = require('fs');
(async () => {
  const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  const page = list.find((x) => x.url.includes('settings.html'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => { ws.onopen = res; });
  let id = 0;
  const send = (method, params) => new Promise((res, rej) => {
    const n = ++id;
    const timer = setTimeout(() => rej(new Error('timeout ' + method)), 8000);
    const onMsg = (e) => { const d = JSON.parse(e.data); if (d.id !== n) return; ws.removeEventListener('message', onMsg); clearTimeout(timer); res(d.result); };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  console.log('enable', !!(await send('Page.enable')));
  console.log('eval', (await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }))?.result?.value);
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: false });
    fs.writeFileSync('tools/cache/dbg.png', Buffer.from(shot.data, 'base64'));
    console.log('shot ok', fs.statSync('tools/cache/dbg.png').size);
  } catch (e) { console.log('shot failed', e.message); }
  ws.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
