/** Fields published by the locally generated, versioned recipe catalogue. */
export type CatalogueRecipe = {
 id:string;sourceId:string;itemIdCandidate:string;itemType:string;tier:number|null;enchantment:number|null;category:string|null;subcategories:string[];
 outputQuantity:number|null;focusBase:number|null;silverCost:number|null;swapTransaction:boolean|null;
 materials:{sourceId:string;itemIdCandidate:string;enchantment:number|null;quantity:number;maxReturnAmount:number|null;returnable:false|null}[];
};

export function searchProductionRecipes(recipes:readonly CatalogueRecipe[],query:string,offset:number,limit:number,names:ReadonlyMap<string,string>):CatalogueRecipe[] {
 const q=query.trim().toLocaleLowerCase();
 if(q.length<2)return [];
 const found:CatalogueRecipe[]=[];let skipped=0;
 for(const recipe of recipes){
  if(!recipe.itemIdCandidate.toLocaleLowerCase().includes(q) && !recipe.sourceId.toLocaleLowerCase().includes(q) && !(names.get(recipe.itemIdCandidate)??names.get(recipe.sourceId)??'').toLocaleLowerCase().includes(q))continue;
  if(skipped++<offset)continue;
  found.push(recipe);if(found.length>=limit)break;
 }
 return found;
}

/** The shared engine cannot model a swap or a capped return; do not silently omit either. */
export function unsupportedRecipe(recipe:CatalogueRecipe):boolean {
 return recipe.swapTransaction===true || recipe.materials.some(m=>m.maxReturnAmount!==null && m.maxReturnAmount>0);
}

import type {ProductionScenario} from './productionTypes';

/** Reconcile a linked scenario with the pinned local catalogue, never a declared list alone. */
export function reconcileProductionRecipe(s:ProductionScenario,recipes:readonly CatalogueRecipe[],revision:string):ProductionScenario|null {
 const evidence=s.metadata?.recipe;
 if(!evidence)return s;
 if(evidence.revision!==revision)return null;
 const matches=recipes.filter(r=>r.id===evidence.id);
 if(matches.length!==1)return null;
 const recipe=matches[0];
 if(unsupportedRecipe(recipe)||s.metadata?.outputItemId!==recipe.itemIdCandidate||!recipe.materials.length||recipe.materials.length!==s.materials.length)return null;
 if(recipe.outputQuantity!==null&&s.outputPerCraft!==recipe.outputQuantity)return null;
 const ids=new Set<string>(),locked:string[]=[];
 for(const m of s.materials){
  const source=recipe.materials.filter(r=>r.itemIdCandidate===m.itemId);
  if(source.length!==1||ids.has(m.itemId))return null;
  if(m.amountPerCraft!==source[0].quantity)return null;
  ids.add(m.itemId);
  if(source[0].maxReturnAmount===0){if(m.returnable)return null;locked.push(m.itemId);}
 }
 if(recipe.silverCost!==null&&s.stationFeePerCraft<recipe.silverCost)return null;
 return {...s,metadata:{...s.metadata,recipe:{id:recipe.id,revision,silverCost:recipe.silverCost,swapTransaction:recipe.swapTransaction,cappedReturn:false,nonReturnableItemIds:locked}}};
}
