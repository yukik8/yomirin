import test from 'node:test';
import assert from 'node:assert/strict';
import {BEATS,FRAMES,initial,advance,illustrationFor,endingFrames} from './story.js';
test('long reading reaches the crisis in order and waits for the chapter ending',()=>{
 let s=initial();const seen=[s.step];let holds=0;
 for(let page=1;page<60;page++){
  const next=advance(s,{page,total:60});
  if(next.step===s.step)holds++;else seen.push(next.step);
  assert.ok(illustrationFor(next)<=4);s=next;
 }
 assert.deepEqual(seen,BEATS.map((_,i)=>i));assert.ok(holds>20);
 assert.deepEqual(endingFrames(advance(s,{end:true})),[5,6]);
});
test('chapter endings cannot skip the attempt and crisis to award the berry',()=>{
 for(let step=-1;step<3;step++){
  const s={...initial(),step};assert.deepEqual(endingFrames(advance(s,{end:true})),[illustrationFor(s)]);
 }
});
test('duplicate and reread page events do not advance the story',()=>{
 const s=advance(initial(),{page:4,total:60});
 assert.strictEqual(advance(s,{page:4,total:60}),s);assert.strictEqual(advance(s,{page:2,total:60}),s);
 const end=advance(s,{end:true});assert.strictEqual(advance(end,{demo:true}),end);
});
test('continuity ledger conserves the mountain and moves only the single blueberry',()=>{
 for(const f of FRAMES)assert.deepEqual([f.pancakes,f.strawberry,f.raspberry,f.blueberryCount,f.butter],[4,1,1,1,0]);
 assert.deepEqual(FRAMES.map(f=>f.blueberry),['top','top','top','edge','hand','hand']);
});
