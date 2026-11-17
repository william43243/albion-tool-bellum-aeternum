import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractWeights} from '../scripts/production-weights.mjs';

test('extracts only item and explicit enchanted weights without fallback',()=>{
  const source={items:{consumableitem:{'@uniquename':'POTION','@weight':'0.87',lootlist:{loot:{'@weight':'999'}},
    enchantments:{enchantment:[{'@enchantmentlevel':'1','@weight':'1.1'},{'@enchantmentlevel':'2'}]}}}};
  assert.deepEqual(extractWeights(source,{}).entries,[
    {sourceId:'POTION',enchantment:null,weight:.87,origin:'item'},
    {sourceId:'POTION',enchantment:1,weight:1.1,origin:'enchantment'},
    {sourceId:'POTION',enchantment:2,weight:null,origin:'enchantment'},
  ]);
});
test('validates weight, enchantment and duplicate identities',()=>{
  assert.throws(()=>extractWeights({items:{x:{'@uniquename':'A','@weight':'NaN'}}},{}),/Invalid weight/);
  assert.throws(()=>extractWeights({items:{x:{'@uniquename':'A',enchantments:{enchantment:{'@weight':'1'}}}}},{}),/Missing enchantment/);
  assert.throws(()=>extractWeights({items:{x:[{'@uniquename':'A'},{'@uniquename':'A'}]}},{}),/Duplicate/);
});
test('pinned index contains independently checked values and missing variant',async()=>{
  const data=JSON.parse(await readFile(new URL('../assets/production/weights.json',import.meta.url),'utf8'));
  assert.equal(data.entries.length,11982);
  const find=(id,level)=>data.entries.find(e=>e.sourceId===id && e.enchantment===level);
  assert.equal(find('T4_ORE',0).weight,.51);
  assert.equal(find('T4_ORE_LEVEL1',1).weight,.51);
  assert.equal(find('T4_MAIN_SWORD',null).weight,5.1);
  assert.equal(find('T4_MAIN_SWORD',1).weight,null);
  assert.equal(find('T6_POTION_ENERGY',1).weight,1.1);
  assert.equal(data.provenance.unit,'source_unconfirmed');
});
