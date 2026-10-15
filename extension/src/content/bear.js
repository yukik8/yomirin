// くま(よみりん)の絵。docs/style/sprites/master.png を基準に透過背景で描き起こした画像を使う。
// 元の透過素材と出力寸法は tools/asset-sprites/manifest.json、書き出しは同じ場所の export.py。
// 絵は動かない1枚ずつで、動き(跳ねる・飛ぶ・潰れる・回る)は stage.js が付ける。
//
//   ふだん      … front(正面)/ back-view(後ろ)/ read(読む)/ read-side(読む・横)/ read-lying(ねそべって読む)
//                 chin(本に顎のせ)/ turn-page(ページめくり)/ think-read(考えながら読む)/ focus(集中中)
//                 sleep-book(本の上で寝る)/ tower(積読の上)/ turn(振り向く)
//   顔だけ      … head(通常)/ head-blink(まばたき)/ head-smile(すこし嬉しい)— 下の縁から顔を出す
//   リアクション … idea(ひらめき・電球つき)/ what(なにそれ?)/ hop(ぴょん)/ flat(べた)/ chira(ちらっ)
//                 hyo(ひょっ)/ ear(耳ぴこ)/ nozoku(のぞく)— この3つは左の縁から(右は鏡写し)
//   フィーバー  … wait(待機)→ surprise(びっくり)→ jump(ジャンプ開始)→ launch(射出)
//                 → tumble(くるくる)/ spin(空中で回転・虹)→ fall(落下)→ land(着地)→ back(元に戻る)
//   小物        … flag(旗)/ mug(マグカップ)/ stack(積読)/ box(箱に入る)/ book(開いた本だけ)
//   予告        … nyo(にょっ: 画面の下の縁から耳だけ。激レアの予告)
//   余白の飾り  … fx-leaf / fx-tulip / fx-flower / fx-orange / fx-sprig / fx-blossom / fx-petals(ふだん)、
//                 fx-star(金の星・予告)/ fx-sparkles(金のきらきら・レアの当たり)— margin.js が置く

export const bearURL = (pose) => new URL(`../../assets/bear/${pose}.webp`, import.meta.url).href;

/** くまの <img> の HTML。飾りなので読み上げない(alt は空)。 */
export function bearImg(pose, cls = '') {
  return `<img class="${cls}" src="${bearURL(pose)}" alt="" draggable="false" data-pose="${pose}">`;
}

/** 要素の中のくまを、ポーズが変わったときだけ差し替える(記録の画面の看板用。動かさない)。 */
export function showBear(el, pose) {
  if (!el || el.dataset.pose === pose) return;
  el.dataset.pose = pose;
  el.innerHTML = bearImg(pose);
}
