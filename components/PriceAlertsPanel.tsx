import React, {useCallback, useEffect, useState} from 'react';
import {AppState, Linking, NativeModules, PermissionsAndroid, Platform, Text, TouchableOpacity, View} from 'react-native';

type Rule={id:string;server:string;item_name:string;quality:number;city:string;side:string;operator:string;threshold:number;max_age_minutes:number;status:string;last_status:string;last_checked?:number;observed_at?:number;last_price?:number};
const bridge=NativeModules.PriceAlerts;
export default function PriceAlertsPanel({lang}:{lang:string}) {
 const [rules,setRules]=useState<Rule[]>([]);const [enabled,setEnabled]=useState(false);const [error,setError]=useState(false);
 const fr=lang==='fr';
 const refresh=useCallback(async()=>{if(!bridge)return;try{const data=JSON.parse(await bridge.list());setRules(Array.isArray(data)?data:[]);setEnabled(await bridge.notificationsEnabled());setError(false)}catch{setError(true)}},[]);
 useEffect(()=>{refresh();const listener=AppState.addEventListener('change',state=>{if(state==='active')refresh()});const timer=setInterval(refresh,5000);return()=>{listener.remove();clearInterval(timer)}},[refresh]);
 const permission=async()=>{if(Platform.OS==='android' && Number(Platform.Version)>=33){const result=await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);if(result==='never_ask_again'||(result==='granted'&&!(await bridge.notificationsEnabled())))await Linking.openSettings()}else await Linking.openSettings();await refresh()};
 const change=async(id:string,action:string)=>{try{await bridge.change(id,action);await refresh()}catch{setError(true)}};
 const checkNow=async()=>{try{await bridge.checkNow()}catch{setError(true)}};
 const symbol=(op:string)=>op==='le'?'≤':op==='ge'?'≥':'=';
 const status=(r:Rule)=>{const labels:Record<string,[string,string]>={waiting:['En attente','Waiting'],checked:['Vérifié','Checked'],stale:['Prix trop ancien','Stale price'],no_data:['Prix indisponible','Price unavailable'],api_error:['Erreur API ou réseau','API or network error'],notifications_disabled:['Notifications désactivées','Notifications disabled'],triggered:['Déclenchée','Triggered']};return (labels[r.last_status]||['En attente','Waiting'])[fr?0:1]};
 const dt=(v?:number)=>v?new Date(v).toLocaleString(): '—';
 return <View style={{marginTop:12,borderTopWidth:1,borderTopColor:'#4a4a4a',paddingTop:12}}>
  <Text style={{color:'#f0cb81',fontWeight:'700',fontSize:15}}>{fr?'Alertes de prix':'Price alerts'} ({rules.filter(r=>r.status==='active').length})</Text>
  <Text style={{color:'#bfbfbf',fontSize:12,marginTop:5}}>{fr?'Vérification visée : 20 min, Android peut retarder. Données communautaires parfois anciennes ou absentes; un prix peut être manqué.':'Target: 20 min; Android can delay checks. Community data can be stale or missing; thresholds can be missed.'}</Text>
  {rules.some(r=>r.status==='active')&&<TouchableOpacity onPress={checkNow} style={{paddingVertical:8}}><Text style={{color:'#f0cb81'}}>{fr?'Vérifier maintenant':'Check now'}</Text></TouchableOpacity>}
  {!enabled&&<TouchableOpacity onPress={permission} style={{paddingVertical:8}}><Text style={{color:'#ffca75',fontWeight:'700'}}>{fr?'Activer les notifications Android':'Enable Android notifications'}</Text></TouchableOpacity>}
  {error&&<Text style={{color:'#ff9999'}}>{fr?'Impossible de charger les alertes.':'Could not load alerts.'}</Text>}
  {rules.length===0&&<Text style={{color:'#aaa',marginTop:8}}>{fr?'Demandez à l’agent de créer une alerte pour un objet et une ville.':'Ask the assistant to create an alert for an item and city.'}</Text>}
  {rules.map(r=><View key={r.id} style={{backgroundColor:'#26272c',borderRadius:8,padding:10,marginTop:8}}>
   <Text style={{color:'#fff',fontWeight:'700'}}>{r.item_name} · Q{r.quality} · {r.city}</Text>
   <Text style={{color:'#f0cb81',marginTop:3}}>{r.server} · {r.side==='sell'?(fr?'achat immédiat':'instant buy'):(fr?'vente immédiate':'instant sell')} {symbol(r.operator)} {r.threshold}</Text>
   <Text style={{color:'#bbb',fontSize:12,marginTop:3}}>{fr?'Prix du jour':'Today’s price'}{r.max_age_minutes>0?` · ≤ ${r.max_age_minutes} min`:''} · {r.status==='paused'?(fr?'En pause':'Paused'):status(r)}</Text>
   <Text style={{color:'#bbb',fontSize:12}}>{fr?'Dernier prix':'Last price'}: {r.last_price ?? '—'} · {fr?'Observé':'Observed'}: {dt(r.observed_at)}</Text>
   <Text style={{color:'#bbb',fontSize:12}}>{fr?'Vérifié':'Checked'}: {dt(r.last_checked)}</Text>
   <View style={{flexDirection:'row',marginTop:6}}><TouchableOpacity onPress={()=>change(r.id,r.status==='active'?'pause':'resume')} style={{paddingRight:20,paddingVertical:6}}><Text style={{color:'#f0cb81'}}>{r.status==='active'?(fr?'Pause':'Pause'):(fr?'Réactiver':'Resume')}</Text></TouchableOpacity><TouchableOpacity onPress={()=>change(r.id,'delete')} style={{paddingVertical:6}}><Text style={{color:'#ff9999'}}>{fr?'Supprimer':'Delete'}</Text></TouchableOpacity></View>
  </View>)}
 </View>;
}
