import { MapAction, planWorldRoute } from './worldMapRoutes';
import { zoneById } from './worldMap';
import { decodePlanRequest, validatePlanResponse } from './planValidation';
export function parseMapToolResult(name: string, raw?: string): MapAction | null {
 if(!raw || raw.length>131072 || !['show_zone','get_route','plan_gathering'].includes(name))return null;
 try {
  const result=JSON.parse(raw);if(result.error)return null;
  if(name==='plan_gathering') {
   const req=decodePlanRequest(result.request);if(!req)return null;
   const checked=validatePlanResponse(result,req);if(checked.status!=='ok')return null;
   const first=checked.results.find(r=>r.route.status==='found');if(!first)return null;
   return {type:'plan_route',from:req.startZoneId,to:first.zoneId,policy:req.policy,excludedRisks:req.excludedRisks};
  }
  const a=result.map_action;if(!a||typeof a!=='object')return null;
  if(name==='show_zone'&&a.type==='focus_zone'&&typeof a.zoneId==='string'&&zoneById.has(a.zoneId))return {type:'focus_zone',zoneId:a.zoneId};
  if(name==='get_route'&&a.type==='plan_route'&&typeof a.from==='string'&&typeof a.to==='string'&&['fewest_transitions','fewest_lethal'].includes(a.policy)){
   const route=planWorldRoute(a.from,a.to,a.policy);
   // Refuse a native/UI dataset mismatch instead of drawing a different itinerary.
   if(route.status!=='found'||!Array.isArray(result.path)||route.zoneIds.length!==result.path.length||route.zoneIds.some((id,i)=>result.path[i]?.id!==id)||result.transitions!==route.transitions)return null;
   return {type:'plan_route',from:a.from,to:a.to,policy:a.policy};
  }
 }catch{}
 return null;
}
