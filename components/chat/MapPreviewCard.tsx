import React,{useMemo,useState} from 'react';
import {Modal,Pressable,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Svg,{G,Image as SvgImage,Circle,Line,Text as Label} from 'react-native-svg';
import {parseMapToolResult} from '../../lib/mapToolResult';
import {planWorldRoute} from '../../lib/worldMapRoutes';
import {zones,zoneById,riskColors,fitZones} from '../../lib/worldMap';

import {useChatTextScale} from './reading';
import WorldMapScreen from '../../screens/WorldMapScreen';
function MapPreviewCard({name,result}:{name:string;result?:string}){
 const scale=useChatTextScale();
 const action=useMemo(()=>parseMapToolResult(name,result),[name,result]);
 const [fullScreen,setFullScreen]=useState(false);
 const [open,setOpen]=useState(false),[width,setWidth]=useState(280);
 if(!action)return null;
 const route=action.type==='plan_route'?planWorldRoute(action.from,action.to,action.policy):null;
 const selected=action.type==='focus_zone'?[zoneById.get(action.zoneId)!]:route?.status==='found'?route.zoneIds.map(id=>zoneById.get(id)!):[];
 const camera=fitZones(selected,width,180),ids=new Set(selected.map(z=>z.id));
 const title=action.type==='focus_zone'?selected[0].name:`${selected[0].name} → ${selected[selected.length-1].name}`;
 return <View style={{marginTop:8,borderRadius:12,overflow:'hidden',borderWidth:1,borderColor:'#496169'}} onLayout={e=>setWidth(e.nativeEvent.layout.width)}>
  <Pressable accessibilityRole="button" accessibilityLabel={`Ouvrir la carte : ${title}`} onPress={()=>{setFullScreen(false);setOpen(true);}}>
   <View style={{height:180,backgroundColor:'#102a32'}}><Svg width={width} height={180} pointerEvents="none"><G transform={`translate(${camera.x},${camera.y}) scale(${camera.scale})`}>
    <SvgImage href={require('../../assets/map/terrain-original.png')} x={-560} y={-520} width={1088} height={1104} preserveAspectRatio="none"/>
    {zones.filter(z=>z.x*camera.scale+camera.x>=0&&z.x*camera.scale+camera.x<=width&&z.y*camera.scale+camera.y>=0&&z.y*camera.scale+camera.y<=180).map(z=><Circle key={z.id} cx={z.x} cy={z.y} r={2/camera.scale} fill={riskColors[z.risk]} opacity={ids.has(z.id)?1:0.35}/>)}
    {selected.slice(1).map((z,i)=><Line key={'line'+z.id} x1={selected[i].x} y1={selected[i].y} x2={z.x} y2={z.y} stroke="#f6d787" strokeWidth={3/camera.scale}/>)}
    {selected.map((z,i)=><G key={'focus'+z.id}><Circle cx={z.x} cy={z.y} r={5/camera.scale} fill={riskColors[z.risk]} stroke="#fff1ce" strokeWidth={1/camera.scale}/>{(i===0||i===selected.length-1)&&<Label x={z.x} y={z.y+15/camera.scale} textAnchor="middle" fontFamily="Arial" fontSize={11/camera.scale} fill="#fff1ce">{z.name}</Label>}</G>)}
   </G></Svg></View>
   <View style={{backgroundColor:'#162c34',padding:10,gap:4}}><Text style={{color:'#f4db9d',fontWeight:'700',fontSize:14*scale}}>{title}</Text><Text style={{color:'#c3d4d5',fontSize:12*scale}}>{route?.status==='found'?`${route.transitions} transitions · ${route.lethalZones} zones rouges/noires`:'Zone sélectionnée'} · Ouvrir la carte ↗</Text><Text style={{color:'#96adaf',fontSize:10*scale}}>Données statiques · pas d’activité de kills en direct</Text></View>
  </Pressable>
  <Modal visible={open} animationType="slide" onRequestClose={()=>{if(fullScreen)setFullScreen(false);else setOpen(false);}}>
   <SafeAreaView style={{flex:1,backgroundColor:'#0c1823'}}>{!fullScreen&&<Pressable accessibilityRole="button" onPress={()=>setOpen(false)} style={{padding:14}}><Text style={{color:'#f4db9d'}}>← Revenir au chat</Text></Pressable>}{open&&<WorldMapScreen fullScreen={fullScreen} onFullScreenChange={setFullScreen} action={{sequence:1,command:action}}/>}</SafeAreaView>
  </Modal>
 </View>;
}

export default React.memo(MapPreviewCard);
