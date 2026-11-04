import {BEATS,FRAMES,illustrationFor,endingFrames} from './story.js';
const NS='http://www.w3.org/2000/svg';
const SHEET='./assets/blueberry-story-v1.png';
export async function preload(){const image=new Image();image.src=SHEET;await image.decode();}
const pose=(angle=0,y=0)=>`translateY(${y}px) rotate(${angle}deg)`;
const gestures={
 peek:[pose(),pose(-.5,-1),pose()],
 reach:[pose(),pose(-.7,-2),pose()],
 climb:[pose(),pose(.6,-2),pose()],
 lean:[pose(),pose(1.4),pose(.5),pose()],
 catch:[pose(.6),pose(-.4),pose()],
 settle:[pose(0,-2),pose(),pose()],
};
export function createScene(host){
 host.innerHTML=`<svg viewBox="0 0 500 440" xmlns="${NS}" aria-hidden="true"><g transform="translate(250 405)"><g id="artwork"></g></g></svg>`;
 const artwork=host.querySelector('#artwork');
 // Render complete sheet cells through SVG viewports. The PNG is not cut or recolored.
 const images=FRAMES.map(({frame})=>{
  const viewport=document.createElementNS(NS,'svg'),image=document.createElementNS(NS,'image');
  const i=frame-1;
  for(const [name,value] of Object.entries({x:-225,y:-385,width:450,height:450,viewBox:`${i%3*512} ${Math.floor(i/3)*512} 512 512`,overflow:'hidden'}))viewport.setAttribute(name,value);
  for(const [name,value] of Object.entries({href:SHEET,width:1536,height:1024}))image.setAttribute(name,value);
  viewport.append(image);viewport.style.overflow='hidden';viewport.style.visibility='hidden';artwork.append(viewport);return viewport;
 });
 let animations=[],timers=[],targetFrame=1,displayFrame=1,lastKey='',generation=0;
 function clearMotion(){animations.forEach(a=>a.cancel());animations=[];timers.forEach(clearTimeout);timers=[];}
 function visible(frame){
  images.forEach((image,i)=>{image.style.opacity='1';image.style.visibility=i===frame-1?'visible':'hidden';});
  displayFrame=frame;host.dataset.frame=String(frame);host.setAttribute('aria-label',FRAMES[frame-1].name);
 }
 function stop(){generation++;clearMotion();visible(targetFrame);artwork.style.transform='none';host.dataset.moving='false';}
 function show(frame,duration){
  const previous=displayFrame;clearMotion();visible(frame);host.dataset.moving='true';
  if(previous!==frame){
   const old=images[previous-1],next=images[frame-1];old.style.visibility='visible';
   animations.push(old.animate([{opacity:1},{opacity:0}],{duration:180,fill:'forwards'}));
   animations.push(next.animate([{opacity:0},{opacity:1}],{duration:180,fill:'forwards'}));
  }
  animations.push(artwork.animate(gestures[FRAMES[frame-1].action].map(transform=>({transform})),{duration,easing:'ease-in-out'}));
 }
 function render(state,{reduced=false,quiet=false,replay=false}={}){
  stop();targetFrame=illustrationFor(state);
  const key=`${state.step}:${state.ended}`,changed=key!==lastKey;lastKey=key;
  if(reduced||quiet||(!changed&&!replay)){stop();return;}
  const token=generation,ending=endingFrames(state);
  if(ending.length===2){
   // Show the catch before the relief. A direct jump would hide the causal resolution.
   show(5,600);
   timers.push(setTimeout(()=>{if(token!==generation)return;show(6,500);timers.push(setTimeout(()=>{if(token===generation)stop();},500));},650));
  }else{
   show(targetFrame,1000);timers.push(setTimeout(()=>{if(token===generation)stop();},1000));
  }
 }
 return{render,stop};
}
