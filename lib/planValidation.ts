import catalogData from '../assets/plan/catalog.json';
import { provenance, zoneById, zones, ZoneRisk } from './worldMap';
import { planWorldRoute, RoutePolicy } from './worldMapRoutes';
import { PLAN_CATALOG_SHA256 } from './planCatalogRevision';

export type PlanRequest = {query:string; kind:'resource'|'creature'|'mob'; tier:number|null; enchantment:number|null; startZoneId:string; excludedRisks:ZoneRisk[]; policy:RoutePolicy};
export type PlanResult = {zoneId:string; zoneName:string; biome:string; risk:ZoneRisk; tier:number; resourceTier:number|null; matchedName:string; resourceId:string|null; mobId:string|null; spawnType:string; enchantment:number|null; evidence:'documented'; confidence:string; theoreticalQuantity:null|{value:number;unit:string;scope:string}; theoreticalProportion:null|{percent:number;numerator:number;denominator:number;basis:string}; sourceRefs:string[]; route:{status:'found'|'unreachable';zoneIds:string[];transitions:number|null}};
export type PlanResponse = {status:'ok'|'no_data'|'invalid_request'|'data_error'; results:PlanResult[]; warnings:string[]; mapRevision?:string; schemaVersion?:string; catalogFingerprint?:string};

type Entry = {resource_id?:string|null; mob_id?:string|null; name:string; category:string; tier:number|null; source_refs:string[]};
type Occurrence = {zone_id:string; resource_id:string|null; mob_id:string|null; tier:number|null; enchantment:number|null; spawn_type:string; confidence:string; source_refs:string[]; theoretical_quantity:null|{value:number;unit:string;scope:string}};
const catalog = catalogData as {schema_version:string; resources:Entry[]; mobs:Entry[]; zone_occurrences:Occurrence[]; zone_totals:{zone_id:string;value:number}[]; sources:{id:string;url:string}[]};
const risks:ZoneRisk[]=['blue','yellow','red','black','city','unknown'];
const bad = ():PlanResponse => ({status:'data_error',results:[],warnings:['Map or planner data is inconsistent.']});
const normalize = (s:string) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const aliases:Record<string,string[]> = {ore:['ore','minerai','mineral'],wood:['wood','bois','madera'],stone:['stone','rock','pierre','piedra'],fiber:['fiber','fibre','fibra'],hide:['hide','skin','peau','cuir','piel']};
const sameArray = (a:unknown,b:string[]) => Array.isArray(a) && a.length===b.length && a.every((v,i)=>v===b[i]);
const originFor = (value:string) => zoneById.get(value.trim()) ?? zones.find(z=>normalize(z.name)===normalize(value));

/** Convert the native tool's explicitly sent sentinel values into a validated UI request. */
export function decodePlanRequest(value:unknown):PlanRequest|null {
 if (!value || typeof value!=='object') return null;
 const p=value as Record<string,unknown>;
 if(typeof p.query!=='string'||p.query.trim().length>120||typeof p.startZoneId!=='string'||!p.startZoneId.trim()||p.startZoneId.trim().length>120||!['resource','creature','mob'].includes(p.kind as string)||!['fewest_transitions','fewest_lethal'].includes(p.policy as string)||!Number.isInteger(p.tier)||Number(p.tier)<0||Number(p.tier)>8||!Number.isInteger(p.enchantment)||Number(p.enchantment)<-1||Number(p.enchantment)>4||!Array.isArray(p.excludedRisks)||!p.excludedRisks.every(r=>risks.includes(r)))return null;
 return {query:p.query,kind:p.kind as PlanRequest['kind'],tier:p.tier===0?null:p.tier as number,enchantment:p.enchantment===-1?null:p.enchantment as number,startZoneId:p.startZoneId,excludedRisks:p.excludedRisks as ZoneRisk[],policy:p.policy as RoutePolicy};
}

/** Refuse a whole native result if either the map or any documented fact differs. */
export function validatePlanResponse(value:unknown, request:PlanRequest):PlanResponse {
 try {
  if(!value || typeof value!=='object')return bad();
  const v=value as PlanResponse & {request?:unknown};
  if(!Array.isArray(v.results)||!Array.isArray(v.warnings)||!v.warnings.every(x=>typeof x==='string')||!['ok','no_data','invalid_request','data_error'].includes(v.status))return bad();
  if(v.status==='data_error')return bad();
  if(v.mapRevision!==provenance.revision||v.schemaVersion!==catalog.schema_version||v.catalogFingerprint!==PLAN_CATALOG_SHA256)return bad();
  if((v.status==='ok') !== (v.results.length>0))return bad();
  const start=originFor(request.startZoneId);
  if(v.status!=='ok')return v;
  if(!start || request.excludedRisks.includes(start.risk))return bad();
  const echo=decodePlanRequest(v.request);
  if(!echo||echo.startZoneId!==start.id||echo.query!==request.query||echo.kind!==request.kind||echo.tier!==request.tier||echo.enchantment!==request.enchantment||echo.policy!==request.policy||!sameArray([...echo.excludedRisks].sort(),[...new Set(request.excludedRisks)].sort()))return bad();
  const sources=new Map(catalog.sources.map(s=>[s.id,s.url]));
  const seen=new Set<string>();
  for(const r of v.results) {
   const z=zoneById.get(r.zoneId);
   if(!z||z.name!==r.zoneName||z.risk!==r.risk||z.biome!==r.biome||z.tier!==r.tier||request.excludedRisks.includes(z.risk))return bad();
   const entries=request.kind==='resource'?catalog.resources:catalog.mobs.filter(m=>m.category===(request.kind==='creature'?'harvestable':'hostile'));
   const entry=entries.find(e=>request.kind==='resource'?e.resource_id===r.resourceId:e.mob_id===r.mobId);
   if(!entry||entry.name!==r.matchedName||(request.tier!==null && entry.tier!==request.tier))return bad();
   const q=normalize(request.query), id=normalize((request.kind==='resource'?entry.resource_id:entry.mob_id)??'');
   if(q && !normalize(entry.name).includes(q) && !id.includes(q) && !(aliases[entry.category]??[]).includes(q))return bad();
   const matches=catalog.zone_occurrences.filter(o=>o.zone_id===r.zoneId&&o.resource_id===r.resourceId&&o.mob_id===r.mobId&&o.tier===r.resourceTier&&o.enchantment===r.enchantment&&o.spawn_type===r.spawnType);
   if(matches.length!==1)return bad();
   const occ=matches[0], key=JSON.stringify([occ.zone_id,occ.resource_id,occ.mob_id,occ.tier,occ.enchantment,occ.spawn_type]);
   if((entry.tier!==null && occ.tier!==entry.tier)||(request.tier!==null && occ.tier!==request.tier)||(request.enchantment!==null && occ.enchantment!==request.enchantment))return bad();
   if(seen.has(key))return bad();seen.add(key);
   const a=r.theoreticalQuantity,b=occ.theoretical_quantity;
   if(r.evidence!=='documented'||r.confidence!==occ.confidence||(b===null?a!==null:!a||a.value!==b.value||a.unit!==b.unit||a.scope!==b.scope))return bad();
   const total=catalog.zone_totals.find(t=>t.zone_id===r.zoneId);
   const proportion=r.theoreticalProportion;
   if(!total || !occ.resource_id) { if(proportion!==null)return bad(); }
   else if(!b || !proportion || proportion.numerator!==b.value || proportion.denominator!==total.value || proportion.basis!=='share_of_documented_zone_nodes_all_tiers_and_enchantments' || !Number.isFinite(proportion.percent) || Math.abs(proportion.percent-100*b.value/total.value)>1e-9)return bad();
   const refs=[...new Set([...entry.source_refs,...occ.source_refs])].map(id=>sources.get(id));
   if(refs.some(x=>!x)||!sameArray(r.sourceRefs,refs as string[]))return bad();
   if(!r.route||!Array.isArray(r.route.zoneIds))return bad();
   const route=planWorldRoute(start.id,z.id,request.policy,zones,request.excludedRisks);
   if(route.status==='found') {
    if(r.route.status!=='found'||r.route.transitions!==route.transitions||!sameArray(r.route.zoneIds,route.zoneIds))return bad();
   } else if(r.route.status!=='unreachable'||r.route.transitions!==null||r.route.zoneIds.length!==0)return bad();
  }
  return v;
 } catch { return bad(); }
}
