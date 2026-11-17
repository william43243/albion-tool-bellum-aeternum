import {isProductionScenario, type ProductionChainStep} from './productionTypes';
export type SavedProductionChain = {id:string;createdAt:string;steps:ProductionChainStep[];budget:number|null;availableFocus:number|null};
type Storage={read:()=>Promise<string|null>;write:(raw:string)=>Promise<void>};
type Envelope={version:1;chains:SavedProductionChain[];[key:string]:unknown};
const optional=(value:unknown)=>value===null || (typeof value==='number' && Number.isFinite(value) && value>=0 && value<=Number.MAX_SAFE_INTEGER);
function valid(v:unknown):v is SavedProductionChain {
 if(!v || typeof v!=='object' || Array.isArray(v))return false;
 const c=v as Record<string,unknown>;
 return typeof c.id==='string' && typeof c.createdAt==='string' && optional(c.budget) && optional(c.availableFocus) && Array.isArray(c.steps) && c.steps.length>=2 && c.steps.length<=12 && c.steps.every((step:unknown)=>{
  if(!step || typeof step!=='object' || Array.isArray(step))return false;
  const e=step as Record<string,unknown>;
  return typeof e.outputItemId==='string' && !!e.outputItemId.trim() && e.outputItemId.length<=128 && isProductionScenario(e.scenario) && e.scenario.budget===null && e.scenario.availableFocus===null;
 });
}
function parse(raw:string|null):Envelope {
 if(raw===null)return {version:1,chains:[]};
 let value:unknown;try{value=JSON.parse(raw);}catch{throw Error('CHAIN_STORAGE_UNREADABLE');}
 if(!value || typeof value!=='object' || Array.isArray(value))throw Error('CHAIN_STORAGE_UNREADABLE');
 const e=value as Record<string,unknown>;
 if(e.version!==1 || !Array.isArray(e.chains) || e.chains.length>100 || !e.chains.every(valid))throw Error('CHAIN_STORAGE_UNREADABLE');
 return e as Envelope;
}
export function createProductionChainStore(storage:Storage){
 let queue=Promise.resolve();
 const enqueue=<T>(work:()=>Promise<T>):Promise<T>=>{const result=queue.then(work);queue=result.then(()=>{},()=>{});return result;};
 return {
  list:()=>enqueue(async()=>parse(await storage.read()).chains),
  save:(steps:ProductionChainStep[],budget:number|null,availableFocus:number|null)=>enqueue(async()=>{
   const envelope=parse(await storage.read());if(envelope.chains.length>=100)throw Error('CHAIN_LIMIT');
   const createdAt=new Date().toISOString();let id=createdAt;let suffix=0;while(envelope.chains.some(c=>c.id===id))id=`${createdAt}-${++suffix}`;
   const chain={id,createdAt,steps:JSON.parse(JSON.stringify(steps)),budget,availableFocus};
   if(!valid(chain))throw Error('INVALID_CHAIN');
   await storage.write(JSON.stringify({...envelope,chains:[...envelope.chains,chain]}));return chain;
  }),
 };
}
