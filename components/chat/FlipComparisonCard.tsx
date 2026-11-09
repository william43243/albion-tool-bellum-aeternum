import React,{useMemo} from 'react';
import {Text,View,StyleSheet} from 'react-native';
import {parseFlipToolResult} from '../../lib/flipToolResult';
import MapPreviewCard from './MapPreviewCard';
import {useChatTextScale} from './reading';
const silver=(n:number)=>n.toLocaleString('fr-CA');
const criteria:Record<string,string>={profit:'bénéfice estimé',profit_per_transition:'bénéfice par zone traversée',distance:'nombre de zones traversées',least_risk:'zones à risque'};
function FlipComparisonCard({name,result}:{name:string;result?:string}){
 const scale=useChatTextScale();
 const comparison=useMemo(()=>parseFlipToolResult(name,result),[name,result]);
 if(!comparison)return null;
 const r=comparison,a=r.assumptions;
 return <View style={s.root}>
  <Text style={[s.title, {fontSize:14*scale,lineHeight:20*scale}]}>Villes et trajets comparés</Text>
  <Text style={[s.text, {fontSize:13*scale,lineHeight:19*scale}]}>{r.item} · Simulation pour {silver(r.quantity)} unité{r.quantity>1?'s':''}</Text>
  <Text style={[s.small, {fontSize:11*scale,lineHeight:16*scale}]}>Achat {a.buy_mode==='instant'?'immédiat':'par ordre'} · Vente {a.sell_mode==='instant'?'immédiate':'par ordre'} · {a.premium?'Premium':'Sans Premium'}</Text>
  <Text style={[s.small, {fontSize:11*scale,lineHeight:16*scale}]}>Classement : {criteria[r.sort_by]} · Observations de moins de {a.max_age_minutes} min au calcul.</Text>
  {r.status!=='positive_estimates'&&<Text style={[s.warning, {fontSize:13*scale,lineHeight:19*scale}]}>{r.status==='no_positive_estimate'?'Aucun bénéfice positif démontré. Ces alternatives sont déficitaires ou à l’équilibre.':'Pas assez de prix récents et de trajets connus pour établir un classement.'}</Text>}
  {r.candidates.slice(0,3).map(c=><View key={`${c.buy_city}-${c.sell_city}`} style={s.candidate}>
   <Text style={[s.title, {fontSize:14*scale,lineHeight:20*scale}]}>{c.rank}. {c.net_profit>0?'+':''}{silver(c.net_profit)} argent net estimé</Text>
   <Text style={[s.text, {fontSize:13*scale,lineHeight:19*scale}]}>Acheter à {c.buy_city} : {silver(c.buy_price)} / unité</Text>
   <Text style={[s.text, {fontSize:13*scale,lineHeight:19*scale}]}>Vendre à {c.sell_city} : {silver(c.sell_price)} / unité</Text>
   <Text style={[s.small, {fontSize:11*scale,lineHeight:16*scale}]}>Frais inclus : {silver(c.buy_setup_fee+c.sell_setup_fee+c.sales_tax)} · Prix relevés il y a {c.buy_age_minutes} min / {c.sell_age_minutes} min au calcul.</Text>
   {c.buy_city===c.sell_city?<Text style={[s.small,{fontSize:11*scale,lineHeight:16*scale}]}>Même ville · aucun trajet entre zones</Text>:<MapPreviewCard name="get_route" result={JSON.stringify(c.route)}/>}
  </View>)}
  <Text style={[s.small, {fontSize:11*scale,lineHeight:16*scale}]}>{Math.min(3,r.candidates.length)} affichés · {r.eligible_count} trajets admissibles · {r.excludedCount} exclus (prix absents/anciens ou trajet inconnu).</Text>
  <Text style={[s.small, {fontSize:11*scale,lineHeight:16*scale}]}>Stock et remplissage des ordres non vérifiés. Transport et pertes PvP non déduits. Distance en zones, pas en minutes. Prix à revérifier avant le départ.</Text>
 </View>;
}
const s=StyleSheet.create({root:{padding:12,gap:7},title:{color:'#f4db9d',fontSize:14,fontWeight:'700'},text:{color:'#d5e2e4',fontSize:13},small:{color:'#a3b8bd',fontSize:11,lineHeight:16},warning:{color:'#f0bd84',fontSize:13,lineHeight:19},candidate:{marginTop:8,paddingTop:10,borderTopWidth:1,borderTopColor:'#354b54',gap:4}});

export default React.memo(FlipComparisonCard);
