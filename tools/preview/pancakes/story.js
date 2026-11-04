// The bear never sees book text. All suspense belongs to this independent story.
const beat=(name,n,pose='front',action='place',extra={})=>({name,n,pose,action,lean:0,stool:0,butter:false,...extra});
export const BEATS=[
 beat('お皿を持ってきた',0,'front','arrive'),
 beat('まず、一枚',1),
 beat('もう一枚',2),
 beat('横から高さを確かめる',2,'wait','inspect'),
 beat('三枚目は少しずれた',3,'front','place',{lean:3}),
 beat('端をそろえる',3,'hop','nudge'),
 beat('四枚、五枚',5),
 beat('片側に寄ってきた',5,'surprise','wobble',{lean:9}),
 beat('両手で受け止める',5,'surprise','catch',{lean:4}),
 beat('そっと押し戻す',5,'hop','nudge'),
 beat('一歩離れて確かめる',5,'front','inspect'),
 beat('まだ積むつもりらしい',6),
 beat('届かなくなった',6,'surprise','reach'),
 beat('小さな踏み台を持ってきた',6,'front','stool',{stool:1}),
 beat('踏み台にのぼる',6,'hop','climb',{stool:2}),
 beat('上から七枚目',7,'front','place',{stool:2}),
 beat('今度は上半分が傾いた',7,'surprise','wobble',{stool:2,lean:10}),
 beat('肩で支えている',7,'hop','catch',{stool:2,lean:5}),
 beat('持ち直した。ひと息',7,'front','nudge',{stool:2}),
 beat('八枚目まで重ねた',8,'front','place',{stool:2}),
 beat('頂上にバターをのせる',8,'hop','butter',{stool:2,butter:true}),
 beat('バターが端へ滑った',8,'surprise','slide',{stool:2,butter:true,butterX:34,lean:5}),
 beat('バターを真ん中へ戻す',8,'hop','catch',{stool:2,butter:true,lean:2}),
 beat('片手に、もう一枚',8,'front','tempt',{stool:2,butter:true,lean:3,extra:true}),
];
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
