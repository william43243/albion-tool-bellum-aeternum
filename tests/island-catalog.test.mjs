import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractIslandCatalog} from '../scripts/island-catalog.mjs';

test('handles singleton and preserves raw fields without manufacturing game rules',()=>{
 const raw={'@uniquename':'TEST_SEED','@tier':'1','@kind':'plant','@shopsubcategory1':'farm','@shopsubcategory2':'seeds',
  craftingrequirements:{'@silver':'100','@swaptransaction':'true'},harvest:{seed:{'@chance':'0'}},'@activefarmbonus':'2'};
 const result=extractIslandCatalog({items:{farmableitem:raw}},{});
 assert.equal(result.farmables.length,1);assert.deepEqual(result.farmables[0].raw,raw);
 assert.equal(result.farmables[0].tier,1);assert.equal(result.verifiedRules.npcPrices,null);
 assert.equal(result.verifiedRules.cityBonuses,null);assert.equal(result.verifiedRules.focusFormula,null);
 assert.deepEqual(result.assumptions.farmPlotSlots,{value:9,source:'user_declared',scope:'farm'});
 assert.equal(result.assumptions.pasturePlotSlots,null);assert.equal(result.assumptions.kennelPlotSlots,null);
});
test('preserves unknown source fields and object or array relationship forms',()=>{
 const rows=[{'@uniquename':'ONE',harvest:{seed:{'@chance':'0.5'}}},{'@uniquename':'TWO',products:{product:[{'@lootlist':'A'},{'@lootlist':'B'}]},consumption:{food:{acceptedfood:{'@favorite':'FOOD'}}}}];
 const result=extractIslandCatalog({items:{farmableitem:rows}},{});
 assert.deepEqual(result.farmables.map(x=>x.raw),rows);
 assert.equal(result.farmables[0].plotType,null);assert.equal(result.farmables[1].tier,null);
});
test('rejects invalid and duplicate source identities',()=>{
 assert.throws(()=>extractIslandCatalog({items:{}},{}),/Missing farmableitem/);
 assert.throws(()=>extractIslandCatalog({items:{farmableitem:[{'@uniquename':'A'},{'@uniquename':'A'}]}},{}),/Duplicate/);
 assert.throws(()=>extractIslandCatalog({items:{farmableitem:{'@uniquename':'A','@tier':'bad'}}},{}),/Invalid tier/);
});
test('pinned snapshot preserves observed source shapes and unknown semantics',async()=>{
 const result=JSON.parse(await readFile(new URL('../assets/island/farmables.json',import.meta.url),'utf8'));
 assert.equal(result.provenance.sourceCommit,'5b581f18e9dc27b0866e78526cea535fb17db02d');
 assert.equal(result.provenance.sourceSha256,'faad7affcd79f7ee4c726d746d0e010889a03fff9159ad69870850457f666ef8');
 assert.equal(result.stats.farmableCount,109);
 const carrot=result.farmables.find(x=>x.sourceId==='T1_FARM_CARROT_SEED');
 assert.equal(carrot.raw.craftingrequirements['@silver'],'2000');assert.equal(carrot.raw.harvest.seed['@chance'],'0.0000');
 const chicken=result.farmables.find(x=>x.sourceId==='T3_FARM_CHICKEN_BABY');
 assert.equal(chicken.raw.grownitem['@uniquename'],'T3_FARM_CHICKEN_GROWN');
 assert.equal(chicken.raw.consumption.food.acceptedfood['@favorite'],'T3_WHEAT');
 assert.equal(result.verifiedRules.npcPrices,null);assert.equal(result.verifiedRules.harvestYield,null);
});
