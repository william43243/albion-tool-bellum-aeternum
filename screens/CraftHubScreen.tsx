import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import CraftingScreen from './CraftingScreen';
import {ProductionOptimizer, ProductionRefining} from './production/ProductionScreens';
import type {ProductionScenario} from '../lib/productionTypes';
import type {Language} from '../lib/i18n';
import type {Server} from '../lib/api';
import {COLORS} from '../constants/theme';

type Props = {t:(key:any)=>any;lang:Language;server:Server;active:boolean;onTransfer:(scenario:ProductionScenario)=>void};
export default function CraftHubScreen({t,lang,server,active,onTransfer}:Props) {
 const [tab,setTab]=useState<'calculator'|'optimizer'|'refining'>('calculator');
 const names = lang==='fr' ? ['Calculateur','Optimiseur','Raffinage'] : lang==='es' ? ['Calculadora','Optimizador','Refinado'] : ['Calculator','Optimizer','Refining'];
 const tabs = ['calculator','optimizer','refining'] as const;
 return <View style={styles.root}>
  <View style={styles.tabs} accessibilityRole="tablist">{tabs.map((key,i)=><Pressable key={key} accessibilityRole="tab" accessibilityState={{selected:tab===key}} onPress={()=>setTab(key)} style={[styles.tab,tab===key&&styles.selected]}><Text style={[styles.label,tab===key&&styles.selectedText]}>{names[i]}</Text></Pressable>)}</View>
  <View style={[styles.root,tab!=='calculator'&&styles.hidden]}><CraftingScreen t={t} lang={lang} active={active&&tab==='calculator'}/></View>
  <View style={[styles.root,tab!=='optimizer'&&styles.hidden]}><ProductionOptimizer lang={lang} server={server} active={active&&tab==='optimizer'} onTransfer={onTransfer}/></View>
  <View style={[styles.root,tab!=='refining'&&styles.hidden]}><ProductionRefining lang={lang} server={server} active={active&&tab==='refining'} onTransfer={onTransfer}/></View>
 </View>;
}
const styles=StyleSheet.create({root:{flex:1,minHeight:0},hidden:{display:'none'},tabs:{flexDirection:'row',padding:8,gap:6,backgroundColor:COLORS.background},tab:{flex:1,minHeight:48,alignItems:'center',justifyContent:'center',borderBottomWidth:2,borderColor:COLORS.border},selected:{borderColor:COLORS.primary},label:{color:COLORS.textSecondary,fontSize:12,fontWeight:'600'},selectedText:{color:COLORS.primary}});
