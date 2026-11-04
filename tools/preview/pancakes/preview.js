import {BEATS,initial,advance} from './story.js';
import {createScene,preload} from './scene.js';
import {paginate} from '../emaki/emaki.js';
const $=id=>document.getElementById(id),scene=createScene($('stage')),motion=matchMedia('(prefers-reduced-motion: reduce)');
let state=initial(),mode='theatre',pages=[],page=0,book=null,lastTurn=-Infinity,ready=false;
const reduced=()=>motion.matches||$('reduced').checked;
function render({quiet=false}={}){
 document.body.classList.toggle('reading',mode==='reading');$('paper').hidden=mode!=='reading';
 $('theatre').setAttribute('aria-pressed',String(mode==='theatre'));$('reading').setAttribute('aria-pressed',String(mode==='reading'));
 $('next').disabled=!ready||state.ended||(mode==='theatre'&&state.step===BEATS.length-1);
 $('finish').disabled=!ready||state.ended;
 $('replay').disabled=!ready||reduced();
 $('next').textContent=mode==='theatre'?'つぎのひとコマ →':page===pages.length-1?'読み終える →':'読み終えて、めくる →';
 $('status').textContent=state.ended?'おしまい。':mode==='theatre'?'ひとコマずつ、くまの動きを試せます。':'くまは、ページをめくるときに、ときどき動きます。';
 if(mode==='reading'){
  $('folio').textContent=`${page+1} / ${pages.length}`;
  $('prose').replaceChildren(...(state.ended?['トロッコ　読了']:pages[page].text.split('\n')).map(text=>{const p=document.createElement('p');p.textContent=text;return p;}));
 }
 $('beat').value=state.step;
 $('direction').textContent=state.ended?'いまの演出：章末':state.step>=0?`いまの演出：${BEATS[state.step].name}`:'いまの演出：始まる前';
 scene.render(state,{reduced:reduced(),quiet});
}
function reset(){state=initial();page=0;lastTurn=-Infinity;render({quiet:true});}
function turn(end=false){
 if(!ready||state.ended)return;
 const now=performance.now();
 // Ignore accidental double turns; suppress subsequent animation during rapid scanning.
 if(now-lastTurn<280)return;
 const quiet=now-lastTurn<1200;lastTurn=now;
 if(end||(mode==='reading'&&page===pages.length-1))state=advance(state,{end:true});
 else if(mode==='theatre')state=advance(state,{demo:true});
 else{page++;state=advance(state,{page,total:pages.length});}
 render({quiet});
}
$('replay').onclick=()=>{const now=performance.now();if(now-lastTurn<1200)return;lastTurn=now;scene.render(state,{reduced:reduced(),replay:true});};
$('next').onclick=()=>turn();$('finish').onclick=()=>turn(true);$('reset').onclick=reset;
for(const name of ['theatre','reading'])$(name).onclick=()=>{mode=name;reset();};
$('reduced').onchange=()=>render({quiet:true});motion.addEventListener('change',()=>render({quiet:true}));
$('length').onchange=()=>{pages=paginate(book,$('length').value==='long'?90:520);reset();};
$('beat').replaceChildren(new Option('始まる前',-1),...BEATS.map((b,i)=>new Option(`${i+1}. ${b.name}`,i)));
$('beat').onchange=()=>{state={...initial(),step:+$('beat').value};render({quiet:true});};
addEventListener('keydown',e=>{if(e.repeat||e.altKey||e.metaKey||e.ctrlKey||/INPUT|SELECT|TEXTAREA|SUMMARY|BUTTON/.test(e.target.tagName))return;if(e.key===' '||e.key==='ArrowRight'){e.preventDefault();turn();}});
addEventListener('pagehide',scene.stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)scene.stop();});
try{
 const [data]=await Promise.all([fetch('../emaki/books.json').then(r=>{if(!r.ok)throw Error(r.status);return r.json();}),preload()]);
 book=data.books.find(b=>b.id==='torokko');pages=paginate(book,90);ready=true;reset();
}catch(error){$('status').textContent='読み込みに失敗しました。HTTPサーバ経由で開き直してください。';console.error(error);}
