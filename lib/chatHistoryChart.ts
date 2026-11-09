export type HistoryObservation={timestamp:number;price:number;itemCount:number};
export type HistoryChartData={item:string;days:number;series:{city:string;points:HistoryObservation[]}[]};
export function parseHistoryChart(name:string,result?:string):HistoryChartData|null{
 if(name!=='get_history'||!result)return null;
 try{
  const raw=JSON.parse(result);if(typeof raw.item!=='string'||!Array.isArray(raw.cities)||raw.cities.length>7||raw.bucket_hours!==24)return null;
  const series=raw.cities.map((c:any)=>{
   if(typeof c.city!=='string'||!Array.isArray(c.observations)||c.observations.length>90||![7,30,60,90].includes(c.requested_days))throw Error();
   const start=Date.parse(c.requested_start_inclusive),end=Date.parse(c.requested_end_exclusive);
   if(!Number.isFinite(start)||end-start!==c.requested_days*86400000)throw Error();
   const points=c.observations.map((p:any)=>{
    if(!Number.isSafeInteger(p.timestamp_ms)||p.timestamp_ms<start||p.timestamp_ms>=end||!Number.isSafeInteger(p.avg_price)||p.avg_price<=0||!Number.isSafeInteger(p.volume)||p.volume<=0)throw Error();
    return {timestamp:p.timestamp_ms,price:p.avg_price,itemCount:p.volume};
   }).sort((a:HistoryObservation,b:HistoryObservation)=>a.timestamp-b.timestamp);
   if(new Set(points.map((p:HistoryObservation)=>p.timestamp)).size!==points.length)throw Error();
   return {city:c.city,points};
  });
  if(!series.length||!series.some((s:any)=>s.points.length))return null;
  return {item:raw.item,days:raw.cities[0].requested_days,series};
 }catch{return null;}
}
