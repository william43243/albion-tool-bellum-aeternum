import {NativeModules} from 'react-native';
import type {Server} from './api';
import type {ProductionAction, ProductionResponse, ProductionScenario, ProductionRanking, ProductionChainStep} from './productionTypes';

let occupied=false;
export type ProductionWeightMaterial={sourceId:string;enchantment:number|null;quantity:number};
export type ProductionWeightIndex={schemaVersion:number;provenance:Record<string,unknown>;entries:unknown[]};
export type ProductionWeightResult={status:'ok';unit:'source_unconfirmed';knownSubtotal:number;total:number|null;missing:{sourceId:string;enchantment:number|null;reason:string}[];materials:unknown[];provenance:Record<string,unknown>}|{status:'error';error:{code:string;message:string}};

/** Native worker; an index subset keeps bridge traffic bounded. */
export async function calculateProductionWeight(materials:ProductionWeightMaterial[],index:ProductionWeightIndex,signal?:AbortSignal):Promise<ProductionWeightResult> {
 const error=(code:string,message:string):ProductionWeightResult=>({status:'error',error:{code,message}});
 if(signal?.aborted)return error('CANCELLED','Weight analysis was cancelled.');
 const native=NativeModules.ProductionModule;
 if(!native?.calculateWeight||!native?.cancel)return error('UNAVAILABLE','Native weight engine unavailable.');
 if(occupied)return error('BUSY','Another production analysis is already running.');
 occupied=true;
 const cancel=()=>{try{void Promise.resolve(native.cancel()).catch(()=>{});}catch{}};
 signal?.addEventListener('abort',cancel,{once:true});
 try{
  if(signal?.aborted)return error('CANCELLED','Weight analysis was cancelled.');
  const raw=await native.calculateWeight(JSON.stringify(materials),JSON.stringify(index));
  if(signal?.aborted)return error('CANCELLED','Weight analysis was cancelled.');
  const value=JSON.parse(raw);
  if(value?.status==='error'&&typeof value.error?.code==='string'&&typeof value.error?.message==='string')return value;
  if(value?.status!=='ok'||value.unit!=='source_unconfirmed'||typeof value.knownSubtotal!=='number'||!Number.isFinite(value.knownSubtotal)||!(value.total===null||(typeof value.total==='number'&&Number.isFinite(value.total)))||!Array.isArray(value.missing)||!Array.isArray(value.materials)||!value.provenance||typeof value.provenance!=='object')return error('INVALID_RESPONSE','Unexpected weight result.');
  return value as ProductionWeightResult;
 }catch{return error('UNAVAILABLE','Unable to execute weight analysis.');}
 finally{signal?.removeEventListener('abort',cancel);occupied=false;}
}
/** One owner for the module-wide cancellation signal; never cancel another UI request. */
export async function runProduction(action:ProductionAction, request:{scenario:ProductionScenario}|{scenario:ProductionScenario;optimizeQuantity:true}|{scenarios:ProductionScenario[];ranking:ProductionRanking}|{steps:ProductionChainStep[];budget:number|null;availableFocus:number|null}, signal:AbortSignal|undefined, server:Server):Promise<ProductionResponse> {
 const error=(code:string,message:string):ProductionResponse=>({status:'error',action,error:{code,message}});
 if(signal?.aborted) return error('CANCELLED','Analysis was cancelled.');
 const native=NativeModules.ProductionModule;
 if(!native?.execute || !native?.cancel) return error('UNAVAILABLE','Native production engine unavailable.');
 if(occupied) return error('BUSY','Another production analysis is already running.');
 occupied=true;
 const cancel=()=>{try {void Promise.resolve(native.cancel()).catch(()=>{});} catch { /* Bridge unavailable; the result will be ignored. */ }};
 signal?.addEventListener('abort',cancel,{once:true});
 try {
  if(signal?.aborted) return error('CANCELLED','Analysis was cancelled.');
  const raw=await native.execute(action,JSON.stringify(request),server);
  if(signal?.aborted) return error('CANCELLED','Analysis was cancelled.');
  const value:unknown=JSON.parse(raw);
  if(!value || typeof value!=='object' || (value as any).action!==action || !['ok','error'].includes((value as any).status)) return error('INVALID_RESPONSE','Unexpected native response.');
  const v=value as any;
  if(v.status==='error' && (typeof v.error?.code!=='string' || typeof v.error?.message!=='string')) return error('INVALID_RESPONSE','Unexpected native error.');
  if(v.status==='ok' && !((v.result && typeof v.result==='object') || (Array.isArray(v.results) && Array.isArray(v.rejected)))) return error('INVALID_RESPONSE','Unexpected native result.');
  return v as ProductionResponse;
 } catch { return error('UNAVAILABLE','Unable to execute production analysis.'); }
 finally { signal?.removeEventListener('abort',cancel); occupied=false; }
}

/** A deliberate user action is required before any scenario enters the AI registry. */
export async function approveProductionScenario(scenario:ProductionScenario,server:Server):Promise<{status:'ok';scenarioId:string}|{status:'error';message:string}> {
 const native=NativeModules.ProductionModule;
 if(!native?.approveScenario)return {status:'error',message:'Production approval unavailable.'};
 try {
  const value=JSON.parse(await native.approveScenario(JSON.stringify(scenario),server));
  if(value?.status==='ok' && typeof value.scenarioId==='string' && value.scenarioId.length>0 && value.scenarioId.length<=160)return {status:'ok',scenarioId:value.scenarioId};
  return {status:'error',message:typeof value?.error?.message==='string'?value.error.message:'Scenario approval failed.'};
 } catch {return {status:'error',message:'Scenario approval unavailable.'};}
}
