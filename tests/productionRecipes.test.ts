import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {reconcileProductionRecipe, searchProductionRecipes, unsupportedRecipe, type CatalogueRecipe} from '../lib/productionRecipes';
import {isProductionScenario, type ProductionScenario} from '../lib/productionTypes';

const sample:CatalogueRecipe={id:'T4_SWORD#root:0',sourceId:'T4_SWORD',itemIdCandidate:'T4_SWORD',itemType:'equipment',tier:4,enchantment:null,category:null,subcategories:[],outputQuantity:null,focusBase:null,silverCost:null,swapTransaction:null,materials:[{sourceId:'T4_METALBAR',itemIdCandidate:'T4_METALBAR',enchantment:null,quantity:8,maxReturnAmount:null,returnable:null}]};

test('recipe search retains distinct variants, supports names, and paginates',()=>{
 const recipes=[sample,{...sample,id:'T4_SWORD#root:1'}];
 const names=new Map([['T4_SWORD','Iron Sword']]);
 assert.equal(searchProductionRecipes(recipes,'i',0,15,names).length,0);
 assert.deepEqual(searchProductionRecipes(recipes,'sword',0,15,names).map(x=>x.id),['T4_SWORD#root:0','T4_SWORD#root:1']);
 assert.deepEqual(searchProductionRecipes(recipes,'iron',1,1,names).map(x=>x.id),['T4_SWORD#root:1']);
});

test('recipe swaps and positive return caps are not treated as supported',()=>{
 assert.equal(unsupportedRecipe(sample),false);
 assert.equal(unsupportedRecipe({...sample,swapTransaction:true}),true);
 assert.equal(unsupportedRecipe({...sample,materials:[{...sample.materials[0],maxReturnAmount:1}]}),true);
 assert.equal(sample.outputQuantity,null);
 assert.equal(sample.materials[0].returnable,null);
});

test('a linked recipe cannot return a zero-cap material after save, transfer, or legacy migration',()=>{
 const recipe={...sample,materials:[{...sample.materials[0],maxReturnAmount:0,returnable:false as const}]};
 const scenario:ProductionScenario={label:'Example',quantity:1,outputPerCraft:1,materials:[{itemId:'T4_METALBAR',amountPerCraft:8,unitPrice:1,returnable:false}],outputUnitPrice:10,returnRate:.2,stationFeePerCraft:0,focusPerCraft:0,salesTaxRate:0,sellOrderFeeRate:0,budget:null,availableFocus:null,volumeObserved:null,volumeDays:null,metadata:{outputItemId:'T4_SWORD',recipe:{id:recipe.id,revision:'abc',silverCost:null,swapTransaction:null,cappedReturn:false}}};
 assert.equal(isProductionScenario(scenario),true); // old saved plans remain readable
 const migrated=reconcileProductionRecipe(scenario,[recipe],'abc');assert.ok(migrated);
 assert.deepEqual(migrated.metadata?.recipe?.nonReturnableItemIds,['T4_METALBAR']);
 const transferred=JSON.parse(JSON.stringify(migrated)) as ProductionScenario;
 assert.equal(isProductionScenario(transferred),true);
 const invalid={...transferred,materials:[{...transferred.materials[0],returnable:true}]};
 assert.equal(isProductionScenario(invalid),false);
 assert.equal(reconcileProductionRecipe(invalid,[recipe],'abc'),null);
 const forged={...invalid,metadata:{...invalid.metadata,recipe:{...invalid.metadata!.recipe!,nonReturnableItemIds:[]}}};
 assert.equal(isProductionScenario(forged),true);
 assert.equal(reconcileProductionRecipe(forged,[recipe],'abc'),null);
 assert.equal(reconcileProductionRecipe(scenario,[recipe],'new-revision'),null);
 assert.equal(reconcileProductionRecipe({...scenario,materials:[{...scenario.materials[0],itemId:'OTHER'}]},[recipe],'abc'),null);
});

test('linked recipe quantities are exact, while missing output remains user-supplied',()=>{
 const recipe={...sample,outputQuantity:2};
 const scenario:ProductionScenario={label:'Example',quantity:3,outputPerCraft:2,materials:[{itemId:'T4_METALBAR',amountPerCraft:8,unitPrice:1,returnable:false}],outputUnitPrice:10,returnRate:0,stationFeePerCraft:0,focusPerCraft:0,salesTaxRate:0,sellOrderFeeRate:0,budget:null,availableFocus:null,volumeObserved:null,volumeDays:null,metadata:{outputItemId:'T4_SWORD',recipe:{id:recipe.id,revision:'abc',silverCost:null,swapTransaction:null,cappedReturn:false}}};
 const reconciled=reconcileProductionRecipe(scenario,[recipe],'abc');assert.ok(reconciled);
 const changedInput={...scenario,materials:[{...scenario.materials[0],amountPerCraft:7}]};
 assert.equal(reconcileProductionRecipe(changedInput,[recipe],'abc'),null);
 assert.equal(reconcileProductionRecipe({...scenario,outputPerCraft:1},[recipe],'abc'),null);
 // quantity is the number of crafts, not the per-craft recipe yield.
 assert.ok(reconcileProductionRecipe({...scenario,quantity:40},[recipe],'abc'));
 assert.ok(reconcileProductionRecipe({...scenario,outputPerCraft:5},[sample],'abc'));
 // Existing stored chains and plans follow exactly the same reconciliation.
 const storedChain=JSON.parse(JSON.stringify([{outputItemId:'T4_SWORD',scenario:changedInput}]));
 assert.equal(reconcileProductionRecipe(storedChain[0].scenario,[recipe],'abc'),null);
 const storedPlan=JSON.parse(JSON.stringify({...scenario,outputPerCraft:1}));
 assert.equal(reconcileProductionRecipe(storedPlan,[recipe],'abc'),null);
 // A deliberate removal of provenance turns the data into a manual scenario.
 const manual={...changedInput,metadata:{outputItemId:'T4_SWORD'}};
 assert.equal(reconcileProductionRecipe(manual,[recipe],'abc'),manual);
});
