import {parseAodpTimestamp} from './aodpTime';
import type {HistoryResponse} from './api';
const HOUR=3600000,DAY=24*HOUR;
export type HourlyCandle={day:number;open:number;high:number;low:number;close:number;count:number;firstHour:number;lastHour:number};
/** OHLC of reported hourly average buckets; never transaction-level OHLC. */
export function candlesFromHourly(history:HistoryResponse,start:number,end:number):HourlyCandle[]{
 if(!Number.isFinite(start)||!Number.isFinite(end)||start%DAY!==0||end%DAY!==0||end<=start)throw new Error('Invalid UTC window');
 if(!Array.isArray(history.data)||history.data.length>24*92+48)throw new Error('Invalid hourly history');
 const hours=new Map<number,number|null>();
 for(const p of history.data){
  const t=parseAodpTimestamp(p.timestamp); if(!Number.isFinite(t)||t<start||t>=end||t%HOUR!==0)continue;
  if(!Number.isSafeInteger(p.avg_price)||p.avg_price<=0||!Number.isSafeInteger(p.item_count)||p.item_count<=0)continue;
  if(hours.has(t)){hours.set(t,null);continue;} hours.set(t,p.avg_price);
 }
 const days=new Map<number,{t:number;p:number}[]>();
 for(const [t,p] of hours){if(p===null)continue;const day=Math.floor(t/DAY)*DAY;const bucket=days.get(day)||[];bucket.push({t,p});days.set(day,bucket)}
 return [...days].sort((a,b)=>a[0]-b[0]).map(([day,points])=>{
  points.sort((a,b)=>a.t-b.t);const prices=points.map(x=>x.p);
  return {day,open:prices[0],high:Math.max(...prices),low:Math.min(...prices),close:prices[prices.length-1],count:points.length,firstHour:(points[0].t-day)/HOUR,lastHour:(points[points.length-1].t-day)/HOUR};
 });
}
