const NS='http://www.w3.org/2000/svg';
export const DURATION=1600;
const el=(name,attrs={})=>{const n=document.createElementNS(NS,name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
const rand=(seed)=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
export function createAtmosphere(edge,flash,paper){
  let animations=[],generation=0,exclusion=null;
  function clear(){exclusion=null;generation++;for(const a of animations)a.cancel();animations=[];edge.replaceChildren();flash.replaceChildren();}
  // スクロールではSVGを作り直さず、本文の除外範囲だけを更新する。
  function syncBounds(){if(!exclusion)return;const r=paper.getBoundingClientRect();for(const [key,value] of Object.entries({x:r.left-12,y:r.top-12,width:r.width+24,height:r.height+24}))exclusion.setAttribute(key,value);}
  function fadeOut(){
    if(!edge.firstChild)return;
    const token=++generation;
    const a=edge.animate([{opacity:getComputedStyle(edge).opacity},{opacity:0}],{duration:180,easing:'ease-out',fill:'forwards'});
    animations.push(a);a.finished.then(()=>{if(generation===token)clear();}).catch(()=>{});
  }
  function play(cue,{strength=1,reduced=false,at=null,seed=1}={}){
    clear();if(!cue||strength<=0)return;
    const token=generation,W=innerWidth,H=innerHeight,r=paper.getBoundingClientRect(),random=rand(seed+52);
    const svg=el('svg',{viewBox:`0 0 ${W} ${H}`,width:W,height:H});
    const defs=el('defs');svg.append(defs);
    const mask=el('mask',{id:'reading-mask',maskUnits:'userSpaceOnUse',x:0,y:0,width:W,height:H});
    exclusion=el('rect',{x:r.left-12,y:r.top-12,width:r.width+24,height:r.height+24,rx:16,fill:'black'});mask.append(el('rect',{width:W,height:H,fill:'white'}),exclusion);defs.append(mask);
    cue.colors.forEach((c,i)=>{const g=el('radialGradient',{id:`wash-${i}`});g.append(el('stop',{offset:0,'stop-color':c,'stop-opacity':.64}),el('stop',{offset:.5,'stop-color':c,'stop-opacity':.24}),el('stop',{offset:1,'stop-color':c,'stop-opacity':0}));defs.append(g);});
    const artwork=el('g',{mask:'url(#reading-mask)'});svg.append(artwork);edge.append(svg);
    const root=el('g');artwork.append(root);
    function animate(n,frames,duration=DURATION,delay=0){const a=n.animate(frames,{duration,delay,fill:'both',easing:'ease-in-out'});animations.push(a);return a;}
    const peak=Math.min(.85,strength*.68);
    const envelope=[{opacity:0,offset:0},{opacity:peak,offset:.28},{opacity:peak*.8,offset:.48},{opacity:0,offset:1}];
    animate(root,envelope);
    const dark=cue.kind==='narrow'||cue.kind==='memory';
    for(let i=0;i<5;i++){
      const side=i%2===0, x=side?W*.02:W*.98, y=H*(.18+i*.15);
      const n=el('ellipse',{cx:x,cy:y,rx:W*(dark?.25:.4),ry:H*.48,fill:`url(#wash-${i%3})`});root.append(n);
      if(!reduced)animate(n,[{transform:`translate(${side?-W*.08:W*.08}px,35px) scale(.9)`},{transform:`translate(${side?W*.04:-W*.04}px,-30px) scale(1.15)`}]);
    }
    if(!reduced){
      const kind=cue.kind;
      // 大きな曲線が同じ方向へ流れる。色面と細線を対にして画面の空気を作る。
      for(let i=0;i<8;i++){
        const side=i%2===0,s=side?1:-1,x=side?-W*.12:W*1.12,y=H*(.1+(i/8)*.95),c=cue.colors[i%3];
        let d,dx=s*W*.12,dy=-H*.07;
        if(kind==='rush'){d=`M${W*.5} ${H*.46} Q${W*.5+s*W*.22} ${y*.75} ${x} ${y}`;dx=-s*W*.14;dy=0;}
        else if(kind==='open'){d=`M${W*.5} ${H*.52} C${W*.5} ${H*.32} ${x} ${H*.2} ${x} ${y}`;dx=-s*W*.12;dy=-H*.05;}
        else if(kind==='narrow'){d=`M${x} ${-H*.1} C${x+s*W*.2} ${H*.25} ${x+s*W*.12} ${H*.7} ${x} ${H*1.1}`;dx=s*W*.1;dy=0;}
        else if(kind==='release'){d=`M${x} ${H*.1} C${x+s*W*.3} ${H*.45} ${x+s*W*.1} ${H*.65} ${x+s*W*.3} ${H*1.1}`;dy=H*.17;}
        else if(kind==='warm'){d=`M${x} ${y} C${x+s*W*.25} ${y-H*.3} ${x+s*W*.4} ${y+H*.12} ${x+s*W*.22} ${y+H*.36}`;dy=-H*.12;}
        else if(kind==='dusk'){d=`M${-W*.2} ${y} C${W*.2} ${y-H*.15} ${W*.65} ${y+H*.13} ${W*1.2} ${y-H*.04}`;dx=-W*.05;dy=H*.1;}
        else {d=`M${-W*.2} ${y} C${W*.1} ${y-H*.23} ${W*.6} ${y+H*.2} ${W*1.2} ${y-H*.16}`;dx=W*.2;}
        const band=el('path',{d,fill:'none',stroke:c,'stroke-width':kind==='memory'?1.5:8+i*3,'stroke-opacity':kind==='memory'?.5:.2,'stroke-linecap':'round'});
        root.append(band);animate(band,[{transform:`translate(${-dx}px,${-dy}px)`,opacity:0},{transform:'translate(0,0)',opacity:1,offset:.22},{transform:`translate(${dx}px,${dy}px)`,opacity:0}],kind==='rush'?1000:DURATION);
        const line=el('path',{d,fill:'none',stroke:c,'stroke-width':i%3===0?2:1.2,'stroke-opacity':.45,'stroke-linecap':'round'});root.append(line);animate(line,[{transform:`translate(${-dx}px,${-dy}px)`},{transform:`translate(${dx}px,${dy}px)`}]);
      }
      const count=kind==='memory'?18:kind==='rush'?36:28;
      for(let i=0;i<count;i++){
        const side=i%2===0,s=side?1:-1,x=side?random()*W*.35:W*(.65+random()*.35),y=random()*H,c=cue.colors[i%3],size=2+random()*7;
        const n=el('g');const grain=kind==='rush'?el('path',{d:`M0 0 l${size*6*s} ${-size}`,stroke:c,'stroke-width':size*.35,'stroke-linecap':'round'}):el('ellipse',{rx:size,ry:size*(.25+random()*.45),fill:c,transform:`rotate(${random()*180})`});n.append(grain);root.append(n);
        let dx=(kind==='rush'||kind==='open')?-s*(60+random()*W*.25):kind==='narrow'?s*45:40+random()*100;
        let dy=kind==='release'?100+random()*140:kind==='warm'?-50-random()*100:kind==='dusk'?50:-20-random()*60;
        const start=80+random()*160,duration=kind==='rush'?900+random()*200:1000+random()*200;
        animate(n,[{transform:`translate(${x-dx*.2}px,${y-dy*.2}px) scale(.3)`,opacity:0},{transform:`translate(${x}px,${y}px) scale(1)`,opacity:.55,offset:.35},{transform:`translate(${x+dx}px,${y+dy}px) scale(.6)`,opacity:0}],duration,start);
      }
      // 本文の明るさを変える全面フラッシュは出さない。

    }
    if(at!==null){for(const a of animations){a.pause();a.currentTime=Math.max(0,at);}}
    else {const last=animations[0];last.finished.then(()=>{if(generation===token)clear();}).catch(()=>{});}
  }
  return {play,clear,syncBounds,fadeOut};
}
