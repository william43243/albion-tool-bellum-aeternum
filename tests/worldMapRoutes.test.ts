import test from 'node:test';
import assert from 'node:assert/strict';
import { planWorldRoute, resolveMapAction } from '../lib/worldMapRoutes';
import { zones, WorldZone, zoneById } from '../lib/worldMap';
const z=(id:string,risk:WorldZone['risk'],exits:string[]):WorldZone=>({id,name:id,risk,exits,x:0,y:0,type:'test',biome:'unknown',tier:0,region:'test',resources:[]});
test('policies differ and follow directed exits without inventing reverse edges',()=>{
 const graph=[z('A','city',['R','B']),z('R','red',['Z']),z('B','blue',['C']),z('C','yellow',['Z']),z('Z','city',[])];
 const short=planWorldRoute('A','Z','fewest_transitions',graph),avoid=planWorldRoute('A','Z','fewest_lethal',graph);
 assert.equal(short.status,'found');if(short.status==='found'){assert.deepEqual(short.zoneIds,['A','R','Z']);assert.equal(short.lethalZones,1);}
 assert.equal(avoid.status,'found');if(avoid.status==='found'){assert.deepEqual(avoid.zoneIds,['A','B','C','Z']);assert.equal(avoid.transitions,3);}
 assert.equal(planWorldRoute('Z','A','fewest_transitions',graph).status,'unreachable');
});
test('unknown risk does not become a safe shortcut; cycles and isolated nodes terminate',()=>{
 const graph=[z('A','city',['U','B']),z('U','unknown',['Z']),z('B','blue',['C','A']),z('C','yellow',['Z']),z('Z','city',[]),z('X','city',[])];
 const result=planWorldRoute('A','Z','fewest_lethal',graph);assert.equal(result.status,'found');if(result.status==='found')assert.equal(result.unknownRiskZones,0);
 assert.equal(planWorldRoute('A','X','fewest_lethal',graph).status,'unreachable');
 assert.equal(planWorldRoute('A','missing','fewest_lethal',graph).status,'unknown_zone');
});
test('real Caerleon to Martlock route reports lethal zones and every edge exists',()=>{
 const start=zones.find(z=>z.name==='Caerleon')!,end=zones.find(z=>z.name==='Martlock')!;
 for(const policy of ['fewest_transitions','fewest_lethal'] as const){
  const route=planWorldRoute(start.id,end.id,policy);assert.equal(route.status,'found');if(route.status!=='found')return;
  assert.ok(route.lethalZones>0);assert.equal(route.transitions,route.zoneIds.length-1);
  for(let i=1;i<route.zoneIds.length;i++)assert.ok(zoneById.get(route.zoneIds[i-1])!.exits.includes(route.zoneIds[i]));
 }
});
test('same-zone route and strict map command resolution',()=>{
 const result=planWorldRoute('3003','3003','fewest_transitions');assert.equal(result.status,'found');if(result.status==='found')assert.equal(result.transitions,0);
 assert.equal(resolveMapAction({type:'focus_zone',zoneId:'3003'}).status,'found');
 assert.equal(resolveMapAction({type:'focus_zone',zoneId:'Caerleon'}).status,'unknown_zone');
 assert.throws(()=>planWorldRoute('3003','3004','magic' as never));
});
