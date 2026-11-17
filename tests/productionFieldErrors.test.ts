import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {invalidProductionSections} from '../lib/productionFieldErrors';

const filled=()=>({label:'Example',quantity:'1',output:'1',outputPrice:'5',returnPercent:'0',stationFee:'0',focus:'0',taxPercent:'0',orderPercent:'0',budget:'',availableFocus:'',volume:'',days:'',materials:[{itemId:'T4_TEST',amount:'2',price:'5',returnable:false}],metadata:{}});
test('identifies only groups with missing or invalid input and accepts explicit zero fees',()=>{
 assert.deepEqual(invalidProductionSections(filled(),'fr'),{basics:false,materials:false,params:false});
 assert.deepEqual(invalidProductionSections({...filled(),output:'',materials:[{itemId:'T4_TEST',amount:'2',price:'',returnable:null}]},'fr'),{basics:true,materials:true,params:false});
 assert.deepEqual(invalidProductionSections({...filled(),taxPercent:'',volume:'5'},'fr'),{basics:false,materials:false,params:true});
});
test('checks locale-aware numbers, positive prices and known fixed costs',()=>{
 assert.equal(invalidProductionSections({...filled(),outputPrice:'0'},'fr').basics,true);
 assert.equal(invalidProductionSections({...filled(),returnPercent:'100'},'fr').params,true);
 assert.equal(invalidProductionSections({...filled(),stationFee:'3',metadata:{recipe:{silverCost:4}}},'fr').params,true);
 assert.equal(invalidProductionSections({...filled(),outputPrice:'1,5'},'fr').basics,false);
});
