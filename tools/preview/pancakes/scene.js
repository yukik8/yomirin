import {BEATS,illustrationFor} from './story.js';
const NS='http://www.w3.org/2000/svg';
// Original pixel dimensions. Preserve the same scale and ground across all six drawings.
const SIZES=[[251,229],[221,189],[238,276],[267,342],[316,388],[362,460]];
const imageURL=frame=>`../../../extension/assets/story/pancakes-${frame}.webp`;
export async function preload(){await Promise.all(SIZES.map(async(_,i)=>{const image=new Image();image.src=imageURL(i+1);await image.decode();}));}
const pose=(angle=0,y=0,squash=1)=>`translateY(${y}px) rotate(${angle}deg) scaleY(${squash})`;
const gestures={
 peek:[pose(),pose(-1,-2),pose()],
 settle:[pose(0,-5),pose(0,1,.99),pose()],
 reach:[pose(),pose(-1.3,0),pose(-.4,-1),pose()],
 'small-lean':[pose(),pose(1.7,0),pose(.8,0),pose()],
 recover:[pose(1.3),pose(-.5),pose()],
 lean:[pose(),pose(2.5),pose(1.7),pose()],
 brace:[pose(1.7),pose(-.8,1,.99),pose(.3),pose()],
 'last-lean':[pose(),pose(3),pose(2.1),pose()],
 ending:[pose(0,-6),pose(0,2,.985),pose(0,-1),pose()],
};
export function createScene(host){
 // SVG is only a carrier. No replacement character, food, props, texture, or filter.
 host.innerHTML=`<svg viewBox="0 0 500 440" xmlns="${NS}" aria-hidden="true"><g transform="translate(250 412)"><g id="artwork"></g></g></svg>`;
 const artwork=host.querySelector('#artwork');
 const images=SIZES.map(([width,height],i)=>{
  const image=document.createElementNS(NS,'image');
  for(const [name,value] of Object.entries({href:imageURL(i+1),x:-width*.9/2,y:-height*.9,width:width*.9,height:height*.9}))image.setAttribute(name,value);
  image.style.visibility='hidden';artwork.append(image);return image;
 });
 let animations=[],currentFrame=1,lastKey='',generation=0;
 function stop(){
  generation++;animations.forEach(a=>a.cancel());animations=[];
  images.forEach((image,i)=>{image.style.opacity='1';image.style.visibility=i===currentFrame-1?'visible':'hidden';});
  artwork.style.transform='none';host.dataset.moving='false';
 }
 function render(state,{reduced=false,quiet=false,replay=false}={}){
  const previousFrame=currentFrame;stop();currentFrame=illustrationFor(state);
  const key=`${state.step}:${state.ended}`,changed=key!==lastKey;lastKey=key;
  images.forEach((image,i)=>{image.style.visibility=i===currentFrame-1?'visible':'hidden';});
  const beat=BEATS[Math.max(0,state.step)],action=state.ended?'ending':beat.action;
  host.setAttribute('aria-label',state.ended?(currentFrame===6?'崩れたパンケーキの上で、くまがブルーベリーを食べている':'くまとパンケーキの物語、おしまい'):beat.name);
  host.dataset.frame=String(currentFrame);
  if(reduced||quiet||(!changed&&!replay))return;
  host.dataset.moving='true';const token=generation;
  if(previousFrame!==currentFrame){
   const old=images[previousFrame-1],next=images[currentFrame-1];
   // Crossfade only the drawings, never the entire screen. Both images are predecoded.
   old.style.visibility='visible';
   animations.push(old.animate([{opacity:1},{opacity:0}],{duration:180,fill:'forwards'}));
   animations.push(next.animate([{opacity:0},{opacity:1}],{duration:180,fill:'forwards'}));
  }
  const duration=action==='last-lean'?1120:action==='ending'?900:1000;
  const movement=artwork.animate(gestures[action].map(transform=>({transform})),{duration,easing:'ease-in-out'});
  animations.push(movement);
  movement.finished.then(()=>{if(token===generation)stop();}).catch(()=>{});
 }
 return{render,stop};
}
