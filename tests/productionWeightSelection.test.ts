import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {selectProductionWeight} from '../lib/productionWeightSelection';
import type {CatalogueRecipe} from '../lib/productionRecipes';
import type {ProductionScenario} from '../lib/productionTypes';

const recipe:CatalogueRecipe={id:'example#root:0',sourceId:'example',itemIdCandidate:'EXAMPLE',itemType:'equipment',tier:4,enchantment:null,category:null,subcategories:[],outputQuantity:null,focusBase:null,silverCost:null,swapTransaction:null,materials:[{sourceId:'SOURCE_LEVEL1',itemIdCandidate:'MARKET_LEVEL1@1',enchantment:1,quantity:3,maxReturnAmount:null,returnable:null}]};
const scenario:ProductionScenario={label:'Example',quantity:2,outputPerCraft:1,materials:[{itemId:'MARKET_LEVEL1@1',amountPerCraft:3,unitPrice:1,returnable:true}],outputUnitPrice:10,returnRate:0,stationFeePerCraft:0,focusPerCraft:0,salesTaxRate:0,sellOrderFeeRate:0,budget:null,availableFocus:null,volumeObserved:null,volumeDays:null,metadata:{outputItemId:'EXAMPLE',recipe:{id:recipe.id,revision:'abc',silverCost:null,swapTransaction:null,cappedReturn:false}}};
const index={schemaVersion:1,provenance:{sourceCommit:'abc'},entries:[{sourceId:'SOURCE_LEVEL1',enchantment:1,weight:4,origin:'item' as const},{sourceId:'OTHER',enchantment:null,weight:3,origin:'item' as const}]};

test('uses exact source identities and sends only matching index entries',()=>{
 const result=selectProductionWeight(scenario,2,[recipe],'abc',index);
 assert.ok('materials' in result);
 assert.deepEqual(result.materials,[{sourceId:'SOURCE_LEVEL1',enchantment:1,quantity:6}]);
 assert.equal(result.index.entries.length,1);
});
test('unknown provenance, changed IDs, revisions and ambiguous variants never yield guessed weights',()=>{
 assert.deepEqual(selectProductionWeight({...scenario,metadata:{}},2,[recipe],'abc',index),{error:'NO_RECIPE'});
 assert.deepEqual(selectProductionWeight(scenario,2,[recipe],'other',index),{error:'REVISION_MISMATCH'});
 assert.deepEqual(selectProductionWeight({...scenario,materials:[{...scenario.materials[0],itemId:'OTHER'}]},2,[recipe],'abc',index),{error:'MATERIAL_MISMATCH'});
 assert.deepEqual(selectProductionWeight(scenario,2,[recipe,recipe],'abc',index),{error:'NO_RECIPE'});
 assert.deepEqual(selectProductionWeight(scenario,0,[recipe],'abc',index),{error:'INVALID_QUANTITY'});
});
