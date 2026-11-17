import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NumberInput from '../../components/NumberInput';
import {COLORS} from '../../constants/theme';
import type {Language} from '../../lib/i18n';
import {CITIES, type City, type Quality, type Server} from '../../lib/api';
import {parseAodpTimestamp} from '../../lib/aodpTime';
import {productionMarket} from '../../lib/productionMarket';
import {createProductionTaskGate} from '../../lib/productionTaskGate';
import {invalidProductionSections} from '../../lib/productionFieldErrors';
import {selectProductionWeight} from '../../lib/productionWeightSelection';
import {getItemsByIds} from '../../lib/items';
import {reconcileProductionRecipe, searchProductionRecipes, unsupportedRecipe, type CatalogueRecipe} from '../../lib/productionRecipes';
import {parseUserNumber} from '../../lib/numberParsing';
import {approveProductionScenario, calculateProductionWeight, runProduction, type ProductionWeightIndex, type ProductionWeightResult} from '../../lib/production';
import {createProductionPlanStore, type SavedProductionPlan} from '../../lib/productionPlans';
import {createProductionChainStore, type SavedProductionChain} from '../../lib/productionChains';
import {isProductionScenario, type ProductionAction, type ProductionRanking, type ProductionResponse, type ProductionResult, type ProductionScenario, type ProductionPriceEvidence, type ProductionVolumeEvidence, type ProductionMetadata, type ProductionChainStep, type ProductionChainResult} from '../../lib/productionTypes';

export type ProductionIncoming = {sequence:number;scenario:ProductionScenario};
export type ProductionScreenProps = {lang:Language;server:Server;active?:boolean;onTransfer?:(scenario:ProductionScenario)=>void;incoming?:ProductionIncoming};
type MaterialDraft = {itemId:string;amount:string;price:string;returnable:boolean|null};
type Draft = {label:string;quantity:string;output:string;outputPrice:string;returnPercent:string;stationFee:string;focus:string;taxPercent:string;orderPercent:string;budget:string;availableFocus:string;volume:string;days:string;materials:MaterialDraft[];priceEvidence:ProductionPriceEvidence[];volumeEvidence?:ProductionVolumeEvidence;metadata:ProductionMetadata};
const freshDraft=():Draft=>({label:'',quantity:'1',output:'',outputPrice:'',returnPercent:'',stationFee:'',focus:'',taxPercent:'',orderPercent:'',budget:'',availableFocus:'',volume:'',days:'',materials:[{itemId:'',amount:'',price:'',returnable:null}],priceEvidence:[],metadata:{}});
const textValue=(n:number,lang:Language)=>String(n).replace('.',lang==='en'?'.':',');
function toDraft(s:ProductionScenario,lang:Language):Draft { return {label:s.label,quantity:String(s.quantity),output:String(s.outputPerCraft),outputPrice:textValue(s.outputUnitPrice,lang),returnPercent:textValue(s.returnRate*100,lang),stationFee:textValue(s.stationFeePerCraft,lang),focus:textValue(s.focusPerCraft,lang),taxPercent:textValue(s.salesTaxRate*100,lang),orderPercent:textValue(s.sellOrderFeeRate*100,lang),budget:s.budget===null?'':textValue(s.budget,lang),availableFocus:s.availableFocus===null?'':textValue(s.availableFocus,lang),volume:s.volumeObserved===null?'':textValue(s.volumeObserved,lang),days:s.volumeDays===null?'':textValue(s.volumeDays,lang),materials:s.materials.map(m=>({itemId:m.itemId,amount:textValue(m.amountPerCraft,lang),price:textValue(m.unitPrice,lang),returnable:m.returnable})),priceEvidence:s.priceEvidence??[],volumeEvidence:s.volumeEvidence,metadata:s.metadata??{}}; }
function fromDraft(d:Draft,lang:Language):ProductionScenario|null {
 const n=(x:string,integer=false):number|null=>{const r=parseUserNumber(x,integer,lang);return r.valid?r.value:null;};
 const quantity=n(d.quantity,true),output=n(d.output,true),outputPrice=n(d.outputPrice),rate=n(d.returnPercent),fee=n(d.stationFee),focus=n(d.focus),tax=n(d.taxPercent),order=n(d.orderPercent);
 const budget=d.budget.trim()?n(d.budget):null,available=d.availableFocus.trim()?n(d.availableFocus):null,volume=d.volume.trim()?n(d.volume):null,days=d.days.trim()?n(d.days):null;
 if([quantity,output,outputPrice,rate,fee,focus,tax,order].some(x=>x===null) || (d.budget.trim() && budget===null) || (d.availableFocus.trim() && available===null) || (d.volume.trim() && volume===null) || (d.days.trim() && days===null)) return null;
 const materials=d.materials.map(m=>({itemId:m.itemId.trim(),amountPerCraft:n(m.amount),unitPrice:n(m.price),returnable:m.returnable}));
 if(materials.some(m=>m.amountPerCraft===null || m.unitPrice===null || m.returnable===null)) return null;
 const candidate={label:d.label.trim(),quantity:quantity!,outputPerCraft:output!,outputUnitPrice:outputPrice!,returnRate:rate!/100,stationFeePerCraft:fee!,focusPerCraft:focus!,salesTaxRate:tax!/100,sellOrderFeeRate:order!/100,budget,availableFocus:available,volumeObserved:volume,volumeDays:days,materials,priceEvidence:d.priceEvidence,...(d.volumeEvidence?{volumeEvidence:d.volumeEvidence}:{}),...(Object.keys(d.metadata).length?{metadata:d.metadata}:{})} as ProductionScenario;
 return isProductionScenario(candidate)?candidate:null;
}
type RecipeIndex={recipes:readonly CatalogueRecipe[];names:ReadonlyMap<string,string>;revision:string};
const EMPTY_RECIPE_INDEX:RecipeIndex={recipes:[],names:new Map(),revision:''};
let cachedRecipeIndex:RecipeIndex|null=null;
function getRecipeIndex():RecipeIndex {
 if(!cachedRecipeIndex){
  const data=require('../../assets/production/recipes.json') as {schemaVersion:number;recipes:CatalogueRecipe[];provenance:{sourceCommit:string}};
  const recipes=data.schemaVersion===1?data.recipes:[];
  const ids=new Set(recipes.flatMap(r=>[r.sourceId,r.itemIdCandidate]));
  cachedRecipeIndex={recipes,names:new Map(getItemsByIds(ids).map(item=>[item.id,item.n])),revision:data.provenance.sourceCommit};
 }
 return cachedRecipeIndex;
}
let cachedWeightIndex:(Omit<ProductionWeightIndex,'provenance'|'entries'> & {provenance:Record<string,unknown>&{sourceCommit:string};entries:{sourceId:string;enchantment:number|null;weight:number|null;origin:'item'|'enchantment'}[]})|null=null;
function getWeightIndex(){if(!cachedWeightIndex)cachedWeightIndex=require('../../assets/production/weights.json');return cachedWeightIndex!;}
const MAX_PRICE_AGE_MS=3_600_000;
function staleEvidence(s:ProductionScenario,server:Server):boolean {
 const seen=new Set<string>();
 const badPrice=(s.priceEvidence??[]).some(e=>{
  const value=e.key==='output'?s.outputUnitPrice:s.materials.find(m=>e.key===`material:${m.itemId}`)?.unitPrice;
  const at=parseAodpTimestamp(e.observedAt),age=Date.now()-at;
  const meta=s.metadata;
  const invalid=seen.has(e.key) || e.server!==server || value===undefined || value!==e.value || (e.key==='output' ? e.side==='purchaseImmediate' || (meta?.outputItemId!==undefined&&e.itemId!==meta.outputItemId) || (meta?.sellCity!==undefined&&e.city!==meta.sellCity) || (meta?.quality!==undefined&&e.quality!==meta.quality) || (meta?.saleSide!==undefined&&e.side!==meta.saleSide) : e.itemId!==e.key.slice('material:'.length) || e.side!=='purchaseImmediate' || (meta?.buyCity!==undefined&&e.city!==meta.buyCity)) || !Number.isFinite(at) || age>MAX_PRICE_AGE_MS || age < -300_000;
  seen.add(e.key);return invalid;
 });
 const v=s.volumeEvidence;
 if(!v)return badPrice;
 const now=Date.now(),end=Math.floor(now/86_400_000)*86_400_000;
 const price=(s.priceEvidence??[]).find(e=>e.key==='output');
 return badPrice || v.server!==server || (!!price && (price.itemId!==v.itemId || price.city!==v.city || price.quality!==v.quality || price.server!==v.server)) || (s.metadata?.outputItemId!==undefined&&v.itemId!==s.metadata.outputItemId) || (s.metadata?.sellCity!==undefined&&v.city!==s.metadata.sellCity) || (s.metadata?.quality!==undefined&&v.quality!==s.metadata.quality) || v.fetchedAt<1 || v.fetchedAt>now+300_000 || now-v.fetchedAt>MAX_PRICE_AGE_MS || v.endMs!==end || v.startMs!==v.endMs-v.requestedDays*86_400_000 || v.observedAt<v.startMs || v.observedAt>=v.endMs || v.observedBuckets!==v.requestedDays || v.observedUnits!==s.volumeObserved || v.requestedDays!==s.volumeDays;
}

const planStore=createProductionPlanStore({read:()=>AsyncStorage.getItem('@albion/production-plans/v1'),write:value=>AsyncStorage.setItem('@albion/production-plans/v1',value)});
const chainStore=createProductionChainStore({read:()=>AsyncStorage.getItem('@albion/production-chains/v1'),write:value=>AsyncStorage.setItem('@albion/production-chains/v1',value)});
function Label({children}:{children:React.ReactNode}) {return <Text style={s.label}>{children}</Text>;}
function Action({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}) {const selected=label.startsWith('✓');return <Pressable accessibilityRole="button" accessibilityState={{disabled,selected}} disabled={disabled} onPress={onPress} style={[s.button,selected&&s.buttonSelected,disabled&&s.disabled]}><Text style={[s.buttonText,selected&&s.buttonTextSelected]}>{label}</Text></Pressable>;}
function Panel({title,summary,open,onToggle,children}:{title:string;summary?:string;open:boolean;onToggle:()=>void;children:React.ReactNode}) {
 return <View style={s.card}><Pressable accessibilityRole="button" accessibilityState={{expanded:open}} onPress={onToggle} style={s.panelHeader}><View style={s.panelText}><Text style={s.panelTitle}>{title}</Text>{!!summary&&<Text style={s.panelSummary}>{summary}</Text>}</View><Text style={s.chevron}>{open?'−':'+'}</Text></Pressable>{open&&<View style={s.panelContent}>{children}</View>}</View>;
}
function PrimaryAction({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}) {return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.primaryButton,disabled&&s.disabled]}><Text style={s.primaryText}>{label}</Text></Pressable>;}
function ProductionScreen({lang,server,active=true,onTransfer,incoming,mode}:ProductionScreenProps & {mode:'optimizer'|'refining'|'plan'}) {
 const tr=(fr:string,en:string,es:string)=>lang==='fr'?fr:lang==='es'?es:en;
 const [draft,setDraft]=useState<Draft>(freshDraft);
 const [showRecipes,setShowRecipes]=useState(false);
 const [recipeQuery,setRecipeQuery]=useState(''),[recipeSearch,setRecipeSearch]=useState(''),[recipeOffset,setRecipeOffset]=useState(0);
 const [recipeConfirmed,setRecipeConfirmed]=useState(false),[chainConfirmed,setChainConfirmed]=useState(false),[detached,setDetached]=useState(false);
 const recipeIndex=useMemo(()=>showRecipes||draft.metadata.recipe?getRecipeIndex():EMPTY_RECIPE_INDEX,[showRecipes,draft.metadata.recipe]);
 const recipeNames=recipeIndex.names;
 const recipeMatches=useMemo(()=>searchProductionRecipes(recipeIndex.recipes,recipeSearch,recipeOffset,16,recipeNames),[recipeIndex,recipeSearch,recipeOffset,recipeNames]);
 const linkedRecipe=draft.metadata.recipe?.revision===recipeIndex.revision?recipeIndex.recipes.find(r=>r.id===draft.metadata.recipe?.id):undefined;
 const noReturnIds=useMemo(()=>new Set(linkedRecipe?.materials.filter(m=>m.maxReturnAmount===0).map(m=>m.itemIdCandidate)??[]),[linkedRecipe]);
 const [draftLocale,setDraftLocale]=useState<Language>(lang);
 const draftRef=useRef(draft);draftRef.current=draft;
 const [productId,setProductId]=useState(''),[buyCity,setBuyCity]=useState<City|null>(null),[sellCity,setSellCity]=useState<City|null>(null);
 const [quality,setQuality]=useState<Quality|null>(null),[saleSide,setSaleSide]=useState<'saleImmediate'|'saleOrderReference'|null>(null);
 const [offlineOnly,setOfflineOnly]=useState(false);
 const marketInputs=JSON.stringify([server,productId,buyCity,sellCity,quality,saleSide,offlineOnly]);
 const marketInputsRef=useRef(marketInputs);marketInputsRef.current=marketInputs;
 const [marketBusy,setMarketBusy]=useState(false),[marketNotice,setMarketNotice]=useState('');
 const marketAbort=useRef<AbortController|null>(null),marketEpoch=useRef(0);
 const [scenarios,setScenarios]=useState<ProductionScenario[]>([]);
 const [ranking,setRanking]=useState<ProductionRanking>('profit');
 const [filterTier,setFilterTier]=useState<number|null>(null),[filterEnchant,setFilterEnchant]=useState<number|null>(null),[filterQuality,setFilterQuality]=useState<number|null>(null);
 const [filterCategory,setFilterCategory]=useState(''),[filterCity,setFilterCity]=useState<City|null>(null);
 const [maximizeQuantity,setMaximizeQuantity]=useState(false);
 const [chainSteps,setChainSteps]=useState<ProductionChainStep[]>([]),[chainBudget,setChainBudget]=useState(''),[chainFocus,setChainFocus]=useState('');
 const [savedChains,setSavedChains]=useState<SavedProductionChain[]>([]),[showChains,setShowChains]=useState(false);
 const [answer,setAnswer]=useState<ProductionResponse|null>(null);
 const [answerInputs,setAnswerInputs]=useState<ProductionScenario[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState<SavedProductionPlan[]>([]);
 const [weightBusy,setWeightBusy]=useState(false),[weightResult,setWeightResult]=useState<ProductionWeightResult|null>(null),[weightNotice,setWeightNotice]=useState(''),[weightQuantity,setWeightQuantity]=useState<number|null>(null);
 const weightGate=useRef(createProductionTaskGate());
 const [approval,setApproval]=useState(''),[approving,setApproving]=useState(false);
 const analysisGate=useRef(createProductionTaskGate()),lastIncoming=useRef<number|null>(null),approvalEpoch=useRef(0);
 const [showSaved,setShowSaved]=useState(false);
 const scrollRef=useRef<React.ComponentRef<typeof ScrollView>>(null);
 const [recipeInfo,setRecipeInfo]=useState(false);
 const [openBasics,setOpenBasics]=useState(true),[openMetadata,setOpenMetadata]=useState(false),[openMaterials,setOpenMaterials]=useState(false),[openParams,setOpenParams]=useState(false),[openMarket,setOpenMarket]=useState(false),[openRanking,setOpenRanking]=useState(false),[openWeight,setOpenWeight]=useState(false),[openChain,setOpenChain]=useState(false),[openMore,setOpenMore]=useState(false),[openInfo,setOpenInfo]=useState(false);
 useEffect(()=>{setApproval('');setRecipeConfirmed(false);approvalEpoch.current++;setApproving(false);},[draft,server]);
 useEffect(()=>{if(error||answer)scrollRef.current?.scrollTo({y:0,animated:true});},[error,answer]);
 useEffect(()=>{setChainConfirmed(false);},[chainSteps]);
 useLayoutEffect(()=>{analysisGate.current.invalidate();setBusy(false);setAnswer(null);},[draft,server,ranking,scenarios,filterTier,filterEnchant,filterQuality,filterCategory,filterCity,chainSteps,chainBudget,chainFocus,maximizeQuantity,marketInputs,recipeConfirmed,chainConfirmed]);
 useLayoutEffect(()=>{weightGate.current.invalidate();setWeightBusy(false);setWeightResult(null);setWeightNotice('');setWeightQuantity(null);},[draft,server,answer]);
 useEffect(()=>()=>{analysisGate.current.invalidate();weightGate.current.invalidate();approvalEpoch.current++;marketEpoch.current++;marketAbort.current?.abort();},[]);
 useEffect(()=>{if(!active){analysisGate.current.invalidate();weightGate.current.invalidate();setBusy(false);setWeightBusy(false);marketEpoch.current++;marketAbort.current?.abort();marketAbort.current=null;setMarketBusy(false);}},[active]);
 const restoreScenario=(value:ProductionScenario)=>{setDetached(false);const checked=reconcile(value),restored=checked??value;setRecipeConfirmed(false);setDraftLocale(lang);setDraft(toDraft(restored,lang));setProductId(restored.metadata?.outputItemId??'');setBuyCity(CITIES.find(c=>c===restored.metadata?.buyCity)??null);setSellCity(CITIES.find(c=>c===restored.metadata?.sellCity)??null);setQuality((restored.metadata?.quality??null) as Quality|null);setSaleSide(restored.metadata?.saleSide??null);setAnswer(null);if(checked)setError('');else catalogueError();};
 useEffect(()=>{if(mode==='plan' && incoming && lastIncoming.current!==incoming.sequence && isProductionScenario(incoming.scenario)){lastIncoming.current=incoming.sequence;restoreScenario(incoming.scenario);}},[incoming,lang,mode]);
 const update=(key:keyof Omit<Draft,'materials'|'priceEvidence'|'volumeEvidence'|'metadata'>,value:string)=>{setDraft(d=>({...d,[key]:value,priceEvidence:key==='outputPrice'?d.priceEvidence.filter(e=>e.key!=='output'):d.priceEvidence,volumeEvidence:key==='volume'||key==='days'?undefined:d.volumeEvidence}));setAnswer(null);};
 const updateMeta=(patch:ProductionMetadata)=>{setDraft(d=>({...d,metadata:{...d.metadata,...patch}}));setAnswer(null);};
 const updateMaterial=(index:number,patch:Partial<MaterialDraft>)=>{setDraft(d=>({...d,materials:d.materials.map((m,i)=>i===index?{...m,...patch}:m),priceEvidence:patch.price!==undefined||patch.itemId!==undefined?d.priceEvidence.filter(e=>e.key!==`material:${d.materials[index].itemId}`):d.priceEvidence}));setAnswer(null);};
 const invalid=()=>{
  const sections=invalidProductionSections(draft,draftLocale),names:string[]=[];
  if(sections.basics){setOpenBasics(true);names.push(tr('Scénario','Scenario','Escenario'));}
  if(sections.materials){setOpenMaterials(true);names.push(tr('Matériaux','Materials','Materiales'));}
  if(sections.params){setOpenParams(true);names.push(tr('Coûts et contraintes','Costs and constraints','Costes y restricciones'));}
  setError(names.length?`${tr('À vérifier dans','Check these sections','Revisa estas secciones')}: ${names.join(' · ')}. ${tr('Renseignez les champs obligatoires et corrigez les valeurs invalides.','Complete required fields and correct invalid values.','Completa los campos obligatorios y corrige los valores inválidos.')}`:tr('Vérifiez les contraintes du scénario et incluez les coûts fixes connus dans les frais.','Check scenario constraints and include known fixed costs in the fees.','Comprueba las condiciones e incluye los costes fijos conocidos en las tasas.'));
 };
 const catalogueError=()=>setError(tr('La recette liée doit conserver ses matériaux et quantités source. Corrigez-les, ou détachez-la pour créer un scénario manuel. Un matériau non retournable ne peut pas être retourné.','The linked recipe must keep its source materials and quantities. Correct them, or detach it to make a manual scenario. A non-returnable material cannot be returned.','La receta vinculada debe conservar los materiales y cantidades de la fuente. Corrígelos o desvincúlala para crear un escenario manual. Un material no retornable no puede devolverse.'));
 const reconcile=(value:ProductionScenario)=>{if(!value.metadata?.recipe)return value;const index=getRecipeIndex();return reconcileProductionRecipe(value,index.recipes,index.revision);};
 const scenario=()=>{let value=fromDraft(draft,draftLocale);if(!value)invalid();else if(!(value=reconcile(value))){catalogueError();return null;}else if(value.metadata?.recipe&&!recipeConfirmed){setError(tr('Confirmez les contraintes de recette et incluez tout coût fixe connu dans les frais saisis.','Confirm recipe constraints and include every known fixed cost in the entered fee.','Confirma las condiciones de la receta e incluye cualquier coste fijo conocido en la tasa indicada.'));return null;}else if(staleEvidence(value,server)){setError(tr('Un prix AODP a expiré ou ne correspond plus au scénario ou au serveur. Actualisez-le avant le calcul.','An AODP price expired or no longer matches the scenario or server. Refresh it before calculating.','Un precio AODP ha caducado o ya no corresponde al escenario o servidor. Actualízalo antes de calcular.'));return null;}return value;};
 async function execute(action:ProductionAction, items:ProductionScenario[]) {
  if(!items.length || busy || marketBusy||weightBusy)return;
  const reconciled=items.map(reconcile);if(reconciled.some(item=>!item)){catalogueError();return;}items=reconciled as ProductionScenario[];
  if(items.some(item=>staleEvidence(item,server))){setError(tr('Un prix AODP a expiré ou provient d’un autre serveur. Actualisez le scénario avant le calcul.','An AODP price expired or belongs to another server. Refresh the scenario before calculating.','Un precio AODP ha caducado o pertenece a otro servidor. Actualiza el escenario antes de calcular.'));return;}
  const task=analysisGate.current.begin();setBusy(true);setError('');setAnswer(null);
  const request=action==='calculate_crafting_profit'?{scenario:items[0]}:action==='optimize_production_plan'&&maximizeQuantity?{scenario:items[0],optimizeQuantity:true as const}:{scenarios:items,ranking};
  const result=await runProduction(action,request,task.signal,server);
  if(!task.isCurrent())return;
  task.finish();setBusy(false);
  if(result.status==='error')setError(`${result.error.code}: ${result.error.message}`); else {setAnswerInputs(items);setAnswer(result);}
 }
 const cancel=()=>analysisGate.current.cancel();
 async function fetchPrices(){
  if(marketBusy||busy||weightBusy)return;
  const ids=draft.materials.map(m=>m.itemId.trim()), outputId=productId.trim();
  if(!buyCity||!sellCity||!quality||!saleSide||!outputId||ids.some(id=>!id)||!ids.length){setMarketNotice(tr('Indiquez les identifiants, les villes, la qualité et le mode de vente avant la recherche.','Enter item IDs, cities, quality and sale mode before searching.','Indica identificadores, ciudades, calidad y modo de venta antes de buscar.'));return;}
  const snapshot=draft,params=marketInputs,controller=new AbortController(),ticket=++marketEpoch.current;
  marketAbort.current=controller;setMarketBusy(true);setMarketNotice('');
  try {
   const [inputs,output]=await Promise.all([
    productionMarket.getPrices({server,itemIds:ids,cities:[buyCity],quality:1,maxAgeMs:MAX_PRICE_AGE_MS,offlineOnly,signal:controller.signal}),
    productionMarket.getPrices({server,itemIds:[outputId],cities:[sellCity],quality,maxAgeMs:MAX_PRICE_AGE_MS,offlineOnly,signal:controller.signal}),
   ]);
   if(ticket!==marketEpoch.current || controller.signal.aborted)return;
   if(draftRef.current!==snapshot || marketInputsRef.current!==params){setMarketNotice(tr('Les champs ont changé pendant la recherche ; aucun prix n’a été appliqué.','Fields changed during the search; no prices were applied.','Los campos cambiaron durante la búsqueda; no se aplicaron precios.'));return;}
   const evidence:ProductionPriceEvidence[]=[];let missing=0;
   const materials=snapshot.materials.map(m=>{
    const row=inputs.rows.find(r=>r.itemId===m.itemId.trim() && r.city===buyCity),quote=row?.purchaseImmediate;
    if(!row||!quote?.fresh){missing++;return m;}
    evidence.push({key:`material:${m.itemId.trim()}`,itemId:m.itemId.trim(),source:'AODP',server,city:buyCity,quality:1,side:'purchaseImmediate',value:quote.value,observedAt:quote.observedAt,fetchedAt:row.fetchedAt});
    return {...m,price:textValue(quote.value,draftLocale)};
   });
   const outputRow=output.rows.find(r=>r.itemId===outputId && r.city===sellCity),outQuote=outputRow?.[saleSide];
   let outputPrice=snapshot.outputPrice;
   if(outputRow&&outQuote?.fresh){evidence.push({key:'output',itemId:outputId,source:'AODP',server,city:sellCity,quality,side:saleSide,value:outQuote.value,observedAt:outQuote.observedAt,fetchedAt:outputRow.fetchedAt});outputPrice=textValue(outQuote.value,draftLocale);}else missing++;
   setDraft({...snapshot,materials,outputPrice,metadata:{...snapshot.metadata,outputItemId:outputId,buyCity,sellCity,quality,saleSide},priceEvidence:[...snapshot.priceEvidence.filter(old=>!evidence.some(e=>e.key===old.key)),...evidence]});setAnswer(null);
   const offline=inputs.offline||output.offline;
   setMarketNotice(`${tr('Prix AODP frais appliqués','Fresh AODP prices applied','Precios AODP recientes aplicados')}: ${evidence.length}; ${tr('manquants ou périmés','missing or stale','faltantes o caducados')}: ${missing}. ${offline?tr('Mode cache hors ligne.','Offline cache.','Caché sin conexión.'):''} ${tr('Un ordre affiché ne garantit pas son exécution.','A listed order is not a guaranteed fill.','Una orden visible no garantiza su ejecución.')}`);
  }catch(e){if(ticket===marketEpoch.current && !controller.signal.aborted)setMarketNotice(tr('Recherche AODP impossible ; aucun prix n’a été appliqué.','AODP lookup failed; no prices were applied.','Falló la consulta AODP; no se aplicaron precios.'));}
  finally{if(ticket===marketEpoch.current){marketAbort.current=null;setMarketBusy(false);}}
 }
 async function fetchHistory(){
  if(marketBusy||busy||weightBusy)return;
  const outputId=productId.trim();
  if(!sellCity||!quality||!outputId){setMarketNotice(tr('Indiquez l’objet produit, sa qualité et la ville de vente.','Enter the output item, its quality and sale city.','Indica el objeto producido, su calidad y la ciudad de venta.'));return;}
  const snapshot=draft,params=marketInputs,controller=new AbortController(),ticket=++marketEpoch.current;
  marketAbort.current=controller;setMarketBusy(true);setMarketNotice('');
  try {
   const history=await productionMarket.getHistory({server,itemId:outputId,city:sellCity,quality,days:7,maxAgeMs:MAX_PRICE_AGE_MS,offlineOnly,signal:controller.signal});
   if(ticket!==marketEpoch.current||controller.signal.aborted)return;
   if(draftRef.current!==snapshot||marketInputsRef.current!==params){setMarketNotice(tr('Les champs ont changé pendant la recherche ; rien n’a été appliqué.','Fields changed during the search; nothing was applied.','Los campos cambiaron durante la búsqueda; no se aplicó nada.'));return;}
   if(!history.fresh||history.fetchedAt===null||history.observedUnits===null||history.observedBuckets!==history.requestedDays){setMarketNotice(tr('Historique manquant, périmé ou incomplet : volume non appliqué.','History missing, stale or incomplete: volume not applied.','Historial ausente, caducado o incompleto: volumen no aplicado.'));return;}
   const observedAt=Math.max(...history.points.map(p=>parseAodpTimestamp(p.timestamp)));
   if(!Number.isFinite(observedAt)){setMarketNotice(tr('Horodatage historique invalide.','Invalid history timestamp.','Fecha de historial inválida.'));return;}
   const volumeEvidence:ProductionVolumeEvidence={source:'AODP',server,itemId:outputId,city:sellCity,quality,observedAt,fetchedAt:history.fetchedAt,startMs:history.startMs,endMs:history.endMs,observedBuckets:history.observedBuckets,requestedDays:history.requestedDays,observedUnits:history.observedUnits};
   setDraft({...snapshot,volume:textValue(history.observedUnits,draftLocale),days:String(history.requestedDays),volumeEvidence,metadata:{...snapshot.metadata,outputItemId:outputId,sellCity,quality}});setAnswer(null);
   setMarketNotice(tr('Historique AODP complet de sept jours importé. Ce sont des unités représentées dans les observations, pas des ventes garanties.','Seven complete days of AODP history imported. These are units represented in observations, not guaranteed sales.','Se importaron siete días completos de historial AODP. Son unidades representadas en observaciones, no ventas garantizadas.'));
  }catch {if(ticket===marketEpoch.current && !controller.signal.aborted)setMarketNotice(tr('Historique AODP indisponible ; volume non appliqué.','AODP history unavailable; volume not applied.','Historial AODP no disponible; volumen no aplicado.'));}
  finally{if(ticket===marketEpoch.current){marketAbort.current=null;setMarketBusy(false);}}
 }
 async function loadPlans(){try{setSaved(await planStore.list());setShowSaved(true);setError('');}catch{setError(tr('Lecture impossible : aucune donnée sauvegardée ne sera écrasée.','Unable to read saved plans; stored data will not be overwritten.','No se pudieron leer los planes; no se sobrescribirán los datos.'));}}
 async function savePlan(){const item=scenario();if(!item)return;try{await planStore.save(item);await loadPlans();}catch{setError(tr('Sauvegarde impossible. Vérifiez le stockage ou le nombre de plans.','Unable to save. Check storage or plan count.','No se pudo guardar. Comprueba el almacenamiento o el número de planes.'));}}
 const chainLimits=():{budget:number|null;availableFocus:number|null}|null=>{
  const parseOptional=(raw:string)=>raw.trim()?parseUserNumber(raw,false,draftLocale):null;
  const b=parseOptional(chainBudget),f=parseOptional(chainFocus);
  if((b&&!b.valid)||(f&&!f.valid)){setError(tr('Vérifiez le budget et le focus globaux.','Check the overall budget and focus.','Comprueba presupuesto y foco globales.'));return null;}
  return {budget:b?.value??null,availableFocus:f?.value??null};
 };
 async function executeChain(){
  if(busy||marketBusy||weightBusy)return;const limits=chainLimits();if(!limits)return;
  if(chainSteps.some(step=>step.scenario.metadata?.recipe)&&!chainConfirmed){setError(tr('Confirmez les contraintes et frais des recettes de la chaîne.','Confirm recipe constraints and fees in this chain.','Confirma las condiciones y costes de las recetas de esta cadena.'));return;}
  if(chainSteps.length<2||chainSteps.length>12){setError(tr('Une chaîne nécessite 2 à 12 étapes.','A chain needs 2 to 12 steps.','Una cadena necesita de 2 a 12 etapas.'));return;}
  const reconciled=chainSteps.map(step=>{const scenario=reconcile(step.scenario);return scenario?{...step,scenario}:null;});if(reconciled.some(step=>!step)){catalogueError();return;}
  if(chainSteps.some(step=>staleEvidence(step.scenario,server))){setError(tr('Une observation de la chaîne est périmée ou incompatible.','A chain observation is stale or incompatible.','Una observación de la cadena ha caducado o no corresponde.'));return;}
  const task=analysisGate.current.begin();setBusy(true);setError('');setAnswer(null);
  const result=await runProduction('optimize_production_plan',{steps:reconciled as ProductionChainStep[],...limits},task.signal,server);
  if(!task.isCurrent())return;task.finish();setBusy(false);
  if(result.status==='error')setError(`${result.error.code}: ${result.error.message}`);else setAnswer(result);
 }
 async function loadChains(){try{setSavedChains(await chainStore.list());setShowChains(true);setError('');}catch{setError(tr('Lecture des chaînes impossible ; aucun fichier ne sera écrasé.','Unable to read chains; stored data will not be overwritten.','No se pudieron leer cadenas; no se sobrescribirán datos.'));}}
 async function saveChain(){const limits=chainLimits();if(!limits)return;const checked=chainSteps.map(step=>{const scenario=reconcile(step.scenario);return scenario?{...step,scenario}:null;});if(checked.some(step=>!step)){catalogueError();return;}try{await chainStore.save(checked as ProductionChainStep[],limits.budget,limits.availableFocus);await loadChains();}catch{setError(tr('Sauvegarde de la chaîne impossible : 2 à 12 étapes valides requises.','Unable to save chain: 2 to 12 valid steps required.','No se pudo guardar la cadena: se requieren de 2 a 12 etapas válidas.'));}}
 async function approveForAI(){
  if(approving||busy||marketBusy||weightBusy)return;
  const item=scenario();if(!item)return;
  const snapshot=draft,ticket=++approvalEpoch.current;
  setApproving(true);setApproval('');
  const result=await approveProductionScenario(item,server);
  if(ticket!==approvalEpoch.current)return;
  setApproving(false);
  if(result.status==='error')setError(result.message);
  else if(draftRef.current!==snapshot)setError(tr('Le scénario précédent a été autorisé mais le formulaire a changé. Vérifiez les valeurs avant une nouvelle autorisation.','The previous scenario was approved but the form changed. Check values before approving again.','Se autorizó el escenario anterior pero el formulario cambió. Revisa los valores antes de autorizar de nuevo.'));
  else {setError('');setApproval(result.scenarioId);}
 }
 async function calculateWeight(){
  if(weightBusy||busy||marketBusy)return;
  const planResult=answer?.status==='ok'&&'result' in answer&&'scope' in answer&&answer.scope==='single_scenario_quantity'?answer.result.scenarioResult:answer?.status==='ok'&&'results' in answer?answer.results[0]:null;
  if(!planResult||!planResult.feasible||!Number.isSafeInteger(planResult.quantity)||planResult.quantity<1){setWeightResult(null);setWeightNotice(tr('Poids indisponible : calculez d’abord un plan réalisable ; les chaînes et quantités nulles ne sont pas prises en charge.','Weight unavailable: first calculate a feasible plan; chains and zero quantities are unsupported.','Peso no disponible: calcula primero un plan viable; cadenas y cantidades nulas no son compatibles.'));return;}
  const quantity=planResult.quantity;
  const parsed=draft.materials.map(m=>({itemId:m.itemId.trim(),amount:parseUserNumber(m.amount,false,draftLocale)}));
  if(parsed.some(m=>!m.amount.valid)){
   setWeightNotice(tr('Quantité ou matériaux invalides : poids inconnu.','Invalid quantity or materials: weight unknown.','Cantidad o materiales inválidos: peso desconocido.'));return;
  }
  const index=getRecipeIndex();
  const selection=selectProductionWeight({metadata:draft.metadata,materials:parsed.map(m=>({itemId:m.itemId,amountPerCraft:m.amount.value!}))},quantity,index.recipes,index.revision,getWeightIndex());
  if('error' in selection){setWeightResult(null);setWeightNotice(tr('Poids inconnu : la provenance ou les matériaux ne correspondent pas exactement à la variante locale.','Weight unknown: provenance or materials do not exactly match the local variant.','Peso desconocido: la procedencia o los materiales no corresponden exactamente a la variante local.'));return;}
  const task=weightGate.current.begin();setWeightBusy(true);setWeightNotice('');setWeightResult(null);setWeightQuantity(quantity);
  const result=await calculateProductionWeight(selection.materials,selection.index,task.signal);
  if(!task.isCurrent())return;task.finish();setWeightBusy(false);
  if(result.status==='error')setWeightNotice(`${result.error.code}: ${result.error.message}`);else setWeightResult(result);
 }
 const chooseRecipe=(recipe:CatalogueRecipe)=>{
  if(unsupportedRecipe(recipe))return;
  setDetached(false);
  const metadata:ProductionMetadata={outputItemId:recipe.itemIdCandidate,recipe:{id:recipe.id,revision:recipeIndex.revision,silverCost:recipe.silverCost,swapTransaction:recipe.swapTransaction,cappedReturn:recipe.materials.some(m=>m.maxReturnAmount!==null&&m.maxReturnAmount>0),nonReturnableItemIds:recipe.materials.filter(m=>m.maxReturnAmount===0).map(m=>m.itemIdCandidate)}};
  if(recipe.tier!==null&&recipe.tier>=1&&recipe.tier<=8)metadata.tier=recipe.tier;
  if(recipe.enchantment!==null&&recipe.enchantment>=0&&recipe.enchantment<=4)metadata.enchantment=recipe.enchantment;
  if(recipe.category&&recipe.category.length<=64)metadata.category=recipe.category;
  setDraftLocale(lang);setDraft({...freshDraft(),label:(recipeNames.get(recipe.itemIdCandidate)??recipeNames.get(recipe.sourceId)??recipe.itemIdCandidate).slice(0,120),output:recipe.outputQuantity===null?'':String(recipe.outputQuantity),materials:recipe.materials.map(m=>({itemId:m.itemIdCandidate,amount:textValue(m.quantity,lang),price:'',returnable:m.returnable})),metadata});
  setProductId(recipe.itemIdCandidate);setBuyCity(null);setSellCity(null);setQuality(null);setSaleSide(null);setRecipeConfirmed(false);setAnswer(null);setError('');setApproval('');setShowRecipes(false);setOpenBasics(true);setOpenMaterials(true);setRecipeInfo(false);scrollRef.current?.scrollTo({y:0,animated:true});
 };
 const editLabel=tr('Nom du scénario','Scenario name','Nombre del escenario');
 const row=(label:string,key:keyof Omit<Draft,'materials'|'priceEvidence'|'volumeEvidence'|'metadata'>,integer=false,optional=false)=> <NumberInput locale={draftLocale} placeholder={optional?tr('Facultatif','Optional','Opcional'):tr('À saisir','Required','Obligatorio')} label={label+(optional?' · '+tr('facultatif','optional','opcional'):'')} value={draft[key]} onChangeText={v=>update(key,v)} integer={integer}/>;
 const filteredScenarios=scenarios.filter(item=>(filterTier===null||item.metadata?.tier===filterTier)&&(filterEnchant===null||item.metadata?.enchantment===filterEnchant)&&(filterQuality===null||item.metadata?.quality===filterQuality)&&(!filterCategory.trim()||item.metadata?.category?.toLowerCase().includes(filterCategory.trim().toLowerCase()))&&(filterCity===null||item.metadata?.sellCity===filterCity));
 const quantityResult=answer?.status==='ok' && 'result' in answer && 'scope' in answer && answer.scope==='single_scenario_quantity' ? answer.result : null;
 const chainResult=answer?.status==='ok' && 'result' in answer && 'scope' in answer && answer.scope==='explicit_linear_chain' ? answer.result : null;
 const results:ProductionResult[]=answer?.status==='ok'?(chainResult?[]:quantityResult?(quantityResult.scenarioResult?[quantityResult.scenarioResult]:[]):'result' in answer?[answer.result as ProductionResult]:answer.results):[];
 const primaryLabel=mode==='optimizer'?tr('Comparer','Compare','Comparar'):mode==='refining'?tr('Analyser','Analyze','Analizar'):tr('Calculer','Calculate','Calcular');
 const runPrimary=()=>{scrollRef.current?.scrollTo({y:0,animated:true});if(mode==='optimizer'){if(filteredScenarios.length)void execute('find_profitable_crafts',filteredScenarios);else {setOpenRanking(true);setError(scenarios.length?tr('Aucun scénario ne correspond aux filtres. Assouplissez-les pour comparer.','No scenario matches the filters. Relax them to compare.','Ningún escenario coincide con los filtros. Amplíalos para comparar.'):tr('Ajoutez d’abord un scénario valide au classement.','First add a valid scenario to the ranking.','Añade primero un escenario válido a la clasificación.'));}return;}const item=scenario();if(item)void execute(mode==='refining'?'optimize_refining':'optimize_production_plan',[item]);};
 return <View style={s.root}>
  <View style={s.toolbar}><View style={s.toolbarText}><Text style={s.title}>{mode==='optimizer'?tr('Optimiseur','Optimizer','Optimizador'):mode==='refining'?tr('Raffinage','Refining','Refinado'):tr('Production','Production','Producción')}</Text><Text style={s.caption} numberOfLines={1}>{draft.label||tr('Nouveau scénario','New scenario','Nuevo escenario')}</Text></View>{mode==='optimizer'&&<Action label={tr('Ajouter','Add','Añadir')} disabled={busy||weightBusy||scenarios.length>=256} onPress={()=>{scrollRef.current?.scrollTo({y:0,animated:true});const item=scenario();if(item){setScenarios(old=>[...old,item]);setOpenRanking(true);setError('');setAnswer(null);}}}/>}<PrimaryAction label={primaryLabel} disabled={busy||weightBusy||marketBusy} onPress={runPrimary}/></View>
  <ScrollView ref={scrollRef} style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
  {busy&&<View style={s.row}><ActivityIndicator color={COLORS.primary}/><Text style={s.body}>{tr('Analyse en cours…','Analyzing…','Analizando…')}</Text><Action label={tr('Annuler','Cancel','Cancelar')} onPress={cancel}/></View>}
  {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  {answer?.status==='ok'&&'rejected'in answer&&<Text style={s.caption}>{tr('Scénarios exclus','Excluded scenarios','Escenarios excluidos')}: {answer.rejected.length} · {answer.rejected.map(r=>`${r.index+1}: ${r.code}`).join(', ')}</Text>}
  {quantityResult&&<Text style={s.body}>{tr('Quantité retenue','Selected quantity','Cantidad seleccionada')}: {quantityResult.selectedQuantity} / {quantityResult.requestedQuantity} · {tr('Limites','Limits','Límites')}: {quantityResult.limitingFactors.join(', ') || tr('aucune','none','ninguna')}{quantityResult.scenarioResult===null?' · '+tr('aucune production possible','no production is feasible','no hay producción posible'):''}</Text>}
  {chainResult&&<ChainResult result={chainResult} lang={lang}/>}
  {results.map((r,i)=><Result key={`${r.inputIndex??0}-${i}`} result={r} scenario={answerInputs[r.inputIndex??0]} lang={lang} server={server} onTransfer={onTransfer && mode==='optimizer' && typeof r.inputIndex==='number' && answerInputs[r.inputIndex] ? ()=>{const item=answerInputs[r.inputIndex!];if(!reconcile(item)){catalogueError();return;}if(staleEvidence(item,server)){setError(tr('Prix périmé ; actualisez le scénario.','Price expired; refresh the scenario.','Precio caducado; actualiza el escenario.'));return;}onTransfer(item);} : undefined}/>)}
  <Text style={s.intro}>{mode==='optimizer'?tr('Comparez vos scénarios de fabrication.','Compare your crafting scenarios.','Compara tus escenarios de fabricación.'):mode==='refining'?tr('Analysez une recette de raffinage.','Analyze a refining recipe.','Analiza una receta de refinado.'):tr('Préparez un plan avec votre budget et votre focus.','Prepare a plan with your budget and focus.','Prepara un plan con tu presupuesto y foco.')}</Text>
  <Pressable accessibilityRole="button" accessibilityState={{expanded:openInfo}} onPress={()=>setOpenInfo(v=>!v)} style={s.detailToggle}><Text style={s.infoLink}>{openInfo?tr('Masquer les hypothèses','Hide assumptions','Ocultar hipótesis'):tr('Sources et hypothèses','Sources and assumptions','Fuentes e hipótesis')} {openInfo?'−':'+'}</Text></Pressable>
  {openInfo&&<Text style={s.notice}>{tr('Le catalogue local propose des recettes candidates. Vérifiez les identifiants et renseignez les valeurs inconnues. Taxes, frais, bonus et prix manuels sont des hypothèses ; seuls les prix AODP indiqués ci-dessous ont une source et une date. Les ventes ne sont pas garanties.','The local catalogue offers candidate recipes. Verify IDs and enter unknown values. Taxes, fees, bonuses and manual prices are assumptions; only the AODP prices below have a source and date. Sales are not guaranteed.','El catálogo local ofrece recetas candidatas. Verifica los identificadores e indica los valores desconocidos. Impuestos, costes, bonificaciones y precios manuales son hipótesis; solo los precios AODP indicados tienen fuente y fecha. No se garantizan ventas.')} {mode==='optimizer'?tr('Le classement porte uniquement sur les scénarios ajoutés.','Ranking covers added scenarios only.','La clasificación incluye solo los escenarios añadidos.'):''}</Text>}
  <Panel title={tr('Choisir une recette','Choose a recipe','Elegir receta')} summary={draft.metadata.recipe?draft.metadata.recipe.id:tr('Catalogue local · facultatif','Local catalogue · optional','Catálogo local · opcional')} open={showRecipes} onToggle={()=>setShowRecipes(v=>!v)}>
   <Text style={s.caption}>{tr('Recherchez un nom anglais ou un identifiant (au moins 2 caractères). Chaque variante est distincte. Charger une recette remplace le formulaire et efface ses prix et paramètres. Les identifiants sont des candidats à vérifier.','Search an English name or ID (at least 2 characters). Each variant is distinct. Loading a recipe replaces the form and clears its prices and assumptions. IDs are candidates to verify.','Busca un nombre inglés o identificador (mínimo 2 caracteres). Cada variante es distinta. Cargar una receta reemplaza el formulario y borra sus precios y parámetros. Verifica los identificadores candidatos.')}</Text>
   <TextInput accessibilityLabel={tr('Rechercher une recette','Search recipes','Buscar receta')} value={recipeQuery} onChangeText={setRecipeQuery} style={s.input} autoCapitalize="none"/>
   <View style={s.row}><Action label={tr('Rechercher','Search','Buscar')} onPress={()=>{setRecipeSearch(recipeQuery.trim());setRecipeOffset(0);}}/>{recipeOffset>0&&<Action label={tr('Précédent','Previous','Anterior')} onPress={()=>setRecipeOffset(Math.max(0,recipeOffset-15))}/ >}{recipeMatches.length>15&&<Action label={tr('Suivant','Next','Siguiente')} onPress={()=>setRecipeOffset(recipeOffset+15)}/>}</View>
   {!!recipeSearch&&recipeSearch.length<2&&<Text style={s.caption}>{tr('Entrez au moins 2 caractères.','Enter at least 2 characters.','Introduce al menos 2 caracteres.')}</Text>}
   {recipeSearch.length>=2&&recipeMatches.length===0&&<Text style={s.caption}>{tr('Aucune recette trouvée.','No recipe found.','No se encontró ninguna receta.')}</Text>}
   {recipeMatches.slice(0,15).map(recipe=><View key={recipe.id} style={s.material}><Text style={s.body}>{recipeNames.get(recipe.itemIdCandidate)??recipeNames.get(recipe.sourceId)??recipe.itemIdCandidate}</Text><Text style={s.caption}>{recipe.itemIdCandidate} · {recipe.id}</Text><Text style={s.caption}>{recipe.materials.map(m=>`${m.quantity} × ${m.itemIdCandidate}`).join(' · ')}</Text><Text style={s.caption}>{tr('Production','Output','Producción')}: {recipe.outputQuantity??'?'} · {tr('Coût fixe source','Source fixed cost','Coste fijo fuente')}: {recipe.silverCost??'?'} · swap: {recipe.swapTransaction===null?'?':String(recipe.swapTransaction)}</Text>{unsupportedRecipe(recipe)?<Text style={s.caption}>{tr('Variante non prise en charge : échange ou plafond de retour.','Unsupported variant: swap or capped return.','Variante no compatible: intercambio o límite de retorno.')}</Text>:<Action label={tr('Charger cette variante','Load this variant','Cargar esta variante')} disabled={busy||marketBusy} onPress={()=>chooseRecipe(recipe)}/>}</View>)}
  </Panel>
  {!!draft.metadata.recipe&&<View style={s.card}>
   <Text style={s.panelTitle}>{tr('Recette chargée','Recipe loaded','Receta cargada')} · {draft.label}</Text>
   <Text style={s.caption}>{tr('Coût fixe source','Source fixed cost','Coste fijo fuente')}: {draft.metadata.recipe.silverCost??tr('inconnu','unknown','desconocido')} · {tr('Échange','Swap','Intercambio')}: {draft.metadata.recipe.swapTransaction===null?tr('inconnu','unknown','desconocido'):draft.metadata.recipe.swapTransaction?tr('oui','yes','sí'):tr('non','no','no')}</Text>
   <Pressable accessibilityRole="button" accessibilityState={{expanded:recipeInfo}} onPress={()=>setRecipeInfo(v=>!v)} style={s.detailToggle}><Text style={s.infoLink}>{tr('Détails et provenance','Details and provenance','Detalles y procedencia')} {recipeInfo?'−':'+'}</Text></Pressable>
   {recipeInfo&&<Text style={s.caption}>{draft.metadata.recipe.id} · {draft.metadata.recipe.revision}. {tr('Vérifiez les identifiants candidats, le rendement, les retours et les contraintes inconnues. Incluez le coût fixe source dans les frais par fabrication. Cette provenance est déclarative.','Verify candidate IDs, output, returns and unknown constraints. Include the source fixed cost in the fee per craft. This provenance is declarative.','Verifica identificadores candidatos, producción, retornos y condiciones desconocidas. Incluye el coste fijo fuente en la tasa por fabricación. Esta procedencia es declarativa.')}</Text>}
   {draft.materials.length===0&&<Text style={s.caption}>{tr('Matériaux absents de la source : ajoutez-les manuellement après vérification.','Materials missing from the source: add them manually after verification.','Materiales ausentes de la fuente: añádelos manualmente tras verificarlos.')}</Text>}
   <Action label={`${recipeConfirmed?'✓ ':''}${tr('Je confirme les contraintes et coûts','I confirm constraints and costs','Confirmo condiciones y costes')}`} onPress={()=>setRecipeConfirmed(v=>!v)}/>
   <Action label={tr('Détacher en scénario manuel','Detach as manual scenario','Desvincular como escenario manual')} onPress={()=>{setDraft(d=>{const metadata={...d.metadata};delete metadata.recipe;return {...d,metadata};});setRecipeConfirmed(false);setDetached(true);setAnswer(null);}}/>
   <Text style={s.caption}>{tr('Détacher conserve les champs saisis ; la recette et ses contraintes deviennent des hypothèses manuelles non vérifiées.','Detaching keeps entered fields; the recipe and its constraints become unverified manual assumptions.','Desvincular conserva los campos; la receta y sus condiciones pasan a ser hipótesis manuales no verificadas.')}</Text>
  </View>}
  {detached&&<Text style={s.notice}>{tr('Scénario détaché : recette et contraintes manuelles non vérifiées.','Detached scenario: recipe and constraints are unverified manual assumptions.','Escenario desvinculado: receta y condiciones manuales no verificadas.')}</Text>}
  <Panel title={tr('Scénario','Scenario','Escenario')} summary={draft.label||tr('Nom et quantité','Name and quantity','Nombre y cantidad')} open={openBasics} onToggle={()=>setOpenBasics(v=>!v)}>
   {draftLocale!==lang&&<Text style={s.caption}>{tr('Les nombres conservent leur format initial','Numbers retain their original format','Los números conservan su formato original')}: {draftLocale.toUpperCase()}</Text>}
   <Label>{editLabel}</Label><TextInput accessibilityLabel={editLabel} value={draft.label} onChangeText={v=>update('label',v)} style={s.input} maxLength={120} />
   {row(tr('Nombre de fabrications','Number of crafts','Número de fabricaciones'),'quantity',true)}
   {row(tr('Objets produits par fabrication','Outputs per craft','Objetos por fabricación'),'output',true)}
   {row(tr('Prix de vente par objet · silver','Sale price per item · silver','Precio de venta por objeto · plata'),'outputPrice')}
  </Panel>
  <Panel title={tr('Caractéristiques','Characteristics','Características')} summary={tr('Tier, enchantement et ville','Tier, enchantment and city','Nivel, encantamiento y ciudad')} open={openMetadata} onToggle={()=>setOpenMetadata(v=>!v)}>
   <Text style={s.caption}>{tr('Caractéristiques facultatives déclarées par vous, non vérifiées.','Optional characteristics declared by you, not verified.','Características opcionales indicadas por ti, no verificadas.')}</Text>
   <Label>{tr('Catégorie','Category','Categoría')}</Label><TextInput accessibilityLabel={tr('Catégorie','Category','Categoría')} value={draft.metadata.category??''} onChangeText={v=>{setDraft(d=>{const metadata={...d.metadata};if(v)metadata.category=v;else delete metadata.category;return {...d,metadata};});setAnswer(null);}} style={s.input} maxLength={64}/>
   <Label>Tier</Label><View style={s.row}><Action label={`${draft.metadata.tier===undefined?'✓ ':''}${tr('Inconnu','Unknown','Desconocido')}`} onPress={()=>{setDraft(d=>{const metadata={...d.metadata};delete metadata.tier;return {...d,metadata};});setAnswer(null);}}/>{[1,2,3,4,5,6,7,8].map(v=><Action key={v} label={`${draft.metadata.tier===v?'✓ ':''}T${v}`} onPress={()=>updateMeta({tier:v})}/>)}</View>
   <Label>{tr('Enchantement','Enchantment','Encantamiento')}</Label><View style={s.row}><Action label={draft.metadata.enchantment===undefined?'✓ ?':'?'} onPress={()=>setDraft(d=>{const metadata={...d.metadata};delete metadata.enchantment;return {...d,metadata};})}/>{[0,1,2,3,4].map(v=><Action key={v} label={`${draft.metadata.enchantment===v?'✓ ':''}.${v}`} onPress={()=>updateMeta({enchantment:v})}/>)}</View>
   <Label>{tr('Ville de production · facultatif','Production city · optional','Ciudad de producción · opcional')}</Label><View style={s.row}>{CITIES.map(city=><Action key={city} label={`${draft.metadata.productionCity===city?'✓ ':''}${city}`} onPress={()=>updateMeta({productionCity:city})}/>)}</View><Text style={s.caption}>{tr('Le bonus local n’est pas calculé automatiquement : saisissez vous-même le taux de retour applicable.','Local bonuses are not calculated automatically: enter the applicable return rate yourself.','Las bonificaciones locales no se calculan automáticamente: indica la tasa de retorno aplicable.')}</Text>
  </Panel>
  <Panel title={tr('Matériaux','Materials','Materiales')} summary={`${draft.materials.length} ${tr('matériau(x)','material(s)','material(es)')}`} open={openMaterials} onToggle={()=>setOpenMaterials(v=>!v)}>
   <Text style={s.section}>{tr('Matériaux par fabrication','Materials per craft','Materiales por fabricación')}</Text>
   <Text style={s.caption}>{tr('Chaque matériau est valorisé, même s’il est déjà possédé : indiquez son coût d’opportunité. Le financement suppose cependant l’achat brut externe de toutes les quantités.','Every material has a value, even when already owned: enter its opportunity cost. Funding nevertheless assumes an external purchase of all gross quantities.','Cada material se valora aunque ya se posea: indica su coste de oportunidad. La financiación supone la compra externa de todas las cantidades brutas.')}</Text>
   {draft.materials.map((m,i)=><View key={i} style={s.material}>
    <Label>{tr('Identifiant du matériau','Material ID','Identificador del material')} {i+1}</Label><TextInput accessibilityLabel={`${tr('Identifiant du matériau','Material ID','Identificador del material')} ${i+1}`} value={m.itemId} onChangeText={v=>updateMaterial(i,{itemId:v})} autoCapitalize="characters" style={s.input} maxLength={128}/>
    <NumberInput locale={draftLocale} placeholder={tr('À saisir','Required','Obligatorio')} label={tr('Quantité par fabrication','Amount per craft','Cantidad por fabricación')} value={m.amount} onChangeText={v=>updateMaterial(i,{amount:v})}/>
    <NumberInput locale={draftLocale} placeholder={tr('À saisir','Required','Obligatorio')} label={tr('Prix d’achat / coût d’opportunité unitaire · silver','Purchase price / unit opportunity cost · silver','Precio de compra / coste de oportunidad unitario · plata')} value={m.price} onChangeText={v=>updateMaterial(i,{price:v})}/>
    {draft.priceEvidence.filter(e=>e.key===`material:${m.itemId}`).map(e=><Text key={e.key} style={s.caption}>AODP · {e.city} · {e.observedAt}</Text>)}
    <Label>{tr('Ce matériau est-il retournable ?','Is this material returnable?','¿Se devuelve este material?')}</Label>{noReturnIds.has(m.itemId)&&<Text style={s.caption}>{tr('Retour interdit par la variante source.','Return prohibited by the source variant.','La variante fuente prohíbe la devolución.')}</Text>}
    <View style={s.row}><Action label={m.returnable===true?'✓ '+tr('Oui','Yes','Sí'):tr('Oui','Yes','Sí')} disabled={noReturnIds.has(m.itemId)} onPress={()=>updateMaterial(i,{returnable:true})}/><Action label={m.returnable===false?'✓ '+tr('Non','No','No'):tr('Non','No','No')} onPress={()=>updateMaterial(i,{returnable:false})}/>{draft.materials.length>1&&<Action label={tr('Retirer','Remove','Quitar')} onPress={()=>{setDraft(d=>({...d,materials:d.materials.filter((_,j)=>j!==i),priceEvidence:d.priceEvidence.filter(e=>e.key!==`material:${d.materials[i].itemId}`)}));setAnswer(null);}}/>}</View>
   </View>)}
   <Action label={tr('Ajouter un matériau','Add a material','Añadir material')} disabled={draft.materials.length>=64} onPress={()=>setDraft(d=>({...d,materials:[...d.materials,{itemId:'',amount:'',price:'',returnable:null}]}))}/>
  </Panel>
  <Panel title={tr('Coûts et contraintes','Costs and constraints','Costes y restricciones')} summary={tr('Retour, frais, focus et budget','Returns, fees, focus and budget','Retorno, tasas, foco y presupuesto')} open={openParams} onToggle={()=>setOpenParams(v=>!v)}>
   <Text style={s.section}>{tr('Paramètres du scénario','Scenario assumptions','Parámetros del escenario')}</Text>
   {row(tr('Retour de ressources · %','Resource return · %','Retorno de recursos · %'),'returnPercent')}
   {row(tr('Frais de station par fabrication · silver','Station fee per craft · silver','Tasa de estación por fabricación · plata'),'stationFee')}
   {row(tr('Focus par fabrication','Focus per craft','Foco por fabricación'),'focus')}
   {row(tr('Taxe de vente · %','Sales tax · %','Impuesto de venta · %'),'taxPercent')}
   {row(tr('Frais d’ordre de vente · %','Sell order fee · %','Tasa de orden de venta · %'),'orderPercent')}
   <Text style={s.caption}>{tr('Saisissez 0 explicitement pour un coût ou taux nul. La vente par ordre et sa réalisation ne sont pas garanties.','Enter 0 explicitly for a zero fee or rate. An order and its execution are not guaranteed.','Introduce 0 explícitamente para una tasa o coste nulo. No se garantiza la ejecución de órdenes.')}</Text>
   {row(tr('Budget disponible · silver','Available budget · silver','Presupuesto disponible · plata'),'budget',false,true)}
   {row(tr('Focus disponible','Available focus','Foco disponible'),'availableFocus',false,true)}
   {row(tr('Unités observées','Observed units','Unidades observadas'),'volume',false,true)}
   {row(tr('Période d’observation · jours','Observation period · days','Período observado · días'),'days',false,true)}
  </Panel>
  <Panel title={tr('Prix et historique AODP','AODP prices and history','Precios e historial AODP')} summary={tr('Villes, qualité et mode de vente','Cities, quality and sale mode','Ciudades, calidad y modo de venta')} open={openMarket} onToggle={()=>setOpenMarket(v=>!v)}>
   <Text style={s.section}>{tr('Prix AODP facultatifs','Optional AODP prices','Precios AODP opcionales')}</Text>
   <Text style={s.caption}>{tr('Recherche limitée aux identifiants renseignés. Seuls les prix âgés de moins d’une heure sont appliqués. Vérifiez la recette et saisissez les taux et frais.','Only the entered item IDs are queried. Only prices less than one hour old are applied. Verify the recipe and enter rates and fees.','Solo se consultan los identificadores indicados. Solo se aplican precios de menos de una hora. Verifica la receta e introduce tasas y costes.')}</Text>
   <Label>{tr('Identifiant de l’objet produit','Output item ID','Identificador del objeto producido')}</Label><TextInput accessibilityLabel={tr('Identifiant de l’objet produit','Output item ID','Identificador del objeto producido')} value={productId} onChangeText={v=>{setProductId(v);setDraft(d=>{const metadata={...d.metadata};if(v)metadata.outputItemId=v;else delete metadata.outputItemId;return {...d,metadata};});setAnswer(null);}} style={s.input} autoCapitalize="characters" maxLength={100}/>
   <Label>{tr('Ville d’achat des matériaux','Material purchase city','Ciudad de compra de materiales')}</Label><View style={s.row}>{CITIES.map(city=><Action key={city} label={`${buyCity===city?'✓ ':''}${city}`} onPress={()=>{setBuyCity(city);updateMeta({buyCity:city});}}/>)}</View>
   <Label>{tr('Ville de vente','Sale city','Ciudad de venta')}</Label><View style={s.row}>{CITIES.map(city=><Action key={city} label={`${sellCity===city?'✓ ':''}${city}`} onPress={()=>{setSellCity(city);updateMeta({sellCity:city});}}/>)}</View>
   <Text style={s.caption}>{tr('Les recherches de prix des matériaux utilisent uniquement la qualité 1. Pour toute autre qualité, saisissez le prix manuellement.','Material price lookups use quality 1 only. Enter the price manually for other qualities.','Las consultas de materiales usan solo calidad 1. Para otras calidades, introduce el precio manualmente.')}</Text><Label>{tr('Qualité de l’objet produit','Output quality','Calidad del objeto producido')}</Label><View style={s.row}>{([1,2,3,4,5] as Quality[]).map(q=><Action key={q} label={`${quality===q?'✓ ':''}Q${q}`} onPress={()=>{setQuality(q);updateMeta({quality:q});}}/>)}</View>
   <Label>{tr('Prix de vente de référence','Sale reference price','Precio de referencia de venta')}</Label><View style={s.row}><Action label={`${saleSide==='saleImmediate'?'✓ ':''}${tr('Vente immédiate','Immediate sale','Venta inmediata')}`} onPress={()=>{setSaleSide('saleImmediate');updateMeta({saleSide:'saleImmediate'});}}/><Action label={`${saleSide==='saleOrderReference'?'✓ ':''}${tr('Ordre de vente','Sell order','Orden de venta')}`} onPress={()=>{setSaleSide('saleOrderReference');updateMeta({saleSide:'saleOrderReference'});}}/></View>
   <View style={s.row}><Action label={`${offlineOnly?'✓ ':''}${tr('Cache uniquement','Cache only','Solo caché')}`} onPress={()=>setOfflineOnly(v=>!v)}/><Action label={tr('Charger les prix','Load prices','Cargar precios')} disabled={busy||marketBusy} onPress={()=>void fetchPrices()}/><Action label={tr('Historique observé · 7 jours','Observed history · 7 days','Historial observado · 7 días')} disabled={busy||marketBusy} onPress={()=>void fetchHistory()}/>{marketBusy&&<><ActivityIndicator color={COLORS.primary}/><Action label={tr('Annuler','Cancel','Cancelar')} onPress={()=>marketAbort.current?.abort()}/></>}</View>
   {!!marketNotice&&<Text style={s.caption}>{marketNotice}</Text>}
   {draft.priceEvidence.filter(e=>e.key==='output').map(e=><Text key={e.key} style={s.caption}>AODP · {e.city} · Q{e.quality} · {e.side} · {e.observedAt}</Text>)}
   {!!draft.volumeEvidence&&<Text style={s.caption}>AODP · {draft.volumeEvidence.itemId} · {draft.volumeEvidence.city} · Q{draft.volumeEvidence.quality} · {new Date(draft.volumeEvidence.startMs).toISOString()} — {new Date(draft.volumeEvidence.endMs).toISOString()} · {tr('observations, pas ventes garanties','observations, not guaranteed sales','observaciones, no ventas garantizadas')}</Text>}
  </Panel>
  {mode==='optimizer'&&<Panel title={tr('Classement','Ranking','Clasificación')} summary={`${scenarios.length} ${tr('scénario(x)','scenario(s)','escenario(s)')}`} open={openRanking} onToggle={()=>setOpenRanking(v=>!v)}>
   <View style={s.row}><Action label={tr('Ajouter au classement','Add to ranking','Añadir a clasificación')} disabled={busy||weightBusy||scenarios.length>=256} onPress={()=>{const item=scenario();if(item){setScenarios(old=>[...old,item]);setError('');setAnswer(null);}}}/><Text style={s.caption}>{scenarios.length}/256</Text></View>
   {scenarios.map((item,i)=><View key={i} style={s.scenarioRow}><Text style={s.body}>{i+1}. {item.label}</Text><Action label={tr('Retirer','Remove','Quitar')} disabled={busy||weightBusy} onPress={()=>{setScenarios(old=>old.filter((_,j)=>j!==i));setAnswer(null);}}/></View>)}
   <Text style={s.caption}>{tr('Filtres appliqués uniquement aux caractéristiques déclarées. Une caractéristique inconnue ne correspond pas à un filtre actif.','Filters use declared characteristics only. Unknown characteristics do not match an active filter.','Los filtros usan solo características declaradas. Los valores desconocidos no coinciden con filtros activos.')}</Text>
   <Label>Tier</Label><View style={s.row}><Action label={`${filterTier===null?'✓ ':''}${tr('Tous','All','Todos')}`} onPress={()=>{setFilterTier(null);setAnswer(null);}}/>{[1,2,3,4,5,6,7,8].map(v=><Action key={v} label={`${filterTier===v?'✓ ':''}T${v}`} onPress={()=>{setFilterTier(v);setAnswer(null);}}/>)}</View>
   <Label>{tr('Enchantement','Enchantment','Encantamiento')}</Label><View style={s.row}><Action label={`${filterEnchant===null?'✓ ':''}${tr('Tous','All','Todos')}`} onPress={()=>{setFilterEnchant(null);setAnswer(null);}}/>{[0,1,2,3,4].map(v=><Action key={v} label={`${filterEnchant===v?'✓ ':''}.${v}`} onPress={()=>{setFilterEnchant(v);setAnswer(null);}}/>)}</View>
   <Label>{tr('Qualité','Quality','Calidad')}</Label><View style={s.row}><Action label={`${filterQuality===null?'✓ ':''}${tr('Toutes','All','Todas')}`} onPress={()=>{setFilterQuality(null);setAnswer(null);}}/>{[1,2,3,4,5].map(v=><Action key={v} label={`${filterQuality===v?'✓ ':''}Q${v}`} onPress={()=>{setFilterQuality(v);setAnswer(null);}}/>)}</View>
   <Label>{tr('Filtre catégorie','Category filter','Filtro de categoría')}</Label><TextInput accessibilityLabel={tr('Filtre catégorie','Category filter','Filtro de categoría')} value={filterCategory} onChangeText={v=>{setFilterCategory(v);setAnswer(null);}} style={s.input} maxLength={80}/>
   <Label>{tr('Filtre ville de vente','Sale city filter','Filtro de ciudad de venta')}</Label><View style={s.row}><Action label={`${filterCity===null?'✓ ':''}${tr('Toutes','All','Todas')}`} onPress={()=>{setFilterCity(null);setAnswer(null);}}/>{CITIES.map(v=><Action key={v} label={`${filterCity===v?'✓ ':''}${v}`} onPress={()=>{setFilterCity(v);setAnswer(null);}}/>)}</View>
   <Label>{tr('Classer par','Rank by','Ordenar por')}</Label><View style={s.row}>{(['profit','roi','focus','liquidity'] as const).map(r=><Action key={r} label={(ranking===r?'✓ ':'')+({profit:tr('Profit','Profit','Ganancia'),roi:'ROI',focus:tr('Silver / focus','Silver / focus','Plata / foco'),liquidity:tr('Liquidité observée','Observed liquidity','Liquidez observada')}[r])} onPress={()=>{setRanking(r);setAnswer(null);}}/>)}</View>
   <Text style={s.caption}>{filteredScenarios.length} / {scenarios.length} {tr('scénarios correspondent','scenarios match','escenarios coinciden')}</Text>
   <Action label={tr('Comparer les scénarios','Compare scenarios','Comparar escenarios')} disabled={busy||weightBusy||!filteredScenarios.length} onPress={()=>void execute('find_profitable_crafts',filteredScenarios)}/>
  </Panel>}
  {mode==='plan'&&<><View style={s.row}><Action label={`${maximizeQuantity?'✓ ':''}${tr('Quantité maximale sous contraintes','Maximum quantity under constraints','Cantidad máxima según restricciones')}`} disabled={busy||weightBusy} onPress={()=>{setMaximizeQuantity(v=>!v);setAnswer(null);}}/></View><View style={s.row}><Action label={tr('Sauvegarder','Save','Guardar')} disabled={busy||weightBusy} onPress={()=>void savePlan()}/><Action label={tr('Charger','Load','Cargar')} disabled={busy||weightBusy} onPress={()=>void loadPlans()}/></View></>}
  {mode==='plan'&&<Panel title={tr('Poids des matériaux','Material weight','Peso de materiales')} summary={tr('Après calcul du plan','After calculating a plan','Tras calcular el plan')} open={openWeight} onToggle={()=>setOpenWeight(v=>!v)}>
   <Text style={s.section}>{tr('Poids brut des matériaux','Gross material weight','Peso bruto de materiales')}</Text>
   <Text style={s.caption}>{tr('Un plan réalisable et une correspondance exacte avec la variante source sont requis ; la quantité retenue par le moteur est utilisée. L’unité de poids de la source reste à confirmer.','A feasible plan and exact source variant and materials are required; uses the quantity selected by the engine. The source weight unit remains unconfirmed.','Se requieren un plan viable y una correspondencia exacta con la variante fuente; se usa la cantidad seleccionada por el motor. La unidad de peso fuente no está confirmada.')}</Text>
   <Action label={tr('Calculer le poids','Calculate weight','Calcular peso')} disabled={busy||weightBusy||marketBusy} onPress={()=>void calculateWeight()}/>
   {weightBusy&&<View style={s.row}><ActivityIndicator color={COLORS.primary}/><Action label={tr('Annuler','Cancel','Cancelar')} onPress={()=>weightGate.current.cancel()}/></View>}
   {!!weightNotice&&<Text style={s.caption}>{weightNotice}</Text>}
   {weightResult?.status==='ok'&&<><Text style={s.body}>{tr('Fabrications','Crafts','Fabricaciones')}: {weightQuantity} · {tr('Poids total','Total weight','Peso total')}: {weightResult.total===null?tr('inconnu','unknown','desconocido'):weightResult.total.toLocaleString(lang,{maximumFractionDigits:3})} · {tr('unité source non confirmée','unconfirmed source unit','unidad fuente no confirmada')}</Text>{weightResult.total===null&&<Text style={s.caption}>{tr('Sous-total connu','Known subtotal','Subtotal conocido')}: {weightResult.knownSubtotal.toLocaleString(lang,{maximumFractionDigits:3})} · {tr('Poids manquants','Missing weights','Pesos faltantes')}: {weightResult.missing.map(m=>`${m.sourceId} (${m.enchantment??'?'})`).join(', ')}</Text>}</>}
  </Panel>}
  {mode==='plan'&&showSaved&&<View style={s.card}><Text style={s.section}>{tr('Plans sauvegardés','Saved plans','Planes guardados')}</Text>{saved.length===0&&<Text style={s.caption}>{tr('Aucun plan sauvegardé.','No saved plans.','No hay planes guardados.')}</Text>}{saved.map(plan=><Action key={plan.id} label={`${plan.scenario.label} · ${plan.createdAt}`} onPress={()=>{restoreScenario(plan.scenario);setShowSaved(false);}}/>)}</View>}
  {mode==='plan'&&<Panel title={tr('Chaîne de production','Production chain','Cadena de producción')} summary={`${chainSteps.length} ${tr('étape(s)','step(s)','etapa(s)')}`} open={openChain} onToggle={()=>setOpenChain(v=>!v)}>
   <Text style={s.section}>{tr('Chaîne explicite','Explicit chain','Cadena explícita')}</Text><Text style={s.caption}>{tr('Le poids agrégé de la chaîne n’est pas encore disponible.','Aggregate chain weight is not yet available.','El peso agregado de la cadena aún no está disponible.')}</Text>
   <Text style={s.caption}>{tr('Ajoutez 2 à 12 étapes dans l’ordre. Chaque sortie intermédiaire doit être utilisée comme matériau d’une étape suivante et entièrement consommée. Les contraintes par scénario sont remplacées ici par les limites globales ci-dessous. Les retours estimés ne sont jamais réutilisés comme stock certain.','Add 2 to 12 steps in order. Every intermediate output must be used as a material in a later step and fully consumed. Per-scenario constraints are replaced by the overall limits below. Estimated returns are never reused as certain stock.','Añade de 2 a 12 etapas en orden. Cada salida intermedia debe utilizarse como material en una etapa posterior y consumirse por completo. Las restricciones por escenario se sustituyen por los límites globales siguientes. Los retornos estimados nunca se reutilizan como existencias seguras.')}</Text>
   <Action label={tr('Ajouter le formulaire comme étape','Add form as a step','Añadir formulario como etapa')} disabled={busy||chainSteps.length>=12} onPress={()=>{const item=scenario();if(!item)return;const id=item.metadata?.outputItemId;if(!id){setError(tr('Indiquez l’identifiant de sortie.','Enter the output item ID.','Indica el identificador de salida.'));return;}if(chainSteps.some(step=>step.outputItemId===id)){setError(tr('Identifiant de sortie déjà utilisé.','Output item ID already used.','Identificador de salida ya utilizado.'));return;}setChainSteps(old=>[...old,{outputItemId:id,scenario:{...item,budget:null,availableFocus:null}}]);setAnswer(null);setError('');}}/>
   {chainSteps.map((step,i)=><View key={`${step.outputItemId}-${i}`} style={s.scenarioRow}><Text style={s.body}>{i+1}. {step.scenario.label} → {step.outputItemId}</Text><Action label={tr('Retirer','Remove','Quitar')} disabled={busy||weightBusy} onPress={()=>{setChainSteps(old=>old.filter((_,j)=>j!==i));setAnswer(null);}}/></View>)}
   {chainSteps.some(step=>step.scenario.metadata?.recipe)&&<Action label={`${chainConfirmed?'✓ ':''}${tr('Je confirme les contraintes et frais des recettes de cette chaîne','I confirm the recipe constraints and costs in this chain','Confirmo las condiciones y costes de las recetas de esta cadena')}`} onPress={()=>setChainConfirmed(v=>!v)}/>}
   <NumberInput locale={draftLocale} placeholder={tr('Facultatif','Optional','Opcional')} label={tr('Budget global · facultatif','Overall budget · optional','Presupuesto global · opcional')} value={chainBudget} onChangeText={v=>{setChainBudget(v);setAnswer(null);}}/>
   <NumberInput locale={draftLocale} placeholder={tr('Facultatif','Optional','Opcional')} label={tr('Focus global · facultatif','Overall focus · optional','Foco global · opcional')} value={chainFocus} onChangeText={v=>{setChainFocus(v);setAnswer(null);}}/>
   <View style={s.row}><Action label={tr('Calculer la chaîne','Calculate chain','Calcular cadena')} disabled={busy||chainSteps.length<2} onPress={()=>void executeChain()}/><Action label={tr('Sauvegarder la chaîne','Save chain','Guardar cadena')} disabled={busy||chainSteps.length<2} onPress={()=>void saveChain()}/><Action label={tr('Charger une chaîne','Load chain','Cargar cadena')} disabled={busy||weightBusy} onPress={()=>void loadChains()}/></View>
   {showChains&&<View>{savedChains.length===0&&<Text style={s.caption}>{tr('Aucune chaîne sauvegardée.','No saved chains.','No hay cadenas guardadas.')}</Text>}{savedChains.map(chain=><Action key={chain.id} label={`${chain.createdAt} · ${chain.steps.map(step=>step.scenario.label).join(' → ')}`} onPress={()=>{const checked=chain.steps.map(step=>{const scenario=reconcile(step.scenario);return scenario?{...step,scenario}:null;});if(checked.some(step=>!step)){catalogueError();return;}setChainSteps(checked as ProductionChainStep[]);setChainBudget(chain.budget===null?'':textValue(chain.budget,draftLocale));setChainFocus(chain.availableFocus===null?'':textValue(chain.availableFocus,draftLocale));setShowChains(false);setAnswer(null);}}/>)}</View>}
  </Panel>}
  <Panel title={tr('Autres actions','More actions','Más acciones')} summary={tr('Transfert et IA','Transfer and AI','Transferencia e IA')} open={openMore} onToggle={()=>setOpenMore(v=>!v)}>
  {mode!=='plan'&&onTransfer&&<Action label={tr('Envoyer ce scénario à Plan','Send this scenario to Plan','Enviar este escenario a Plan')} disabled={busy||weightBusy} onPress={()=>{const item=scenario();if(item)onTransfer(item);}}/>}
  <Action label={tr('Autoriser ce scénario pour l’IA','Approve this scenario for AI','Autorizar este escenario para la IA')} disabled={busy||marketBusy||approving} onPress={()=>void approveForAI()}/>
  {!!approval&&<Text selectable style={s.caption}>{tr('Scénario approuvé pour cette session, au plus 30 minutes. Identifiant à transmettre à l’IA :','Scenario approved for this session, for at most 30 minutes. ID to provide to the AI:','Escenario autorizado para esta sesión, hasta 30 minutos. Identificador para la IA:')} {approval}</Text>}
  </Panel>
 </ScrollView></View>;
}

function ChainResult({result:r,lang}:{result:ProductionChainResult;lang:Language}){
 const [detail,setDetail]=useState(false);
 const tr=(fr:string,en:string,es:string)=>lang==='fr'?fr:lang==='es'?es:en;
 const f=(v:number|null)=>v===null?tr('Non réalisé','Not realized','No realizado'):v.toLocaleString(lang,{maximumFractionDigits:2});
 const lines:[string,number|null][]=[
  [tr('Achats externes','External purchases','Compras externas'),r.externalPurchaseCost],
  [tr('Frais de station','Station fees','Tasas de estación'),r.stationFees],
  [tr('Frais d’ordre final','Final order fee','Tasa de orden final'),r.sellOrderFee],
  [tr('Capital initial requis','Initial capital required','Capital inicial requerido'),r.initialCapitalRequired],
  [tr('Trésorerie avant vente','Cash flow before sale','Flujo de caja antes de la venta'),r.cashFlowBeforeFinalSale],
  [tr('Focus requis','Focus required','Foco requerido'),r.focusRequired],
  [tr('Revenu brut si vente','Gross revenue if sold','Ingresos brutos si se vende'),r.grossRevenueIfSold],
  [tr('Taxe de vente','Sales tax','Impuesto de venta'),r.salesTax],
  [tr('Profit en espèces si vente','Cash profit if sold','Ganancia en efectivo si se vende'),r.cashProfitIfFinalSale],
  [tr('Valeur estimée des retours','Estimated return asset value','Valor estimado del retorno'),r.expectedReturnAssetValueAtInputPrices],
  [tr('Profit estimé avec retours','Estimated profit including returns','Ganancia estimada con retornos'),r.estimatedProfitIncludingReturns],
  [tr('Profit réalisé','Realized profit','Ganancia realizada'),r.realizedProfit],
  [tr('ROI estimé · %','Estimated ROI · %','ROI estimado · %'),r.roiPercent],
 ];
 return <View style={s.card}>
  <Text style={s.resultTitle}>{tr('Résultat de la chaîne','Chain result','Resultado de la cadena')}: {r.finalOutputItemId} × {f(r.finalOutputUnits)}</Text>
  {!r.feasible&&<Text style={s.error}>{tr('Contraintes non respectées','Constraints not met','Restricciones no cumplidas')}: {r.violations.join(', ')}</Text>}
  <Text style={s.profit}>{tr('Profit estimé avec retours','Estimated profit including returns','Ganancia estimada con retornos')}: {f(r.estimatedProfitIncludingReturns)} silver</Text>
  <Text style={s.caption}>{tr('Vente et retours non garantis.','Sale and returns are not guaranteed.','Venta y retornos no garantizados.')}</Text>
  <View style={s.metricRow}><View style={s.metric}><Text style={s.metricLabel}>{tr('Capital requis','Capital required','Capital requerido')}</Text><Text style={s.metricValue}>{f(r.initialCapitalRequired)}</Text></View><View style={s.metric}><Text style={s.metricLabel}>{tr('Profit si vente','Profit if sold','Ganancia si se vende')}</Text><Text style={s.metricValue}>{f(r.cashProfitIfFinalSale)}</Text></View></View>
  <Pressable accessibilityRole="button" accessibilityState={{expanded:detail}} onPress={()=>setDetail(v=>!v)} style={s.detailToggle}><Text style={s.infoLink}>{detail?tr('Masquer le détail','Hide details','Ocultar detalle'):tr('Voir le détail de la chaîne','View chain details','Ver detalle de la cadena')} {detail?'−':'+'}</Text></Pressable>
  {detail&&<>
  {lines.map(([label,value])=><View key={label} style={s.resultRow}><Text style={s.body}>{label}</Text><Text style={s.resultValue}>{f(value)}</Text></View>)}
  {r.steps.map(step=><View key={`${step.index}-${step.outputItemId}`} style={s.material}><Text style={s.body}>{step.index+1}. {step.label} → {step.outputItemId} × {f(step.outputUnits)}</Text>{step.inputs.map(input=><Text key={input.itemId} style={s.caption}>{input.itemId} · {tr('brut','gross','bruto')}: {f(input.grossUnits)} · {tr('issu de la chaîne','from chain','de cadena')}: {f(input.internalUnits)} · {tr('achat externe','external purchase','compra externa')}: {f(input.externalUnits)} · {tr('retour attendu','expected return','retorno esperado')}: {f(input.expectedReturnedUnits)}</Text>)}<Text style={s.caption}>{tr('Frais station','Station fees','Tasas de estación')}: {f(step.stationFees)} · Focus: {f(step.focusRequired)}</Text></View>)}
  <Text style={s.notice}>{tr('Seul le dernier produit est vendu hypothétiquement. Les retours sont des actifs estimés, jamais réutilisés comme stock certain ; la vente et son prix ne sont pas garantis.','Only the final product is hypothetically sold. Returns are estimated assets, never reused as certain stock; sale and price are not guaranteed.','Solo se vende hipotéticamente el producto final. Los retornos son activos estimados, nunca existencias seguras; la venta y el precio no están garantizados.')}</Text>
  </>}
 </View>;
}

function Result({result:r,scenario,lang,server,onTransfer}:{result:ProductionResult;scenario?:ProductionScenario;lang:Language;server:Server;onTransfer?:()=>void}) {
 const [detail,setDetail]=useState(false);
 const tr=(fr:string,en:string,es:string)=>lang==='fr'?fr:lang==='es'?es:en;
 const f=(v:number|null)=>v===null?tr('Inconnu','Unknown','Desconocido'):Number.isFinite(v)?v.toLocaleString(lang,{maximumFractionDigits:2}):tr('Invalide','Invalid','Inválido');
 const lines:[string,number|null][]=[
  [tr('Capital initial requis','Initial capital required','Capital inicial requerido'),r.initialCapitalRequired],
  [tr('Coût brut des matériaux','Gross material cost','Coste bruto de materiales'),r.grossMaterialCost],
  [tr('Valeur estimée du retour','Expected returned value','Valor estimado del retorno'),r.expectedReturnedValue],
  [tr('Coût net attendu des matériaux','Expected net material cost','Coste neto esperado de materiales'),r.expectedMaterialCost],
  [tr('Frais de station','Station fees','Tasas de estación'),r.stationFees],
  [tr('Coût total attendu','Expected total cost','Coste total esperado'),r.expectedTotalCost],
  [tr('Revenu brut','Gross revenue','Ingresos brutos'),r.grossRevenue],
  [tr('Taxe de vente','Sales tax','Impuesto de venta'),r.salesTax],
  [tr('Frais d’ordre de vente','Sell order fee','Tasa de orden de venta'),r.sellOrderFee],
  [tr('Profit net par objet','Net profit per item','Ganancia neta por objeto'),r.profitPerUnit],
  [tr('ROI · % du capital initial','ROI · % of initial capital','ROI · % del capital inicial'),r.roiPercent],
  [tr('Focus total','Total focus','Foco total'),r.focusRequired],
  [tr('Profit total par focus · non incrémental','Total profit per focus · not incremental','Ganancia total por foco · no incremental'),r.silverPerFocus],
  [tr('Unités observées par jour','Observed units per day','Unidades observadas por día'),r.observedUnitsPerDay],
  [tr('Jours au rythme observé · indicatif','Days at observed rate · indicative','Días al ritmo observado · indicativo'),r.estimatedSaleDays],
 ];
 return <View style={s.card}>
  <Text style={s.resultTitle}>{r.label}</Text><Text style={s.profit}>{tr('Profit net attendu','Expected net profit','Ganancia neta esperada')}: {f(r.netProfit)} silver</Text>
  {!r.feasible&&<Text style={s.error}>{tr('Contraintes non respectées','Constraints not met','Restricciones no cumplidas')}: {r.violations.join(', ')}</Text>}
  <Text style={s.caption}>{server} · {f(r.quantity)} {tr('fabrications','crafts','fabricaciones')} · {f(r.outputUnits)} {tr('objets','items','objetos')} · {scenario?.metadata?.sellCity??tr('ville non précisée','city unspecified','ciudad no indicada')} · {scenario?.metadata?.saleSide==='saleImmediate'?tr('vente immédiate','immediate sale','venta inmediata'):scenario?.metadata?.saleSide==='saleOrderReference'?tr('ordre de vente','sell order','orden de venta'):tr('mode de vente non précisé','sale mode unspecified','modo de venta no indicado')}</Text>
  <Text style={s.caption}>{scenario?.priceEvidence?.find(e=>e.key==='output')?`${tr('Prix de vente AODP','AODP sale price','Precio de venta AODP')} · ${scenario.priceEvidence.find(e=>e.key==='output')!.server} · ${scenario.priceEvidence.find(e=>e.key==='output')!.observedAt}`:tr('Prix de vente manuel, date non vérifiée','Manual sale price, date unverified','Precio de venta manual, fecha no verificada')}</Text>
  <View style={s.metricRow}><View style={s.metric}><Text style={s.metricLabel}>{tr('Capital requis','Capital required','Capital requerido')}</Text><Text style={s.metricValue}>{f(r.initialCapitalRequired)}</Text></View><View style={s.metric}><Text style={s.metricLabel}>ROI</Text><Text style={s.metricValue}>{r.roiPercent===null?'—':`${f(r.roiPercent)} %`}</Text></View></View>
  <Text style={s.caption}>{tr('Profit attendu ; vente et retours non garantis.','Expected profit; sales and returns are not guaranteed.','Ganancia esperada; venta y retornos no garantizados.')}</Text>
  {onTransfer&&<Action label={tr('Transférer vers Plan','Transfer to Plan','Transferir a Plan')} onPress={onTransfer}/>}
  <Pressable accessibilityRole="button" accessibilityState={{expanded:detail}} onPress={()=>setDetail(v=>!v)} style={s.detailToggle}><Text style={s.infoLink}>{detail?tr('Masquer le détail','Hide details','Ocultar detalle'):tr('Voir le détail du calcul','View calculation details','Ver detalle del cálculo')} {detail?'−':'+'}</Text></Pressable>
  {detail&&<>
  {lines.map(([label,value])=><View key={label} style={s.resultRow}><Text style={s.body}>{label}</Text><Text style={s.resultValue}>{f(value)}</Text></View>)}
  <Text style={s.section}>{tr('Matériaux','Materials','Materiales')}</Text>
  {r.materials.map(m=><View key={m.itemId} style={s.material}><Text style={s.body}>{m.itemId}</Text><Text style={s.caption}>{tr('Brut','Gross','Bruto')}: {f(m.grossUnits)} · {tr('Retour attendu','Expected return','Retorno esperado')}: {f(m.expectedReturnedUnits)} · {tr('Consommation attendue','Expected consumed','Consumo esperado')}: {f(m.expectedConsumedUnits)}</Text><Text style={s.caption}>{tr('Prix unitaire','Unit price','Precio unitario')}: {f(m.unitPrice)} · {tr('Coût initial','Upfront cost','Coste inicial')}: {f(m.upfrontCost)} · {tr('Coût net attendu','Expected net cost','Coste neto esperado')}: {f(m.expectedNetCost)}</Text></View>)}
  <Text style={s.notice}>{tr('Recette, frais et prix manuels non vérifiés. Retour moyen : non garanti. Le volume observé ne garantit ni délai ni vente.','Recipe, fees and manual prices are unverified. Returns are expected, not guaranteed. Observed volume does not guarantee timing or a sale.','Receta, costes y precios manuales no verificados. El retorno esperado no está garantizado. El volumen observado no garantiza plazo ni venta.')}</Text>
  {scenario?.priceEvidence?.map(e=><Text key={e.key} style={s.caption}>{e.key}: {e.itemId} · AODP · {e.server} · {e.city} · Q{e.quality} · {e.side} · {e.observedAt}</Text>)}
  {!!scenario?.volumeEvidence&&<Text style={s.caption}>AODP · {scenario.volumeEvidence.itemId} · {scenario.volumeEvidence.server} · {scenario.volumeEvidence.city} · Q{scenario.volumeEvidence.quality} · {new Date(scenario.volumeEvidence.startMs).toISOString()} — {new Date(scenario.volumeEvidence.endMs).toISOString()} · {tr('unités dans les observations','units in observations','unidades en observaciones')}</Text>}
  </>}
 </View>;
}

export function ProductionOptimizer(props:ProductionScreenProps) {return <ProductionScreen {...props} mode="optimizer"/>;}
export function ProductionRefining(props:ProductionScreenProps) {return <ProductionScreen {...props} mode="refining"/>;}
export function ProductionPlanner(props:ProductionScreenProps) {return <ProductionScreen {...props} mode="plan"/>;}

const s=StyleSheet.create({
 metricRow:{flexDirection:'row',columnGap:16,marginTop:4,borderTopWidth:StyleSheet.hairlineWidth,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:COLORS.border},
 metric:{flex:1,minWidth:0,paddingVertical:9},
 metricLabel:{color:COLORS.textSecondary,fontSize:12},
 metricValue:{color:COLORS.text,fontSize:16,fontWeight:'700',fontVariant:['tabular-nums'],marginTop:3},
 detailToggle:{minHeight:48,justifyContent:'center'},
 toolbar:{paddingHorizontal:16,paddingVertical:10,flexDirection:'row',alignItems:'center',gap:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:COLORS.border,backgroundColor:COLORS.card},
 toolbarText:{flex:1,minWidth:0},
 primaryButton:{minHeight:48,paddingHorizontal:14,paddingVertical:9,borderRadius:3,justifyContent:'center',alignItems:'center',backgroundColor:COLORS.primary},
 primaryText:{color:COLORS.onPrimary,fontSize:14,fontWeight:'800',textAlign:'center'},
 panelHeader:{minHeight:48,flexDirection:'row',alignItems:'center',gap:10},
 panelText:{flex:1},
 panelTitle:{color:COLORS.text,fontSize:16,fontWeight:'800'},
 panelSummary:{color:COLORS.textSecondary,fontSize:13,lineHeight:18,marginTop:2},
 panelContent:{gap:8,paddingTop:8},
 chevron:{color:COLORS.textSecondary,fontSize:24,fontWeight:'400',minWidth:22,textAlign:'center'},
 intro:{color:COLORS.textSecondary,fontSize:13,lineHeight:19},
 infoLink:{color:COLORS.primary,fontSize:13,fontWeight:'700'},
 root:{flex:1,backgroundColor:COLORS.background},
 content:{padding:16,paddingBottom:40,gap:10},
 title:{color:COLORS.text,fontWeight:'800',fontSize:23,letterSpacing:-0.3},
 section:{color:COLORS.text,fontWeight:'800',fontSize:16,marginVertical:8},
 label:{color:COLORS.text,fontWeight:'700',fontSize:14,marginTop:6,marginBottom:4},
 body:{color:COLORS.text,fontSize:14,lineHeight:21,flexShrink:1},
 caption:{color:COLORS.textSecondary,fontSize:12,lineHeight:19,flexShrink:1},
 notice:{color:COLORS.textSecondary,fontSize:13,lineHeight:20,borderLeftWidth:2,borderLeftColor:COLORS.borderStrong,paddingVertical:6,paddingLeft:10},
 input:{color:COLORS.text,backgroundColor:COLORS.card,borderColor:COLORS.borderStrong,borderWidth:1,borderRadius:3,minHeight:48,paddingHorizontal:12,marginBottom:6},
 card:{backgroundColor:COLORS.card,borderColor:COLORS.border,borderTopWidth:StyleSheet.hairlineWidth,borderBottomWidth:StyleSheet.hairlineWidth,padding:12,gap:7},
 material:{borderColor:COLORS.border,borderTopWidth:StyleSheet.hairlineWidth,paddingVertical:9,marginBottom:4,gap:3},
 row:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:6},
 scenarioRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:COLORS.border,paddingVertical:4},
 button:{minHeight:48,backgroundColor:COLORS.card,borderColor:COLORS.borderStrong,borderWidth:1,borderRadius:3,paddingHorizontal:10,paddingVertical:9,justifyContent:'center',alignItems:'center'},
 buttonSelected:{backgroundColor:COLORS.primarySoft,borderColor:COLORS.primary},
 buttonText:{color:COLORS.text,fontWeight:'600',fontSize:13,textAlign:'center'},
 buttonTextSelected:{color:COLORS.primary,fontWeight:'800'},
 disabled:{opacity:0.45},
 error:{color:COLORS.loss,fontSize:14,lineHeight:20},
 resultTitle:{color:COLORS.text,fontSize:18,fontWeight:'800'},
 profit:{color:COLORS.text,fontSize:19,fontWeight:'800',fontVariant:['tabular-nums']},
 resultRow:{flexDirection:'row',justifyContent:'space-between',gap:8,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:COLORS.border,paddingVertical:6},
 resultValue:{color:COLORS.text,fontWeight:'700',fontSize:14,fontVariant:['tabular-nums'],maxWidth:'46%',textAlign:'right'},
});
