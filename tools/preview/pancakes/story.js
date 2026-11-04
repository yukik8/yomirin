// The independent story never receives book text.
// This ledger is reviewed against the six actual sheet cells, not inferred from animation.
export const FRAMES=[
 {frame:1,name:'頂上のブルーベリーが気になる',action:'peek',blueberry:'top'},
 {frame:2,name:'背伸びしても、あと少し届かない',action:'reach',blueberry:'top'},
 {frame:3,name:'山にしがみついて、手を伸ばす',action:'climb',blueberry:'top'},
 {frame:4,name:'体重で傾いた。実が端まで転がる',action:'lean',blueberry:'edge'},
 {frame:5,name:'山を支えながら、落ちた実を受け止めた',action:'catch',blueberry:'hand'},
 {frame:6,name:'山はそのまま。欲しかった実は手の中',action:'settle',blueberry:'hand'},
].map(frame=>({...frame,pancakes:4,strawberry:1,raspberry:1,blueberryCount:1,butter:0}));
// Build anticipation during reading; the catch and relief belong to the ending.
export const BEATS=FRAMES.slice(0,4);
export function canResolve(state){return state.step===BEATS.length-1;}
export function endingFrames(state){return state.ended&&canResolve(state)?[5,6]:[BEATS[Math.max(0,state.step)].frame];}
export function illustrationFor(state){return endingFrames(state).at(-1);}
export const initial=()=>({step:0,furthest:0,ended:false});
// Irregular dwell times, scaled to chapter length. No countdown is shown to readers.
export function schedule(total){
 const weights=BEATS.map((_,i)=>[1,2,1,3,2,1,2][i%7]);
 const sum=weights.slice(0,-1).reduce((a,b)=>a+b,0)||1;let elapsed=0;
 return weights.map((w,i)=>{const at=i===0?1:1+Math.floor(elapsed/sum*Math.max(0,total-3));elapsed+=w;return at;});
}
export function advance(state,{page,total=60,demo=false,end=false}={}){
 if(state.ended)return state;
 if(end)return {...state,ended:true};
 if(demo)return {...state,step:Math.min(BEATS.length-1,state.step+1)};
 if(!Number.isInteger(page)||page<=state.furthest)return state;
 const due=schedule(total).filter(p=>p<=page).length-1;
 // Short chapters see a shorter story; do not teleport through an entire plot.
 return {...state,furthest:page,step:Math.min(state.step+1,Math.max(0,due),BEATS.length-1)};
}
