const fs=require('fs');
function parsePO(file){
  const txt=fs.readFileSync(file,'utf8');
  const out=[];let id=null,str=null,cur=null;
  const flush=()=>{if(id!==null&&str!==null){out.push([id,str]);}id=null;str=null;cur=null;};
  for(const line of txt.split('\n')){
    if(line.startsWith('msgid "')){if(id!==null&&str!==null)flush();id=line.slice(7,-1);cur='id';}
    else if(line.startsWith('msgstr "')){str=line.slice(8,-1);cur='str';}
    else if(line.startsWith('"')&&cur){const v=line.slice(1,-1);if(cur==='id')id+=v;else str+=v;}
    else if(line.trim()===''){if(id!==null&&str!==null)flush();}
  }
  if(id!==null&&str!==null)flush();
  return out;
}
const norm=(s)=>s.replace(/\{[0-9]+(?::[^}]*)?\}/g,'#').replace(/\(-?[\d.]+--?[\d.]+\)/g,'#').replace(/\+?#/g,'#');
for(const f of ['skills','passives','items','stats']){
  const pairs=parsePO('tools/cache/po/'+f+'.po');
  const filled=pairs.filter(([i,s])=>s.trim());
  console.log(f,'entries',pairs.length,'translated',filled.length,'empty id?',pairs.filter(([i])=>!i).length);
  if(f==='stats'){
    const idx=new Map();for(const [i,s] of filled){const k=norm(i);if(!idx.has(k))idx.set(k,s);}
    console.log(' stats patterns',idx.size);
    const trade=JSON.parse(fs.readFileSync('tools/cache/trade-stats-en.json','utf8'));
    let total=0,hit=0;const miss=[];
    for(const g of trade.result)for(const e of g.entries){total++;const k=norm(e.text);if(idx.has(k))hit++;else if(miss.length<25)miss.push(e.text);}
    console.log(' trade stats',total,'matched',hit,(100*hit/total).toFixed(1)+'%');
    console.log(' sample misses:');for(const m of miss)console.log('   ',m);
  }
}
