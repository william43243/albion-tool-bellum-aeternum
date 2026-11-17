import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionMarketClient } from '../lib/productionMarketClient';

const now = Date.parse('2026-11-16T12:00:00Z');
const query = {server:'americas', itemIds:['T4_ORE'], cities:['Fort Sterling'], quality:1, maxAgeMs:3600000} as const;
const request = () => ({ ...query, itemIds:[...query.itemIds],cities:[...query.cities] });
const price = {item_id:'T4_ORE',city:'Fort Sterling',quality:1,sell_price_min:120,sell_price_max:130,buy_price_min:80,buy_price_max:90,
  sell_price_min_date:'2026-11-16T11:30:00',sell_price_max_date:'2026-11-16T11:30:00',buy_price_min_date:'2026-11-16T11:30:00',buy_price_max_date:'2026-11-16T11:30:00'};
const response = (data: unknown, status=200, retryAfter: string|null=null) => ({ok:status>=200 && status<300,status,headers:{get:()=>retryAfter},json:async()=>data}) as unknown as Response;
function storage(initial: string|null=null) {
 let value=initial, writes=0;
 return {getItem:async()=>value,setItem:async(_key:string,next:string)=>{writes++;value=next;}, value:()=>value,writes:()=>writes};
}

test('uses correct market sides and retains observations for offline use',async()=>{
 const store=storage(); let calls=0;
 const client=createProductionMarketClient(store,async()=>{calls++;return response([price]);},()=>now);
 const result=await client.getPrices(request());
 assert.equal(result.rows[0].purchaseImmediate?.value,120);
 assert.equal(result.rows[0].saleImmediate?.value,90);
 assert.equal(result.rows[0].saleOrderReference?.value,120);
 assert.equal(result.rows[0].purchaseImmediate?.fresh,true);
 assert.equal(result.rows[0].purchaseImmediate?.ageMs,1800000);
 assert.equal(result.rows[0].source,'AODP');
 assert.equal(calls,1); assert.equal(store.writes(),1);
 const offline=createProductionMarketClient(store,async()=>{throw Error('unexpected network');},()=>now+7200000);
 const cached=await offline.getPrices({...request(),offlineOnly:true});
 assert.equal(cached.offline,true); assert.equal(cached.rows[0].purchaseImmediate?.fresh,false);
});

test('rejects absent and future prices and preserves stale observations on network failure',async()=>{
 const store=storage();
 const client=createProductionMarketClient(store,async()=>response([{...price,buy_price_max:0,sell_price_min_date:'2026-11-16T13:00:00Z'}]),()=>now);
 const result=await client.getPrices(request());
 assert.equal(result.rows[0].purchaseImmediate,null); assert.equal(result.rows[0].saleImmediate,null);
 const offline=createProductionMarketClient(store,async()=>{throw Error('offline');},()=>now+7200000);
 const failed=await offline.getPrices(request());
 assert.equal(failed.offline,true); assert.equal(failed.error,'offline'); assert.equal(failed.rows[0].saleImmediate,null);
});

test('respects rate limit and never overwrites unreadable cache',async()=>{
 const store=storage('not json');let calls=0;
 const client=createProductionMarketClient(store,async()=>{calls++;return response([],429,'60');},()=>now);
 assert.equal((await client.getPrices(request())).error,'AODP_RATE_LIMITED');
 assert.equal((await client.getPrices(request())).error,'AODP_RATE_LIMITED');
 assert.equal(calls,1);assert.equal(store.writes(),0);assert.equal(store.value(),'not json');
});

test('cancelling one shared request does not cancel another consumer',async()=>{
 let resolve!: (r:Response)=>void;let calls=0;let networkSignal:AbortSignal|undefined;
 const client=createProductionMarketClient(storage(),(_url,options)=>{calls++;networkSignal=options?.signal as AbortSignal;return new Promise(r=>{resolve=r;});},()=>now);
 const controller=new AbortController();
 const a=client.getPrices({...request(),signal:controller.signal}); const b=client.getPrices(request());
 await new Promise<void>(r=>setTimeout(r,0));
 controller.abort(); await assert.rejects(a,{name:'AbortError'});
 assert.equal(networkSignal?.aborted,false); resolve(response([price]));
 assert.equal((await b).rows.length,1);assert.equal(calls,1);
});

test('invalid or oversized requests do not contact AODP',async()=>{
 let calls=0;const client=createProductionMarketClient(storage(),async()=>{calls++;return response([]);},()=>now);
 await assert.rejects(client.getPrices({...request(),itemIds:['../../private']}),/INVALID_MARKET_QUERY/);
 await assert.rejects(client.getPrices({...request(),itemIds:Array.from({length:201},(_,i)=>`T4_ITEM_${i}`)}),/INVALID_MARKET_QUERY/);
 assert.equal(calls,0);
});

test('history includes only unique complete UTC buckets in the requested window',async()=>{
 const store=storage(), hist={location:'Fort Sterling',item_id:'T4_ORE',quality:1,data:[
  {timestamp:'2026-11-12T00:00:00',item_count:900,avg_price:100}, // outside window
  {timestamp:'2026-11-14T00:00:00',item_count:20,avg_price:90},
  {timestamp:'2026-11-13T00:00:00',item_count:10,avg_price:80},
  {timestamp:'2026-11-15T12:00:00',item_count:10,avg_price:90}, // incomplete daily bucket
  {timestamp:'2026-11-16T00:00:00',item_count:40,avg_price:90}, // current UTC day
 ]};
 const client=createProductionMarketClient(store,async()=>response([hist]),()=>now);
 const options={server:'americas',itemId:'T4_ORE',city:'Fort Sterling',quality:1,days:3,maxAgeMs:3600000} as const;
 const result=await client.getHistory(options);
 assert.equal(result.observedUnits,30);assert.equal(result.observedBuckets,2);assert.equal(result.requestedDays,3);
 assert.deepEqual(result.points.map(x=>x.itemCount),[10,20]); assert.equal(result.fresh,true);
 const offline=createProductionMarketClient(store,async()=>{throw Error('unexpected network');},()=>now+7200000);
 const cached=await offline.getHistory({...options,offlineOnly:true});assert.equal(cached.observedUnits,30);assert.equal(cached.fresh,false);
});

test('ambiguous history does not manufacture a volume',async()=>{
 const point={timestamp:'2026-11-14T00:00:00',item_count:10,avg_price:80};
 const client=createProductionMarketClient(storage(),async()=>response([{location:'Fort Sterling',item_id:'T4_ORE',quality:1,data:[point,point]}]),()=>now);
 const result=await client.getHistory({server:'americas',itemId:'T4_ORE',city:'Fort Sterling',quality:1,days:3,maxAgeMs:3600000});
 assert.equal(result.error,'AODP_AMBIGUOUS_HISTORY');assert.equal(result.observedUnits,null);
});

test('duplicate cached history buckets are not counted or overwritten',async()=>{
 const raw=JSON.stringify({version:1,rows:[],histories:[{server:'americas',itemId:'T4_ORE',city:'Fort Sterling',quality:1,startMs:Date.parse('2026-11-13T00:00:00Z'),endMs:Date.parse('2026-11-16T00:00:00Z'),fetchedAt:now,points:[{timestamp:'2026-11-14T00:00:00',itemCount:10,averagePrice:80},{timestamp:'2026-11-14T00:00:00',itemCount:10,averagePrice:80}]}]});
 const store=storage(raw),client=createProductionMarketClient(store,async()=>response([]),()=>now);
 const result=await client.getHistory({server:'americas',itemId:'T4_ORE',city:'Fort Sterling',quality:1,days:3,maxAgeMs:3600000,offlineOnly:true});
 assert.equal(result.observedUnits,null);assert.equal(result.cachePersistent,false);assert.equal(store.value(),raw);
});
