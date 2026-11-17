import type {ProductionWeightIndex,ProductionWeightMaterial} from './production';
import type {CatalogueRecipe} from './productionRecipes';
import type {ProductionScenario} from './productionTypes';

type WeightEntry={sourceId:string;enchantment:number|null;weight:number|null;origin:'item'|'enchantment'};
type SourceWeightIndex=Omit<ProductionWeightIndex,'provenance'|'entries'> & {provenance:Record<string,unknown>&{sourceCommit:string};entries:WeightEntry[]};
type Selection={materials:ProductionWeightMaterial[];index:ProductionWeightIndex}|{error:'NO_RECIPE'|'REVISION_MISMATCH'|'MATERIAL_MISMATCH'|'INVALID_QUANTITY'};

/** Match exact catalogue identities; market IDs are never reverse-engineered into source IDs. */
export function selectProductionWeight(scenario:{metadata?:ProductionScenario['metadata'];materials:{itemId:string;amountPerCraft:number}[]},quantity:number,recipes:readonly CatalogueRecipe[],recipeRevision:string,index:SourceWeightIndex):Selection {
 const provenance=scenario.metadata?.recipe;
 if(!provenance)return {error:'NO_RECIPE'};
 if(provenance.revision!==recipeRevision||index.schemaVersion!==1||index.provenance.sourceCommit!==recipeRevision)return {error:'REVISION_MISMATCH'};
 const matches=recipes.filter(recipe=>recipe.id===provenance.id);
 if(matches.length!==1)return {error:'NO_RECIPE'};
 const recipe=matches[0];
 if(scenario.metadata?.outputItemId!==recipe.itemIdCandidate)return {error:'MATERIAL_MISMATCH'};
 if(recipe.materials.length!==scenario.materials.length||!recipe.materials.length)return {error:'MATERIAL_MISMATCH'};
 if(!Number.isSafeInteger(quantity)||quantity<1)return {error:'INVALID_QUANTITY'};
 const keys=new Set<string>(),materials:ProductionWeightMaterial[]=[];
 for(const input of scenario.materials){
  const source=recipe.materials.filter(row=>row.itemIdCandidate===input.itemId);
  if(source.length!==1||keys.has(input.itemId))return {error:'MATERIAL_MISMATCH'};
  keys.add(input.itemId);
  const amount=quantity*input.amountPerCraft;
  if(!Number.isFinite(amount)||amount<=0||amount>1e12)return {error:'INVALID_QUANTITY'};
  materials.push({sourceId:source[0].sourceId,enchantment:source[0].enchantment,quantity:amount});
 }
 const identities=new Set(materials.map(m=>JSON.stringify([m.sourceId,m.enchantment])));
 return {materials,index:{schemaVersion:index.schemaVersion,provenance:index.provenance,entries:index.entries.filter(e=>identities.has(JSON.stringify([e.sourceId,e.enchantment])))}};
}
