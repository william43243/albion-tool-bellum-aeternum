import React, {useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {zones, zoneById, ZoneRisk} from '../lib/worldMap';
import {COLORS} from '../constants/theme';
import {RoutePolicy} from '../lib/worldMapRoutes';
import {planSearch, PlanRequest, PlanResponse} from '../lib/plan';
import {parsePlanCommand} from '../lib/planCommand';
import catalog from '../assets/plan/catalog.json';

type Props = {lang?: string; onShowRoute: (zoneIds: string[]) => void};
const exampleCommand='/plan {"query":"ore","kind":"resource","tier":7,"enchantment":null,"startZoneId":"Fort Sterling","excludedRisks":["red"],"policy":"fewest_transitions"}';
const copy = {
 fr:{title:'Planifier une sortie',sub:'Récolte · créatures · exploration',search:'Ressource ou ennemi',placeholder:'Ex. minerai, bois, sanglier…',kind:'Type',resource:'Ressources',creature:'Créatures récoltables',mob:'Mobs PvE',tier:'Tier',any:'Tous',enchant:'Enchantement',start:'Départ',startSearch:'Rechercher une ville ou une zone',danger:'Exclure du trajet',policy:'Itinéraire',short:'Moins de transitions',safe:'Moins de zones létales',go:'Rechercher',loading:'Recherche en cours…',empty:'Aucune donnée exploitable pour ces filtres.',invalid:'Vérifiez la recherche et le point de départ.',error:'Impossible de charger ou de valider les données.',route:'Afficher sur la carte',noRoute:'Itinéraire indisponible dans le graphe statique.',direct:'Présence documentée',compatible:'Biome compatible · présence non confirmée',quantity:'Quantité théorique',unknown:'Inconnue',sources:'Sources',details:'Détails',warning:'Données statiques et incomplètes ; ni présence actuelle ni sécurité garanties.',count:'résultats',transition:'transitions'},
 en:{title:'Plan an outing',sub:'Gathering · creatures · exploration',search:'Resource or enemy',placeholder:'E.g. ore, wood, boar…',kind:'Type',resource:'Resources',creature:'Harvestable creatures',mob:'PvE mobs',tier:'Tier',any:'Any',enchant:'Enchantment',start:'Starting point',startSearch:'Search a city or zone',danger:'Exclude from route',policy:'Route',short:'Fewest transitions',safe:'Fewest lethal zones',go:'Search',loading:'Searching…',empty:'No usable data for these filters.',invalid:'Check the search and starting point.',error:'Unable to load or validate the data.',route:'Show on map',noRoute:'Route unavailable in the static graph.',direct:'Documented occurrence',compatible:'Compatible biome · occurrence not confirmed',quantity:'Theoretical quantity',unknown:'Unknown',sources:'Sources',details:'Details',warning:'Static, incomplete data; current presence and safety are not guaranteed.',count:'results',transition:'transitions'},
 es:{title:'Planificar una salida',sub:'Recolección · criaturas · exploración',search:'Recurso o enemigo',placeholder:'Ej. mineral, madera, jabalí…',kind:'Tipo',resource:'Recursos',creature:'Criaturas recolectables',mob:'Enemigos PvE',tier:'Nivel',any:'Todos',enchant:'Encantamiento',start:'Origen',startSearch:'Buscar ciudad o zona',danger:'Excluir de la ruta',policy:'Ruta',short:'Menos transiciones',safe:'Menos zonas letales',go:'Buscar',loading:'Buscando…',empty:'No hay datos utilizables para estos filtros.',invalid:'Comprueba la búsqueda y el origen.',error:'No se pudieron cargar o validar los datos.',route:'Mostrar en el mapa',noRoute:'Ruta no disponible en el grafo estático.',direct:'Presencia documentada',compatible:'Bioma compatible · presencia no confirmada',quantity:'Cantidad teórica',unknown:'Desconocida',sources:'Fuentes',details:'Detalles',warning:'Datos estáticos e incompletos; no garantizan presencia actual ni seguridad.',count:'resultados',transition:'transiciones'},
};
const riskNames:Record<string,Record<ZoneRisk,string>>={
 fr:{city:'Ville',blue:'Bleue',yellow:'Jaune',red:'Rouge',black:'Noire',unknown:'Inconnue'},
 en:{city:'City',blue:'Blue',yellow:'Yellow',red:'Red',black:'Black',unknown:'Unknown'},
 es:{city:'Ciudad',blue:'Azul',yellow:'Amarilla',red:'Roja',black:'Negra',unknown:'Desconocida'},
};

export default function PlanScreen({lang='en',onShowRoute}:Props) {
 const language=lang==='fr'?'fr':lang==='es'?'es':'en', t=copy[language];
 const [query,setQuery]=useState(''),[kind,setKind]=useState<PlanRequest['kind']>('resource');
 const [tier,setTier]=useState<number|null>(null),[enchantment,setEnchantment]=useState<number|null>(null);
 const [start,setStart]=useState(()=>zones.find(z=>z.name.toLowerCase()==='fort sterling')?.id??zones.find(z=>z.risk==='city')?.id??'');
 const [startQuery,setStartQuery]=useState(''),[choosingStart,setChoosingStart]=useState(false);
 const [excluded,setExcluded]=useState<ZoneRisk[]>([]),[policy,setPolicy]=useState<RoutePolicy>('fewest_transitions');
 const [response,setResponse]=useState<PlanResponse|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[expanded,setExpanded]=useState<string|null>(null);
 const [command,setCommand]=useState(''),[commandError,setCommandError]=useState(false),[showCommand,setShowCommand]=useState(false);
 const requestNumber=useRef(0);
 const startChoices=useMemo(()=>{
  const q=startQuery.trim().toLocaleLowerCase();
  return (q?zones.filter(z=>`${z.name} ${z.id}`.toLocaleLowerCase().includes(q)):zones.filter(z=>z.risk==='city')).slice(0,12);
 },[startQuery]);
 const invalidate=()=>{requestNumber.current++;setBusy(false);setFailed(false);setResponse(null);setExpanded(null);};
 const runRequest=async(request:PlanRequest)=>{
  const ticket=++requestNumber.current;setFailed(false);setResponse(null);setExpanded(null);setBusy(true);
  try {const next=await planSearch(request);if(ticket===requestNumber.current)setResponse(next);}
  catch {if(ticket===requestNumber.current)setFailed(true);}
  finally {if(ticket===requestNumber.current)setBusy(false);}
 };
 const submit=()=>runRequest({query:query.trim(),kind,tier,enchantment,startZoneId:start,excludedRisks:excluded,policy});
 const submitCommand=()=>{
  const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const request=parsePlanCommand(command,value=>{
   if(zoneById.has(value))return value;
   const matches=zones.filter(z=>normalize(z.name)===normalize(value));return matches.length===1?matches[0].id:undefined;
  });
  if(!request){invalidate();setCommandError(true);return;}
  setCommandError(false);setQuery(request.query);setKind(request.kind);setTier(request.tier);setEnchantment(request.enchantment);setStart(request.startZoneId);setExcluded(request.excludedRisks);setPolicy(request.policy);setChoosingStart(false);void runRequest(request);
 };
 // Compatible biomes alone are not results: keep only documented occurrences
 // with a documented quantity, even if an older native engine is installed.
 const documentedResults=response?.results.filter(result=>result.evidence==='documented'&&typeof result.resourceTier==='number'&&Number.isInteger(result.resourceTier)&&result.resourceTier>=1&&result.resourceTier<=8&&!!result.theoreticalQuantity&&Number.isFinite(result.theoreticalQuantity.value)&&result.theoreticalQuantity.value>=0&&!!result.theoreticalQuantity.unit&&!!result.theoreticalQuantity.scope&&Array.isArray(result.sourceRefs)&&result.sourceRefs.length>0)??[];
 const strictEmpty=language==='fr'?'Aucune donnée de zone avec tier et quantité théorique documentés ne correspond à ces filtres.':language==='es'?'No hay datos de zona con nivel y cantidad teórica documentados que coincidan con estos filtros.':'No zone data with a documented tier and theoretical quantity matches these filters.';
 const strictWarning=language==='fr'?'Seules les données documentées par zone sont affichées. Une quantité théorique ne garantit ni disponibilité actuelle ni sécurité.':language==='es'?'Solo se muestran datos documentados por zona. Una cantidad teórica no garantiza disponibilidad actual ni seguridad.':'Only zone-documented data is shown. A theoretical quantity does not guarantee current availability or safety.';
 const nodeCountLabel=language==='fr'?'nœuds de ressource théoriques':language==='es'?'nodos de recursos teóricos':'theoretical resource nodes';
 const nodeCountExplanation=language==='fr'?'Tous enchantements confondus. Nombre indiqué par la source : distribution de zone ou nœuds placés manuellement, selon le plus élevé. Ce n’est ni le nombre disponible actuellement ni une quantité récoltable.':language==='es'?'Todos los encantamientos juntos. Recuento de la fuente: el mayor entre distribución de zona y nodos colocados manualmente. No es la cantidad disponible actualmente ni el rendimiento de recolección.':'All enchantment levels combined. Source count: the higher of zone distribution or manually placed nodes. This is neither the number currently available nor harvest yield.';
 const unknownScope=language==='fr'?'Périmètre non reconnu':language==='es'?'Alcance no reconocido':'Unrecognized scope';
 const chip=(label:string,onPress:()=>void,active=false,key=label)=><Pressable accessibilityRole="button" accessibilityState={{selected:active}} key={key} onPress={onPress} style={[s.chip,active&&s.chipActive]}><Text style={[s.chipText,active&&s.chipTextActive]}>{label}</Text></Pressable>;
 const group=(label:string,content:React.ReactNode)=><View style={s.group}><Text style={s.label}>{label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={s.chips}>{content}</ScrollView></View>;
 return <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
  <View style={s.heading}><Text accessibilityRole="header" style={s.title}>{t.title}</Text><Text style={s.subtitle}>{t.sub}</Text></View>
  <Pressable accessibilityRole="button" accessibilityState={{expanded:showCommand}} onPress={()=>setShowCommand(v=>!v)} style={s.textControl}><Text style={s.details}>/plan {language==='fr'?'structuré sans IA':language==='es'?'estructurado sin IA':'structured without AI'} {showCommand?'▴':'▾'}</Text></Pressable>
  {showCommand&&<View style={s.group}><Text style={s.caption}>{language==='fr'?'Saisissez la commande et un objet JSON complet. Exemple :':language==='es'?'Introduce el comando y un objeto JSON completo. Ejemplo:':'Enter the command and a complete JSON object. Example:'}</Text><Text selectable style={s.caption}>{exampleCommand}</Text><TextInput accessibilityLabel="/plan" value={command} onChangeText={v=>{setCommand(v);setCommandError(false);invalidate();}} placeholder={exampleCommand} placeholderTextColor={COLORS.textSecondary} multiline autoCorrect={false} autoCapitalize="none" style={[s.input,{minHeight:90,textAlignVertical:'top',paddingVertical:10}]}/><Pressable accessibilityRole="button" disabled={busy} style={s.mapButton} onPress={submitCommand}><Text style={s.mapText}>{t.go}</Text></Pressable>{commandError&&<Text accessibilityRole="alert" style={s.error}>{language==='fr'?'Commande invalide : vérifiez le JSON, les filtres et le départ.':language==='es'?'Comando inválido: comprueba el JSON, los filtros y el origen.':'Invalid command: check the JSON, filters and starting point.'}</Text>}</View>}
  <Text style={s.label}>{t.search}</Text><TextInput accessibilityLabel={t.search} value={query} onChangeText={v=>{setQuery(v);invalidate();}} placeholder={t.placeholder} placeholderTextColor={COLORS.textSecondary} style={s.input} autoCorrect={false}/>
  {group(t.kind,(['resource','creature','mob'] as const).map(v=>chip(t[v],()=>{setKind(v);invalidate();},kind===v)))}
  {group(t.tier,[chip(t.any,()=>{setTier(null);invalidate();},tier===null,'tier-any'),...[1,2,3,4,5,6,7,8].map(v=>chip(`T${v}`,()=>{setTier(v);invalidate();},tier===v,`tier-${v}`))])}
  {group(t.enchant,[chip(t.any,()=>{setEnchantment(null);invalidate();},enchantment===null,'ench-any'),...[0,1,2,3,4].map(v=>chip(`.${v}`,()=>{setEnchantment(v);invalidate();},enchantment===v,`ench-${v}`))])}
  <View style={s.group}><Text style={s.label}>{t.start}</Text>
   <Pressable accessibilityRole="button" accessibilityState={{expanded:choosingStart}} onPress={()=>setChoosingStart(v=>!v)} style={s.selector}><Text style={s.body}>{zoneById.get(start)?.name??t.startSearch} ▾</Text></Pressable>
   {choosingStart&&<View style={s.dropdown}><TextInput accessibilityLabel={t.startSearch} value={startQuery} onChangeText={setStartQuery} placeholder={t.startSearch} placeholderTextColor={COLORS.textSecondary} style={s.input}/>{startChoices.map(z=><Pressable key={z.id} accessibilityRole="button" style={s.option} onPress={()=>{setStart(z.id);setChoosingStart(false);setStartQuery('');invalidate();}}><Text style={s.body}>{z.name} · {riskNames[language][z.risk]}</Text></Pressable>)}</View>}
  </View>
  {group(t.danger,(['blue','yellow','red','black','unknown'] as ZoneRisk[]).map(v=>chip(riskNames[language][v],()=>{setExcluded(old=>old.includes(v)?old.filter(x=>x!==v):[...old,v]);invalidate();},excluded.includes(v),`risk-${v}`)))}
  {group(t.policy,[chip(t.short,()=>{setPolicy('fewest_transitions');invalidate();},policy==='fewest_transitions'),chip(t.safe,()=>{setPolicy('fewest_lethal');invalidate();},policy==='fewest_lethal')])}
  <Pressable accessibilityRole="button" accessibilityLabel={t.go} disabled={busy} accessibilityState={{disabled:busy}} onPress={submit} style={[s.primary,busy&&{opacity:0.6}]}><Text style={s.primaryText}>{t.go}</Text></Pressable>
  <Text style={s.notice}>{strictWarning}</Text>
  {busy&&<View style={s.message}><ActivityIndicator color={COLORS.primary}/><Text style={s.body}>{t.loading}</Text></View>}
  {(failed||response?.status==='data_error')&&<Text accessibilityRole="alert" style={s.error}>{t.error}</Text>}
  {response?.status==='invalid_request'&&<Text accessibilityRole="alert" style={s.error}>{t.invalid}</Text>}
  {response?.status==='no_data'&&<Text style={s.empty}>{strictEmpty}</Text>}
  {!!response?.warnings?.length&&response.warnings.map((v,i)=><Text key={i} style={s.caption}>{v}</Text>)}
  {response?.status==='ok'&&<View style={s.results}><Text accessibilityRole="header" style={s.resultHeading}>{documentedResults.length} {t.count}</Text>{documentedResults.length===0&&<Text style={s.empty}>{strictEmpty}</Text>}{documentedResults.map((result,index)=>{
   const quantity=result.theoreticalQuantity, details=expanded===`${result.zoneId}-${index}`, route=result.route;
   const knownNodeCount=quantity?.unit==='nodes'&&quantity.scope==='zone_distribution_or_hand_placed_whichever_is_greater';
   const share=result.theoreticalProportion;
   return <View key={`${result.zoneId}-${index}`} style={s.card}>
    <Pressable accessibilityRole="button" accessibilityState={{expanded:details}} onPress={()=>setExpanded(details?null:`${result.zoneId}-${index}`)}><View style={s.cardHeader}><Text style={s.cardTitle}>{index+1}. {result.zoneName}</Text><Text style={s.badge}>{riskNames[language][result.risk]??result.risk} · {language==='fr'?'Zone':language==='es'?'Zona':'Zone'} T{result.tier}</Text></View><Text style={s.body}>{result.matchedName} · {result.resourceTier===null?t.unknown:`T${result.resourceTier}`} · {result.biome}</Text><Text style={s.caption}>{t.direct} · {String(result.confidence)}</Text><Text style={s.caption}>{t.quantity}: {quantity?`${quantity.value} ${knownNodeCount?nodeCountLabel:quantity.unit}`:t.unknown}</Text>{quantity&&<Text style={s.caption}>{knownNodeCount?nodeCountExplanation:`${unknownScope}: ${quantity.scope}`}</Text>}<Text style={s.details}>{t.details} {details?'▴':'▾'}</Text></Pressable>
    <Text style={s.caption}>{language==='fr'?'Part théorique des nœuds de la zone':language==='es'?'Proporción teórica de nodos de la zona':'Theoretical share of zone nodes'}: {share?`${share.percent.toFixed(1)} % (${share.numerator}/${share.denominator})`:t.unknown}</Text>
    {details&&<View style={s.detailBox}><Text style={s.caption}>{t.sources}: {!result.sourceRefs.length&&t.unknown}</Text>{result.sourceRefs.map(id=>{const source=catalog.sources.find(item=>item.id===id||item.url===id);return source?<Pressable accessibilityRole="link" key={id} onPress={()=>{Linking.openURL(source.url).catch(()=>{});}}><Text style={s.link}>{source.url}</Text><Text style={s.caption}>{source.accessed_at} · {source.license_status}</Text></Pressable>:<Text key={id} style={s.caption}>{id}</Text>;})}{route?.status==='found'?<><Text style={s.body}>{route.transitions} {t.transition}</Text><Pressable accessibilityRole="button" style={s.mapButton} onPress={()=>onShowRoute(route.zoneIds)}><Text style={s.mapText}>{t.route} ↗</Text></Pressable></>:<Text style={s.caption}>{t.noRoute}</Text>}</View>}
   </View>;
  })}</View>}
 </ScrollView>;
}

const s=StyleSheet.create({
 root:{flex:1,backgroundColor:COLORS.background},
 content:{padding:16,paddingBottom:32,gap:8},
 heading:{borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:COLORS.border,marginBottom:2,paddingBottom:10},
 title:{color:COLORS.text,fontSize:26,fontWeight:'800',letterSpacing:-0.4},
 subtitle:{color:COLORS.textSecondary,fontSize:13,marginTop:3},
 group:{gap:4,marginTop:4},
 label:{color:COLORS.text,fontSize:13,fontWeight:'700',marginTop:4},
 input:{borderWidth:1,borderColor:COLORS.borderStrong,backgroundColor:COLORS.card,borderRadius:3,paddingHorizontal:12,minHeight:48,color:COLORS.text,fontSize:15},
 chips:{gap:5,paddingVertical:2},
 chip:{minHeight:48,minWidth:48,justifyContent:'center',alignItems:'center',borderWidth:1,borderBottomWidth:2,borderRadius:3,backgroundColor:COLORS.card,paddingHorizontal:10,paddingVertical:7,borderColor:COLORS.border},
 chipActive:{borderColor:COLORS.primary,borderBottomColor:COLORS.primary,backgroundColor:COLORS.primarySoft},
 chipText:{color:COLORS.text,fontSize:13},
 chipTextActive:{color:COLORS.primary,fontWeight:'800'},
 selector:{borderWidth:1,borderColor:COLORS.borderStrong,backgroundColor:COLORS.card,borderRadius:3,paddingHorizontal:12,paddingVertical:8,minHeight:48,justifyContent:'center'},
 dropdown:{backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.border,borderRadius:3,padding:8,gap:4},
 option:{minHeight:48,justifyContent:'center',paddingHorizontal:8,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:COLORS.border},
 primary:{backgroundColor:COLORS.primary,minHeight:48,padding:10,borderRadius:3,alignItems:'center',justifyContent:'center',marginTop:8},
 primaryText:{color:COLORS.onPrimary,fontWeight:'800',fontSize:15},
 body:{color:COLORS.text,fontSize:14,lineHeight:20},
 caption:{color:COLORS.textSecondary,fontSize:12,lineHeight:18},
 notice:{color:COLORS.textSecondary,fontSize:12,lineHeight:18,borderLeftWidth:2,borderLeftColor:COLORS.borderStrong,paddingVertical:5,paddingLeft:9},
 error:{color:COLORS.loss,padding:10},
 empty:{color:COLORS.textSecondary,paddingVertical:12},
 message:{flexDirection:'row',alignItems:'center',gap:10,padding:12},
 results:{marginTop:8,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:COLORS.border},
 resultHeading:{fontSize:16,fontWeight:'800',color:COLORS.text,marginBottom:8},
 card:{backgroundColor:COLORS.card,borderColor:COLORS.border,borderTopWidth:StyleSheet.hairlineWidth,padding:12,gap:6},
 cardHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:4},
 cardTitle:{color:COLORS.text,fontSize:16,fontWeight:'800',flex:1},
 badge:{color:COLORS.textSecondary,fontSize:12,flexShrink:1,textAlign:'right'},
 details:{color:COLORS.primary,marginTop:6,fontSize:13,fontWeight:'700'},
 textControl:{alignSelf:'flex-start',minHeight:48,justifyContent:'center'},
 link:{color:COLORS.primary,fontSize:13,textDecorationLine:'underline'},
 detailBox:{gap:7,borderTopWidth:StyleSheet.hairlineWidth,borderColor:COLORS.border,paddingTop:9},
 mapButton:{alignSelf:'flex-start',minHeight:48,justifyContent:'center',borderRadius:3,backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.borderStrong,paddingHorizontal:12},
 mapText:{color:COLORS.primary,fontWeight:'700',fontSize:13},
});
