import React, {useCallback, useEffect, useState} from 'react';
import {AppState, Linking, NativeModules, PermissionsAndroid, Platform, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {COLORS} from '../constants/theme';

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
 return <View style={styles.panel}>
  <Text accessibilityRole="header" style={styles.heading}>{fr?'Alertes de prix':'Price alerts'} ({rules.filter(r=>r.status==='active').length})</Text>
  <Text style={styles.caption}>{fr?'Vérification visée : 20 min, Android peut retarder. Données communautaires parfois anciennes ou absentes; un prix peut être manqué.':'Target: 20 min; Android can delay checks. Community data can be stale or missing; thresholds can be missed.'}</Text>
  {rules.some(r=>r.status==='active')&&<TouchableOpacity accessibilityRole="button" onPress={checkNow} style={styles.control}><Text style={styles.command}>{fr?'Vérifier maintenant':'Check now'}</Text></TouchableOpacity>}
  {!enabled&&<TouchableOpacity accessibilityRole="button" onPress={permission} style={styles.control}><Text style={styles.command}>{fr?'Activer les notifications Android':'Enable Android notifications'}</Text></TouchableOpacity>}
  {error&&<Text accessibilityRole="alert" style={styles.error}>{fr?'Impossible de charger les alertes.':'Could not load alerts.'}</Text>}
  {rules.length===0&&<Text style={styles.caption}>{fr?'Demandez à l’agent de créer une alerte pour un objet et une ville.':'Ask the assistant to create an alert for an item and city.'}</Text>}
  {rules.map(r=><View key={r.id} style={styles.rule}>
   <Text style={styles.item}>{r.item_name} · Q{r.quality} · {r.city}</Text>
   <Text style={styles.threshold}>{r.server} · {r.side==='sell'?(fr?'achat immédiat':'instant buy'):(fr?'vente immédiate':'instant sell')} {symbol(r.operator)} {r.threshold}</Text>
   <Text style={styles.caption}>{fr?'Prix du jour':'Today’s price'}{r.max_age_minutes>0?` · ≤ ${r.max_age_minutes} min`:''} · {r.status==='paused'?(fr?'En pause':'Paused'):status(r)}</Text>
   <Text style={styles.data}>{fr?'Dernier prix':'Last price'}: {r.last_price ?? '—'} · {fr?'Observé':'Observed'}: {dt(r.observed_at)}</Text>
   <Text style={styles.data}>{fr?'Vérifié':'Checked'}: {dt(r.last_checked)}</Text>
   <View style={styles.actions}><TouchableOpacity accessibilityRole="button" onPress={()=>change(r.id,r.status==='active'?'pause':'resume')} style={styles.control}><Text style={styles.command}>{r.status==='active'?(fr?'Pause':'Pause'):(fr?'Réactiver':'Resume')}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" onPress={()=>change(r.id,'delete')} style={styles.control}><Text style={styles.error}>{fr?'Supprimer':'Delete'}</Text></TouchableOpacity></View>
  </View>)}
 </View>;
}

const styles=StyleSheet.create({
 panel:{marginTop:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:COLORS.border,paddingTop:12,gap:4},
 heading:{color:COLORS.text,fontWeight:'800',fontSize:17},
 caption:{color:COLORS.textSecondary,fontSize:13,lineHeight:19,marginTop:3},
 control:{minHeight:48,minWidth:48,justifyContent:'center',paddingVertical:6,alignSelf:'flex-start'},
 command:{color:COLORS.primary,fontSize:14,fontWeight:'700'},
 error:{color:COLORS.loss,fontSize:14,fontWeight:'700'},
 rule:{backgroundColor:COLORS.card,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:COLORS.border,paddingHorizontal:12,paddingTop:10,marginTop:6},
 item:{color:COLORS.text,fontSize:15,fontWeight:'800'},
 threshold:{color:COLORS.text,marginTop:4,fontSize:14,fontWeight:'600',fontVariant:['tabular-nums']},
 data:{color:COLORS.textSecondary,fontSize:13,lineHeight:19,fontVariant:['tabular-nums']},
 actions:{flexDirection:'row',flexWrap:'wrap',gap:20,marginTop:4},
});
