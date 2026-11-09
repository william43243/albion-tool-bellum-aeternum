import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownBlocks} from '../components/chat/presentation';
import {validChatTextScale,nextChatTextScale} from '../components/chat/reading';
test('tables retain prices, signed profits and inline formatting in distinct cells',()=>{
 assert.deepEqual(markdownBlocks('| Ville | Net |\n| :--- | ---: |\n| **Martlock** | -1 234 |\n| Lymhurst | +328 |'),[{kind:'table',headers:['Ville','Net'],rows:[['**Martlock**','-1 234'],['Lymhurst','+328']]}]);
});
test('escaped pipes and inline code stay in their cells; incomplete streamed rows stay visible',()=>{
 const blocks=markdownBlocks('| A | B |\n| --- | --- |\n| x\\|y | `a|b` |\n| partial');
 assert.deepEqual(blocks,[{kind:'table',headers:['A','B'],rows:[['x|y','`a|b`']]},{kind:'line',line:{kind:'text',text:'| partial'}}]);
});
test('ordinary pipes and fenced code are not converted to tables',()=>{
 assert.ok(markdownBlocks('a | b\nnot a separator').every(b=>b.kind==='line'));
 assert.ok(markdownBlocks('```\n| A | B |\n| --- | --- |\n```').every(b=>b.kind==='line'));
});
test('text zoom validates stored values, steps and clamps both ends',()=>{
 for(const value of [null,undefined,NaN,Infinity,0,-1,3,'0.85'])assert.equal(validChatTextScale(value),1);
 assert.equal(nextChatTextScale(1,-1),0.85);assert.equal(nextChatTextScale(0.85,-1),0.75);
 assert.equal(nextChatTextScale(0.75,-1),0.75);assert.equal(nextChatTextScale(1.3,1),1.3);
 assert.equal(nextChatTextScale(0.85,1),1);
});
