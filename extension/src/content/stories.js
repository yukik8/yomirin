// よみりんの小さなストーリー(ストーリー集 ① の A の話)。読書中、画面の右下の角で、無言のくまが一つのものを作り進める。
// 絵は透過背景で描き起こした docs/style/sprites/<id>.png から tools/asset-sprites/export.py で書き出す。
// 動かし方は story.js。説明は一切しない(何を作っているのかも、あと何コマかも)。
//
//   frames … コマの数(絵は <id>-1 〜 <id>-<frames>)。最後から2つ目のコマまで進んで待ち、最後のコマはオチ
//   ending … オチの型(story.js の ENDINGS)
//             boom 膨らんで弾ける / collapse 傾いて崩れる / crumble 崩れた絵に替わって、ぺしゃっと潰れる /
//             fly 上へ飛んでいく / sail 横へ滑って出ていく / complete 仕上がってきらっと光る / pop ぴょんと出てくる /
//             stay そのまま(フィーバーはくま抜きで、この絵が横に残る)
//   pace   … 進みやすさ(1 が並。小さいほど一コマに長くかかる)
//   stars  … オチで散る星の色(省けば金。虹の話は虹、静かな話は銀)
//   burst  … オチで散る粒の量(省けば 1)
// 並びはストーリー集の絵の順(試写室の一覧もこの順)
export const STORIES = [
  { id: 'books', name: '本積み', frames: 6, ending: 'boom', pace: 1 },
  { id: 'castle', name: '本のお城', frames: 5, ending: 'pop', pace: 0.9 },
  { id: 'pancakes', name: 'パンケーキ', frames: 6, ending: 'collapse', pace: 1.1 },
  { id: 'blocks', name: '謎タワー', frames: 5, ending: 'collapse', pace: 1.1 },
  { id: 'balloons', name: '風船', frames: 4, ending: 'fly', pace: 0.7 },
  { id: 'stars', name: '星集め', frames: 5, ending: 'boom', pace: 0.9 },
  { id: 'clouds', name: '雲作り', frames: 5, ending: 'complete', pace: 1, stars: 'rainbow' },
  { id: 'bed', name: '寝床', frames: 5, ending: 'stay', pace: 1.2 },
  { id: 'boxes', name: '段ボール', frames: 5, ending: 'pop', pace: 1 },
  { id: 'plant', name: '謎の植物', frames: 5, ending: 'complete', pace: 0.7 },
  { id: 'bonsai', name: '盆栽', frames: 4, ending: 'complete', pace: 0.6, stars: 'silver', burst: 0.3 },
  { id: 'flag', name: '旗立て', frames: 4, ending: 'complete', pace: 0.8 },
  { id: 'rainbow', name: '虹建設', frames: 4, ending: 'complete', pace: 0.8, stars: 'rainbow' },
  { id: 'snowman', name: '雪だるま', frames: 5, ending: 'crumble', pace: 1, stars: 'silver' },
  { id: 'gift', name: '謎の箱', frames: 5, ending: 'pop', pace: 1.2, burst: 1.6 },
  { id: 'cookies', name: 'クッキー', frames: 6, ending: 'stay', pace: 1 },
  { id: 'yarn', name: '毛糸', frames: 5, ending: 'stay', pace: 1 },
  { id: 'boat', name: '紙の船', frames: 4, ending: 'sail', pace: 0.8 },
];
