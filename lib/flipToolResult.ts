import {parseMapToolResult} from './mapToolResult';
import {zoneById} from './worldMap';

export interface FlipPreviewCandidate {
 rank:number;buy_city:string;sell_city:string;quantity:number;buy_price:number;sell_price:number;
 purchase_total:number;gross_revenue:number;buy_setup_fee:number;sell_setup_fee:number;sales_tax:number;net_profit:number;
 buy_age_minutes:number;sell_age_minutes:number;route:Record<string,unknown>|null;
}
export interface FlipPreview {
 item:string;quantity:number;status:string;sort_by:string;excludedCount:number;eligible_count:number;
 assumptions:{premium:boolean;buy_mode:'instant'|'order';sell_mode:'instant'|'order';max_age_minutes:number};
 candidates:FlipPreviewCandidate[];
}
const integer=(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):value is number=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const fee=(amount:number,numerator:number,denominator:number)=>Number((BigInt(amount)*BigInt(numerator)+BigInt(denominator-1))/BigInt(denominator));
export function parseFlipToolResult(name:string,raw?:string):FlipPreview|null{
 if(name!=='compare_flip_routes'||!raw||raw.length>131072)return null;
 try{
  const r=JSON.parse(raw),a=r.assumptions;
  if(r.error||typeof r.item!=='string'||!integer(r.quantity,1,100000)||!integer(r.eligible_count,0,49)||!Array.isArray(r.candidates)||r.candidates.length>6||!Array.isArray(r.excluded)||r.excluded.length>49)return null;
  if(!['positive_estimates','no_positive_estimate','insufficient_fresh_data_or_routes'].includes(r.status)||!['profit','profit_per_transition','distance','least_risk'].includes(r.sort_by))return null;
  if(!a||typeof a.premium!=='boolean'||!['instant','order'].includes(a.buy_mode)||!['instant','order'].includes(a.sell_mode)||!integer(a.max_age_minutes,1,1440)||!integer(r.compared_at_ms,1))return null;
  for(const [i,c] of r.candidates.entries()){
   if(c.rank!==i+1||c.quantity!==r.quantity)return null;
   if(c.buy_city===c.sell_city){if(c.route!==null||!['Caerleon','Bridgewatch','Fort Sterling','Lymhurst','Thetford','Martlock','Brecilien'].includes(c.buy_city))return null;}
   else {const action=parseMapToolResult('get_route',JSON.stringify(c.route));
    if(!action||action.type!=='plan_route'||zoneById.get(action.from)?.name!==c.buy_city||zoneById.get(action.to)?.name!==c.sell_city)return null;}
   if(!integer(c.buy_price,1,2147483647)||!integer(c.sell_price,1,2147483647)||!integer(c.net_profit,-Number.MAX_SAFE_INTEGER))return null;
   if(c.purchase_total!==c.buy_price*c.quantity||c.gross_revenue!==c.sell_price*c.quantity)return null;
   if(c.buy_setup_fee!==(a.buy_mode==='order'?fee(c.purchase_total,25,1000):0)||c.sell_setup_fee!==(a.sell_mode==='order'?fee(c.gross_revenue,25,1000):0)||c.sales_tax!==fee(c.gross_revenue,a.premium?4:8,100))return null;
   if(c.net_profit!==c.gross_revenue-c.purchase_total-c.buy_setup_fee-c.sell_setup_fee-c.sales_tax)return null;
   for(const side of ['buy','sell']){
    const stamp=c[`${side}_observed_at_ms`];
    if(!integer(stamp,1)||stamp>r.compared_at_ms+300000||r.compared_at_ms-stamp>a.max_age_minutes*60000)return null;
    if(c[`${side}_age_minutes`]!==Math.floor(Math.max(0,r.compared_at_ms-stamp)/60000))return null;
   }
  }
  if(r.status==='positive_estimates'&&!r.candidates.some((c:FlipPreviewCandidate)=>c.net_profit>0))return null;
  if(r.status==='no_positive_estimate'&&(!r.candidates.length||r.candidates.some((c:FlipPreviewCandidate)=>c.net_profit>0)))return null;
  if(r.status==='insufficient_fresh_data_or_routes'&&r.candidates.length)return null;
  return {...r,excludedCount:r.excluded.length};
 }catch{return null;}
}
