// 場面の絵の試作(#50 → #34)。Claude が返す「形のデータ」を検め、段ごとの SVG を組み立てる。
// Claude が決めるのは形(path の d)と色の名前だけ。線の揺れ・水彩のにじみ・紙の質感は、ここの決まった値で付ける。
// 文字列は SVG に入れない(items は試写室で根拠を見るためだけ)。組み立てた SVG は <img> に載せる(スクリプトも外部の読み込みも動かない)。
// 試写室(index.html)と check.mjs(検査・集計・schema)で使う。章の絵巻(../emaki/)も、形の検査と画風をここから使う。
// 見込みが立てば extension/src/content/scene.js へ移す。
export const VIEW = { width: 320, height: 240 };
export const STAGES = ['まだ無い', '下描き', '淡い色', '色が濃くなる', '仕上がり'];
export const LAST = STAGES.length - 1; // 章の終わりで出す段。#34 ではその手前で待つ
// 色の表。名前と説明は Claude に見せ(schema の enum)、値は端末が決める
export const COLORS = {
  sky: ['#9cc8e8', '昼の空・遠くの水'],
  blue: ['#5b8fc7', '水・青い物・青い影'],
  night: ['#34406e', '夜空・暗い青'],
  violet: ['#9b86c9', '夕暮れ・紫の物・紫の影'],
  leaf: ['#a3c77f', '若葉・草・明るい緑'],
  green: ['#5d8a5e', '木・森・深い緑'],
  lemon: ['#f3d54a', '黄色い物・日なた'],
  orange: ['#f0a24e', '橙の物・灯り・夕日'],
  red: ['#d8645a', '赤い物'],
  pink: ['#f1a8b4', '桃色の物・花'],
  sand: ['#e8d3a2', '砂・土の道・紙・木の明るい面'],
  brown: ['#a8764f', '木・土・茶色の物'],
  umber: ['#5c4636', '濃い茶・暗い影'],
  gray: ['#a39c95', '石・金属・灰色の物'],
  white: ['#fbf8f0', '白い物・雪・雲・光'],
};
export const TONES = { pale: .42, mid: .68, deep: .9 };
export const WIDTHS = { thin: 1, mid: 1.6, bold: 2.4 };
export const LIMITS = { items: 12, ground: 16, forms: 60, lines: 90, light: 30, d: 1500, total: 30000 };
const LAYERS = ['ground', 'forms', 'lines', 'light'];
const PATH = /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/;
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const GRAPHITE = '#7a6b5f';
const PAPER = '#fdfaf3';
// 段ごとの、水彩の濃さ(tone に掛ける)と線
const WASH = [0, 0, .38, .8, 1];
const LINE = [0, .75, .6, .9, .9];

/** Claude に渡す構造化出力の JSON Schema。数や長さは縛れないので checkScene で検める */
export function sceneSchema() {
  const d = { type: 'string', description: `SVG の path の d。viewBox は 0 0 ${VIEW.width} ${VIEW.height}。コマンドと数字だけ` };
  const color = { type: 'string', enum: Object.keys(COLORS), description: Object.entries(COLORS).map(([k, [, note]]) => `${k}=${note}`).join(' / ') };
  const shape = (extra = {}) => ({ type: 'object', additionalProperties: false, required: ['d', 'color', ...Object.keys(extra)], properties: { d, color, ...extra } });
  const tone = { type: 'string', enum: Object.keys(TONES), description: '水彩の濃さ' };
  const width = { type: 'string', enum: Object.keys(WIDTHS), description: '線の太さ' };
  return {
    type: 'object', additionalProperties: false, required: ['items', ...LAYERS],
    properties: {
      items: { type: 'array', description: '描いた物と、その根拠になる本文の語句(本文からそのまま写す)', items: { type: 'object', additionalProperties: false, required: ['thing', 'quote'], properties: { thing: { type: 'string' }, quote: { type: 'string' } } } },
      ground: { type: 'array', description: `地。空・地面・壁・水面など、奥の大きな面(${LIMITS.ground}まで)`, items: shape({ tone }) },
      forms: { type: 'array', description: `物の面。奥から手前の順(${LIMITS.forms}まで)`, items: shape({ tone }) },
      lines: { type: 'array', description: `色鉛筆の線。輪郭・陰影・細部(${LIMITS.lines}まで)`, items: shape({ width }) },
      light: { type: 'array', description: `光るものそのものの形。灯り・星・光る物・水面のきらめきなど。周りの光の輪は端末が付ける。最後の段で足す(${LIMITS.light}まで)`, items: shape() },
    },
  };
}

/** 形を1つ検める。layer は ground / forms / lines / light。読めない形は null */
export function checkShape(layer, s) {
  if (!s || typeof s !== 'object') return null;
  const d = typeof s.d === 'string' ? s.d.trim() : '';
  if (!d || d.length > LIMITS.d || !PATH.test(d)) return null;
  if (!(d.match(NUMBER) ?? []).every((n) => Math.abs(+n) <= 1000)) return null;
  if (typeof s.color !== 'string' || !Object.hasOwn(COLORS, s.color)) return null;
  if (layer === 'light') return { d, color: s.color };
  if (layer === 'lines') return typeof s.width === 'string' && Object.hasOwn(WIDTHS, s.width) ? { d, color: s.color, width: s.width } : null;
  return typeof s.tone === 'string' && Object.hasOwn(TONES, s.tone) ? { d, color: s.color, tone: s.tone } : null;
}

/**
 * 返ってきた形のデータを検める。{ scene, dropped, error }。
 * 形として読めないもの・上限を超えたものは落として数える(dropped)。層が無い・描くものが無いときは error で、scene は null。
 */
export function checkScene(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { scene: null, dropped: 0, error: 'not_object' };
  const scene = { items: [] };
  let dropped = 0, total = 0;
  for (const layer of LAYERS) {
    if (!Array.isArray(data[layer])) return { scene: null, dropped, error: `no_${layer}` };
    scene[layer] = [];
    for (const s of data[layer]) {
      const shape = checkShape(layer, s);
      if (!shape || scene[layer].length >= LIMITS[layer] || total + shape.d.length > LIMITS.total) { dropped += 1; continue; }
      total += shape.d.length;
      scene[layer].push(shape);
    }
  }
  for (const item of Array.isArray(data.items) ? data.items : []) {
    if (!item || typeof item.thing !== 'string' || typeof item.quote !== 'string' || scene.items.length >= LIMITS.items) { dropped += 1; continue; }
    scene.items.push({ thing: item.thing.trim().slice(0, 40), quote: item.quote.trim().slice(0, 80) });
  }
  if (!scene.forms.length && !scene.lines.length) return { scene: null, dropped, error: 'empty' };
  return { scene, dropped, error: null };
}

/** 描いた物の根拠の語句が、本文にそのまま有るか(空白と改行は無視する) */
export function grounded(scene, text) {
  const flat = (s) => s.replace(/\s+/g, '');
  const body = flat(text);
  const missing = scene.items.filter((item) => flat(item.quote).length < 2 || !body.includes(flat(item.quote))).map((item) => item.thing);
  return { total: scene.items.length, found: scene.items.length - missing.length, missing };
}

// 画風。どれも userSpaceOnUse の全面にする(水平な線は外接箱の高さが 0 で、割合の領域だと消える)
const AREA = `filterUnits="userSpaceOnUse" x="0" y="0" width="${VIEW.width}" height="${VIEW.height}"`;
const ALPHA = (a, b) => `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${a} ${b}`;
// 水彩の縁の揺れ。物の下に敷く紙(under)も同じ揺れにして、縁をそろえる
const WARP = '<feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="3" result="warp"/><feDisplacementMap in="SourceGraphic" in2="warp" scale="5" xChannelSelector="R" yChannelSelector="G" result="shape"/>';
// 紙の目(paper.css と同じ茶のノイズを少し濃く)
const PAPER_NOISE = `<filter id="paper" ${AREA}><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .31 0 0 0 0 .23 0 0 0 0 .17 0 0 0 .07 0"/></filter>`;
// 絵の縁: 紙の内側で、揺れながらぼけて紙に溶ける
const EDGE = `<filter id="edge" ${AREA}><feTurbulence type="fractalNoise" baseFrequency=".022" numOctaves="2" seed="21" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="22" xChannelSelector="R" yChannelSelector="G" result="r"/><feGaussianBlur in="r" stdDeviation="2.4"/></filter>`;
const FADE = `<rect x="13" y="11" width="${VIEW.width - 26}" height="${VIEW.height - 22}"`; // 絵の内側(fill と filter="url(#edge)" を足して使う)
const DEFS = '<defs>' + PAPER_NOISE + EDGE
  + `<mask id="fade" maskUnits="userSpaceOnUse" x="0" y="0" width="${VIEW.width}" height="${VIEW.height}">${FADE} fill="#fff" filter="url(#edge)"/></mask>`
  // 水彩: 縁を揺らす → 顔料のむら(細かい粒×大きなむら)→ 縁に溜まる色
  + `<filter id="wash" ${AREA}>${WARP}`
  + `<feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" seed="8"/><feColorMatrix values="${ALPHA(-.7, 1.28)}" result="grain"/>`
  + `<feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="2" seed="11"/><feColorMatrix values="${ALPHA(-.8, 1.32)}" result="pool"/>`
  + '<feComposite in="grain" in2="pool" operator="arithmetic" k1="1" result="mottle"/><feComposite in="shape" in2="mottle" operator="in" result="body"/>'
  + '<feMorphology in="shape" operator="erode" radius="1.1" result="inner"/><feComposite in="shape" in2="inner" operator="out" result="rim"/>'
  + '<feMerge><feMergeNode in="body"/><feMergeNode in="rim"/></feMerge></filter>'
  // 物の下に敷く紙: 後ろの地や物を隠す(水彩を重ねるだけだと、手前の物から奥が透ける)
  + `<filter id="under" ${AREA}>${WARP}</filter>`
  // 色鉛筆: ゆるい手の揺れ → 紙の目でかすれる。二度描きは種を替える
  + [5, 6].map((seed, i) => `<filter id="pencil${i}" ${AREA}><feTurbulence type="fractalNoise" baseFrequency=".06" numOctaves="1" seed="${seed}" result="w"/><feDisplacementMap in="SourceGraphic" in2="w" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="line"/><feTurbulence type="fractalNoise" baseFrequency="1.5" numOctaves="1" seed="${seed + 4}"/><feColorMatrix values="${ALPHA(-2.6, 2.2)}" result="tooth"/><feComposite in="line" in2="tooth" operator="in"/></filter>`).join('')
  // 光: 遠くまでぼけた光と近くの光の上に、光る物の芯
  + `<filter id="glow" ${AREA}><feGaussianBlur in="SourceGraphic" stdDeviation="7" result="far"/><feGaussianBlur in="SourceGraphic" stdDeviation="2" result="near"/><feMerge><feMergeNode in="far"/><feMergeNode in="near"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
  + '</defs>';

/**
 * 層の形を、決まった画風で描いた断片にする(frame で SVG にする)。
 * - wash: 水彩の濃さ(tone に掛ける)。0 なら地と物を描かない
 * - line: 線の不透明度。colored=false なら線を鉛筆の色で描く。形に sketch: true があれば、その線だけ鉛筆の色
 * - light: 'none'(描かない)・'soft'(淡い色で置くだけ)・'glow'(光の輪を付ける)
 */
export function paint({ ground = [], forms = [], lines = [], light = [] }, { wash = 1, line = .9, colored = true, light: glow = 'glow', styled = true } = {}) {
  const art = [];
  if (wash > 0) {
    for (const s of [...ground, ...forms]) {
      const a = +(TONES[s.tone] * wash).toFixed(3);
      const form = forms.includes(s);
      if (styled && form) art.push(`<path d="${s.d}" fill="${PAPER}" filter="url(#under)"/>`);
      // 物だけ multiply で重ねる。地まで multiply にすると、暗い地の上の明るい地(夜空の天の川)が消える
      const blend = form ? ' style="mix-blend-mode:multiply"' : '';
      art.push(`<path d="${s.d}" fill="${COLORS[s.color][0]}" fill-opacity="${a}"${styled ? ` filter="url(#wash)"${blend}` : ''}/>`);
    }
  }
  if (line > 0 && lines.length) {
    const paths = lines.map((s) => `<path d="${s.d}" stroke="${colored && !s.sketch ? COLORS[s.color][0] : GRAPHITE}" stroke-width="${WIDTHS[s.width]}"/>`).join('');
    const g = (extra) => `<g fill="none" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</g>`;
    if (styled) art.push(g(`opacity="${line}" filter="url(#pencil0)"`), g(`opacity="${+(line * .4).toFixed(2)}" transform="translate(.6 .45)" filter="url(#pencil1)"`));
    else art.push(g(`opacity="${line}"`));
  }
  if (glow === 'soft' && light.length) {
    art.push(light.map((s) => `<path d="${s.d}" fill="${COLORS[s.color][0]}" fill-opacity=".5"${styled ? ' filter="url(#wash)"' : ''}/>`).join(''));
  }
  if (glow === 'glow' && light.length) {
    const paths = light.map((s) => `<path d="${s.d}" fill="${COLORS[s.color][0]}"/>`).join('');
    art.push(styled ? `<g opacity=".85" filter="url(#glow)" style="mix-blend-mode:screen">${paths}</g>` : `<g opacity=".85">${paths}</g>`);
  }
  return art.join('');
}

/** paint の断片を、紙を敷き、縁を紙に溶かした SVG にする。断片が複数なら横に並べる(章の絵巻)。fade=false は縁を溶かさない(上に縁の紙 edgeSvg を重ねるとき) */
export function frame(arts, { styled = true, fade = true } = {}) {
  const { width: w, height: h } = VIEW;
  const total = w * arts.length;
  const panels = arts.map((art, i) => {
    const body = styled ? `<rect width="${w}" height="${h}" filter="url(#paper)"/>${fade ? `<g mask="url(#fade)">${art}</g>` : art}` : art;
    return i ? `<g transform="translate(${w * i} 0)">${body}</g>` : body;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${h}" width="${total}" height="${h}">${styled ? DEFS : ''}<rect width="${total}" height="${h}" fill="${PAPER}"/>${panels.join('')}</svg>`;
}

/** paint の断片を、紙も縁も付けない透明な SVG にする(層に分けて重ね、層ごとに動かすとき) */
export function layer(art, { styled = true } = {}) {
  const { width: w, height: h } = VIEW;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${styled ? DEFS : ''}${art}</svg>`;
}

/** 縁の紙: 層を重ねた絵のいちばん上に置く覆い。縁を揺らしながら紙に溶かし、内側は透ける */
export function edgeSvg() {
  const { width: w, height: h } = VIEW;
  const rim = `<mask id="rim" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/>${FADE} fill="#000" filter="url(#edge)"/></mask>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs>${PAPER_NOISE}${EDGE}${rim}</defs><g mask="url(#rim)"><rect width="${w}" height="${h}" fill="${PAPER}"/><rect width="${w}" height="${h}" filter="url(#paper)"/></g></svg>`;
}

/** 段 stage(0〜LAST)の SVG の文字列。styled=false は画風を付けない(Claude が書いたままの形) */
export function buildSvg(scene, stage, { styled = true } = {}) {
  const at = Math.max(0, Math.min(LAST, Math.round(stage)));
  return frame([paint(scene, { wash: WASH[at], line: LINE[at], colored: at >= 3, light: at === LAST ? 'glow' : 'none', styled })], { styled });
}

export const svgUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
