import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHistoryChart} from '../lib/chatHistoryChart';
const start=Date.parse('2026-01-01T00:00:00Z');
const result=(points:any[])=>JSON.stringify({item:'T4_ROCK',bucket_hours:24,cities:[{city:'Martlock',requested_days:7,requested_start_inclusive:'2026-01-01T00:00:00Z',requested_end_exclusive:'2026-01-08T00:00:00Z',observations:points}]});
test('history graph keeps only supplied observations in chronological order with volume',()=>{
 const data=parseHistoryChart('get_history',result([{timestamp_ms:start+2*86400000,avg_price:9,volume:3},{timestamp_ms:start,avg_price:7,volume:2}]));
 assert.deepEqual(data?.series[0].points.map(p=>p.timestamp),[start,start+2*86400000]);assert.equal(data?.series[0].points[1].price,9);assert.equal(data?.series[0].points[1].itemCount,3);
});
test('rejects invalid, duplicated, out of window and fabricated zero values',()=>{
 const p={timestamp_ms:start,avg_price:7,volume:2};
 for(const points of [[p,p],[{...p,timestamp_ms:start-1}],[{...p,avg_price:0}],[{...p,volume:0}]])assert.equal(parseHistoryChart('get_history',result(points)),null);
 assert.equal(parseHistoryChart('get_prices',result([p])),null);
});
