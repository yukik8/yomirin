// 本文のページにある語句だけを根拠にした手付けの演出。自動分類ではない。
export const SCORE = [
  {kind:'wind',label:'風が抜ける',quote:'土工の袢天の裾がひらついたり',colors:['#8fbacb','#b7cc9c','#ebc48d']},
  {kind:'dusk',label:'薄明かり',quote:'薄明るい中に並んでいる',colors:['#b9a1ce','#e5b08b','#7e93ba']},
  {kind:'rush',label:'風を切る',quote:'顔に当る薄暮の風',colors:['#8eafca','#c3a7d4','#ebbc94']},
  {kind:'warm',label:'親しみ',quote:'何だか親しみ易いような気がした',colors:['#e9b379','#d5c28d','#b5c6a0']},
  {kind:'warm',label:'日を受ける',quote:'黄色い実がいくつも日を受けている',colors:['#e7ba60','#d8cc8c','#a7c39c']},
  {kind:'open',label:'空間がひらく',quote:'広広と薄ら寒い海が開けた',colors:['#6eaac6','#9bc7cd','#d0d5b0']},
  {kind:'narrow',label:'心が落ち着かない',quote:'良平は独りいらいらしながら',colors:['#9ba6bd','#b4a0b8','#d4b9a2']},
  {kind:'dusk',label:'光が遠のく',quote:'西日の光が消えかかっている',colors:['#da9e7c','#b69ac2','#7c8ea9']},
  {kind:'rush',label:'駆ける',quote:'どんどん線路伝いに走り出した',colors:['#8a99b7','#a7acba','#d6baa5']},
  {kind:'warm',label:'灯りがにじむ',quote:'電燈の光がさし合っていた',colors:['#e2b272','#ddc69a','#9cacc3']},
  {kind:'release',label:'こらえたものがほどける',quote:'わっと泣き出さずにはいられなかった',colors:['#9fb3ca','#c3b3cc','#dfc5ae']},
  {kind:'memory',label:'細い余韻',quote:'細細と一すじ断続している',colors:['#a8a4bb','#c3b19d','#a9bdc2']},
];
export const CONSTANT={kind:'warm',label:'一定の余韻',quote:'',colors:['#e3a596','#8fb0d4','#b7c59b']};
export function cueFor(page,text){const cue=SCORE[page];return cue&&text.includes(cue.quote)?cue:null;}
// completed は読み終えたページの数。未読の台本は公開しない。
export function revealedCue(completed,pages){if(!Number.isInteger(completed)||completed<1||completed>pages.length)return null;return cueFor(completed-1,pages[completed-1].text);}
