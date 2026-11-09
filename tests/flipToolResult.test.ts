import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFlipToolResult} from '../lib/flipToolResult';
import {planWorldRoute} from '../lib/worldMapRoutes';
const now=1793919600000;
function fixture(){
 const route=planWorldRoute('3003','3004','fewest_lethal');
 if(route.status!=='found')throw Error('Missing reference route');
 return {item:'T4_ROCK',quantity:10,quality:1,eligible_count:1,excluded:[],status:'positive_estimates',sort_by:'profit',compared_at_ms:now,
  assumptions:{premium:true,buy_mode:'instant',sell_mode:'instant',max_age_minutes:60},
  candidates:[{rank:1,buy_city:'Caerleon',sell_city:'Martlock',quantity:10,buy_price:100,sell_price:200,purchase_total:1000,gross_revenue:2000,buy_setup_fee:0,sell_setup_fee:0,sales_tax:80,net_profit:920,buy_observed_at_ms:now,sell_observed_at_ms:now,buy_age_minutes:0,sell_age_minutes:0,
   route:{path:route.zoneIds.map(id=>({id})),transitions:route.transitions,map_action:{type:'plan_route',from:'3003',to:'3004',policy:'fewest_lethal'}}}]
 };
}
test('validated flip result supplies a real route and fee-correct estimate to chat',()=>{
 const parsed=parseFlipToolResult('compare_flip_routes',JSON.stringify(fixture()));
 assert.equal(parsed?.candidates[0].net_profit,920);
 assert.equal(parsed?.candidates[0].sell_city,'Martlock');
 assert.equal(parseFlipToolResult('get_prices',JSON.stringify(fixture())),null);
});
test('flip cards reject wrong geography, misleading profit, stale quotes and mismatched quantities',()=>{
 for(const change of [
  (f:ReturnType<typeof fixture>)=>{f.candidates[0].net_profit=1000;},
  (f:ReturnType<typeof fixture>)=>{f.candidates[0].sales_tax=0;},
  (f:ReturnType<typeof fixture>)=>{f.candidates[0].sell_city='Thetford';},
  (f:ReturnType<typeof fixture>)=>{f.candidates[0].quantity=100;},
  (f:ReturnType<typeof fixture>)=>{f.candidates[0].route.path[1].id='fake';},
  (f:ReturnType<typeof fixture>)=>{f.candidates[0].buy_observed_at_ms=now-3600001;},
  (f:ReturnType<typeof fixture>)=>{f.candidates[0].buy_age_minutes=99;},
 ]){const f=fixture();change(f);assert.equal(parseFlipToolResult('compare_flip_routes',JSON.stringify(f)),null);}
});
test('missing data shows an empty comparison and never invents a recommended route',()=>{
 const f=fixture();f.status='insufficient_fresh_data_or_routes';f.candidates=[];f.eligible_count=0;
 assert.deepEqual(parseFlipToolResult('compare_flip_routes',JSON.stringify(f))?.candidates,[]);
 f.status='positive_estimates';assert.equal(parseFlipToolResult('compare_flip_routes',JSON.stringify(f)),null);
});
test('same-city comparisons need no invented route and retain exact fees',()=>{
 const f:any=fixture();f.assumptions.buy_mode='order';f.assumptions.sell_mode='order';
 Object.assign(f.candidates[0],{sell_city:'Caerleon',buy_price:80,sell_price:100,purchase_total:800,gross_revenue:1000,buy_setup_fee:20,sell_setup_fee:25,sales_tax:40,net_profit:115,route:null});
 assert.equal(parseFlipToolResult('compare_flip_routes',JSON.stringify(f))?.candidates[0].net_profit,115);
 f.candidates[0].route={};assert.equal(parseFlipToolResult('compare_flip_routes',JSON.stringify(f)),null);
});
