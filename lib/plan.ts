import { NativeModules } from 'react-native';
import { PlanRequest, PlanResponse, validatePlanResponse } from './planValidation';
export { validatePlanResponse } from './planValidation';
export type { PlanRequest, PlanResponse, PlanResult } from './planValidation';

export async function planSearch(request:PlanRequest):Promise<PlanResponse> {
 const module=NativeModules.PlanModule;
 if(!module?.search) return {status:'data_error',results:[],warnings:['Native planner unavailable.']};
 try {
  const raw=await module.search(JSON.stringify({...request,tier:request.tier??0,enchantment:request.enchantment??-1}));
  return validatePlanResponse(JSON.parse(raw),request);
 } catch { return {status:'data_error',results:[],warnings:['Unable to validate planner data.']}; }
}
