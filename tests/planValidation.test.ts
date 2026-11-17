import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../assets/plan/catalog.json';
import { provenance, zoneById } from '../lib/worldMap';
import { PLAN_CATALOG_SHA256 } from '../lib/planCatalogRevision';
import { PlanRequest, validatePlanResponse, decodePlanRequest } from '../lib/planValidation';
import { parseMapToolResult } from '../lib/mapToolResult';

// Test-only facts: these numbers are synthetic and never written to the catalogue.
const fixture = catalog as unknown as {zone_occurrences:{zone_id:string;resource_id:string;mob_id:null;tier:number;enchantment:null;spawn_type:string;confidence:string;theoretical_quantity:{value:number;unit:string;scope:string};source_refs:string[]}[];zone_totals:{zone_id:string;value:number}[]};
fixture.zone_occurrences.push({zone_id:'4000',resource_id:'T4_ROCK',mob_id:null,tier:4,enchantment:null,spawn_type:'node',confidence:'synthetic',theoretical_quantity:{value:20,unit:'nodes',scope:'synthetic'},source_refs:[catalog.sources[0].id]});
fixture.zone_totals.push({zone_id:'4000',value:100});
const occ=fixture.zone_occurrences[0], zone=zoneById.get(occ.zone_id)!;
const entry=catalog.resources.find(e=>e.resource_id===occ.resource_id)!;
const url=(id:string)=>catalog.sources.find(s=>s.id===id)!.url;
const refs=[...new Set([...entry.source_refs,...occ.source_refs])].map(url);
const request:PlanRequest={query:entry.name,kind:'resource',tier:entry.tier,enchantment:null,startZoneId:zone.id,excludedRisks:[],policy:'fewest_transitions'};
const wire={...request,tier:request.tier??0,enchantment:-1};
const total=fixture.zone_totals.find(t=>t.zone_id===occ.zone_id)!;
function payload() { return {status:'ok',warnings:['Static data'],mapRevision:provenance.revision,schemaVersion:catalog.schema_version,catalogFingerprint:PLAN_CATALOG_SHA256,request:wire,
 results:[{zoneId:zone.id,zoneName:zone.name,biome:zone.biome,risk:zone.risk,tier:zone.tier,resourceTier:occ.tier,matchedName:entry.name,resourceId:entry.resource_id,mobId:null,spawnType:occ.spawn_type,enchantment:occ.enchantment,evidence:'documented',confidence:occ.confidence,theoreticalQuantity:occ.theoretical_quantity,theoreticalProportion:{numerator:occ.theoretical_quantity!.value,denominator:total.value,percent:100*occ.theoretical_quantity!.value/total.value,basis:'share_of_documented_zone_nodes_all_tiers_and_enchantments'},sourceRefs:refs,route:{status:'found',zoneIds:[zone.id],transitions:0}}]}; }

test('valid documented occurrence and matching map route can be displayed',()=>{
 const value=payload(); assert.equal(validatePlanResponse(value,request).status,'ok');
 assert.deepEqual(parseMapToolResult('plan_gathering',JSON.stringify(value)),{type:'plan_route',from:zone.id,to:zone.id,policy:'fewest_transitions',excludedRisks:[]});
 assert.deepEqual(decodePlanRequest(wire),request);
});
test('catalogue, occurrence and route mutations reject the entire response and chat map',()=>{
 const mutations:Array<(p:ReturnType<typeof payload>)=>void>=[
  p=>{p.catalogFingerprint='0'.repeat(64)}, p=>{p.schemaVersion='stale'}, p=>{p.mapRevision='stale'},
  p=>{p.results[0].resourceId='T8_ORE'}, p=>{p.results[0].resourceTier=8}, p=>{p.results[0].matchedName='Unknown'},
  p=>{p.results[0].spawnType='wrong'}, p=>{p.results[0].confidence='verified'}, p=>{p.results[0].sourceRefs=['https://example.com']},
  p=>{p.results[0].theoreticalQuantity={...p.results[0].theoreticalQuantity!,value:99999}},
  p=>{p.results[0].theoreticalQuantity={...p.results[0].theoreticalQuantity!,unit:'wrong'}},
  p=>{p.results[0].theoreticalQuantity={...p.results[0].theoreticalQuantity!,scope:'wrong'}},
  p=>{p.results[0].theoreticalProportion.percent=99},
  p=>{p.results[0].theoreticalProportion.denominator++},
  p=>{p.results[0].route={status:'found',zoneIds:['fake'],transitions:0}},
  p=>{p.results.push({...p.results[0],resourceId:'fake'})}, p=>{p.results.push({...p.results[0]})},
 ];
 for(const mutate of mutations){const value=payload();mutate(value);assert.equal(validatePlanResponse(value,request).status,'data_error');assert.equal(parseMapToolResult('plan_gathering',JSON.stringify(value)),null);}
});
test('request filters, malformed empty responses and unreachable routes are not silently accepted',()=>{
 assert.equal(validatePlanResponse(payload(),{...request,kind:'mob'}).status,'data_error');
 assert.equal(validatePlanResponse(payload(),{...request,tier:8}).status,'data_error');
 assert.equal(validatePlanResponse(payload(),{...request,excludedRisks:[zone.risk]}).status,'data_error');
 const v=payload(); v.status='no_data';assert.equal(validatePlanResponse(v,request).status,'data_error');
 const route=payload();route.results[0].route={status:'unreachable',zoneIds:[zone.id],transitions:0};assert.equal(validatePlanResponse(route,request).status,'data_error');
 assert.equal(decodePlanRequest({...wire,excludedRisks:['madeup']}),null);
});
