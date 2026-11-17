/** Explicit, user-entered estimates. No recipe or market data is inferred. */
export type ProductionMaterial = { itemId: string; amountPerCraft: number; unitPrice: number; returnable: boolean };
export type ProductionPriceEvidence = {key:string;itemId:string;source:'AODP';server:string;city:string;quality:number;side:'purchaseImmediate'|'saleImmediate'|'saleOrderReference';value:number;observedAt:string;fetchedAt:number};
export type ProductionVolumeEvidence = {source:'AODP';server:string;itemId:string;city:string;quality:number;observedAt:number;fetchedAt:number;startMs:number;endMs:number;observedBuckets:number;requestedDays:number;observedUnits:number};
export type ProductionRecipeEvidence = {id:string;revision:string;silverCost:number|null;swapTransaction:boolean|null;cappedReturn:boolean;nonReturnableItemIds?:string[]};
export type ProductionMetadata = {outputItemId?:string;tier?:number;enchantment?:number;quality?:number;category?:string;buyCity?:string;sellCity?:string;productionCity?:string;saleSide?:'saleImmediate'|'saleOrderReference';recipe?:ProductionRecipeEvidence};
export type ProductionScenario = {
  label: string; quantity: number; outputPerCraft: number; materials: ProductionMaterial[];
  outputUnitPrice: number; returnRate: number; stationFeePerCraft: number; focusPerCraft: number;
  salesTaxRate: number; sellOrderFeeRate: number; budget: number | null; availableFocus: number | null;
  volumeObserved: number | null; volumeDays: number | null;
  priceEvidence?: ProductionPriceEvidence[];
  volumeEvidence?: ProductionVolumeEvidence;
  metadata?: ProductionMetadata;
};
export type ProductionRanking = 'profit' | 'roi' | 'focus' | 'liquidity';
export type ProductionChainStep = {outputItemId:string;scenario:ProductionScenario};
export type ProductionChainResult = {steps:{index:number;label:string;outputItemId:string;outputUnits:number;inputs:{itemId:string;grossUnits:number;internalUnits:number;externalUnits:number;externalPurchaseCost:number;expectedReturnedUnits:number;expectedReturnedValueAtInputPrice:number}[];stationFees:number;focusRequired:number}[];finalOutputItemId:string;finalOutputUnits:number;externalPurchaseCost:number;stationFees:number;sellOrderFee:number;salesTax:number;initialCapitalRequired:number;focusRequired:number;grossRevenueIfSold:number;cashFlowBeforeFinalSale:number;cashProfitIfFinalSale:number;expectedReturnAssetValueAtInputPrices:number;estimatedProfitIncludingReturns:number;realizedProfit:null;roiPercent:number|null;feasible:boolean;violations:string[]};
export type ProductionAction = 'calculate_crafting_profit' | 'find_profitable_crafts' | 'optimize_refining' | 'optimize_production_plan' | 'compare_crafting_routes' | 'analyze_market_liquidity' | 'calculate_focus_efficiency';
export type ProductionMaterialResult = {itemId:string;grossUnits:number;expectedReturnedUnits:number;expectedConsumedUnits:number;unitPrice:number;upfrontCost:number;expectedReturnedValue:number;expectedNetCost:number;returnable:boolean};
export type ProductionResult = {
 label:string; provenance:string; quantity:number; outputUnits:number; materials:ProductionMaterialResult[];
 grossMaterialCost:number; expectedReturnedValue:number; expectedMaterialCost:number; stationFees:number;
 initialCapitalRequired:number; expectedTotalCost:number; grossRevenue:number; salesTax:number; sellOrderFee:number;
 netProfit:number; profitPerUnit:number; roiPercent:number|null; roiBasis:string; focusRequired:number;
 silverPerFocus:number|null; silverPerFocusBasis:string; budget:number|null; availableFocus:number|null;
 feasible:boolean; violations:string[]; volumeObserved:number|null; volumeDays:number|null;
 observedUnitsPerDay:number|null; estimatedSaleDays:number|null; liquidityCaveat:string; assumptions:string[]; inputIndex?:number;
};
export type ProductionResponse =
 | {status:'ok';action:ProductionAction;scope:'explicit_linear_chain';result:ProductionChainResult}
 | {status:'ok';action:ProductionAction;scope:'single_scenario_quantity';result:{requestedQuantity:number;selectedQuantity:number;limitingFactors:string[];scenarioResult:ProductionResult|null}}
 | {status:'ok';action:ProductionAction;result:ProductionResult}
 | {status:'ok';action:ProductionAction;ranking:ProductionRanking;scope:string;results:ProductionResult[];rejected:{index:number;code:string;message?:string;violations?:string[]}[];warning:string}
 | {status:'error';action:ProductionAction;error:{code:string;message:string}};

const finite = (v:unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const optional = (v:unknown) => v === null || finite(v);
/** Reject invalid or partial imports; unknown numbers are not zeros. */
export function isProductionScenario(value:unknown): value is ProductionScenario {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
 const s=value as Record<string,unknown>;
 if (typeof s.label !== 'string' || !s.label.trim() || s.label.length>120 || !Number.isSafeInteger(s.quantity) || Number(s.quantity)<1 || Number(s.quantity)>1_000_000 || !Number.isSafeInteger(s.outputPerCraft) || Number(s.outputPerCraft)<1 || Number(s.outputPerCraft)>1_000_000) return false;
 if (!Array.isArray(s.materials) || !s.materials.length || s.materials.length>64) return false;
 const ids=new Set<string>();
 for (const raw of s.materials) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const m=raw as Record<string,unknown>;
  if (typeof m.itemId !== 'string' || !m.itemId.trim() || m.itemId.length>128 || ids.has(m.itemId.trim()) || !finite(m.amountPerCraft) || m.amountPerCraft<=0 || !finite(m.unitPrice) || m.unitPrice<=0 || typeof m.returnable !== 'boolean') return false;
  ids.add(m.itemId.trim());
 }
 if (!finite(s.outputUnitPrice) || s.outputUnitPrice<=0 || !finite(s.returnRate) || s.returnRate>=1 || !finite(s.stationFeePerCraft) || !finite(s.focusPerCraft) || !finite(s.salesTaxRate) || s.salesTaxRate>1 || !finite(s.sellOrderFeeRate) || s.sellOrderFeeRate>1) return false;
 if (!optional(s.budget) || !optional(s.availableFocus) || !optional(s.volumeObserved) || !optional(s.volumeDays)) return false;
 if ((s.volumeObserved === null)!==(s.volumeDays === null) || (typeof s.volumeDays === 'number' && s.volumeDays<=0)) return false;
 if(s.priceEvidence!==undefined && (!Array.isArray(s.priceEvidence) || !s.priceEvidence.every((e:unknown)=>{
  if(!e || typeof e!=='object' || Array.isArray(e))return false;
  const p=e as Record<string,unknown>;
  return typeof p.key==='string' && p.key.length<=140 && typeof p.itemId==='string' && /^[A-Z0-9_@.-]{1,100}$/.test(p.itemId) && p.source==='AODP' && ['americas','europe','asia'].includes(p.server as string) && ['Caerleon','Bridgewatch','Fort Sterling','Lymhurst','Thetford','Martlock','Brecilien'].includes(p.city as string) && Number.isInteger(p.quality) && Number(p.quality)>=1 && Number(p.quality)<=5 && ['purchaseImmediate','saleImmediate','saleOrderReference'].includes(p.side as string) && finite(p.value) && p.value>0 && typeof p.observedAt==='string' && finite(p.fetchedAt);
 }))) return false;
 if(s.volumeEvidence!==undefined){
  if(!s.volumeEvidence || typeof s.volumeEvidence!=='object' || Array.isArray(s.volumeEvidence))return false;
  const e=s.volumeEvidence as Record<string,unknown>;
  if(e.source!=='AODP'||!['americas','europe','asia'].includes(e.server as string)||typeof e.itemId!=='string'||!/^[A-Z0-9_@.-]{1,100}$/.test(e.itemId)||!['Caerleon','Bridgewatch','Fort Sterling','Lymhurst','Thetford','Martlock','Brecilien'].includes(e.city as string)||!Number.isInteger(e.quality)||Number(e.quality)<1||Number(e.quality)>5||!finite(e.observedAt)||!finite(e.fetchedAt)||!finite(e.startMs)||!finite(e.endMs)||!Number.isInteger(e.requestedDays)||Number(e.requestedDays)<1||Number(e.requestedDays)>90||e.observedBuckets!==e.requestedDays||!finite(e.observedUnits)||e.observedUnits!==s.volumeObserved||e.requestedDays!==s.volumeDays)return false;
 }
 if(s.metadata!==undefined){
  if(!s.metadata || typeof s.metadata!=='object' || Array.isArray(s.metadata))return false;
  const m=s.metadata as Record<string,unknown>, keys=['outputItemId','tier','enchantment','quality','category','buyCity','sellCity','productionCity','saleSide','recipe'];
  if(Object.keys(m).some(k=>!keys.includes(k)))return false;
  if(m.outputItemId!==undefined && (typeof m.outputItemId!=='string'||!/^[A-Z0-9_@.-]{1,100}$/.test(m.outputItemId)))return false;
  if(m.tier!==undefined && (!Number.isInteger(m.tier)||Number(m.tier)<1||Number(m.tier)>8))return false;
  if(m.enchantment!==undefined && (!Number.isInteger(m.enchantment)||Number(m.enchantment)<0||Number(m.enchantment)>4))return false;
  if(m.quality!==undefined && (!Number.isInteger(m.quality)||Number(m.quality)<1||Number(m.quality)>5))return false;
  if(m.category!==undefined && (typeof m.category!=='string'||!m.category.trim()||m.category.length>64))return false;
  if(m.buyCity!==undefined && !['Caerleon','Bridgewatch','Fort Sterling','Lymhurst','Thetford','Martlock','Brecilien'].includes(m.buyCity as string))return false;
  if(m.sellCity!==undefined && !['Caerleon','Bridgewatch','Fort Sterling','Lymhurst','Thetford','Martlock','Brecilien'].includes(m.sellCity as string))return false;
  if(m.productionCity!==undefined && !['Caerleon','Bridgewatch','Fort Sterling','Lymhurst','Thetford','Martlock','Brecilien'].includes(m.productionCity as string))return false;
  if(m.saleSide!==undefined && !['saleImmediate','saleOrderReference'].includes(m.saleSide as string))return false;
  if(m.saleSide==='saleImmediate' && s.sellOrderFeeRate!==0)return false;
  if(m.recipe!==undefined){
   if(!m.recipe || typeof m.recipe!=='object' || Array.isArray(m.recipe))return false;
   const r=m.recipe as Record<string,unknown>,keys=['id','revision','silverCost','swapTransaction','cappedReturn','nonReturnableItemIds'];
   if(Object.keys(r).some(k=>!keys.includes(k))||typeof r.id!=='string'||!r.id.trim()||r.id.length>200||typeof r.revision!=='string'||!r.revision.trim()||r.revision.length>128||!optional(r.silverCost)||(r.swapTransaction!==null&&typeof r.swapTransaction!=='boolean')||typeof r.cappedReturn!=='boolean'||r.swapTransaction===true||r.cappedReturn===true||(typeof r.silverCost==='number'&&r.silverCost>Number(s.stationFeePerCraft)))return false;
   if(r.nonReturnableItemIds!==undefined){
    if(!Array.isArray(r.nonReturnableItemIds)||r.nonReturnableItemIds.length>64||new Set(r.nonReturnableItemIds).size!==r.nonReturnableItemIds.length)return false;
    if(r.nonReturnableItemIds.some((id:unknown)=>typeof id!=='string'||!id.trim()||id.length>128||!s.materials || !(s.materials as Record<string,unknown>[]).some(x=>x.itemId===id&&x.returnable===false)))return false;
   }
  }
 }
 return true;
}
