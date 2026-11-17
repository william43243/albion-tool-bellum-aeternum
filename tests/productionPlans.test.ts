import test from 'node:test';
import assert from 'node:assert/strict';
import {isProductionScenario, type ProductionScenario} from '../lib/productionTypes';
import {createProductionPlanStore} from '../lib/productionPlans';
import {createProductionChainStore} from '../lib/productionChains';

const scenario=():ProductionScenario=>({label:'Synthetic scenario',quantity:3,outputPerCraft:1,materials:[{itemId:'TEST_MATERIAL',amountPerCraft:4,unitPrice:25,returnable:true}],outputUnitPrice:200,returnRate:0.1,stationFeePerCraft:4,focusPerCraft:0,salesTaxRate:0.05,sellOrderFeeRate:0,budget:null,availableFocus:null,volumeObserved:null,volumeDays:null});
test('requires explicit, positive prices and complete non-invented assumptions',()=>{
 const good=scenario();assert.equal(isProductionScenario(good),true);
 assert.equal(isProductionScenario({...good,outputUnitPrice:0}),false);
 assert.equal(isProductionScenario({...good,materials:[{...good.materials[0],unitPrice:0}]}),false);
 assert.equal(isProductionScenario({...good,returnRate:1}),false);
 assert.equal(isProductionScenario({...good,volumeObserved:5,volumeDays:null}),false);
 assert.equal(isProductionScenario({...good,materials:[good.materials[0],good.materials[0]]}),false);
 assert.equal(isProductionScenario({...good,focusPerCraft:0,stationFeePerCraft:0}),true);
});
test('persists a versioned plan and detaches the snapshot from later edits',async()=>{
 let raw:string|null=null;const store=createProductionPlanStore({read:async()=>raw,write:async v=>{raw=v;}});
 const initial=scenario();await store.save(initial);initial.materials[0].unitPrice=999;
 const rows=await store.list();assert.equal(rows.length,1);assert.equal(rows[0].scenario.materials[0].unitPrice,25);
 assert.equal(JSON.parse(raw!).version,1);
});
test('recipe provenance and fixed cost survive plan and chain storage',async()=>{
 const recipe={id:'T4_ITEM#root:0',revision:'123456',silverCost:4,swapTransaction:null,cappedReturn:false};
 const item:ProductionScenario={...scenario(),metadata:{outputItemId:'T4_ITEM',recipe}};
 assert.equal(isProductionScenario(item),true);
 assert.equal(isProductionScenario({...item,stationFeePerCraft:3}),false);
 assert.equal(isProductionScenario({...item,metadata:{...item.metadata,recipe:{...recipe,swapTransaction:true}}}),false);
 let planRaw:string|null=null,chainRaw:string|null=null;
 const plans=createProductionPlanStore({read:async()=>planRaw,write:async v=>{planRaw=v;}});
 const chains=createProductionChainStore({read:async()=>chainRaw,write:async v=>{chainRaw=v;}});
 await plans.save(item);await chains.save([{outputItemId:'FIRST',scenario:item},{outputItemId:'SECOND',scenario:item}],null,null);
 assert.deepEqual((await plans.list())[0].scenario.metadata?.recipe,recipe);
 assert.deepEqual((await chains.list())[0].steps[0].scenario.metadata?.recipe,recipe);
});
test('does not overwrite unreadable or newer saved data',async()=>{
 for(const bad of ['{broken',JSON.stringify({version:2,plans:[]}),JSON.stringify({version:1,plans:[{id:'x'}]})]){
  let writes=0;const store=createProductionPlanStore({read:async()=>bad,write:async()=>{writes++;}});
  await assert.rejects(store.save(scenario()),/PLAN_STORAGE_UNREADABLE/);assert.equal(writes,0);
 }
});
test('serializes concurrent additions and preserves unknown envelope properties',async()=>{
 let raw:string|null=JSON.stringify({version:1,plans:[],futureField:'keep'});
 const store=createProductionPlanStore({read:async()=>raw,write:async v=>{await Promise.resolve();raw=v;}});
 await Promise.all([store.save(scenario()),store.save({...scenario(),label:'Second'})]);
 const data=JSON.parse(raw!);assert.equal(data.plans.length,2);assert.notEqual(data.plans[0].id,data.plans[1].id);assert.equal(data.futureField,'keep');
});
test('write failure reports failure and leaves persisted value untouched',async()=>{
 const raw=JSON.stringify({version:1,plans:[]});const store=createProductionPlanStore({read:async()=>raw,write:async()=>{throw Error('disk');}});
 await assert.rejects(store.save(scenario()),/disk/);assert.deepEqual((await store.list()),[]);
});
test('chain storage keeps steps and global limits in a separate versioned record',async()=>{
 let raw:string|null=null;const store=createProductionChainStore({read:async()=>raw,write:async v=>{raw=v;}});
 const steps=[{outputItemId:'FIRST',scenario:scenario()},{outputItemId:'SECOND',scenario:scenario()}];
 await store.save(steps,1234,500);steps[0].scenario.label='mutated';
 const rows=await store.list();assert.equal(rows.length,1);assert.equal(rows[0].budget,1234);assert.equal(rows[0].availableFocus,500);assert.equal(rows[0].steps[0].scenario.label,'Synthetic scenario');
 assert.equal(JSON.parse(raw!).version,1);
});
test('chain storage rejects malformed or newer data without overwrite',async()=>{
 let writes=0;const bad=JSON.stringify({version:2,chains:[]});const store=createProductionChainStore({read:async()=>bad,write:async()=>{writes++;}});
 const steps=[{outputItemId:'FIRST',scenario:scenario()},{outputItemId:'SECOND',scenario:scenario()}];
 await assert.rejects(store.save(steps,null,null),/CHAIN_STORAGE_UNREADABLE/);assert.equal(writes,0);
 const empty=createProductionChainStore({read:async()=>null,write:async()=>{writes++;}});
 await assert.rejects(empty.save(steps.slice(0,1),null,null),/INVALID_CHAIN/);assert.equal(writes,0);
});
