import test from 'node:test';
import assert from 'node:assert/strict';
import {candlesFromHourly} from '../lib/hourlyCandles';
const start=Date.parse('2026-01-01T00:00:00Z');
const p=(hour:number,price:number,volume=1)=>({timestamp:new Date(start+hour*3600000).toISOString(),avg_price:price,item_count:volume});
const history=(data:any[])=>({location:'Martlock',item_id:'T4_ROCK',quality:1,data});
test('daily candle uses only actual hourly averages in time order',()=>{
 const rows=candlesFromHourly(history([p(23,11),p(1,10),p(4,20),p(8,5),p(25,7)]),start,start+3*86400000);
 assert.deepEqual(rows,[{day:start,open:10,high:20,low:5,close:11,count:4,firstHour:1,lastHour:23},{day:start+86400000,open:7,high:7,low:7,close:7,count:1,firstHour:1,lastHour:1}]);
});
test('missing, invalid, duplicate and outside hours never create prices',()=>{
 const rows=candlesFromHourly(history([p(1,4),p(1,8),p(2,0),p(3,10,0),p(4,12),p(72,20),{...p(5,8),timestamp:'invalid'}]),start,start+2*86400000);
 assert.deepEqual(rows,[{day:start,open:12,high:12,low:12,close:12,count:1,firstHour:4,lastHour:4}]);
});
test('unaligned and invalid windows are rejected',()=>assert.throws(()=>candlesFromHourly(history([]),start+1,start+86400000)));
