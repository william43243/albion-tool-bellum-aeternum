import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractRecipes} from '../scripts/production-recipes.mjs';

test('preserves singleton, alternatives, explicit unknowns and enchantments', () => {
  const raw = {items:{weapon:{'@uniquename':'T4_EXAMPLE','@tier':'4','@shopcategory':'weapons',
    craftingrequirements:[{craftresource:{'@uniquename':'T4_METALBAR','@count':'16'}},
      {'@amountcrafted':'2','@silver':'7','@swaptransaction':'true',craftresource:[
        {'@uniquename':'T4_ARTEFACT','@count':'1','@maxreturnamount':'0'},
        {'@uniquename':'T4_OTHER','@count':'3','@maxreturnamount':'2'}]}],
    enchantments:{enchantment:{'@enchantmentlevel':'1',craftingrequirements:{'@craftingfocus':'10',craftresource:
      {'@uniquename':'T4_METALBAR_LEVEL1','@enchantmentlevel':'1','@count':'16'}}}}}}};
  const {recipes,stats} = extractRecipes(raw, {});
  assert.equal(recipes.length,3);
  assert.equal(new Set(recipes.map(r=>r.id)).size,3);
  assert.equal(recipes[0].outputQuantity,null);
  assert.equal(recipes[0].materials[0].returnable,null);
  assert.equal(recipes[1].outputQuantity,2);
  assert.equal(recipes[1].silverCost,7);
  assert.equal(recipes[1].swapTransaction,true);
  assert.equal(recipes[1].materials[0].returnable,false);
  assert.equal(recipes[1].materials[1].returnable,null);
  assert.equal(recipes[1].materials[1].maxReturnAmount,2);
  assert.equal(recipes[2].itemIdCandidate,'T4_EXAMPLE@1');
  assert.equal(recipes[2].materials[0].itemIdCandidate,'T4_METALBAR_LEVEL1@1');
  assert.equal(stats.categories.weapons,3);
});

test('does not infer enchantment from LEVEL suffix', () => {
  const r = extractRecipes({items:{simpleitem:{'@uniquename':'T1_FISHSAUCE_LEVEL1',craftingrequirements:{
    craftresource:{'@uniquename':'T1_EXTRACT_LEVEL1','@count':'1'}}}}},{}).recipes[0];
  assert.equal(r.enchantment,null);
  assert.equal(r.itemIdCandidate,'T1_FISHSAUCE_LEVEL1');
  assert.equal(r.materials[0].enchantment,null);
  assert.equal(r.materials[0].itemIdCandidate,'T1_EXTRACT_LEVEL1');
});

test('fails closed on invalid quantities and duplicate recipe identifiers', () => {
  assert.throws(() => extractRecipes({items:{weapon:{'@uniquename':'X',craftingrequirements:{craftresource:{'@uniquename':'Y','@count':'0'}}}}},{}),/Invalid material count/);
  const item = {'@uniquename':'X',craftingrequirements:{'@amountcrafted':'1'}};
  assert.throws(() => extractRecipes({items:{weapon:[item,item]}},{}),/Duplicate recipe/);
});

test('pinned generated catalog preserves known alternatives and observations', async () => {
  const db=JSON.parse(await readFile(new URL('../assets/production/recipes.json',import.meta.url),'utf8'));
  assert.equal(db.provenance.sourceCommit,'5b581f18e9dc27b0866e78526cea535fb17db02d');
  assert.equal(db.stats.recipeCount,13561);
  const variants=db.recipes.filter(r=>r.sourceId==='T4_METALBAR' && r.id.includes('#root:'));
  assert.equal(variants.length,2);
  assert.deepEqual(variants[0].materials.map(m=>[m.sourceId,m.quantity]),[['T4_ORE',2],['T3_METALBAR',1]]);
  assert.deepEqual(variants[1].materials.map(m=>[m.sourceId,m.quantity]),[['T4_ORE',1],['T1_FACTION_MOUNTAIN_TOKEN_1',1],['T3_METALBAR',1]]);
  const sword=db.recipes.find(r=>r.id==='T4_MAIN_SWORD#enchant:1:0');
  assert.equal(sword.itemIdCandidate,'T4_MAIN_SWORD@1');
  assert.equal(sword.materials[0].itemIdCandidate,'T4_METALBAR_LEVEL1@1');
  assert.equal(sword.outputQuantity,null);
  const artefact=db.recipes.find(r=>r.sourceId==='T4_MAIN_ARCANESTAFF_UNDEAD' && r.materials.some(m=>m.returnable===false));
  assert.ok(artefact);
  assert.ok(db.recipes.some(r=>r.swapTransaction === true && r.silverCost > 0));
});
