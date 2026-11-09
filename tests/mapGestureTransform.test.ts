import test from 'node:test';
import assert from 'node:assert/strict';
import {mapGestureTransform,recordMapTouch,isMapTap,resizeMapCamera} from '../lib/mapGestureTransform';
test('fullscreen roundtrip preserves zoom and the world point at viewport centre',()=>{
 const camera={x:-530,y:110,scale:8},small={width:360,height:190},full={width:360,height:720};
 const expanded=resizeMapCamera(camera,small,full);
 assert.equal(expanded.scale,camera.scale);
 assert.equal((full.width/2-expanded.x)/expanded.scale,(small.width/2-camera.x)/camera.scale);
 assert.equal((full.height/2-expanded.y)/expanded.scale,(small.height/2-camera.y)/camera.scale);
 assert.deepEqual(resizeMapCamera(expanded,full,small),camera);
});
test('lifting a finger after a pinch never turns the gesture into a city tap',()=>{
 const pinch={maxTouches:1,maxTravel:0};
 recordMapTouch(pinch,2); // Even two stationary fingers must not select a city.
 recordMapTouch(pinch,1);
 recordMapTouch(pinch,0);
 assert.equal(isMapTap(pinch),false);
 const pan={maxTouches:1,maxTravel:0};
 recordMapTouch(pan,1,30,0);
 recordMapTouch(pan,0,0,0); // Returning to the start does not restore tap eligibility.
 assert.equal(isMapTap(pan),false);
 const tap={maxTouches:1,maxTravel:0};
 recordMapTouch(tap,0,2,2);
 assert.equal(isMapTap(tap),true);
});
test('cached native map transform preserves world coordinates during pans and pinches',()=>{
 for(const next of [{x:90,y:-33,scale:2},{x:-400,y:120,scale:7},{x:3,y:2,scale:.35}]){
  const base={x:41,y:-10,scale:2},width=360,height=250;
  const [x,y,s]=mapGestureTransform(base,next,width,height);
  for(const [wx,wy] of [[0,0],[-300,400],[90,-60]]){
   const actualX=(base.x+wx*base.scale-width/2)*s.scale!+width/2+x.translateX!;
   const actualY=(base.y+wy*base.scale-height/2)*s.scale!+height/2+y.translateY!;
   assert.ok(Math.abs(actualX-(next.x+wx*next.scale))<1e-9);
   assert.ok(Math.abs(actualY-(next.y+wy*next.scale))<1e-9);
  }
 }
});
