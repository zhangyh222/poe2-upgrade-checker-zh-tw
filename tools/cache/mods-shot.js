const fs = require('fs');
(async () => {
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
  const run = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  const lines = [
    { text: '+56 to maximum Mana', key: '# to maximum Mana', value: 56, tag: 'explicit', affix: { kind: 'prefix', tier: 2, group: 'Mana' } },
    { text: '+89 to maximum Life', key: '# to maximum Life', value: 89, tag: 'explicit', affix: { kind: 'prefix', tier: 1, group: 'Life' } },
    { text: '+39% to Lightning Resistance', key: '#% to Lightning Resistance', value: 39, tag: 'explicit', affix: { kind: 'suffix', tier: 3, group: 'Resistance' } },
    { text: '+31 to Intelligence', key: '# to Intelligence', value: 31, tag: 'explicit', affix: { kind: 'suffix', tier: 2, group: 'Attribute' } },
    { text: '20% increased Elemental Damage with Attacks', key: null, value: null, tag: 'enchant' },
  ];
  await run(`document.body.style.background='#14110f';document.body.style.margin='0';
    document.querySelector('#charBody').innerHTML='<div style="padding:14px;width:520px;font-family:Segoe UI,Microsoft YaHei,sans-serif">'
      + '<div class="name rare" style="font-size:16px;margin-bottom:6px">毀滅之環 <span style="font-size:12px;color:#858585">黃金戒指</span></div>'
      + window.itemModsHtml({lines:${JSON.stringify(lines)}}) + '</div>';`);
  await run("document.querySelector('[data-tab=char]').click()");
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('tools/cache/mods-shot.png', Buffer.from(shot.data, 'base64'));
  console.log('saved', fs.statSync('tools/cache/mods-shot.png').size);
  ws.close();
})().catch((e) => { console.error(e); process.exit(1); });
