import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {parsePlanCommand} from '../lib/planCommand';

const resolve=(name:string)=>name==='Fort Sterling'||name==='3004'?'3004':undefined;
const valid='/plan {"query":"ore","kind":"resource","tier":7,"enchantment":null,"startZoneId":"Fort Sterling","excludedRisks":["red"],"policy":"fewest_transitions"}';
test('structured command resolves a starting point and retains strict filters',()=>{
 const result=parsePlanCommand(valid,resolve);
 assert.equal(result?.startZoneId,'3004');assert.deepEqual(result?.excludedRisks,['red']);assert.equal(result?.tier,7);
});
test('rejects malformed and unsafe structured commands',()=>{
 for(const input of [valid.replace('/plan','/other'),'/plan {',valid.replace('Fort Sterling','Missing'),valid.replace('"tier":7','"tier":9'),valid.replace('"red"','"bogus"'),valid.replace('"red"','"red","red"'),valid.replace('"enchantment":null','"enchantment":5'),valid.replace('"kind":"resource"','"kind":"other"'),valid.replace('"query":"ore"','"query":"ore","extra":true')])assert.equal(parsePlanCommand(input,resolve),null);
});
