import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Pressable,ScrollView,Text,View} from 'react-native';
import Svg,{Circle,Line,Rect,Text as SvgText} from 'react-native-svg';
import {CITIES,City,fetchPriceHistory,Quality,SERVERS,Server} from '../../lib/api';
import {candlesFromHourly,HourlyCandle} from '../../lib/hourlyCandles';

type Meta={item:string;quality:Quality;server:Server;cities:City[];start:number;end:number};
function parseMeta(result?:string):Meta|null{
 try{
  const r=JSON.parse(result||'');const server=(Object.keys(SERVERS) as Server[]).find(k=>SERVERS[k]===r.source);
  if(!server || typeof r.item!=='string' || !/^[A-Za-z0-9_@.-]{1,120}$/.test(r.item) || !Array.isArray(r.cities)||r.cities.length<1||r.cities.length>7)return null;
  const first=r.cities[0];const start=Date.parse(first.requested_start_inclusive),end=Date.parse(first.requested_end_exclusive),quality=first.quality;
  if(!Number.isInteger(quality)||quality<1||quality>5||!Number.isFinite(start)||!Number.isFinite(end)||start%86400000!==0||end-start!==first.requested_days*86400000||![7,30,60,90].includes(first.requested_days))return null;
  const cities:City[]=r.cities.map((c:any)=>{if(!CITIES.includes(c.city)||c.quality!==quality||Date.parse(c.requested_start_inclusive)!==start||Date.parse(c.requested_end_exclusive)!==end)throw Error();return c.city});
  if(new Set(cities).size!==cities.length)return null;
  return {item:r.item,quality,server,cities,start,end};
 }catch{return null}
}
export default function HourlyCandleChart({result,limit}:{result?:string;limit:number}){
 const meta=useMemo(()=>parseMeta(result),[result]);const scroll=useRef<React.ComponentRef<typeof ScrollView>>(null);
 const [data,setData]=useState<Record<string,HourlyCandle[]>|null>(null);const [error,setError]=useState(false);const [selected,setSelected]=useState<number|null>(null);const [city,setCity]=useState('');const [width,setWidth]=useState(300);const [retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setData(null);setError(false);setSelected(null);if(!meta)return;
  setCity(meta.cities[0]);
  fetchPriceHistory(meta.item,meta.cities,new Date(meta.start).toISOString().slice(0,10),new Date(meta.end).toISOString().slice(0,10),1,meta.server,meta.quality)
   .then(rows=>{if(!active)return;const out:Record<string,HourlyCandle[]>={};for(const row of rows){if(out[row.location])throw new Error('Duplicate city');out[row.location]=candlesFromHourly(row,meta.start,meta.end)};setData(out)})
   .catch(()=>{if(active)setError(true)});
  return()=>{active=false};
 },[meta,retry]);
 if(!meta)return <Text style={{color:'#e0c286'}}>Moyennes horaires indisponibles pour cet historique. Revenez en mode Ligne.</Text>;
 if(error)return <View><Text style={{color:'#ffb1a5'}}>Impossible de charger les moyennes horaires. Vérifiez le réseau ou réessayez plus tard.</Text><Pressable onPress={()=>setRetry(n=>n+1)}><Text style={{color:'#f4db9d',paddingVertical:8}}>Réessayer</Text></Pressable></View>;
 if(!data)return <View style={{flexDirection:'row',gap:8}}><ActivityIndicator color="#f4db9d"/><Text style={{color:'#c1d2d2'}}>Chargement des moyennes horaires…</Text></View>;
 const list=(data[city]||[]).filter(c=>c.day<=limit);const all=data[city]||[];
 const chosen=list.find(c=>c.day===selected);const min=list.length?Math.min(...list.map(c=>c.low)):0,max=list.length?Math.max(...list.map(c=>c.high)):1;const pad=Math.max(1,(max-min)*0.08);const lo=Math.max(0,min-pad),hi=max+pad;
 const days=Math.round((meta.end-meta.start)/86400000), step=Math.max(15,(width-60)/Math.max(days,1)), graphWidth=Math.max(width,days*step+58),h=260;
 const x=(day:number)=>12+((day-meta.start)/86400000+0.5)*step;const y=(v:number)=>12+(hi-v)/(hi-lo)*(h-44);const candleWidth=Math.min(12,Math.max(3,step*0.55));
 return <View style={{gap:8}} onLayout={e=>setWidth(Math.max(220,e.nativeEvent.layout.width))}>
  <Text style={{color:'#e0c286',fontSize:12}}>Bougies de moyennes horaires · 1 jour UTC. Première et dernière moyennes disponibles ; ce ne sont pas les hauts et bas de toutes les transactions. Une bougie en pointillé indique une journée incomplète ; un point représente une seule heure.</Text>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{meta.cities.map(c=><Pressable accessibilityRole="button" accessibilityState={{selected:city===c}} key={c} onPress={()=>{setCity(c);setSelected(null)}} style={{padding:6,borderRadius:6,backgroundColor:city===c?'#635334':'#1d2935'}}><Text style={{color:'#f5dfaa'}}>{c}</Text></Pressable>)}</View>
  {all.length===0?<Text style={{color:'#bccfd0'}}>Aucune moyenne horaire disponible pour {city}.</Text>:<ScrollView horizontal ref={scroll} onContentSizeChange={()=>scroll.current?.scrollToEnd({animated:false})}><Svg width={graphWidth} height={h} style={{backgroundColor:'#0b121b',borderRadius:8}}>
   {[0,1,2,3,4].map(k=>{const yy=12+k*(h-44)/4;return <React.Fragment key={k}><Line x1={10} x2={graphWidth-45} y1={yy} y2={yy} stroke="#293643"/><SvgText x={graphWidth-42} y={yy+4} fill="#a5b4c3" fontSize={10}>{(hi-(hi-lo)*k/4).toFixed(0)}</SvgText></React.Fragment>})}
   {list.map(c=>{const xx=x(c.day),up=c.close>=c.open,color=up?'#63d58a':'#ee7872',yy1=y(Math.max(c.open,c.close)),yy2=y(Math.min(c.open,c.close));return <React.Fragment key={c.day}>
    {c.count===1?<Circle cx={xx} cy={y(c.open)} r={4} fill={color} onPress={()=>setSelected(c.day)}/>:<><Line x1={xx} x2={xx} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={1.5} strokeDasharray={c.count<24?'3 2':undefined}/><Rect x={xx-candleWidth/2} y={yy1} width={candleWidth} height={Math.max(2,yy2-yy1)} fill={c.count<24?'#101821':color} stroke={color} strokeWidth={1.5} strokeDasharray={c.count<24?'3 2':undefined} onPress={()=>setSelected(c.day)}/></>}
    {((c.day-meta.start)/86400000)%Math.max(1,Math.ceil(days/8))===0&&<SvgText x={xx} y={h-8} fill="#a5b4c3" fontSize={9} textAnchor="middle">{new Date(c.day).toISOString().slice(5,10)}</SvgText>}
   </React.Fragment>})}
  </Svg></ScrollView>}
  {chosen&&<Text style={{color:'#fff',fontSize:12}}>{new Date(chosen.day).toISOString().slice(0,10)} UTC · {chosen.count}/24 heures · Première {chosen.open} · Haut {chosen.high} · Bas {chosen.low} · Dernière {chosen.close}{chosen.count<24?' · Incomplet':''}</Text>}
  {!chosen&&<Text style={{color:'#a8babd',fontSize:11}}>Touchez une bougie pour voir ses valeurs et sa couverture. Les journées sans données restent vides.</Text>}
 </View>;
}
