import data from '../assets/map/world-map.local.json';
export type ZoneRisk = 'blue' | 'yellow' | 'red' | 'black' | 'city' | 'unknown';
export interface WorldZone { id:string; name:string; x:number; y:number; type:string; risk:ZoneRisk; biome:string; tier:number; region:string; exits:string[]; resources:string[] }
export const zones = data.zones as WorldZone[];
export const provenance = data.provenance;
export const zoneById = new Map(zones.map(z=>[z.id,z]));
export const riskColors:Record<ZoneRisk,string>={blue:'#51b6ff',yellow:'#f0c75a',red:'#f16b68',black:'#ac8adb',city:'#f7e6b0',unknown:'#a0a9b5'};
export const biomeColors:Record<string,string>={swamp:'#315b56',forest:'#395c43',highland:'#665e48',mountain:'#586b7a',steppe:'#8b7045',unknown:'#45515c'};
export type Camera = { x:number; y:number; scale:number };
export function routeFitsRegion(route: readonly WorldZone[], region: string): boolean {
  return route.length > 0 && (region === 'all' || route.every(zone => zone.region === region));
}
export function routeEdgeVisible(a: WorldZone, b: WorldZone, region: string): boolean {
  return region === 'all' || (a.region === region && b.region === region);
}
export const clampScale=(s:number)=>Math.max(0.35,Math.min(28,s));
export function zoomAt(c:Camera, factor:number, px:number,py:number):Camera {
  const scale=clampScale(c.scale*factor);
  return {x:px-(px-c.x)*scale/c.scale,y:py-(py-c.y)*scale/c.scale,scale};
}
export function fitZones(list:WorldZone[],width:number,height:number):Camera {
  if (!list.length || width<=0 || height<=0) return {x:0,y:0,scale:1};
  const xs=list.map(z=>z.x),ys=list.map(z=>z.y);
  const left=Math.min(...xs)-16,right=Math.max(...xs)+16,top=Math.min(...ys)-16,bottom=Math.max(...ys)+16;
  const scale=clampScale(Math.min(width/(right-left),height/(bottom-top))*0.9);
  return {x:width/2-(left+right)/2*scale,y:height/2-(top+bottom)/2*scale,scale};
}
export function hitZone(list:WorldZone[],c:Camera,x:number,y:number):WorldZone|undefined {
  return list.map(z=>({z,d:Math.hypot(z.x*c.scale+c.x-x,z.y*c.scale+c.y-y)})).filter(v=>v.d<=Math.max(13,4*c.scale)).sort((a,b)=>a.d-b.d)[0]?.z;
}
export const searchZones=(q:string,list=zones)=>list.filter(z=>`${z.name} ${z.id}`.toLowerCase().includes(q.trim().toLowerCase()));
