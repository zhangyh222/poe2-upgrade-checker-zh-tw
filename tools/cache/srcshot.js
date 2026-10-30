const fs = require('fs');
const { connect, sleep } = require('./cdp');
(async () => {
  const { evalJs, close } = await connect('settings.html');
  await evalJs("document.querySelector('[data-tab=char]').click()");
  await sleep(7000);
  const hover = async (stat) => {
    await evalJs(`(()=>{const e=[...document.querySelectorAll('#charBody .has-src')].find(x=>x.dataset.src==='${stat}');if(!e)return 'missing';e.dispatchEvent(new MouseEvent('mouseenter'));return 'ok'})()`);
    await sleep(1600);
    return await evalJs("(()=>{const p=document.querySelector('.src-pop');return p&&!p.classList.contains('hidden')?p.innerText.slice(0,700):'hidden'})()");
  };
  console.log('== Armour\n' + await hover('Armour'));
  console.log('== TotalDPS\n' + await hover('CombinedDPS'));
  await evalJs("document.querySelector('.src-pop').classList.add('hidden')");
  // pin the life row for a screenshot
  await evalJs("(()=>{const e=[...document.querySelectorAll('#charBody tr.has-src')].find(x=>x.dataset.src==='Life');e.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 'ok'})()");
  await sleep(1600);
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
  fs.writeFileSync('tools/cache/srcshot.png', Buffer.from(shot.data, 'base64'));
  console.log('shot', fs.statSync('tools/cache/srcshot.png').size);
  ws.close();
  close();
})().catch((e) => { console.error(e); process.exit(1); });
