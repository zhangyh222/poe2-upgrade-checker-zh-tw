const { connect, sleep } = require('./cdp');
(async () => {
  const { evalJs, close } = await connect('settings.html');
  await evalJs("document.querySelector('[data-tab=gear]').click()"); await sleep(700);
  console.log('== jewel rows');
  const rows = await evalJs("[...document.querySelectorAll('#slots tr')].filter(r=>/珠寶|珠宝/.test(r.innerText)).map(r=>r.innerText.replace(/\\n/g,' | ')).join('\\n')");
  console.log(rows);

  console.log('== advanced-copy item');
  const text = [
    'Item Class: Rings', 'Rarity: Rare', 'Doom Loop', 'Gold Ring', '--------', 'Item Level: 80', '--------',
    '{ Prefix Modifier "Sapphire" (Tier: 2) — Mana }', '+56 to maximum Mana',
    '{ Prefix Modifier "Hale" (Tier: 1) — Life }', '+89 to maximum Life',
    '{ Suffix Modifier "of the Squall" (Tier: 3) — Resistance }', '+39% to Lightning Resistance',
    '{ Suffix Modifier "of the Fox" (Tier: 2) — Attribute }', '+31 to Intelligence',
  ].join('\n');
  await evalJs(`(function(){const el=document.querySelector('#testText');el.value=${JSON.stringify(text)};document.querySelector('[data-tab=test]').click();document.querySelector('#testBtn').click();return 'clicked'})()`);
  await sleep(2500);
  const html = await evalJs("document.querySelector('#testResult .modgroups') ? document.querySelector('#testResult .modgroups').innerText : (document.querySelector('#testResult').innerText.slice(0,600))");
  console.log(html);
  close();
})().catch((e) => { console.error(e); process.exit(1); });
