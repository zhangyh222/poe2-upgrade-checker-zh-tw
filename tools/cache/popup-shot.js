const fs = require('fs');
const { connect, sleep } = require('./cdp');
(async () => {
  const s = await connect('settings.html');
  const text = [
    'Item Class: Rings', 'Rarity: Rare', 'Doom Loop', 'Gold Ring', '--------', 'Item Level: 80', '--------',
    '{ Prefix Modifier "Sapphire" (Tier: 2) — Mana }', '+56 to maximum Mana',
    '{ Prefix Modifier "Hale" (Tier: 1) — Life }', '+89 to maximum Life',
    '{ Suffix Modifier "of the Squall" (Tier: 3) — Resistance }', '+39% to Lightning Resistance',
    '{ Suffix Modifier "of the Fox" (Tier: 2) — Attribute }', '+31 to Intelligence',
  ].join('\n');
  await s.evalJs(`window.api.evaluateText(${JSON.stringify(text)})`);
  await sleep(3000);
  s.close();

  const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  const page = list.find((x) => x.url.includes('popup.html'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => { ws.onopen = res; });
  let id = 0;
  const send = (method, params) => new Promise((res) => {
    const n = ++id;
    const onMsg = (e) => { const d = JSON.parse(e.data); if (d.id !== n) return; ws.removeEventListener('message', onMsg); res(d.result); };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  // open the "More" panel so the mod groups are in the shot
  const evalJs = (expression) => send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value);
  await evalJs("document.querySelector('#moreBtn') && document.querySelector('#moreBtn').click()");
  await sleep(600);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync('tools/cache/popup-shot.png', Buffer.from(shot.data, 'base64'));
  console.log('saved', fs.statSync('tools/cache/popup-shot.png').size, 'bytes');
  const text2 = await evalJs('document.body.innerText');
  console.log(text2.slice(0, 900));
  ws.close();
})().catch((e) => { console.error(e); process.exit(1); });
