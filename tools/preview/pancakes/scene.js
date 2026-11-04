import {BEATS} from './story.js';
const NS='http://www.w3.org/2000/svg';
const bearURL=name=>`../../../extension/assets/bear/${name}.webp`;
export async function preload(){await Promise.all(['front','wait','surprise','hop'].map(async name=>{const img=new Image();img.src=bearURL(name);await img.decode();}));}
export function createScene(host){
 host.innerHTML=`<svg viewBox="0 0 600 390" xmlns="${NS}" aria-hidden="true"><defs>
 <linearGradient id="cake-side" x2="0" y2="1"><stop stop-color="#f5cd7e"/><stop offset=".6" stop-color="#ffe3a3"/><stop offset="1" stop-color="#d99c50"/></linearGradient>
 <radialGradient id="cake-top" cx=".4" cy=".35" r=".8"><stop stop-color="#eab16a"/><stop offset=".8" stop-color="#ce8a43"/><stop offset="1" stop-color="#b97438"/></radialGradient>
 <filter id="pencil" x="-10%" y="-20%" width="120%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".14" numOctaves="2" seed="12" result="grain"/><feDisplacementMap in="SourceGraphic" in2="grain" scale=".6" xChannelSelector="R" yChannelSelector="G"/></filter>
 <g id="cake" stroke="#94613c" stroke-width="1.4" stroke-linejoin="round"><path d="M-73,-7 C-73,9 -47,17 0,17 S73,8 73,-7 L73,-13 L-73,-13Z" fill="url(#cake-side)"/><ellipse cy="-12" rx="73" ry="20" fill="url(#cake-top)"/><ellipse cy="-13" rx="65" ry="15" fill="none" stroke="#f5d18b" opacity=".7"/><path d="M-45,-15 Q-25,-24 -5,-21 M26,-4 L32,-5 M-33,1 L-28,2" fill="none" stroke="#ffe4a8" stroke-linecap="round" opacity=".65"/></g>
 <g id="butter-shape" stroke="#bd934b" stroke-width="1.2" stroke-linejoin="round"><path d="M-17,-8 L7,-13 L19,-6 L-5,1Z" fill="#fff0b4"/><path d="M-17,-8 L-17,3 L-5,11 L-5,1Z" fill="#efd080"/><path d="M-5,1 L19,-6 L19,5 L-5,11Z" fill="#f9df94"/></g></defs>
 <ellipse cx="300" cy="352" rx="160" ry="10" fill="#b49b7e" opacity=".1"/>
 <g id="stool" stroke="#916d50" stroke-width="2" fill="#d2ae83"><path d="M373,310 L369,348 M418,310 L425,348 M373,334 L422,334" fill="none" stroke-width="7"/><path d="M360,302 Q393,292 430,302 L430,314 Q396,322 360,314Z"/><ellipse cx="395" cy="302" rx="36" ry="10" fill="#e9cfaa"/></g>
 <g id="bear-position"><g id="bear-motion"><image id="bear" href="${bearURL('front')}" x="-94" y="-164" width="188" height="164"/></g></g>
 <g id="plate" transform="translate(225 338)"><ellipse cy="5" rx="101" ry="23" fill="#dfcdb1" stroke="#bda585" stroke-width="1.4"/><ellipse rx="102" ry="22" fill="#faf1db" stroke="#bda585" stroke-width="1.4"/><ellipse cy="-1" rx="83" ry="15" fill="#eee0c4" stroke="#d8c3a1"/></g>
 <g transform="translate(225 322)"><g id="stack-motion" filter="url(#pencil)"></g></g>
 <g id="butter-position"><g id="butter-motion"><use href="#butter-shape"/></g></g>
 <g id="extra-position"><g id="extra-motion"><use href="#cake" transform="scale(.65)"/></g></g>
 </svg>`;
 const q=id=>host.querySelector(`#${id}`),stack=q('stack-motion');
 const cakes=Array.from({length:8},()=>{const pos=document.createElementNS(NS,'g'),motion=document.createElementNS(NS,'g'),use=document.createElementNS(NS,'use');use.setAttribute('href','#cake');motion.append(use);pos.append(motion);stack.append(pos);return{pos,motion};});
 let animations=[],lastStep=-2;
 function stop(){animations.forEach(a=>a.cancel());animations=[];}
 function animate(node,frames,duration=900){animations.push(node.animate(frames,{duration,easing:'cubic-bezier(.25,.7,.3,1)'}));}
 function render(state,{reduced=false,quiet=false}={}){
  stop();const b=BEATS[Math.max(0,state.step)],ending=state.ended,active=state.step>=0;
  const n=active?b.n:0,up=b.stool===2?42:0;
  host.setAttribute('aria-label',ending?'パンケーキの山が崩れ、くまがそばに座っている':active?b.name:'お皿のそばに立つくま');
  const bearX=b.action==='catch'&&b.stool!==2?335:b.action==='inspect'?410:385;
  q('bear-position').setAttribute('transform',`translate(${ending?375:bearX} ${ending?348:348-up})`);
  const pose=ending?'front':b.pose;q('bear').setAttribute('href',bearURL(pose));
  // Fixed body height; the transparent pose canvas varies substantially.
  const width=pose==='wait'?190:pose==='surprise'?228:pose==='hop'?158:188;
  q('bear').setAttribute('width',width);q('bear').setAttribute('x',-width/2);
  q('stool').style.visibility=b.stool&&!ending?'visible':'hidden';
  cakes.forEach(({pos},i)=>{
   pos.style.visibility=i<n?'visible':'hidden';
   const x=ending?(i%2?-1:1)*(17+Math.floor(i/2)*25):b.lean*i*.7;
   const y=ending?-Math.floor(i/3)*10:-i*19;
   const rotation=ending?(i%2?-1:1)*(7+i*3):b.lean*i/Math.max(1,n);
   pos.setAttribute('transform',`translate(${x} ${y}) rotate(${rotation})`);
  });
  const butterY=322-Math.max(0,n-1)*19-28;
  q('butter-position').style.visibility=b.butter&&active?'visible':'hidden';
  q('butter-position').setAttribute('transform',ending?'translate(275 327) rotate(12)':`translate(${225+(b.butterX||0)+b.lean*(n-1)*.7} ${butterY})`);
  q('extra-position').style.visibility=b.extra&&active&&!ending?'visible':'hidden';
  q('extra-position').setAttribute('transform',`translate(${bearX-57} ${267-up}) rotate(-12)`);
  const changed=state.step!==lastStep;lastStep=state.step;
  if(reduced||quiet||(!changed&&!ending))return;
  if(ending){
   cakes.slice(0,n).forEach(({motion},i)=>animate(motion,[{transform:`translate(${(i%2?1:-1)*(17+Math.floor(i/2)*25)+b.lean*i*.7}px,${-i*19+Math.floor(i/3)*10}px) rotate(${-(i%2?-1:1)*(7+i*3)}deg)`},{transform:`translate(0,-${12+i*2}px) rotate(3deg)`,offset:.7},{transform:'none'}],1100));
   animate(q('bear-motion'),[{transform:'rotate(-7deg)'},{transform:'translateY(-9px) rotate(4deg)',offset:.45},{transform:'none'}],1100);return;
  }
  if(b.action==='place'&&n){animate(cakes[n-1].motion,[{transform:'translate(90px,-36px) rotate(-10deg)'},{transform:'translate(0,-3px)',offset:.75},{transform:'none'}],1000);}
  else if(b.action==='wobble'){animate(stack,[{transform:'translateX(-3px) rotate(-2deg)'},{transform:'translateX(4px) rotate(2deg)',offset:.45},{transform:'none'}],1100);}
  else if(b.action==='catch'||b.action==='nudge'){animate(stack,[{transform:`translateX(${b.action==='catch'?10:-8}px) rotate(2deg)`},{transform:'none'}],900);}
  if(b.action==='slide')animate(q('butter-motion'),[{transform:'translateX(-34px)'},{transform:'none'}],1050);
  if(b.action==='butter')animate(q('butter-motion'),[{transform:'translate(90px,-20px)'},{transform:'none'}],1000);
  if(b.action==='tempt')animate(q('extra-motion'),[{transform:'translate(22px,24px) rotate(20deg)'},{transform:'none'}],1000);
  if(b.action==='stool')animate(q('stool'),[{transform:'translateX(35px)'},{transform:'none'}],900);
  const moves={climb:'translate(15px,42px)',reach:'translateY(7px)',inspect:'translateX(-18px)',catch:'translateX(16px) rotate(5deg)',nudge:'rotate(-6deg)',arrive:'translateX(25px)',place:'rotate(4deg)'};
  if(moves[b.action])animate(q('bear-motion'),[{transform:moves[b.action]},{transform:'none'}],1000);
 }
 return{render,stop};
}
