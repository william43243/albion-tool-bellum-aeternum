import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import PlanScreen from './PlanScreen';
import {ProductionPlanner, type ProductionIncoming} from './production/ProductionScreens';
import type {Language} from '../lib/i18n';
import type {Server} from '../lib/api';
import {COLORS} from '../constants/theme';

type Props={lang:Language;server:Server;active:boolean;incoming?:ProductionIncoming;onShowRoute:(zoneIds:string[])=>void};
export default function PlanHubScreen({lang,server,active,incoming,onShowRoute}:Props) {
 const [tab,setTab]=useState<'outing'|'production'>('outing');
 useEffect(()=>{if(incoming)setTab('production');},[incoming?.sequence]);
 const names=lang==='fr'?['Sortie','Production']:lang==='es'?['Salida','Producción']:['Outing','Production'];
 return <View style={styles.root}>
  <View style={styles.tabs} accessibilityRole="tablist">{(['outing','production'] as const).map((key,i)=><Pressable key={key} accessibilityRole="tab" accessibilityState={{selected:tab===key}} onPress={()=>setTab(key)} style={[styles.tab,tab===key&&styles.selected]}><Text style={[styles.label,tab===key&&styles.selectedText]}>{names[i]}</Text></Pressable>)}</View>
  <View style={[styles.root,tab!=='outing'&&styles.hidden]}><PlanScreen lang={lang} onShowRoute={onShowRoute}/></View>
  <View style={[styles.root,tab!=='production'&&styles.hidden]}><ProductionPlanner lang={lang} server={server} active={active&&tab==='production'} incoming={incoming}/></View>
 </View>;
}
const styles=StyleSheet.create({
 root:{flex:1,minHeight:0},
 hidden:{display:'none'},
 tabs:{flexDirection:'row',paddingHorizontal:12,backgroundColor:COLORS.card,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:COLORS.border},
 tab:{flex:1,minHeight:48,alignItems:'center',justifyContent:'center',borderBottomWidth:3,borderBottomColor:'transparent',paddingHorizontal:6,paddingVertical:6},
 selected:{borderBottomColor:COLORS.primary},
 label:{color:COLORS.textSecondary,fontSize:13,fontWeight:'600'},
 selectedText:{color:COLORS.primary,fontWeight:'800'},
});
