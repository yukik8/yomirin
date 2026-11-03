// トロッコの見本(Claude Code が手で書いた読み取りと絵)を、端末の決まりでたどって runs/torokko.sample.json にする。
// 計測していないので判定には使わない。道具(封・演じ方・試写室)を確かめるためのもの。
//
//   node tools/preview/emaki/sample.mjs
//
// 1ページに1回(ページを開いた瞬間に送る形)。絵は物の名前で書き、ここで id に置き換える。
// 語句がそのページに無い・頼んでいない物を描いた・形が落ちた、のどれかがあれば止まる
import { readFileSync, writeFileSync } from 'node:fs';
import { EMAKI, applyReading, paginate, replay, startChapter, ticksOf, timeline } from './emaki.js';

const dir = new URL('./', import.meta.url);
const { books } = JSON.parse(readFileSync(new URL('books.json', dir), 'utf8'));
const pages = paginate(books.find((b) => b.id === 'torokko'), EMAKI.pageSize);
const settings = { start: 0, pageSize: EMAKI.pageSize, every: EMAKI.every, chapters: null };
const plan = ticksOf(pages, settings);

// 形
const S = (d, color, tone = 'mid') => ({ d, color, tone });
const L = (d, color, width = 'mid') => ({ d, color, width });
const G = (d, color) => ({ d, color });
const ring = (pts, r) => pts.map(([x, y]) => `M${x - r} ${y} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`).join(' ');
const wheels = (pts, r) => S(ring(pts, r), 'umber', 'deep');
// 物: 名前・形と、足もと・奥行き(数の大きい物が前に重なる)・描いた所・最初に居る所・最初は見えないか・灯り・揺らぎ
const T = (name, forms = [], lines = [], light = [], more = {}) => ({ name, forms, lines, light, at: { x: 160, y: 120 }, depth: 5, spot: '', start: '', hidden: false, lit: true, loop: 'none', ...more });
const P = (name, x, y, scale = 1) => ({ name, x, y, scale });
const R = (from, to, d) => ({ from, to, d });
const B = (event, name, act, to = '', speed = 'mid', fx = 'none') => ({ event, name, act, to, speed, fx });
// 読み取り
const scene = (o) => ({ change: 'new', place: '', place_quote: '', time: 'unknown', time_quote: '', weather: 'unknown', weather_quote: '', mood: 'unknown', mood_quote: '', keep: [], things: [], changes: [], beats: [], ...o });
const thing = (name, look, quote, main = false) => ({ name, look, quote, main });
const beat = (name, act, quote, to = '', speed = 'mid', fx = 'none') => ({ name, act, to, speed, fx, quote });
const ev = (text, quote) => ({ text, quote });

// 何度も出る物
const mountain = (d) => T('山', [S(d, 'green')], [L(d.replace(/ V150 Z$| Z$/, ''), 'umber', 'thin')], [], { depth: 2 });
const rails = T('線路', [], [L('M10 236 L250 122 M44 240 L262 126', 'gray', 'bold'), L('M24 232 l26 5 M56 216 l24 5 M88 201 l22 4 M120 186 l20 4 M150 172 l18 3 M180 158 l16 3 M208 145 l14 3 M234 133 l11 2', 'brown')], [], { depth: 3 });
const cart = (name, more) => T(name, [S('M46 176 L104 170 L108 194 L50 200 Z', 'brown', 'deep'), S('M56 188 l20 -2 l-4 8 l-14 1 Z M84 184 l16 -2 l-2 6 l-12 2 Z', 'umber'), wheels([[62, 200], [94, 196]], 7)],
  [L('M46 176 L104 170 L108 194 L50 200 Z', 'umber'), L('M50 186 L106 180', 'umber', 'thin'), L(ring([[62, 200], [94, 196]], 7), 'umber', 'thin')], [], { at: { x: 78, y: 206 }, depth: 6, ...more });
const teahouse = T('茶店', [S('M118 140 C140 84 200 62 256 70 C286 78 306 108 316 140 Z', 'green'), S('M142 116 H258 V172 H142 Z', 'sand'), S('M128 112 L200 72 L272 112 L264 120 L136 120 Z', 'brown'), S('M186 132 H214 V172 H186 Z', 'umber', 'deep')],
  [L('M128 112 L200 72 L272 112 L264 120 L136 120 Z M142 120 V172 H258 V120 M186 172 V132 H214 V172', 'umber'), L('M150 108 l10 -6 M170 97 l10 -6 M190 86 l8 -5 M212 86 l8 5 M232 97 l10 6 M252 108 l8 5', 'brown', 'thin'), L('M118 140 C140 84 200 62 256 70 C286 78 306 108 316 140', 'green', 'thin')], [], { depth: 3 });
const sleepers = (more) => T('枕木を積んだトロッコ', [S('M90 192 L170 184 L174 212 L94 220 Z', 'brown', 'deep'), S('M96 192 L166 185 L166 177 L96 184 Z', 'umber'), wheels([[112, 222], [154, 217]], 8)],
  [L('M90 192 L170 184 L174 212 L94 220 Z M96 192 L166 185 L166 177 L96 184 Z', 'umber'), L(ring([[112, 222], [154, 217]], 8), 'umber', 'thin')], [], { at: { x: 130, y: 226 }, depth: 6, ...more });

const ticks = [
  { // 1ページ: 村外れの工事場。トロッコが山を下って来て止まり、土をぶちまけて、また山へ登っていく
    reader: {
      events: [
        ev('軽便鉄道の工事が始まり、良平は毎日村外れへトロッコを見に行く', '良平は毎日村外れへ、その工事を見物に行った'),
        ev('トロッコが山を下って来て、村外れの平地で止まる', 'トロッコは村外れの平地へ来ると、自然と其処に止まってしまう'),
        ev('土工たちは終点に土をぶちまけ、トロッコを押して山へ登っていく', 'その線路の終点へ車の土をぶちまける'),
      ],
      scenes: [scene({ place: '村外れの工事場', place_quote: 'トロッコは村外れの平地へ来ると', mood: 'joyful', mood_quote: 'それが面白さに見に行ったのである',
        things: [thing('トロッコ', '土を積んだ台車', 'トロッコで土を運搬する', true), thing('線路', '山から村外れへ下る細い線路', '細い線路がしなったり'), thing('山', '線路の先の山', 'トロッコは山を下るのだから'), thing('土の山', '終点にぶちまけた土', 'その線路の終点へ車の土をぶちまける')] })],
    },
    drawers: [{
      ground: [S('M0 0 H320 V150 H0 Z', 'sky', 'pale'), S('M0 150 C90 142 220 140 320 148 V240 H0 Z', 'sand')],
      spots: [P('終点', 78, 206), P('山の上', 222, 140, .45)],
      routes: [],
      things: [
        mountain('M150 150 C180 95 215 70 250 62 C280 70 305 95 320 110 V150 Z'),
        rails,
        T('土の山', [S('M6 218 C14 200 36 196 50 208 C54 212 56 216 58 220 Z', 'brown')], [L('M6 218 C14 200 36 196 50 208 C54 212 56 216 58 220', 'umber', 'thin')], [], { at: { x: 32, y: 218 }, depth: 4, hidden: true }),
        { ...cart('トロッコ', { spot: '終点', start: '山の上' }), forms: [...cart('トロッコ').forms, S('M50 178 C62 164 92 160 104 172 Z', 'brown', 'pale')] },
      ],
      beats: [B(1, 'トロッコ', 'move', '終点', 'fast', 'bob'), B(2, '土の山', 'appear'), B(2, 'トロッコ', 'move', '山の上', 'slow', 'bob')],
    }],
  },
  { // 2ページ: 夕方、子供だけでトロッコを押して坂を登る
    reader: {
      events: [ev('或夕方、弟たちと、土工のいないトロッコを押して線路を登る', '三人の子供は恐る恐る、一番端にあるトロッコを押した'), ev('勾配が急になり、良平は乗ろうと合図する', '良平はもう好いと思ったから、年下の二人に合図をした')],
      scenes: [scene({ place: '夕方の村外れ', place_quote: 'トロッコの置いてある村外れへ行った', time: 'evening', time_quote: '或夕方', mood: 'tense', mood_quote: '三人の子供は恐る恐る', keep: ['線路', '山'],
        things: [thing('泥だらけのトロッコ', '泥だらけの台車', 'トロッコは泥だらけになったまま、薄明るい中に並んでいる', true)] })],
    },
    drawers: [{
      ground: [S('M0 0 H320 V150 H0 Z', 'violet', 'pale'), S('M0 104 C80 96 240 96 320 104 V150 H0 Z', 'orange', 'pale'), S('M0 150 C90 142 220 140 320 148 V240 H0 Z', 'sand')],
      spots: [P('線路の下', 78, 206), P('坂の途中', 150, 172, .78), P('坂の上', 214, 142, .6)],
      routes: [],
      things: [mountain('M150 150 C180 95 215 70 250 62 C280 70 305 95 320 110 V150 Z'), rails, cart('泥だらけのトロッコ', { spot: '線路の下' })],
      beats: [B(0, '泥だらけのトロッコ', 'move', '坂の途中', 'slow', 'bob')],
    }],
  },
  { // 3ページ: 飛び乗って、一息に線路を下る
    reader: {
      events: [ev('三人はトロッコに飛び乗って線路を下り、良平は有頂天になる', '良平は殆ど有頂天になった'), ev('背の高い土工に怒鳴られ、三人は逃げ出す', '誰に断ってトロに触った？')],
      scenes: [scene({ change: 'same', mood: 'joyful', mood_quote: '良平は殆ど有頂天になった', beats: [beat('泥だらけのトロッコ', 'move', '一息に線路を下り出した', '線路の下', 'fast', 'bob')] })],
    },
    drawers: [],
  },
  { // 4ページ: 十日余り後の工事場。枕木を積んだトロッコが登って来る
    reader: {
      events: [ev('十日余り後、良平は一人で午過ぎの工事場にいる', 'その後十日余りたってから'), ev('枕木を積んだトロッコが、太い線路を登って来る', '太い線路を登って来た'), ev('押している若い二人に、押そうかと声をかける', 'おじさん。押してやろうか？')],
      scenes: [scene({ place: '午過ぎの工事場', place_quote: '午過ぎの工事場に佇みながら', time: 'day', time_quote: '午過ぎの工事場', mood: 'warm', mood_quote: '何だか親しみ易いような気がした', keep: ['山'],
        things: [thing('枕木を積んだトロッコ', '枕木を積んだ一輛の台車', '枕木を積んだトロッコが一輛', true), thing('太い線路', '本線になる太い線路', '本線になる筈の、太い線路を登って来た'), thing('土を積んだトロッコ', '土を積んだ台車', '土を積んだトロッコの外に')] })],
    },
    drawers: [{
      ground: [S('M0 0 H320 V140 H0 Z', 'sky', 'pale'), S('M0 140 C100 134 220 132 320 138 V240 H0 Z', 'sand')],
      spots: [P('画面の外の左', -50, 232, 1.1), P('線路の中ほど', 167, 196), P('線路の奥', 286, 160, .55)],
      routes: [R('画面の外の左', '線路の中ほど', 'M-50 232 C20 222 100 206 167 196'), R('線路の中ほど', '線路の奥', 'M167 196 C210 184 250 170 286 160')],
      things: [
        mountain('M0 140 C40 100 90 80 130 84 C170 90 200 112 220 140 Z'),
        T('太い線路', [], [L('M0 214 C90 196 200 170 320 150 M0 236 C95 216 205 186 320 162', 'gray', 'bold'), L('M20 213 l4 20 M60 205 l4 19 M100 196 l4 18 M140 188 l4 17 M180 179 l3 16 M220 170 l3 15 M260 161 l3 14 M300 153 l2 12', 'brown')], [], { depth: 3 }),
        T('土を積んだトロッコ', [S('M20 160 L62 156 L64 172 L22 176 Z', 'brown'), S('M22 160 C32 148 52 146 62 156 Z', 'umber', 'pale'), wheels([[33, 178], [55, 175]], 5)], [L('M20 160 L62 156 L64 172 L22 176 Z M22 160 C32 148 52 146 62 156', 'umber', 'thin')], [], { at: { x: 42, y: 180 } }),
        T('枕木を積んだトロッコ', [S('M124 162 L208 153 L212 180 L128 189 Z', 'brown', 'deep'), S('M130 162 L204 154 L204 146 L130 154 Z M132 152 L202 145 L202 137 L132 144 Z', 'umber'), wheels([[148, 190], [192, 186]], 8)],
          [L('M124 162 L208 153 L212 180 L128 189 Z', 'umber', 'bold'), L('M130 162 L204 154 L204 146 L130 154 Z M132 152 L202 145 L202 137 L132 144 Z', 'umber', 'thin'), L(ring([[148, 190], [192, 186]], 8), 'umber')], [], { at: { x: 167, y: 196 }, depth: 6, spot: '線路の中ほど', start: '画面の外の左' }),
      ],
      beats: [B(1, '枕木を積んだトロッコ', 'move', '線路の中ほど', 'slow', 'bob')],
    }],
  },
  { // 5ページ: 若い二人と押して行く。急勾配になり、両側に蜜柑畑
    reader: {
      events: [ev('良平は若い二人の間に入り、力一杯トロッコを押す', '力一杯押し始めた'), ev('優しい人たちだと思う', '良平は「優しい人たちだ」と思った'), ev('線路がまた急勾配になり、両側に蜜柑畑が見える', '線路はもう一度急勾配になった')],
      scenes: [
        scene({ change: 'same', beats: [beat('枕木を積んだトロッコ', 'move', '力一杯押し始めた', '線路の奥', 'mid', 'bob')] }),
        scene({ place: '蜜柑畑の登り路', place_quote: '線路はもう一度急勾配になった', time: 'day', time_quote: '黄色い実がいくつも日を受けている', weather: 'clear', weather_quote: '日を受けている', mood: 'warm', mood_quote: '良平は「優しい人たちだ」と思った', keep: ['枕木を積んだトロッコ', '太い線路'],
          things: [thing('蜜柑畑', '両側の斜面に黄色い実が日を受ける', '両側の蜜柑畑に、黄色い実がいくつも日を受けている', true)] }),
      ],
    },
    drawers: [{
      ground: [S('M0 0 H320 V112 H0 Z', 'sky', 'pale'), S('M0 112 H320 V240 H0 Z', 'leaf', 'pale')],
      spots: [P('畑の下', 160, 226), P('登りつめた所', 175, 122, .42), P('峠の向こう', 175, 115, .26)],
      routes: [],
      things: [
        T('太い線路', [], [L('M126 240 L168 114 M200 240 L182 114', 'gray', 'bold'), L('M132 226 h62 M140 200 h50 M148 176 h40 M155 154 h32 M161 136 h24 M166 122 h16', 'brown')], [], { depth: 3 }),
        T('蜜柑畑', [S('M0 120 C30 112 70 116 120 130 L110 240 H0 Z M320 120 C290 112 250 116 212 130 L222 240 H320 Z', 'green'), S(ring([[24, 150], [62, 170], [36, 196], [86, 210], [14, 226], [70, 138], [296, 150], [258, 170], [284, 196], [236, 214], [306, 226], [250, 138]], 4), 'orange', 'deep'), S(ring([[46, 160], [96, 186], [276, 160], [226, 190]], 3), 'lemon', 'deep')],
          [L('M0 120 C30 112 70 116 120 130 M320 120 C290 112 250 116 212 130', 'green', 'thin')], [], { at: { x: 160, y: 240 }, depth: 4, loop: 'sway' }),
        T('枕木を積んだトロッコ', [S('M124 196 H196 V216 H124 Z', 'brown', 'deep'), S('M128 186 H192 V196 H128 Z', 'umber'), wheels([[136, 220], [184, 220]], 6)], [L('M124 196 H196 V216 H124 Z M128 186 H192 V196 H128 Z', 'umber'), L(ring([[136, 220], [184, 220]], 6), 'umber', 'thin')], [], { at: { x: 160, y: 226 }, depth: 6, spot: '畑の下' }),
      ],
      beats: [],
    }],
  },
  { // 6ページ: 蜜柑畑を登りつめ、乗って走り下る。竹藪・雑木林を押して登ると、崖の向うに海
    reader: {
      events: [ev('蜜柑畑の間を登りつめ、下りではトロッコに乗って走る', 'ひた辷りに線路を走り出した'), ev('竹藪で止まり、また重いトロッコを押す', '重いトロッコを押し始めた'), ev('雑木林を登り切ると、崖の向うに海が開ける', '高い崖の向うに、広広と薄ら寒い海が開けた')],
      scenes: [
        scene({ change: 'same', mood: 'joyful', mood_quote: '押すよりも乗る方がずっと好い', beats: [beat('枕木を積んだトロッコ', 'move', '蜜柑畑の間を登りつめると', '登りつめた所', 'slow', 'bob'), beat('枕木を積んだトロッコ', 'leave', 'ひた辷りに線路を走り出した', '峠の向こう', 'fast', 'bob')] }),
        scene({ place: '雑木林の崖の上', place_quote: '今度は高い崖の向うに', mood: 'wonder', mood_quote: '広広と薄ら寒い海が開けた', keep: ['枕木を積んだトロッコ', '太い線路'],
          changes: [{ name: '太い線路', look: '落葉に埋もれかけた赤錆の線路', quote: '赤錆の線路も見えない程' }],
          things: [thing('海', '崖の向うに広広と開けた、薄ら寒い海', '広広と薄ら寒い海が開けた', true), thing('雑木林', '竹藪から続く雑木の林', '竹藪は何時か雑木林になった'), thing('落葉', '線路の上にたまった落葉', '落葉のたまっている場所もあった')] }),
      ],
    },
    drawers: [{
      ground: [S('M0 0 H320 V118 H0 Z', 'sky', 'pale'), S('M0 128 C70 122 140 124 190 132 L210 240 H0 Z', 'sand')],
      // 線路は崖の手前で曲がり、海を右に見ながら、雑木の枝の下を奥へ続く
      spots: [P('林の下', 25, 240, 1.15), P('林の中', 96, 193), P('崖の上', 158, 162, .7), P('枝の下', 150, 129, .3)],
      routes: [R('林の下', '林の中', 'M25 240 C50 222 74 206 96 193'), R('林の中', '崖の上', 'M96 193 C118 180 140 170 158 162'), R('崖の上', '枝の下', 'M158 162 C174 155 166 140 150 129')],
      things: [
        T('海', [S('M150 118 H320 V240 H210 L190 132 C175 126 160 120 150 118 Z', 'blue'), S('M150 118 H320 V132 C260 128 200 126 150 118 Z', 'sky')], [L('M150 118 H320', 'blue', 'thin'), L('M190 132 L210 240', 'umber'), L('M230 160 q8 -4 16 0 M262 182 q8 -4 16 0 M240 206 q8 -4 16 0 M285 146 q6 -3 12 0', 'blue', 'thin')], [G('M252 150 l3 -2 l3 2 l-3 2 Z M276 172 l3 -2 l3 2 l-3 2 Z M228 192 l3 -2 l3 2 l-3 2 Z', 'white')], { at: { x: 240, y: 240 }, depth: 1, loop: 'bob' }),
        T('雑木林', [S('M0 0 H90 C84 30 70 56 40 64 C20 70 8 70 0 70 Z', 'green'), S('M0 70 C20 60 50 64 60 90 C40 100 20 104 0 104 Z', 'leaf'), S('M88 34 C108 24 130 34 132 56 C126 72 100 76 88 62 Z', 'green'), S('M124 98 C130 84 150 80 162 90 C168 100 160 110 146 110 C134 110 124 106 124 98 Z', 'leaf')],
          [L('M30 70 L34 130 M62 88 L64 128 M108 70 L110 124 M138 108 L139 127', 'umber'), L('M0 70 C20 60 50 64 60 90 M90 0 C84 30 70 56 40 64 M124 98 C130 84 150 80 162 90', 'green', 'thin')], [], { at: { x: 60, y: 130 }, depth: 4, loop: 'sway' }),
        T('太い線路', [], [L('M2 236 L15 227 L28 218 L41 210 L53 202 L65 194 L77 187 L89 181 L101 175 L112 169 L123 165 L134 160 L144 156 L154 153 L159 151 L159 147 L156 142 L151 135 L148 132 M35 253 L46 244 L58 235 L70 227 L81 219 L92 212 L103 205 L114 198 L124 192 L134 186 L143 181 L153 176 L162 171 L167 168 L171 164 L173 159 L174 154 L174 149 L173 145 L170 141 L168 137 L164 134 L161 131 L157 128 L152 126', 'brown', 'bold'),
          L('M13 224 L37 256 M38 207 L60 238 M63 191 L83 222 M87 178 L105 208 M111 167 L125 195 M133 158 L145 183 M153 151 L163 173 M157 151 L176 154 M157 145 L169 136 M153 139 L162 130', 'umber')], [], { depth: 3 }),
        T('落葉', [S('M20 180 c6 -3 10 0 6 4 c-4 3 -10 1 -6 -4 Z M70 196 c6 -3 10 0 6 4 c-4 3 -10 1 -6 -4 Z M150 172 c6 -3 10 0 6 4 c-4 3 -10 1 -6 -4 Z M152 210 c6 -3 10 0 6 4 c-4 3 -10 1 -6 -4 Z M40 220 c6 -3 10 0 6 4 c-4 3 -10 1 -6 -4 Z M110 226 c6 -3 10 0 6 4 c-4 3 -10 1 -6 -4 Z', 'orange'), S('M60 170 c6 -3 10 0 6 4 c-4 3 -10 1 -6 -4 Z M130 200 c6 -3 10 0 6 4 c-4 3 -10 1 -6 -4 Z', 'red', 'pale')], [L('M22 182 l6 1 M72 198 l6 1 M152 174 l6 1', 'brown', 'thin')], [], { at: { x: 90, y: 230 }, depth: 4, loop: 'drift' }),
        T('枕木を積んだトロッコ', [S('M66 167 L126 157 L130 179 L70 189 Z', 'brown', 'deep'), S('M70 165 L124 156 L124 149 L70 158 Z', 'umber'), wheels([[86, 189], [116, 184]], 7)], [L('M66 167 L126 157 L130 179 L70 189 Z M70 165 L124 156 L124 149 L70 158 Z', 'umber'), L(ring([[86, 189], [116, 184]], 7), 'umber', 'thin')], [], { at: { x: 96, y: 193 }, depth: 6, spot: '林の中', start: '林の下' }),
      ],
      beats: [B(1, '枕木を積んだトロッコ', 'move', '林の中', 'slow', 'bob'), B(2, '枕木を積んだトロッコ', 'move', '崖の上', 'mid', 'bob')],
    }],
  },
  { // 7ページ: 海を右に走る。藁屋根の茶店で止まり、駄菓子をもらう
    reader: {
      events: [ev('遠く来過ぎたと感じ、良平はもう帰ってほしいと念じる', '「もう帰ってくれれば好い」'), ev('藁屋根の茶店の前で止まり、土工たちは茶を飲む', '藁屋根の茶店の前だった'), ev('良平は新聞紙に包んだ駄菓子をもらう', '新聞紙に包んだ駄菓子をくれた')],
      scenes: [
        scene({ change: 'same', beats: [beat('枕木を積んだトロッコ', 'leave', '車は海を右にしながら、雑木の枝の下を走って行った', '枝の下', 'mid', 'bob')] }),
        scene({ place: '藁屋根の茶店の前', place_quote: '藁屋根の茶店の前だった', mood: 'tense', mood_quote: '良平は独りいらいらしながら', keep: ['枕木を積んだトロッコ'],
          things: [thing('茶店', '切崩した山を背負った藁屋根の茶店', '切崩した山を背負っている', true), thing('駄菓子', '新聞紙に包んだ駄菓子', '新聞紙に包んだ駄菓子をくれた')] }),
      ],
    },
    drawers: [{
      ground: [S('M0 0 H320 V140 H0 Z', 'sky', 'pale'), S('M0 140 H320 V240 H0 Z', 'sand')],
      spots: [P('画面の外の左', -60, 222), P('茶店の前', 130, 226), P('坂の上', 340, 176, .7)],
      routes: [],
      things: [
        teahouse,
        sleepers({ spot: '茶店の前', start: '画面の外の左' }),
        T('駄菓子', [S('M182 212 l18 -4 l4 10 l-18 4 Z', 'white')], [L('M182 212 l18 -4 l4 10 l-18 4 Z M186 214 l14 -3', 'gray', 'thin')], [], { at: { x: 192, y: 222 }, depth: 7, hidden: true }),
      ],
      beats: [B(1, '枕木を積んだトロッコ', 'move', '茶店の前', 'mid', 'bob'), B(2, '駄菓子', 'appear')],
    }],
  },
  { // 8ページ: 二つ目の茶店。西日が消えかかり、土工たちはトロッコと行ってしまう
    reader: {
      events: [ev('三人はトロッコを押して緩い坂を登る', '緩い傾斜を登って行った'), ev('二つ目の茶店の前で、日が暮れるのを気にする', '「もう日が暮れる」'), ev('土工たちは、向う泊りだから帰れと言う', 'おれたちは今日は向う泊りだから')],
      scenes: [
        scene({ change: 'same', beats: [beat('枕木を積んだトロッコ', 'leave', '緩い傾斜を登って行った', '坂の上', 'slow', 'bob')] }),
        scene({ place: '二つ目の茶店の前', place_quote: '又同じような茶店があった', time: 'evening', time_quote: '西日の光が消えかかっている', weather: 'clear', weather_quote: '西日の光', mood: 'tense', mood_quote: '帰る事ばかり気にしていた', keep: ['枕木を積んだトロッコ'],
          things: [thing('茶店', '山を背負った藁屋根の茶店', '又同じような茶店があった', true), thing('梅', '花の咲いた梅の木', '茶店の前には花のさいた梅に'), thing('西日', '消えかかる西日の光', '西日の光が消えかかっている')] }),
      ],
    },
    drawers: [{
      ground: [S('M0 0 H320 V140 H0 Z', 'orange', 'pale'), S('M0 0 H320 V58 C220 70 100 70 0 58 Z', 'violet', 'pale'), S('M0 140 H320 V240 H0 Z', 'sand')],
      spots: [P('空の低い所', 293, 70), P('山の端', 293, 108), P('茶店の前', 130, 226), P('道の先', 400, 210, .9)],
      routes: [],
      things: [
        // 日は茶店の山より奥。山の端へ下りると、山の後ろに隠れる
        T('西日', [], [], [G('M278 70 a15 15 0 1 0 30 0 a15 15 0 1 0 -30 0', 'orange')], { at: { x: 293, y: 70 }, depth: 1, spot: '空の低い所', loop: 'flicker' }),
        teahouse,
        T('梅', [S(ring([[34, 128], [50, 118], [66, 124], [42, 140], [78, 132], [58, 108], [26, 146]], 5), 'pink'), S(ring([[40, 120], [72, 114], [86, 128]], 4), 'white')], [L('M58 210 C56 178 62 156 54 132 M56 166 C44 156 38 146 32 136 M60 156 C72 146 80 138 88 128', 'umber', 'bold')], [], { at: { x: 58, y: 210 }, depth: 4, loop: 'sway' }),
        sleepers({ spot: '茶店の前' }),
      ],
      beats: [B(1, '西日', 'move', '山の端', 'slow'), B(1, '西日', 'dark', '', 'slow'), B(2, '枕木を積んだトロッコ', 'leave', '道の先', 'mid', 'bob')],
    }],
  },
  { // 9ページ: 一人で線路伝いに走って帰る。菓子包みと板草履を捨てる
    reader: {
      events: [ev('一人で歩いて帰らねばならないと分かり、良平は線路伝いに走り出す', 'どんどん線路伝いに走り出した'), ev('菓子包みと板草履を路側に捨てる', '板草履も其処へ脱ぎ捨ててしまった'), ev('左に海を感じながら、急な坂路を駈け登る', '急な坂路を駈け登った')],
      scenes: [scene({ place: '夕暮れの線路', place_quote: '良平は少時無我夢中に線路の側を走り続けた', time: 'evening', time_quote: 'もうかれこれ暗くなる事', mood: 'tense', mood_quote: '良平は殆ど泣きそうになった',
        things: [thing('線路', '暮れていく中を一すじ続く線路', 'どんどん線路伝いに走り出した', true), thing('海', '左手に暗くなっていく海', '彼は左に海を感じながら'), thing('菓子包み', '路側に抛り出した菓子包み', '懐の菓子包み'), thing('板草履', '路側に脱ぎ捨てた板草履', '板草履も其処へ脱ぎ捨ててしまった')] })],
    },
    drawers: [{
      ground: [S('M0 0 H320 V130 H0 Z', 'violet'), S('M0 92 C100 84 220 84 320 92 V130 H0 Z', 'orange', 'pale'), S('M0 130 C120 126 220 126 320 132 V240 H0 Z', 'umber', 'pale')],
      spots: [], routes: [],
      things: [
        T('海', [S('M0 118 C40 116 80 118 112 124 L92 150 C60 146 30 144 0 146 Z', 'blue')], [L('M0 118 C40 116 80 118 112 124', 'night', 'thin'), L('M14 132 q6 -3 12 0 M50 136 q6 -3 12 0', 'blue', 'thin')], [], { at: { x: 50, y: 150 }, depth: 1, loop: 'bob' }),
        T('線路', [], [L('M320 236 C240 200 180 170 130 140 M282 240 C214 204 164 174 122 142', 'gray', 'bold'), L('M300 228 l-26 9 M262 208 l-22 8 M228 190 l-18 6 M200 175 l-15 5 M176 162 l-12 4 M154 151 l-9 3', 'umber')], [], { depth: 3 }),
        T('菓子包み', [S('M206 214 l16 -4 l3 9 l-16 4 Z', 'white')], [L('M206 214 l16 -4 l3 9 l-16 4 Z', 'gray', 'thin')], [], { at: { x: 215, y: 222 }, hidden: true }),
        T('板草履', [S('M64 206 c10 -6 26 -6 30 0 c-4 6 -20 8 -30 0 Z M86 218 c10 -6 26 -6 30 0 c-4 6 -20 8 -30 0 Z', 'brown')], [L('M64 206 c10 -6 26 -6 30 0 c-4 6 -20 8 -30 0 Z M86 218 c10 -6 26 -6 30 0 c-4 6 -20 8 -30 0 Z', 'umber', 'thin'), L('M74 202 l6 4 l6 -4 M96 214 l6 4 l6 -4', 'red', 'thin')], [], { at: { x: 90, y: 222 }, hidden: true }),
      ],
      beats: [B(1, '菓子包み', 'appear'), B(1, '板草履', 'appear')],
    }],
  },
  { // 10ページ: 竹藪を駈け抜け、羽織を捨てる。暗くなる。村に入ると電燈がともっている
    reader: {
      events: [ev('竹藪の側を駈け抜け、羽織を路側に捨てる', '羽織を路側へ脱いで捨てた'), ev('あたりは暗くなり、命さえ助かればと走る', '「命さえ助かれば――」'), ev('村に入ると、家々に電燈がともっている', '電燈の光がさし合っていた')],
      scenes: [
        scene({ change: 'same', time: 'night', time_quote: 'あたりは暗くなる一方だった',
          things: [thing('竹藪', '線路の側の竹藪', '竹藪の側を駈け抜けると'), thing('日金山の空', '火照りが消えかかる夕焼けの山の空', '夕焼けのした日金山の空'), thing('羽織', '路側に脱ぎ捨てた羽織', '羽織を路側へ脱いで捨てた')] }),
        scene({ place: '村の家並み', place_quote: '彼の村へはいって見ると', time: 'night', time_quote: '遠い夕闇の中に', mood: 'sad', mood_quote: '一思いに泣きたくなった',
          things: [thing('家家', '両側に並ぶ村の家々', 'もう両側の家家には', true), thing('電燈', '家々にともる電燈の光', '電燈の光がさし合っていた'), thing('工事場', '夕闇の向うの村外れの工事場', '村外れの工事場が見えた')] }),
      ],
    },
    drawers: [
      {
        ground: [], spots: [], routes: [], beats: [],
        things: [
          T('竹藪', [S('M244 40 l14 -6 l-6 10 Z M262 58 l14 -6 l-6 10 Z M278 34 l14 -6 l-6 10 Z M296 50 l14 -6 l-6 10 Z M248 90 l14 -6 l-6 10 Z M286 96 l14 -6 l-6 10 Z', 'green', 'deep')], [L('M250 20 C252 80 254 130 256 176 M266 12 C268 80 270 130 272 180 M282 26 C284 90 286 130 288 176 M298 16 C300 80 302 130 304 172', 'green')], [], { at: { x: 276, y: 178 }, depth: 4, loop: 'sway' }),
          T('日金山の空', [S('M120 130 C150 96 180 84 210 86 C236 92 252 110 262 130 Z', 'night'), S('M126 100 C160 72 220 70 262 92 V102 C220 86 168 88 126 108 Z', 'orange', 'pale')], [L('M120 130 C150 96 180 84 210 86 C236 92 252 110 262 130', 'umber', 'thin')], [], { depth: 1 }),
          T('羽織', [S('M150 214 C160 200 190 198 204 206 C210 214 200 226 182 228 C166 228 152 224 150 214 Z', 'umber')], [L('M150 214 C160 200 190 198 204 206 C210 214 200 226 182 228 C166 228 152 224 150 214 Z', 'umber', 'thin'), L('M160 214 C172 210 186 210 198 214', 'umber', 'thin')], [], { at: { x: 178, y: 228 } }),
        ],
      },
      {
        ground: [S('M0 0 H320 V120 H0 Z', 'night', 'deep'), S('M0 120 H320 V240 H0 Z', 'umber'), S('M120 240 L160 120 H176 L230 240 Z', 'brown', 'pale')],
        spots: [], routes: [],
        things: [
          T('工事場', [S('M150 116 L170 114 L171 120 L151 122 Z', 'brown', 'pale')], [L('M144 122 L190 122', 'gray', 'thin')], [], { depth: 2 }),
          T('家家', [S('M0 90 L40 70 L80 90 V170 H0 Z M80 100 L110 84 L140 100 V160 H80 Z', 'umber', 'deep'), S('M196 100 L226 84 L256 100 V160 H196 Z M256 90 L290 72 L320 88 V170 H256 Z', 'umber', 'deep')], [L('M0 90 L40 70 L80 90 V170 M80 100 L110 84 L140 100 V160 M196 160 V100 L226 84 L256 100 M256 90 L290 72 L320 88', 'umber', 'thin')], [], { depth: 3 }),
          T('電燈', [], [], [G('M20 110 h14 v12 h-14 Z M50 122 h12 v10 h-12 Z M96 116 h12 v10 h-12 Z M212 116 h12 v10 h-12 Z M276 110 h12 v12 h-12 Z M300 128 h10 v10 h-10 Z', 'orange'), G('M164 104 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0', 'lemon')], { depth: 4, lit: false, loop: 'flicker' }),
        ],
        beats: [B(2, '電燈', 'light', '', 'slow')],
      },
    ],
  },
  { // 11ページ: 明るい店の前を走り過ぎ、家の門口で泣き出す
    reader: {
      events: [ev('雑貨屋や床屋の明るい家の前を走り過ぎる', '明るい家の前を走り過ぎた'), ev('家の門口で、とうとう大声に泣き出す', 'わっと泣き出さずにはいられなかった'), ev('二十六の年、良平は東京へ出て来た', '妻子と一しょに東京へ出て来た')],
      scenes: [scene({ change: 'same', mood: 'sad', mood_quote: '啜り上げ啜り上げ泣き続けた',
        things: [thing('雑貨屋', '明るい雑貨屋の店先', '雑貨屋だの床屋だの、明るい家の前'), thing('門口', '薄暗い家の門口', '薄暗い門口へ集って来た')] })],
    },
    drawers: [{
      ground: [], spots: [], routes: [], beats: [],
      things: [
        T('雑貨屋', [S('M10 170 H90 V232 H10 Z', 'sand'), S('M6 164 H94 L88 176 H12 Z', 'red')], [L('M10 176 V232 H90 V176 M6 164 H94 L88 176 H12 Z', 'umber', 'thin')], [G('M20 186 H80 V214 H20 Z', 'lemon')], { loop: 'flicker' }),
        T('門口', [S('M232 150 h8 v90 h-8 Z M288 150 h8 v90 h-8 Z M226 146 H302 V154 H226 Z', 'umber', 'deep'), S('M240 158 H288 V240 H240 Z', 'night')], [L('M226 146 H302 V154 H226 Z M232 154 V240 M296 154 V240', 'umber')]),
      ],
    }],
  },
  { // 12ページ: 大人になった良平は、今もときどき、その時の路を思い出す
    reader: {
      events: [ev('良平は雑誌社の二階で校正をしている', '校正の朱筆を握っている'), ev('今もときどき、その時の薄暗い藪や坂のある路を思い出す', '薄暗い藪や坂のある路が')],
      scenes: [scene({ place: '雑誌社の二階', place_quote: '今では或雑誌社の二階に', mood: 'sad', mood_quote: '塵労に疲れた彼の前には',
        things: [thing('朱筆', '校正刷りの上の赤い筆', '校正の朱筆を握っている', true), thing('藪や坂のある路', '薄暗い藪と坂の路が細く一すじ続く(思い出)', '薄暗い藪や坂のある路が、細細と一すじ断続している')] })],
    },
    drawers: [{
      ground: [S('M0 0 H320 V150 H0 Z', 'gray', 'pale'), S('M0 150 H320 V240 H0 Z', 'brown')],
      spots: [], routes: [],
      things: [
        T('朱筆', [S('M70 172 L230 162 L240 216 L80 228 Z', 'white'), S('M150 200 L250 150 L254 154 L156 206 Z', 'umber', 'deep'), S('M150 200 l-10 7 l4 -11 Z', 'red', 'deep')], [L('M70 172 L230 162 L240 216 L80 228 Z', 'gray', 'thin'), L('M150 200 L250 150 L254 154 L156 206 Z', 'umber')]),
        T('藪や坂のある路', [S('M30 130 C80 90 140 70 210 60 C250 56 280 60 300 70 V130 Z', 'green', 'pale'), S('M60 130 C100 108 150 92 200 80 C230 74 260 72 290 74 L292 80 C262 80 232 84 204 90 C156 102 110 118 72 132 Z', 'sand', 'pale'), S('M40 60 C60 40 90 44 100 70 C80 84 52 84 40 60 Z', 'green')],
          [L('M60 130 C100 108 150 92 200 80 C230 74 260 72 290 74', 'brown', 'thin'), L('M56 40 L60 96 M70 36 L72 96 M84 44 L86 96', 'green', 'thin')], [], { depth: 2, hidden: true, loop: 'drift' }),
      ],
      beats: [B(1, '藪や坂のある路', 'appear', '', 'slow')],
    }],
    summary: { summary: 'トロッコに乗りたかった八つの良平は、若い二人の土工と遠くまで押して行ったが、日暮れに一人で帰れと言われ、暗くなる線路を走って帰り、家の門口で泣き出した。大人になった今も、その時の藪や坂のある路を思い出す。' },
  },
];

const brief = { known: 'yes', work: '芥川龍之介「トロッコ」', whole: '小田原熱海間の軽便鉄道の工事を見物する八つの良平は、トロッコに乗りたいと思っている。夕方、弟たちと土工のいないトロッコを押して乗るが、土工に怒鳴られて逃げる。十日余り後、若い二人の土工のトロッコを押させてもらい、蜜柑畑や雑木林を抜けて海の見える所まで行く。茶店で休むうちに日が暮れかかり、土工たちは向う泊りだから帰れと言う。良平は一人で、暗くなる線路伝いを泣きそうになりながら走って帰り、家の門口で大声に泣き出す。二十六になり東京の雑誌社で校正をする良平は、今もときどき、その時の薄暗い藪や坂のある路を思い出す。', world: '大正のころの、小田原と熱海の間の山あいの村。二月の初め。軽便鉄道の工事場・土工・藁屋根の茶店・蜜柑畑・竹藪・海の見える崖。' };
const run = { format: 3, book: 'torokko', label: 'torokko.sample', model: 'sample', settings, models: { brief: 'sample', reader: 'sample', drawer: 'sample', summary: 'sample', judge: null }, brief: { model: 'sample', data: brief }, ticks: [], judge: null, finished: true };
if (plan.length !== ticks.length) throw new Error(`回の数が違う: ${plan.length} / ${ticks.length}`);

for (const [i, hand] of ticks.entries()) {
  const [a, b] = plan[i];
  const reader = { seed: '', ...hand.reader };
  run.ticks.push({ pages: [a, b], chapter: pages[a].chapter, reader: { model: 'sample', data: reader }, drawers: [], summary: hand.summary ? { model: 'sample', data: hand.summary } : null });
  // 端末の決まりで読み取りを当て、絵の物の名前を id に替える
  const { book } = replay({ ...run, ticks: run.ticks.slice(0, i) }, pages);
  if (book.emaki.chapter !== pages[a].chapter) startChapter(book, pages[a].chapter);
  const read = applyReading(book, reader, pages.slice(a, b + 1).map((p) => p.text).join('\n'), i);
  const bad = read.dropped.filter((d) => d.why !== 'limit');
  if (bad.length) throw new Error(`${i + 1}ページ目で落ちた: ${JSON.stringify(bad)}`);
  if (read.draws.length !== hand.drawers.length) throw new Error(`${i + 1}ページ目: 描く数が違う ${read.draws.length} / ${hand.drawers.length}`);
  read.draws.forEach((draw, k) => {
    const panel = book.emaki.panels.find((p) => p.id === draw.panel);
    const idOf = (name) => {
      const t = panel.things.find((x) => x.name === name && draw.ids.includes(x.id));
      if (!t) throw new Error(`${i + 1}ページ目: ${name} は頼んでいない`);
      return t.id;
    };
    const { things, beats, ...rest } = hand.drawers[k];
    run.ticks[i].drawers.push({ model: 'sample', data: { ...rest, things: things.map(({ name, ...shapes }) => ({ id: idOf(name), ...shapes })), beats: beats.map(({ name, ...x }) => ({ ...x, id: idOf(name) })) } });
  });
}

const { book, logs } = replay(run, pages);
for (const log of logs) for (const d of log.drawn) if (d && (d.dropped || d.strangers.length || d.missed.length)) throw new Error(`${log.tick + 1}ページ目の絵: ${JSON.stringify(d)}`);
writeFileSync(new URL('runs/torokko.sample.json', dir), JSON.stringify(run, null, 1) + '\n');
console.log(book.emaki.panels.map((p) => `${p.id} ${p.place.name}: ${p.things.map((t) => t.name).join('・')}`).join('\n'));
for (const c of timeline(run, pages, logs)) console.log(`${c.turn + 1}ページを開くとき ${(c.start / 1000).toFixed(1)}秒〜 ${c.kind} ${c.panel} ${c.id ?? ''} ${c.act ?? ''} ${c.to ?? ''}`);
