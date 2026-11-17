import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createProductionTaskGate} from '../lib/productionTaskGate';

test('a delayed result cannot overwrite a changed form or server',async()=>{
 const gate=createProductionTaskGate();let resolve!:(v:string)=>void;
 const pending=new Promise<string>(r=>{resolve=r;});let displayed='';
 const task=gate.begin();const completion=pending.then(value=>{if(task.isCurrent())displayed=value;});
 gate.invalidate();assert.equal(task.signal.aborted,true);resolve('old result');await completion;
 assert.equal(displayed,'');
 const next=gate.begin();assert.equal(next.isCurrent(),true);next.finish();
});

test('starting a new analysis cancels the old one without cancelling the new one',()=>{
 const gate=createProductionTaskGate(),old=gate.begin(),current=gate.begin();
 assert.equal(old.signal.aborted,true);assert.equal(old.isCurrent(),false);
 assert.equal(current.signal.aborted,false);assert.equal(current.isCurrent(),true);
});
