import type {Camera} from './worldMap';

export function resizeMapCamera(camera:Camera,previous:{width:number;height:number},next:{width:number;height:number}):Camera{
 return {...camera,x:camera.x+(next.width-previous.width)/2,y:camera.y+(next.height-previous.height)/2};
}

export type MapTapIntent={maxTouches:number;maxTravel:number};
export function recordMapTouch(intent:MapTapIntent,touches:number,dx=0,dy=0){
 intent.maxTouches=Math.max(intent.maxTouches,touches);
 intent.maxTravel=Math.max(intent.maxTravel,Math.hypot(dx,dy));
}
export function isMapTap(intent:MapTapIntent){
 return intent.maxTouches===1&&intent.maxTravel<=5;
}

/** Native View transforms scale around its centre, while our camera uses top-left. */
export function mapGestureTransform(base:Camera,next:Camera,width:number,height:number){
 const scale=next.scale/base.scale;
 return [
  {translateX:next.x-base.x*scale+(scale-1)*width/2},
  {translateY:next.y-base.y*scale+(scale-1)*height/2},
  {scale},
 ];
}
