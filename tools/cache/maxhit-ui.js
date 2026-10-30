'use strict';
const { connect, sleep } = require('./cdp');
(async () => {
  const { evalJs, close } = await connect('settings.html');
  await evalJs("document.querySelector('.tabs button[data-tab=char]').click()");
  await sleep(4000);
  console.log(await evalJs(`(()=>{
    const rows=[...document.querySelectorAll('#charBody tr.has-src')].map(x=>x.dataset.src);
    return JSON.stringify(rows.filter(x=>/MaximumHitTaken/.test(x)));
  })()`));
  // hover the fire row
  console.log('hover', await evalJs(`(()=>{const e=[...document.querySelectorAll('#charBody .has-src')].find(x=>x.dataset.src==='FireMaximumHitTaken');if(!e)return 'missing';e.dispatchEvent(new MouseEvent('mouseenter'));return 'ok'})()`));
  await sleep(1800);
  console.log(await evalJs(`(()=>{const p=document.querySelector('.src-pop:not(.hidden)');return p?p.innerText.slice(0,1500):'no bubble'})()`));
  close();
})().catch((e) => { console.error(e); process.exit(1); });
