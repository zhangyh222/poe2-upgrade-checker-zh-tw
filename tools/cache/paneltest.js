const { connect, sleep } = require('./cdp');
async function sendTo(urlPart, method, params) {
  const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  const p = list.find((x) => x.url.includes(urlPart));
  if (!p) throw new Error('no target ' + urlPart);
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((res) => { ws.onopen = res; });
  const res = await new Promise((resolve) => {
    ws.addEventListener('message', function h(e) {
      const d = JSON.parse(e.data);
      if (d.id !== 1) return;
      ws.removeEventListener('message', h);
      resolve(d.result || d.error);
    });
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  ws.close();
  return res;
}
(async () => {
  const { evalJs, close } = await connect('settings.html');
  await evalJs("document.querySelector('[data-tab=char]').click()");
  await sleep(7000);
  const click = (st) => evalJs(`(()=>{const e=[...document.querySelectorAll('#charBody .has-src')].find(x=>x.dataset.src==='${st}');if(!e)return 'missing';e.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 'ok'})()`);
  console.log('open life', await click('Life')); await sleep(2000);
  console.log('open es', await click('EnergyShield')); await sleep(2000);
  let list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  console.log('panels:', list.filter((x) => x.url.includes('panel.html')).length);
  // minimise the main window, then check the panel window is still normal (not minimised)
  const main = await sendTo('settings.html', 'Browser.getWindowForTarget', {});
  console.log('main window', JSON.stringify(main));
  if (main && main.windowId) {
    console.log('minimise main', JSON.stringify(await sendTo('settings.html', 'Browser.setWindowBounds', { windowId: main.windowId, bounds: { windowState: 'minimized' } })));
    await sleep(1200);
  }
  const panel = await sendTo('panel.html?stat=Life', 'Browser.getWindowForTarget', {});
  console.log('panel window', JSON.stringify(panel));
  const vis = await sendTo('panel.html?stat=Life', 'Runtime.evaluate', { expression: "document.visibilityState", returnByValue: true });
  console.log('panel visibility', JSON.stringify(vis));
  if (main && main.windowId) await sendTo('settings.html', 'Browser.setWindowBounds', { windowId: main.windowId, bounds: { windowState: 'normal' } });
  await sleep(600);
  // clicking the same row again should close only that panel
  await click('Life'); await sleep(800);
  list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  console.log('after toggle old:', list.filter((x) => x.url.includes('panel.html')).map((x) => new URL(x.url).searchParams.get('stat')).join(','));
  close();
})().catch((e) => { console.error(e); process.exit(1); });
