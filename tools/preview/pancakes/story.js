// The story uses only the six original illustrations. No book text enters it.
const beat=(name,frame,action)=>({name,frame,action});
export const BEATS=[
 beat('お皿の向こうから、ちらり',1,'peek'),
 beat('一枚、できた',2,'settle'),
 beat('いつのまにか、こんな山に',3,'settle'),
 beat('上のいちごに手を伸ばす',4,'reach'),
 beat('体重をかけたら、少しぐらり',4,'small-lean'),
 beat('そっと体勢を戻す',4,'recover'),
 beat('もっと高くして、しがみついた',5,'settle'),
 beat('重みで、ゆっくり傾く',5,'lean'),
 beat('ぎゅっと踏ん張る',5,'brace'),
 beat('ひとまず落ち着いた',5,'recover'),
 beat('もう一度、あぶない',5,'last-lean'),
 beat('なんとか持ちこたえている',5,'brace'),
];
export function illustrationFor(state){
 const beat=BEATS[Math.max(0,state.step)];
 // Do not conjure a large pile when a short chapter ends before the tall tower.
 return state.ended&&beat.frame===5?6:beat.frame;
}
export const initial=()=>({step:-1,furthest:0,ended:false});
// Irregular dwell times, scaled to chapter length. No countdown is shown to readers.
export function schedule(total){
 const weights=BEATS.map((_,i)=>[1,2,1,3,2,1,2][i%7]);
 const sum=weights.reduce((a,b)=>a+b,0);let elapsed=0;
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
