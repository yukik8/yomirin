import test from 'node:test';
import assert from 'node:assert/strict';
import {BEATS,initial,advance} from './story.js';
test('long chapter progresses in order, includes pauses, and waits for chapter ending',()=>{
 let s=initial(),holds=0;const seen=[];
 for(let page=1;page<80;page++){
  const next=advance(s,{page,total:80});assert.ok(next.step-s.step<=1);
  if(next.step===s.step)holds++;else seen.push(next.step);s=next;assert.equal(s.ended,false);
 }
 assert.deepEqual(seen,BEATS.map((_,i)=>i));assert.ok(holds>20);
 assert.equal(advance(s,{end:true}).ended,true);
});
test('rereading and duplicate notifications do not advance the bear',()=>{
 const s=advance(initial(),{page:4,total:80});
 assert.strictEqual(advance(s,{page:4,total:80}),s);assert.strictEqual(advance(s,{page:2,total:80}),s);
});
test('short chapter ends with its accumulated stack, without jumping to the full tower',()=>{
 let s=initial();for(let page=1;page<8;page++)s=advance(s,{page,total:8});
 const ended=advance(s,{end:true});assert.equal(ended.step,s.step);assert.ok(ended.step<BEATS.length-1);
 assert.strictEqual(advance(ended,{demo:true}),ended);assert.strictEqual(advance(ended,{end:true}),ended);
});
test('demo waits at its last beat, and even an empty scene can end',()=>{
 let s=initial();for(let i=0;i<40;i++)s=advance(s,{demo:true});assert.equal(s.step,23);assert.equal(s.ended,false);
 assert.equal(advance(initial(),{end:true}).step,-1);
});
