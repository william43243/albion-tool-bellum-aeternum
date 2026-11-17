import type {PlanRequest} from './plan';
import type {ZoneRisk} from './worldMap';

/** Parse only the documented structured command; never ask a model to interpret it. */
export function parsePlanCommand(text:string, resolveStart:(nameOrId:string)=>string|undefined):PlanRequest|null {
 if(text.length>4096)return null;
 const match=/^\/plan\s+([\s\S]+)$/i.exec(text.trim());
 if(!match)return null;
 try {
  const obj:unknown=JSON.parse(match[1]);
  if(!obj||typeof obj!=='object'||Array.isArray(obj))return null;
  const p=obj as Record<string,unknown>;
  const fields=['query','kind','tier','enchantment','startZoneId','excludedRisks','policy'];
  if(Object.keys(p).length!==fields.length||fields.some(k=>!(k in p)))return null;
  if(typeof p.query!=='string'||p.query.length>120||typeof p.startZoneId!=='string'||!p.startZoneId.trim()||p.startZoneId.length>120)return null;
  if(p.kind!=='resource'&&p.kind!=='creature'&&p.kind!=='mob')return null;
  if(p.policy!=='fewest_transitions'&&p.policy!=='fewest_lethal')return null;
  if(p.tier!==null&&(!Number.isInteger(p.tier)||Number(p.tier)<1||Number(p.tier)>8))return null;
  if(p.enchantment!==null&&(!Number.isInteger(p.enchantment)||Number(p.enchantment)<0||Number(p.enchantment)>4))return null;
  const validRisks=['blue','yellow','red','black','city','unknown'];
  if(!Array.isArray(p.excludedRisks)||p.excludedRisks.some(r=>typeof r!=='string'||!validRisks.includes(r))||new Set(p.excludedRisks).size!==p.excludedRisks.length)return null;
  const start=resolveStart(p.startZoneId.trim());if(!start)return null;
  return {query:p.query.trim(),kind:p.kind,tier:p.tier as number|null,enchantment:p.enchantment as number|null,startZoneId:start,excludedRisks:p.excludedRisks as ZoneRisk[],policy:p.policy};
 } catch {return null;}
}
