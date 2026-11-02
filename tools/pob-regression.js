const assert = require('node:assert/strict');
const {createEngine}=require('../src/pobengine');
const e=createEngine({appPath:require('node:path').join(__dirname,'..'),packaged:false});
const xml='<PathOfBuilding2><Build level="90" className="Sorceress" ascendClassName="None" mainSocketGroup="1"/></PathOfBuilding2>';
const shield='Item Class: Shields\nRarity: Rare\nAudit Guard\nSplintered Tower Shield\n--------\nItem Level: 80\n--------\n+30% to Cold Resistance';
const glove='Item Class: Gloves\nRarity: Rare\nAudit Glove\nVaal Gloves\n--------\nItem Level: 80\n--------\n+10% to Cold Resistance';
(async()=>{
 await e.loadBuild(xml,[]);
 await e.send({cmd:'equip',items:[{slot:'Weapon 2 Swap',text:shield}]});
 for(const set of [1,2,1]) {
  await e.setWeaponSet(set); const s=await e.sheet();
  const [r]=await e.evalItems([{slot:'Gloves',text:glove}]);
  assert.equal(r.before.ColdResistTotal,s.stats.ColdResistTotal);
  assert.equal(r.before.Life,s.stats.Life);
  assert.equal(r.after.ColdResistTotal-r.before.ColdResistTotal,10);
  assert.equal(e.info().stats.ColdResistTotal,s.stats.ColdResistTotal);
 }
 await e.setWeaponSet(2);
 await e.send({cmd:'equip',items:[{slot:'Weapon 2',text:shield.replace('+30%','+60%')}]});
 for(const [set,expected] of [[1,10],[2,-20]]) {
  await e.setWeaponSet(set); assert.equal((await e.sheet()).stats.ColdResistTotal,expected);
 }
 const j=require('../src/core/pobverdict').judge({TotalDPS:0},{TotalDPS:5000});
 assert.equal(j.dps.pct,null); assert.ok(j.score>0);
 console.log('Numerical regressions passed: current baseline, weapon slots, cached summary, zero DPS.');
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(()=>e.kill());
