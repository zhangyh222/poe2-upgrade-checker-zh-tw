const fs = require('fs');
(async () => {
  const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  const page = list.find((x) => x.url.includes('settings.html'));
  if (!page) throw new Error('settings window not found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => { ws.onopen = res; });
  let id = 0;
  const send = (method, params) => new Promise((res) => {
    const n = ++id;
    const onMsg = (e) => { const d = JSON.parse(e.data); if (d.id !== n) return; ws.removeEventListener('message', onMsg); res(d.result); };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const run = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

  const item = {
    name: 'Doom Loop', baseType: 'Gold Ring', itemClass: 'Rings', rarity: 'Rare', itemLevel: 82,
    lines: [
      { text: 'Requires: Level 75, 59 Str, 59 Int', tag: 'req' },
      { text: 'Item Level: 82', tag: 'prop' },
      { text: '20% increased Elemental Damage with Attacks', tag: 'enchant' },
      { text: '+56 to maximum Mana', tag: 'explicit', affix: { kind: 'prefix', tier: 2, group: 'Mana' } },
      { text: '+89 to maximum Life', tag: 'explicit', affix: { kind: 'prefix', tier: 1, group: 'Life' } },
      { text: '+39% to Lightning Resistance', tag: 'explicit', affix: { kind: 'suffix', tier: 3, group: 'Resistance' } },
      { text: '+31 to Intelligence', tag: 'explicit', affix: { kind: 'suffix', tier: 2, group: 'Attribute' } },
      { text: 'Corrupted', tag: 'flag' },
    ],
    affixes: { known: true, openPrefix: 0, openSuffix: 0 },
  };
  await send('Page.enable');
  await run('window.focus && window.focus()');
  await send('Page.bringToFront').catch(() => {});
  await run(`document.querySelector('[data-tab=char]').click()`);
  await run(`(function(){var o=document.getElementById('tipshot');if(!o){o=document.createElement('div');o.id='tipshot';document.body.appendChild(o);}o.style.cssText='position:fixed;left:24px;top:24px;z-index:99999;padding:16px;background:#14110f;border:1px solid #333';o.innerHTML=window.itemTooltipHtml(${JSON.stringify(item)});return o.innerText})()`);
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync('tools/cache/tooltip-shot.png', Buffer.from(shot.data, 'base64'));
  console.log('saved', fs.statSync('tools/cache/tooltip-shot.png').size);
  console.log(await run("document.getElementById('tipshot').innerText"));
  ws.close();
})().catch((e) => { console.error(e); process.exit(1); });
