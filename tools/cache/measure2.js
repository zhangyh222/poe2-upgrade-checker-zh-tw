const fs=require('fs');
const data=JSON.parse(fs.readFileSync('src/data/zh-tw.json','utf8'));
const modKey=(s)=>String(s).replace(/\(-?[\d.]+--?[\d.]+\)/g,'#').replace(/\{[0-9]+(?::[^}]*)?\}/g,'#').replace(/\btotal\s+/gi,'').replace(/[−–]/g,'-').replace(/[-+]?\d+(?:\.\d+)?/g,'#').replace(/\+#/g,'#').replace(/\s+/g,' ').trim();
const fill=(tpl,nums)=>tpl.replace(/\{(\d+)(?::([^}]*))?\}/g,(m,i,fmt)=>{const v=nums[Number(i)];if(v===undefined)return m;const num=Number(v);if(/\+d/.test(fmt||''))return (num>=0?'+':'')+Math.round(num);return /%/.test(fmt||'')?String(v)+'%':String(v);});
function tr(s){if(data.names[s])return data.names[s];const nums=(String(s).match(/-?\d+(?:\.\d+)?/g)||[]);const k=modKey(s);const tpl=data.mods[k];if(tpl){const need=Math.max(...[...tpl.matchAll(/\{(\d+)/g)].map(m=>Number(m[1])+1),0);if(need<=nums.length)return fill(tpl,nums)}return null}
const lua=fs.readFileSync('vendor/pob/src/Data/TradeSiteStats.lua','utf8');
const texts=[...lua.matchAll(/text\s*=\s*"((?:[^"\\]|\\.)*)"/g)].map(m=>m[1].replace(/\\"/g,'"'));
const uniq=[...new Set(texts)];
let hit=0;const miss=[];
for(const s of uniq){if(tr(s))hit++;else if(miss.length<20)miss.push(s)}
console.log('trade stat texts',uniq.length,'translated',hit,(100*hit/uniq.length).toFixed(1)+'%');
console.log(miss.join('\n'));
const samples=['Shattering Palm','Hollow Focus Technique','Morior Invictus','Martial Artist','Monk','Chaos Inoculation','Brimmed Helm','+89 to maximum Life','+32% to Fire Resistance','12% increased Elemental Damage with Attacks','Adds 5 to 10 Physical Damage'];
for(const s of samples)console.log(s,'=>',tr(s));
