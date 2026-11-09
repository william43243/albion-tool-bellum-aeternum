import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {View,Text,TextInput,Pressable,ScrollView,StyleSheet,PanResponder,Platform,BackHandler,Keyboard} from 'react-native';
import Svg,{G,Path,Line,Polygon,Text as Label,Circle,Image as SvgImage,Defs,LinearGradient,Stop,Rect} from 'react-native-svg';
import {zones,zoneById,riskColors,fitZones,hitZone,zoomAt,searchZones,routeFitsRegion,routeEdgeVisible,Camera,WorldZone,ZoneRisk} from '../lib/worldMap';
import {LicensedMapArtwork,validateArtwork,pointInPolygon} from '../lib/worldMapGeometry';
import {mapGestureTransform,recordMapTouch,isMapTap,resizeMapCamera} from '../lib/mapGestureTransform';
import {planWorldRoute,RoutePolicy,MapAction} from '../lib/worldMapRoutes';

const overscan=100;
const names:Record<ZoneRisk,string>={blue:'Bleue',yellow:'Jaune',red:'Rouge',black:'Noire',city:'Ville',unknown:'Inconnue'};
const biomes:Record<string,string>={swamp:'Marais',forest:'Forêt',highland:'Hautes terres',mountain:'Montagne',steppe:'Steppe',unknown:'Non renseigné'};

export default function WorldMapScreen({artwork,action,onZoneSelected,fullScreen=false,onFullScreenChange}:{artwork?:LicensedMapArtwork;action?:{sequence:number;command:MapAction};onZoneSelected?:(zone:WorldZone)=>void;fullScreen?:boolean;onFullScreenChange?:(value:boolean)=>void}={}){
 useMemo(()=>{if(artwork)validateArtwork(artwork);},[artwork]);
 const [size,setSize]=useState({width:1,height:1}),[camera,setCamera]=useState<Camera>({x:0,y:0,scale:1});
 const [region,setRegion]=useState('royal'),[risk,setRisk]=useState<ZoneRisk|'all'>('all'),[query,setQuery]=useState('');
 const [selected,setSelected]=useState<WorldZone>(),[info,setInfo]=useState(false);
 const [from,setFrom]=useState('3003'),[to,setTo]=useState('3004'),[policy,setPolicy]=useState<RoutePolicy>('fewest_transitions');
 const [routing,setRouting]=useState(false),[pick,setPick]=useState<'from'|'to'|null>(null);
 const route=useMemo(()=>routing?planWorldRoute(from,to,policy):null,[from,to,policy,routing]);
 const routeZones=useMemo(()=>route?.status==='found'?route.zoneIds.map(id=>zoneById.get(id)!):[],[route]);
 const routeIds=useMemo(()=>new Set(routeZones.map(z=>z.id)),[routeZones]);
 const visible=useMemo(()=>zones.filter(z=>(region==='all'||z.region===region)&&(risk==='all'||z.risk===risk)),[region,risk]);
 const results=query.trim()?searchZones(query).slice(0,8):[];
 const state=useRef({camera,visible,artwork});state.current={camera,visible,artwork};
 const layer=useRef<React.ComponentRef<typeof View>>(null),frame=useRef<number|null>(null);
 const rendered=useRef({camera,size});rendered.current={camera,size};
 const moveCamera=(next:Camera)=>{
  state.current.camera=next;
  if(frame.current!==null)return;
  frame.current=requestAnimationFrame(()=>{
   frame.current=null;
   const base=rendered.current;
   layer.current?.setNativeProps({style:{transform:mapGestureTransform(base.camera,state.current.camera,base.size.width,base.size.height)}});
  });
 };
 const finishCamera=()=>{
  if(frame.current!==null){cancelAnimationFrame(frame.current);frame.current=null;}
  setCamera({...state.current.camera});
 };
 useLayoutEffect(()=>{
  layer.current?.setNativeProps({renderToHardwareTextureAndroid:false,shouldRasterizeIOS:false,style:{transform:[{translateX:0},{translateY:0},{scale:1}]}});
 },[camera]);
 useEffect(()=>()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);},[]);
 const gesture=useRef<{camera:Camera;x:number;y:number;distance:number;mx:number;my:number;moved:boolean;maxTouches:number;maxTravel:number}|null>(null);
 const container=useRef<React.ComponentRef<typeof View>>(null),pendingFocus=useRef<WorldZone|null>(null);
 const previousViewport=useRef({region,width:1,height:1});
 useEffect(()=>{
  const previous=previousViewport.current;
  previousViewport.current={region,...size};
  const z=pendingFocus.current;pendingFocus.current=null;
  if(z)setCamera({x:size.width/2-z.x*8,y:size.height/2-z.y*8,scale:8});
  else if(previous.region===region&&previous.width>1&&previous.height>1)
   setCamera(c=>resizeMapCamera(c,previous,size));
  else setCamera(fitZones(routing&&routeFitsRegion(routeZones,region)?routeZones:visible,size.width,size.height));
 },[region,size.width,size.height]);
 useEffect(()=>{
  if(!fullScreen)return;
  const back=BackHandler.addEventListener('hardwareBackPress',()=>{onFullScreenChange?.(false);return true;});
  return()=>back.remove();
 },[fullScreen,onFullScreenChange]);

 const focus=(z:WorldZone)=>{setRisk('all');setQuery('');setSelected(z);onZoneSelected?.(z);if(pick){if(pick==='from')setFrom(z.id);else setTo(z.id);setPick(null);setRouting(true);}if(region!==z.region){pendingFocus.current=z;setRegion(z.region);}else setCamera({x:size.width/2-z.x*8,y:size.height/2-z.y*8,scale:8});};
 const fitRoute=()=>{setRisk('all');setRegion(routeZones.length&&routeZones.every(z=>z.region===routeZones[0].region)?routeZones[0].region:'all');setSelected(undefined);setCamera(fitZones(routeZones.length?routeZones:visible,size.width,size.height));};
 useEffect(()=>{if(!action)return;const command=action.command;
  if(command.type==='focus_zone'){const z=zoneById.get(command.zoneId);if(z)focus(z);}
  else if(command.type==='plan_route'&&zoneById.has(command.from)&&zoneById.has(command.to)){
   setFrom(command.from);setTo(command.to);setPolicy(command.policy);setRouting(true);setRisk('all');setSelected(undefined);
   const result=planWorldRoute(command.from,command.to,command.policy);
   if(result.status==='found'){const list=result.zoneIds.map(id=>zoneById.get(id)!);setRegion(list.every(z=>z.region===list[0].region)?list[0].region:'all');setCamera(fitZones(list,size.width,size.height));}
  }
 },[action?.sequence]);
 const responder=useMemo(()=>PanResponder.create({
  onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:()=>true,
  onPanResponderGrant:e=>{layer.current?.setNativeProps({renderToHardwareTextureAndroid:true,shouldRasterizeIOS:true});const t=e.nativeEvent.touches[0]??e.nativeEvent;gesture.current={camera:state.current.camera,x:t.pageX,y:t.pageY,distance:0,mx:0,my:0,moved:false,maxTouches:Math.max(1,e.nativeEvent.touches.length),maxTravel:0};},
  onPanResponderStart:e=>{if(gesture.current)recordMapTouch(gesture.current,e.nativeEvent.touches.length);},
  onPanResponderMove:(e,gs)=>{const g=gesture.current;if(!g)return;const ts=e.nativeEvent.touches;recordMapTouch(g,ts.length,gs.dx,gs.dy);
   if(ts.length>=2){const [a,b]=ts,d=Math.hypot(a.pageX-b.pageX,a.pageY-b.pageY),mx=(a.locationX+b.locationX)/2,my=(a.locationY+b.locationY)/2;
    if(!g.distance){g.camera=state.current.camera;g.distance=d;g.mx=mx;g.my=my;}
    const n=zoomAt(g.camera,d/Math.max(1,g.distance),g.mx,g.my);moveCamera({...n,x:n.x+mx-g.mx,y:n.y+my-g.my});g.moved=true;
   }else if(ts.length===1){const t=ts[0];if(g.distance){g.camera=state.current.camera;g.x=t.pageX;g.y=t.pageY;g.distance=0;}const dx=t.pageX-g.x,dy=t.pageY-g.y;if(Math.hypot(dx,dy)>5)g.moved=true;moveCamera({...g.camera,x:g.camera.x+dx,y:g.camera.y+dy});}},
  onPanResponderRelease:(e,gs)=>{if(gesture.current)recordMapTouch(gesture.current,0,gs.dx,gs.dy);if(gesture.current&&!gesture.current.moved&&isMapTap(gesture.current)){const {camera:c,visible:v,artwork:a}=state.current;const x=e.nativeEvent.locationX,y=e.nativeEvent.locationY;const exact=v.find(z=>a?.polygons?.[z.id]&&pointInPolygon((x-c.x)/c.scale,(y-c.y)/c.scale,a.polygons[z.id]));setSelected(exact??hitZone(v,c,x,y));}finishCamera();gesture.current=null;},
  onPanResponderTerminate:()=>{finishCamera();gesture.current=null;},onPanResponderTerminationRequest:()=>true,
 }),[]);
 useEffect(()=>{if(Platform.OS!=='web')return;const node=container.current as unknown as HTMLElement|null;if(!node?.addEventListener)return;
  const wheel=(e:WheelEvent)=>{e.preventDefault();const r=node.getBoundingClientRect();setCamera(c=>zoomAt(c,Math.exp(-e.deltaY*0.0015),e.clientX-r.left,e.clientY-r.top));};
  node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);
 },[]);
 const drawn=visible.filter(z=>z.x*camera.scale+camera.x>-overscan-80&&z.x*camera.scale+camera.x<size.width+overscan+80&&z.y*camera.scale+camera.y>-overscan-35&&z.y*camera.scale+camera.y<size.height+overscan+35);
 const edgePath=useMemo(()=>{const ids=new Set(visible.map(z=>z.id));return visible.flatMap(z=>z.exits.filter(id=>(id>z.id||!zoneById.get(id)?.exits.includes(z.id))&&ids.has(id)).map(id=>{const b=zoneById.get(id)!;return `M${z.x},${z.y}L${b.x},${b.y}`;})).join(' ');},[visible]);
 const button=(label:string,action:()=>void,active=false)=><Pressable accessibilityRole="button" key={label} style={[s.button,active&&s.active]} onPress={action}><Text style={s.text}>{label}</Text></Pressable>;
 return <View style={s.root}>
  <View style={fullScreen?{display:'none'}:undefined}>
  <View style={s.header}><View><Text style={s.eyebrow}>BELLUM AETERNUM · ATLAS</Text><Text style={s.title}>Un monde à parcourir</Text></View><View style={s.row}>{button('Itinéraire',()=>{setRouting(!routing);setSelected(undefined);},routing)}{button('ⓘ',()=>setInfo(!info))}</View></View>
  <TextInput accessibilityLabel="Rechercher une zone" placeholder={pick?`Choisir ${pick==='from'?'le départ':'l’arrivée'} : nom de zone…`:'Rechercher une ville, une zone…'} placeholderTextColor="#8295a6" value={query} onChangeText={setQuery} style={s.search}/>
  {!!query.trim()&&<View style={s.results}>{results.length?results.map(z=><Pressable key={z.id} onPress={()=>focus(z)} style={s.result}><Text style={s.text}>{z.name}</Text><Text style={{color:riskColors[z.risk]}}>{names[z.risk]} · T{z.tier}</Text></Pressable>):<Text style={s.caption}>Aucun résultat dans les 414 zones cartographiées.</Text>}</View>}
  <View style={s.row}>{[['royal','Continent royal'],['outlands','Outlands'],['all','Monde']].map(([key,label])=>button(label,()=>{setRegion(key);setSelected(undefined);},region===key))}</View>
  {!routing&&<ScrollView horizontal style={s.legend} contentContainerStyle={s.row} showsHorizontalScrollIndicator={false}>{(['all','city','blue','yellow','red','black'] as const).map(key=><Pressable accessibilityRole="button" key={key} style={[s.button,risk===key&&s.active]} onPress={()=>{setRisk(key);setSelected(undefined);}}><Text style={{color:key==='all'?'#d7e1e9':riskColors[key]}}>{key==='all'?'Toutes':`● ${names[key]}`}</Text></Pressable>)}</ScrollView>}
  {routing&&<View style={s.planner}>
   <View style={s.row}>{button(`A · ${zoneById.get(from)?.name??'Départ'}`,()=>setPick('from'),pick==='from')}{button('⇄',()=>{setFrom(to);setTo(from);})}{button(`B · ${zoneById.get(to)?.name??'Arrivée'}`,()=>setPick('to'),pick==='to')}</View>
   <ScrollView horizontal style={{flexGrow:0}} contentContainerStyle={s.row}>{button('Moins de transitions',()=>setPolicy('fewest_transitions'),policy==='fewest_transitions')}{button('Moins de zones létales',()=>setPolicy('fewest_lethal'),policy==='fewest_lethal')}{button('Voir le trajet',fitRoute)}</ScrollView>
   {pick&&<View style={s.row}><Text style={s.caption}>Recherchez {pick==='from'?'le départ':'l’arrivée'}.</Text>{button('Annuler',()=>setPick(null))}</View>}
  </View>}
  </View>
  <View ref={container} style={s.map} onLayout={e=>setSize(e.nativeEvent.layout)}>
   <View ref={layer} collapsable={false} pointerEvents="none" style={{position:'absolute',left:-overscan,top:-overscan,width:size.width+overscan*2,height:size.height+overscan*2}}>
   <Svg width="100%" height="100%" pointerEvents="none">
    <Defs>
     <LinearGradient id="ocean" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#0c2933"/><Stop offset="1" stopColor="#07161e"/></LinearGradient>
    </Defs>
    <Rect width="100%" height="100%" fill="url(#ocean)"/>
    <G transform={`translate(${camera.x+overscan},${camera.y+overscan}) scale(${camera.scale})`}>
    {!artwork&&<SvgImage href={require('../assets/map/terrain-original.png')} x={-560} y={-520} width={1088} height={1104} preserveAspectRatio="none"/>}
    {artwork&&<SvgImage href={{uri:artwork.uri}} x={artwork.x} y={artwork.y} width={artwork.width} height={artwork.height} preserveAspectRatio="none"/>}
    {artwork?.polygons&&visible.filter(z=>artwork.polygons?.[z.id]).map(z=><Polygon key={'boundary-'+z.id} points={artwork.polygons![z.id].map(p=>p.join(',')).join(' ')} fill={selected?.id===z.id?riskColors[z.risk]:'transparent'} fillOpacity={0.22} stroke={riskColors[z.risk]} strokeWidth={1.5/camera.scale}/>)}
    <Path d={edgePath} fill="none" stroke="#afc7bc" strokeOpacity={routing?0.12:0.25} strokeWidth={1/camera.scale}/>
    {routeZones.slice(1).map((z,i)=>routeEdgeVisible(routeZones[i],z,region)&&<G key={'route'+z.id}><Line x1={routeZones[i].x} y1={routeZones[i].y} x2={z.x} y2={z.y} stroke="#f6d787" strokeOpacity={0.12} strokeWidth={13/camera.scale}/><Line x1={routeZones[i].x} y1={routeZones[i].y} x2={z.x} y2={z.y} stroke="#f6d787" strokeWidth={3/camera.scale}/></G>)}
    {drawn.map(z=><G key={z.id} opacity={routing&&!routeIds.has(z.id)&&z.risk!=='city'?0.65:1}>
     {(z.risk==='city'||routeIds.has(z.id))&&<Circle cx={z.x} cy={z.y} r={9/camera.scale} fill={riskColors[z.risk]} opacity={0.15}/>}
     <Circle cx={z.x} cy={z.y} r={(z.risk==='city'?4.5:routeIds.has(z.id)?4:2.5)/camera.scale} fill={riskColors[z.risk]} stroke={selected?.id===z.id?'#ffffff':'#142a30'} strokeWidth={1.5/camera.scale}/>
     {(camera.scale>4||z.risk==='city'||selected?.id===z.id||routeIds.has(z.id))&&<G><Label x={z.x} y={z.y+15/camera.scale} fill={z.risk==='city'?'#fff1ca':'#e0eae5'} stroke="#10232a" strokeWidth={2.5/camera.scale} fontFamily="Arial" fontSize={(z.risk==='city'?12:10)/camera.scale} fontWeight={z.risk==='city'?'700':'400'} textAnchor="middle">{z.name}</Label><Label x={z.x} y={z.y+15/camera.scale} fill={z.risk==='city'?'#fff1ca':'#e0eae5'} stroke="none" fontFamily="Arial" fontSize={(z.risk==='city'?12:10)/camera.scale} fontWeight={z.risk==='city'?'700':'400'} textAnchor="middle">{z.name}</Label></G>}
     {routing&&(z.id===from||z.id===to)&&<Label x={z.x} y={z.y-12/camera.scale} fill="#ffe5a5" fontSize={12/camera.scale} fontWeight="700" textAnchor="middle">{z.id===from?'A':'B'}</Label>}
    </G>)}
   </G></Svg></View>
  <View style={StyleSheet.absoluteFill} collapsable={false} {...responder.panHandlers}/>
  {onFullScreenChange&&<View style={s.fullscreenControl}>{button(fullScreen?'Quitter plein écran':'Plein écran',()=>{Keyboard.dismiss();onFullScreenChange(!fullScreen);})}</View>}
  <View style={[s.controls,size.height<220&&{flexDirection:'row'}]}>{button('+',()=>setCamera(c=>zoomAt(c,1.5,size.width/2,size.height/2)))}{button('−',()=>setCamera(c=>zoomAt(c,1/1.5,size.width/2,size.height/2)))}{button('⌖',()=>setCamera(fitZones(visible,size.width,size.height)))}</View>
  <View pointerEvents="none" style={s.north}><Text style={s.caption}>N ↑</Text></View></View>
  {routing&&!fullScreen&&<View style={s.routeSummary}>
   {route?.status==='found'?<><Text style={s.routeTitle}>{route.transitions} transitions · {route.lethalZones} zones rouges ou noires{route.unknownRiskZones?` · ${route.unknownRiskZones} risques inconnus`:''}</Text><ScrollView horizontal contentContainerStyle={s.row} showsHorizontalScrollIndicator={false}>{routeZones.map((z,i)=>button(`${i+1} · ${z.name}`,()=>focus(z),selected?.id===z.id))}</ScrollView><Text style={s.micro}>Sorties statiques · lignes entre zones, pas chemins au sol. Aucun trajet garanti sûr ni activité PvP en direct.</Text></>:<Text style={s.caption}>Aucun itinéraire trouvé dans les connexions statiques disponibles. Cela ne prouve pas l’absence de toute liaison en jeu.</Text>}
  </View>}
  {selected&&<View style={s.detail}><View style={s.header}><Text style={s.zoneTitle}>{selected.name}</Text>{button('✕',()=>setSelected(undefined))}</View><Text style={{color:riskColors[selected.risk]}}>{names[selected.risk]} · T{selected.tier} · {biomes[selected.biome]}</Text><Text style={s.caption}>{selected.risk==='red'||selected.risk==='black'?'PvP létal : risque de perte de l’équipement et de l’inventaire.':selected.risk==='yellow'?'PvP ordinaire non létal. Vérifiez les règles des activités spéciales.':selected.risk==='city'?'Ville / refuge. Vérifiez les règles des activités et des sorties en jeu.':selected.risk==='unknown'?'Risque non renseigné : ne pas considérer cette zone comme sûre.':'PvP hostile ordinaire désactivé. Vérifiez les règles des activités spéciales.'}</Text><View style={s.row}>{button('Départ ici',()=>{setFrom(selected.id);setRouting(true);setSelected(undefined);})}{button('Arrivée ici',()=>{setTo(selected.id);setRouting(true);setSelected(undefined);})}</View><ScrollView horizontal style={{maxHeight:48}}><View style={s.row}>{selected.exits.map(id=>button(`↗ ${zoneById.get(id)!.name}`,()=>focus(zoneById.get(id)!)))}</View></ScrollView></View>}
  {info&&!fullScreen&&<View style={s.info}><View style={s.header}><Text style={s.zoneTitle}>Une carte documentée</Text>{button('Fermer',()=>setInfo(false))}</View><Text style={s.caption}>414 zones aux positions du dump ao-data/ao-bin-dumps, révision 90b141e. Silhouettes continentales redessinées à partir d’une référence visuelle All Things Albion : simplifiées, sans relief ni frontières exactes. Points = risque ; textures originales = biomes indicatifs, sans relief mesuré.</Text><Text style={s.caption}>Connexions statiques directes seulement. Sans routes dynamiques d’Avalon, Brumes, intérieurs ni Brecilien sans coordonnées publiées. Aucun état serveur en direct. Vérifiez en jeu.</Text><Text style={s.caption}>Données de jeu © Sandbox Interactive. Évaluation locale ; droits de redistribution des données non établis. Textures dessinées pour cette application ; aucune image de référence intégrée.</Text></View>}
  {!routing&&!fullScreen&&<View style={s.footer}><Text style={s.caption}>{visible.length} zones · Glisser / pincer pour explorer</Text><Text style={s.micro}>{artwork?artwork.attribution:'Positions documentées · Biomes texturés · Côtes simplifiées'}</Text></View>}
 </View>;
}
const s=StyleSheet.create({planner:{backgroundColor:'#142a32',borderBottomWidth:1,borderColor:'#30474d'},routeSummary:{backgroundColor:'#142a32',padding:12,gap:4},routeTitle:{color:'#f4d793',fontSize:13,fontWeight:'700'},root:{flex:1,backgroundColor:'#0c1823',overflow:'hidden'},header:{padding:14,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},eyebrow:{color:'#d8b978',letterSpacing:2,fontSize:10,fontWeight:'800'},title:{color:'#f3f0e7',fontSize:23,fontWeight:'700',marginTop:4},text:{color:'#e1e8ed',fontSize:12},caption:{color:'#a9bac8',fontSize:12,lineHeight:18},micro:{color:'#71889a',fontSize:10,marginTop:2},search:{marginHorizontal:16,borderWidth:1,borderColor:'#344959',backgroundColor:'#142535',borderRadius:10,paddingHorizontal:14,height:43,color:'#edf4f7'},row:{flexDirection:'row',gap:6,paddingHorizontal:12,paddingVertical:7},button:{paddingHorizontal:10,paddingVertical:10,borderRadius:7,backgroundColor:'#1a2b3b'},active:{backgroundColor:'#30495b',borderColor:'#c8b584',borderWidth:1},legend:{flexGrow:0,flexShrink:0,height:49},map:{flex:1,overflow:'hidden',backgroundColor:'#101f2b',minHeight:100},controls:{position:'absolute',right:14,top:14,gap:8},fullscreenControl:{position:'absolute',left:14,top:14},north:{position:'absolute',left:18,bottom:14},footer:{paddingHorizontal:16,paddingVertical:8,borderTopWidth:1,borderTopColor:'#253a4b'},detail:{position:'absolute',bottom:62,left:12,right:12,backgroundColor:'#1a2c3c',borderColor:'#5b6c74',borderWidth:1,borderRadius:12,padding:12,gap:4},zoneTitle:{color:'#f3e8c9',fontSize:17,fontWeight:'700',flexShrink:1},results:{position:'absolute',top:132,left:16,right:16,zIndex:10,backgroundColor:'#243949',borderRadius:8,padding:8},result:{padding:10,borderBottomWidth:1,borderBottomColor:'#3a4c58',flexDirection:'row',justifyContent:'space-between',gap:8},info:{position:'absolute',top:135,left:12,right:12,zIndex:20,backgroundColor:'#203547',borderRadius:12,padding:15,gap:10}});


