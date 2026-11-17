import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {isDrawablePlannedRoute} from '../lib/plannedRouteValidation';

const graph=new Map([['a',{exits:['b']}],['b',{exits:['c']}],['c',{exits:[]}] ]);
test('accepts a route only when its directed edges are present',()=>{
 assert.equal(isDrawablePlannedRoute(['a','b','c'],graph),true);
 assert.equal(isDrawablePlannedRoute(['a'],graph),true);
 assert.equal(isDrawablePlannedRoute(['b','a'],graph),false);
 assert.equal(isDrawablePlannedRoute(['a','c'],graph),false);
 assert.equal(isDrawablePlannedRoute(['a','missing'],graph),false);
 assert.equal(isDrawablePlannedRoute([],graph),false);
});
