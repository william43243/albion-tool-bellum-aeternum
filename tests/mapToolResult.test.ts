import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMapToolResult } from '../lib/mapToolResult';
import { planWorldRoute } from '../lib/worldMapRoutes';
test('map refuses fabricated zones, tool names, failed tools and malformed payloads',()=>{
 const good=JSON.stringify({map_action:{type:'focus_zone',zoneId:'3003'}});
 assert.deepEqual(parseMapToolResult('show_zone',good),{type:'focus_zone',zoneId:'3003'});
 assert.equal(parseMapToolResult('get_prices',good),null);
 assert.equal(parseMapToolResult('show_zone','{'),null);
 assert.equal(parseMapToolResult('show_zone',JSON.stringify({error:'oops',map_action:{type:'focus_zone',zoneId:'3003'}})),null);
 assert.equal(parseMapToolResult('show_zone',JSON.stringify({map_action:{type:'focus_zone',zoneId:'invented'}})),null);
});
test('route card checks native route against UI graph, never draws mismatching or invented links',()=>{
 const action={type:'plan_route',from:'3003',to:'3004',policy:'fewest_transitions'};
 const route=planWorldRoute(action.from,action.to,'fewest_transitions');assert.equal(route.status,'found');if(route.status!=='found')return;
 const payload={map_action:action,path:route.zoneIds.map(id=>({id})),transitions:route.transitions};
 assert.deepEqual(parseMapToolResult('get_route',JSON.stringify(payload)),action);
 assert.equal(parseMapToolResult('get_route',JSON.stringify({...payload,transitions:1})),null);
 assert.equal(parseMapToolResult('get_route',JSON.stringify({...payload,path:[{id:'3003'},{id:'3004'}]})),null);
});
test('native and JS use exactly the same pinned map dataset',()=>{
 assert.deepEqual(readFileSync('assets/map/world-map.local.json'),readFileSync('android/app/src/main/assets/world-map.local.json'));
});
