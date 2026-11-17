import type {ProductionScenario} from './productionTypes';
import {isProductionScenario} from './productionTypes';

export type SavedProductionPlan = {id:string;createdAt:string;scenario:ProductionScenario};
type Storage = {read:()=>Promise<string|null>;write:(value:string)=>Promise<void>};
type Envelope = {version:1;plans:SavedProductionPlan[];[key:string]:unknown};
function parse(raw:string|null):Envelope {
 if(raw===null) return {version:1,plans:[]};
 let value:unknown; try { value=JSON.parse(raw); } catch { throw Error('PLAN_STORAGE_UNREADABLE'); }
 if(!value || typeof value!=='object' || Array.isArray(value)) throw Error('PLAN_STORAGE_UNREADABLE');
 const e=value as Record<string,unknown>;
 if(e.version!==1 || !Array.isArray(e.plans) || e.plans.length>100 || !e.plans.every(p=>p && typeof p==='object' && typeof p.id==='string' && typeof p.createdAt==='string' && isProductionScenario(p.scenario))) throw Error('PLAN_STORAGE_UNREADABLE');
 return e as Envelope;
}
/** Refuse to overwrite unreadable/newer data, and serialize read-modify-write. */
export function createProductionPlanStore(storage:Storage) {
 let queue=Promise.resolve();
 const enqueue=<T>(work:()=>Promise<T>):Promise<T>=>{ const result=queue.then(work); queue=result.then(()=>{},()=>{}); return result; };
 return {
  list:()=>enqueue(async()=>parse(await storage.read()).plans),
  save:(scenario:ProductionScenario)=>enqueue(async()=>{
   if(!isProductionScenario(scenario)) throw Error('INVALID_PLAN');
   const existing=parse(await storage.read());
   if(existing.plans.length>=100) throw Error('PLAN_LIMIT');
   const createdAt=new Date().toISOString();
   let id=createdAt; let suffix=0; while(existing.plans.some(p=>p.id===id)) id=`${createdAt}-${++suffix}`;
   const plan:SavedProductionPlan={id,createdAt,scenario:JSON.parse(JSON.stringify(scenario))};
   await storage.write(JSON.stringify({...existing,plans:[...existing.plans,plan]}));
   return plan;
  }),
 };
}
