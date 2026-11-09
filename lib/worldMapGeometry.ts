/** Geometry must be supplied from a verified, authorized source. No invented boundaries. */
export type Point = readonly [number,number];
export interface LicensedMapArtwork {
  /** Local image URI or bundled asset. Do not hotlink third-party art without permission. */
  uri:string; x:number; y:number; width:number; height:number;
  attribution:string; source:string; rights:string;
  /** Coordinates in the same x,-y world system as the map. Optional until authentic polygons exist. */
  polygons?:Record<string,Point[]>;
}
export function validateArtwork(a:LicensedMapArtwork):void {
 if(!a.uri||!a.source||!a.attribution||!a.rights)throw new Error('Artwork provenance and permission are required');
 if(![a.x,a.y,a.width,a.height].every(Number.isFinite)||a.width<=0||a.height<=0)throw new Error('Invalid artwork bounds');
 for(const points of Object.values(a.polygons??{}))if(points.length<3||points.some(p=>p.length!==2||!p.every(Number.isFinite)))throw new Error('Invalid polygon');
}
export function pointInPolygon(x:number,y:number,points:readonly Point[]):boolean {
 let inside=false;
 for(let i=0,j=points.length-1;i<points.length;j=i++){
  const [xi,yi]=points[i],[xj,yj]=points[j];
  if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
 }
 return inside;
}
