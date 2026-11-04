import {paginate} from '../emaki/emaki.js';
import {revealedCue,CONSTANT} from './score.js';
import {createAtmosphere,DURATION} from './fx.js';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const fx=createAtmosphere($('fx-edge'),$('fx-flash'),$('paper'));
const motion=matchMedia('(prefers-reduced-motion: reduce)');
let pages=[],page=0,lastRead=null,completed=false,lastTurn=-Infinity,pending=0;
function clear(){cancelAnimationFrame(pending);fx.clear();$('freeze').checked=false;$('scrub').hidden=true;}
function render(){
  $('prose').hidden=completed;$('end').hidden=!completed;
  if(!completed)$('prose').replaceChildren(...pages[page].text.split('\n').map(text=>{const p=document.createElement('p');p.textContent=text;return p;}));
  $('folio').textContent=`${String(page+1).padStart(2,'0')} / ${pages.length}`;
  $('position').textContent=completed?'読了':`${page+1} / ${pages.length}`;
  $('next').disabled=completed;$('next').innerHTML=page===pages.length-1?'読み終える <span aria-hidden="true">→</span>':'読み終えて、めくる <span aria-hidden="true">→</span>';
  $('back').disabled=page===0&&!completed;$('jump').value=String(page);
}
function selectedCue(){if(lastRead===null)return null;return $('mode').value==='constant'?CONSTANT:revealedCue(lastRead+1,pages);}
function info(){
  const cue=selectedCue(),off=$('mode').value==='off'||+$('strength').value===0;
  $('replay').disabled=!cue||off;
  $('strength-value').value=`${$('strength').value}%`;
  if(lastRead===null){$('status').textContent='まず1ページ。読み終えたら、めくってください。';$('source').textContent='読み終えたページの根拠だけを、ここに表示します。';return;}
  $('status').textContent=off?'演出なしで読んでいます。':`${lastRead+1}ページの余韻 · ${cue?.label??'静かなまま'}`;
  $('source').textContent=cue?.quote?`${lastRead+1}ページ「${cue.quote}」から。読み終えた文章だけを使っています。`:$('mode').value==='constant'?'比較用の一定の演出です。本文の内容とは連動しません。':'このページには演出を付けていません。';
}
function play(at=null){if($('mode').value==='off')return;fx.play(selectedCue(),{strength:+$('strength').value/100,reduced:motion.matches||$('reduced').checked,at,seed:(lastRead??0)+1});}
function forward(){
  if(!pages.length||completed)return;
  const now=performance.now(),quiet=now-lastTurn<DURATION;
  if(quiet){cancelAnimationFrame(pending);fx.fadeOut();$('freeze').checked=false;$('scrub').hidden=true;}else clear();
  lastRead=page;if(page<pages.length-1)page++;else completed=true;
  render();info();
  // 長いページを読み終えた場合も次の本文の先頭へ戻す。再配置後に除外領域を測る。
  if(scrollY>120)window.scrollTo({top:Math.max(0,$('paper').getBoundingClientRect().top+scrollY-24),behavior:'instant'});
  fx.syncBounds();if(!quiet){pending=requestAnimationFrame(()=>{pending=requestAnimationFrame(()=>play());});}lastTurn=now;
}
function reset(to=0){clear();page=to;completed=false;lastRead=null;lastTurn=-Infinity;render();info();}
$('next').addEventListener('click',forward);
$('back').addEventListener('click',()=>reset(completed?page:Math.max(0,page-1)));
$('restart').addEventListener('click',()=>reset());
$('jump').addEventListener('change',()=>reset(+$('jump').value));
$('replay').addEventListener('click',()=>{const now=performance.now();if(now-lastTurn<DURATION)return;lastTurn=now;clear();play();});
$('settings-toggle').addEventListener('click',()=>{clear();const open=$('settings').hidden;$('settings').hidden=!open;$('settings-toggle').setAttribute('aria-expanded',String(open));});
for(const id of ['mode','strength','reduced'])$(id).addEventListener('input',()=>{clear();info();});
$('freeze').addEventListener('change',()=>{$('scrub').hidden=!$('freeze').checked;if($('freeze').checked)play(+$('time').value);else fx.clear();});
$('time').addEventListener('input',()=>{$('time-value').value=`${$('time').value} ms`;play(+$('time').value);});
$('evidence').addEventListener('toggle',()=>{if(!$('evidence').open)clear();});
addEventListener('keydown',e=>{if(e.repeat||e.altKey||e.metaKey||e.ctrlKey||/INPUT|SELECT|TEXTAREA|SUMMARY/.test(e.target.tagName)||(e.key===' '&&e.target.tagName==='BUTTON'))return;if([' ','ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')$('back').click();else forward();}});
addEventListener('resize',clear);addEventListener('scroll',()=>fx.syncBounds(),{passive:true});addEventListener('pagehide',clear);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});motion.addEventListener('change',clear);
try{
 const response=await fetch('../emaki/books.json');if(!response.ok)throw Error('本文を読み込めませんでした。');
 const data=await response.json(),book=data.books.find(b=>b.id==='torokko');pages=paginate(book);
 $('jump').replaceChildren(...pages.map((_,i)=>new Option(`${i+1}ページ`,i)));
 if(['linked','constant','off'].includes(params.get('mode')))$('mode').value=params.get('mode');
 reset(Math.max(0,Math.min(pages.length-1,(Number(params.get('page'))||1)-1)));
}catch(error){$('status').textContent='本文を読み込めませんでした。HTTPサーバ経由で開き直してください。';console.error(error);}
