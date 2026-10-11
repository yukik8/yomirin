// よみりんの小さなストーリー(Play ブックス・読書中の Meso と Macro)。話の表は stories.js。
//
// 原則(2026-10-10・docs/style.md §0):
//   - 蓄積を一つのオブジェクトに集める。飾りを散らすのではなく、一つのものの状態を大きく変えていく
//   - 状態が変わるのはめくった瞬間だけ(ふわっと替わって、あとは静止)。読んでいる瞬間には動かさない
//   - 1コマ目は最初のめくりで必ず出す。そのあとは毎回は進めない(何もない回が続く・ときどき2コマ進む)。進捗バーにしない。何を作っているのかは説明しない
//   - 最後から2つ目のコマで止まって待つ。章の終わりに、同じオブジェクトがオチる(蓄積と解放を同じものでつなぐ)。
//     章が先に終われば、途中のコマのままオチる(たまった分だけの小さな解放)
//   - 全部を派手な成功にしない: 崩れる・飛んでいく・寝たまま、もある
//   - 作ったものは持ち越さない。章ごとに新しい話(直前と同じ話は避ける)。θ=0 では何もしない(main.js が呼ばない)
//
// 置き場所: 画面の右下の角。右の余白の帯が広ければ(MIN_SIDE 以上)その下の方、狭ければ下の余白の右寄せ。
// 本文の枠には決してかけない。入らなければ置かない(話は見えないまま進む)。右下の問いのボタンは避ける。
// 一度置いたら動かさない(めくっている最中は段落が一瞬消えたり2ページ分が重なったりするので、そのたびに測り直すと点滅する)。
// 置き直すのは、画面の大きさが変わったときと、落ち着いた本文の枠が話にかかったときだけ。
// 同じ話のコマは、絵の元の大きさの比のまま同じ倍率で描く(コマが替わっても、くまの大きさがそろう)。

import { STORIES } from './stories.js';

export const storyURL = (name) => new URL(`../../assets/story/${name}.webp`, import.meta.url).href;

const SCALE = 0.45; // 切り抜いた絵(元の絵の4倍・v0.26。前は2倍で 0.9)の何倍で描くか(θ=8 のとき。θ が低いほど小さい)
const MIN_SCALE = 0.3; // これより小さくしか入らなければ置かない
const PAD = 8; // 本文の枠からこれだけ離す
const EDGE = 12; // 画面の縁からこれだけ離す
const FAB = 56; // 右下の問いのボタン(overlay.js の .ask-fab)を避ける幅
const MIN_SIDE = 90; // 右の余白の帯がこれより広ければ、その下の方に置く
const MIN_BOTTOM = 64; // 下の余白の帯がこれより高ければ、右寄せで置く
const MAX_TALL = 0.5; // 右の余白の帯でも、高さは画面のこの割合まで
const SETTLE = 800; // 本文の枠が変わってから、これだけ落ち着いたら置き場所を確かめる(ミリ秒)

const CSS = `
canvas.paint { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.story { position: fixed; pointer-events: none; transform-origin: 50% 100%; transition: opacity .6s ease-out; }
.story.gone { opacity: 0; }
/* コマは重ねて置き、めくった瞬間に入れ替える(ふわっと替わって、あとは静止)。新しいコマを上に重ねて出し、
   前のコマは新しいコマが半分出てから消す(入れ替えの途中で、くまが薄くならないように) */
.story img { position: absolute; bottom: 0; height: auto; opacity: 0; transition: opacity .45s ease-in .45s; user-select: none; }
.story img.on { opacity: 1; z-index: 1; transition: opacity .9s ease-out; }
.story.quick img { transition: opacity .15s ease-in .15s; }
.story.quick img.on { transition: opacity .3s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .story, .story img { transition: none !important; }
}
`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const any = (xs) => xs[Math.floor(Math.random() * xs.length)];

/**
 * @param {*} Paint paint.js の Paint(オチで散る粒)
 * @param {{ fx?: object }} o fx は config の READING_FX.story
 */
export function createStory(Paint, { fx = {} } = {}) {
  const minP = fx.minP ?? 0.12;
  const maxP = fx.maxP ?? 0.45;
  const skipP = fx.skipP ?? 0.15;
  const [ripeMin, ripeMax] = fx.ripePages ?? [2, 4];

  const host = document.createElement('div');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483645; pointer-events: none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style><canvas class="paint"></canvas>`;
  document.documentElement.append(host);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const paint = new Paint(root.querySelector('canvas.paint'), 240);
  paint.reduced = reduced();

  // 粒が舞っている間だけ描く(何も無いときは描画を止めて CPU を使わない)
  let raf = 0;
  let last = 0;
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    paint.update(dt);
    paint.draw();
    raf = paint.busy ? requestAnimationFrame(loop) : 0;
  }
  paint.onWake = () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };

  let text = null; // 本文の枠 { left, right, top, bottom }
  let settle = 0;
  let viewport = '';
  let lastId = null;
  // いまの話 { spec, step(-1 = まだ何も無い), waited, ripeAt, pace, level, el, imgs, size, box, ended }
  let cur = null;

  /** 置く箱 { x, y, w, h, k }(k は絵の倍率)。入らなければ null。 */
  function boxFor(c) {
    const W = innerWidth;
    const H = innerHeight;
    const { w: nw, h: nh } = c.size;
    if (!nw || !nh) return null; // 絵が読み込めなかった
    let k = SCALE * (0.6 + 0.4 * Math.min(1, Math.max(0, c.level)));
    const side = W - EDGE - (text.right + PAD);
    const below = H - EDGE - (text.bottom + PAD);
    let right;
    let bottom;
    if (side >= MIN_SIDE) {
      k = Math.min(k, side / nw, (H * MAX_TALL) / nh);
      right = W - EDGE;
      bottom = H - FAB;
    } else if (below >= MIN_BOTTOM) {
      k = Math.min(k, below / nh, (W * 0.4) / nw);
      right = W - FAB;
      bottom = H - EDGE;
    } else {
      return null;
    }
    if (k < MIN_SCALE) return null;
    const w = nw * k;
    const h = nh * k;
    return { x: right - w, y: bottom - h, w, h, k };
  }

  const overlaps = (b, t) => b.x < t.right + PAD && b.x + b.w > t.left - PAD && b.y < t.bottom + PAD && b.y + b.h > t.top - PAD;

  /** 置き場所を決める。置いてある話は、force でなければ、画面の大きさが変わったか本文の枠がかかったときだけ置き直す。 */
  function layout(force = false) {
    const c = cur;
    if (!c || !c.size || c.ended) return; // オチたあとは、その場に残す(次の話が始まるまで)
    const size = `${innerWidth}x${innerHeight}`;
    if (c.box && !force && size === viewport && !(text && overlaps(c.box, text))) return;
    viewport = size;
    const box = text ? boxFor(c) : null;
    c.box = box;
    c.el.style.visibility = box ? '' : 'hidden';
    if (!box) return;
    Object.assign(c.el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    for (const img of c.imgs) {
      const w = img.naturalWidth * box.k;
      img.style.width = `${w}px`;
      img.style.left = `${(box.w - w) / 2}px`;
    }
  }

  function show(c, step) {
    c.imgs.forEach((img, i) => img.classList.toggle('on', i === step));
  }

  /** 前の話を、ふっと消す(めくった瞬間)。 */
  function retire(c) {
    if (!c) return;
    c.el.classList.add('gone');
    setTimeout(() => c.el.remove(), 700);
  }

  /** 新しい話を選んで、絵を読み込んでおく(まだ何も見せない)。id を省けば、直前と違う話を乱数で。level は θ/8。 */
  function begin(id, level = cur?.level ?? 1) {
    retire(cur);
    const spec = STORIES.find((s) => s.id === id) ?? any(STORIES.filter((s) => s.id !== lastId));
    lastId = spec.id;
    const el = document.createElement('div');
    el.className = 'story';
    const imgs = [];
    for (let i = 1; i <= spec.frames; i += 1) {
      const img = document.createElement('img');
      img.src = storyURL(`${spec.id}-${i}`);
      img.alt = '';
      img.draggable = false;
      imgs.push(img);
    }
    el.append(...imgs);
    root.append(el);
    const c = {
      spec,
      step: -1,
      waited: 0,
      ripeAt: ripeMin + Math.floor(Math.random() * (ripeMax - ripeMin + 1)),
      // 話ごとの進みやすさに、章ごとの揺らぎを掛ける(同じ話でも、すぐ終わる章と長くかかる章がある)
      pace: spec.pace * (0.75 + Math.random() * 0.5),
      level,
      el,
      imgs,
      size: null,
      box: null,
      ended: false,
    };
    cur = c;
    Promise.all(imgs.map((img) => img.decode().catch(() => {}))).then(() => {
      if (cur !== c) return;
      c.size = { w: Math.max(...imgs.map((i) => i.naturalWidth)), h: Math.max(...imgs.map((i) => i.naturalHeight)) };
      layout();
    });
    return c;
  }

  // 置けていないときは、絵が読み込めたかと、右と下の余白の幅も返す(開発版の記録で、本物の余白が足りているかを見る)
  const room = () =>
    text && { side: Math.round(innerWidth - EDGE - (text.right + PAD)), below: Math.round(innerHeight - EDGE - (text.bottom + PAD)) };
  const state = (c, moved = false) =>
    c && {
      id: c.spec.id,
      name: c.spec.name,
      step: c.step,
      frames: c.spec.frames,
      moved,
      waited: c.waited,
      ended: c.ended,
      shown: !!c.box,
      ...(c.box ? {} : { loaded: c.size ? c.size.w > 0 : null, room: room() }),
    };

  // ---- オチ ---------------------------------------------------------------------
  // どれも、オブジェクトが動き終わる(か、フィーバーに渡す)まで待つ。フィーバーの幕がそのあとを覆う

  const center = (box, fy = 0.5) => [box.x + box.w / 2, box.y + box.h * fy];
  // 話ごとの、散る星の色(金・虹・銀)と粒の量
  const look = (spec) => ({ stars: spec.stars ?? 'gold', n: (count) => Math.max(1, Math.round(count * (spec.burst ?? 1))) });
  const ENDINGS = {
    // 仕上がってきらっと光る
    async complete({ el, box, spec }) {
      const { stars, n } = look(spec);
      el.animate([{ transform: 'none' }, { transform: 'scale(1.08)', offset: 0.35 }, { transform: 'none' }], { duration: 700, easing: 'ease-out' });
      const [cx, cy] = center(box, 0.45);
      paint.twinkle(cx, cy, { count: n(14), stars, radius: box.w * 0.55 });
      paint.bloom(cx, cy, { count: n(5), radius: box.w * 0.45, size: 0.6 });
      paint.scatter(cx, cy, { count: n(16), kinds: ['petal', 'star'], speed: 300, angle: -Math.PI / 2, spread: 2.2, stars });
      await wait(800);
    },
    // ぴょんと出てくる
    async pop({ el, box, spec }) {
      const { stars, n } = look(spec);
      el.animate(
        [
          { transform: 'none', easing: 'cubic-bezier(.3, 0, .6, 1)' },
          { transform: 'translateY(-16%) scale(.94, 1.08)', offset: 0.4, easing: 'cubic-bezier(.5, 0, 1, .6)' },
          { transform: 'scale(1.1, .9)', offset: 0.75 },
          { transform: 'none' },
        ],
        { duration: 560 },
      );
      const [cx, cy] = center(box, 0.3);
      paint.scatter(cx, cy, { count: n(14), kinds: ['star', 'petal'], speed: 320, stars });
      await wait(700);
    },
    // 膨らんで、震えて、弾ける
    async boom({ el, box, spec }) {
      const { stars, n } = look(spec);
      const swell = [1, 1.05, 1.09, 1.13, 1.17, 1.22].map((s, i, a) => ({
        transform: `scale(${s}) rotate(${i === 0 ? 0 : i % 2 ? -2.5 : 2.5}deg)`,
        offset: i / (a.length - 1),
      }));
      el.animate(swell, { duration: 620, easing: 'ease-in', fill: 'forwards' });
      await wait(620);
      el.animate([{ transform: 'scale(1.22)', opacity: 1 }, { transform: 'scale(1.7)', opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' });
      const [cx, cy] = center(box);
      paint.bloom(cx, cy, { count: n(6), radius: box.w * 0.6, size: 0.9 });
      paint.scatter(cx, cy, { count: n(36), kinds: ['star', 'petal', 'drop'], speed: 640, stars });
      await wait(380);
    },
    // ぐらっと傾いて、崩れる
    async collapse({ el, box, spec }) {
      const { n } = look(spec);
      el.animate([{ transform: 'none' }, { transform: 'rotate(-4deg)', offset: 0.3 }, { transform: 'rotate(3deg)', offset: 0.6 }, { transform: 'rotate(-2deg)' }], {
        duration: 520,
        easing: 'ease-in-out',
        fill: 'forwards',
      });
      await wait(520);
      el.animate([{ transform: 'rotate(-2deg)', opacity: 1 }, { transform: 'translate(-14%, 22%) rotate(-32deg)', opacity: 0 }], {
        duration: 480,
        easing: 'cubic-bezier(.5, 0, 1, .6)',
        fill: 'forwards',
      });
      await wait(260);
      const bx = box.x + box.w * 0.35;
      const by = box.y + box.h;
      paint.bloom(bx, by - 10, { count: n(4), radius: box.w * 0.45, size: 0.6 });
      paint.scatter(bx, by - 6, { count: n(18), kinds: ['drop', 'petal'], speed: 360, angle: -Math.PI / 2, spread: 2.6 });
      await wait(320);
    },
    // 崩れた絵に替わったところで、ぺしゃっと潰れて戻る(雪だるま: 仕上がって待っていたものが、最後に崩れる)
    async crumble({ el, box, spec }) {
      const { stars, n } = look(spec);
      el.animate(
        [
          { transform: 'none', easing: 'cubic-bezier(.5, 0, 1, .6)' },
          { transform: 'scale(1.12, .84)', offset: 0.3, easing: 'cubic-bezier(.2, 1.4, .4, 1)' },
          { transform: 'scale(.97, 1.04)', offset: 0.65 },
          { transform: 'none' },
        ],
        { duration: 620 },
      );
      const [cx] = center(box);
      const by = box.y + box.h * 0.8;
      paint.scatter(cx, by, { count: n(22), kinds: ['star', 'drop'], speed: 380, angle: -Math.PI / 2, spread: 2.8, stars });
      paint.twinkle(cx, box.y + box.h * 0.4, { count: n(8), stars, radius: box.w * 0.5 });
      await wait(760);
    },
    // ふわふわ揺れながら、上へ飛んでいく
    async fly({ el, box }) {
      const up = box.y + box.h + 40;
      el.animate(
        [
          { transform: 'none' },
          { transform: 'translate(-4%, -6%) rotate(-3deg)', offset: 0.25 },
          { transform: `translate(3%, ${-up * 0.5}px) rotate(3deg)`, offset: 0.6 },
          { transform: `translate(-2%, ${-up}px) rotate(-2deg)` },
        ],
        { duration: 1500, easing: 'cubic-bezier(.4, 0, .9, .7)', fill: 'forwards' },
      );
      await wait(1200);
    },
    // 揺れながら、横へ滑って画面の外へ
    async sail({ el, box }) {
      const away = innerWidth - box.x + 20;
      el.animate(
        [
          { transform: 'none' },
          { transform: 'translate(4%, -2%) rotate(-2deg)', offset: 0.25 },
          { transform: `translate(${away * 0.4}px, 1%) rotate(2deg)`, offset: 0.6 },
          { transform: `translate(${away}px, -2%) rotate(-1deg)` },
        ],
        { duration: 1600, easing: 'cubic-bezier(.5, 0, .9, .8)', fill: 'forwards' },
      );
      await wait(1300);
    },
  };

  return {
    /** 本文の枠(見えている段落の外接矩形)。null(めくっている最中など)なら、前の枠のまま。 */
    setText(rect) {
      if (!rect) return; // めくっている最中は段落が一瞬消える。そのあいだは前の枠のまま
      text = rect;
      clearTimeout(settle);
      if (cur?.box) settle = setTimeout(layout, SETTLE); // 置いてある話は、枠が落ち着いてから確かめる
      else layout();
    },

    /** 話を始める(id を省けば乱数・level は θ/8)。試写室で話を選ぶのにも使う。 */
    begin(id, level) {
      return state(begin(id, level));
    },

    /**
     * めくった瞬間に呼ぶ(1コマ目がまだなら、どのめくりでも。そのあとは、ちゃんと読んだページだけ)。
     * 1コマ目は必ず出す。そのあとは確率で1コマ(ときどき2コマ)進む。θ が高いほど進みやすく、大きい。
     * 最後から2つ目のコマで止まって待つ。前の話がオチたあとなら、残っていた物が消えて次の話が始まる(まだ何も見せない)。
     */
    advance(level = 1) {
      if (!cur || cur.ended) return state(begin(undefined, level));
      const c = cur;
      if (c.level !== level) {
        c.level = level; // θ が変わったときだけ大きさを測り直す(めくるたびには置き直さない)
        layout(true);
      }
      const limit = c.spec.frames - 2;
      if (c.step >= limit) {
        c.waited += 1;
        return state(c);
      }
      // 1コマ目(何も無い所に、最初の物が現れる)は、最初のめくりで必ず出す(話があることに、すぐ気づけるように)
      if (c.step >= 0 && Math.random() >= (minP + (maxP - minP) * level) * c.pace) return state(c);
      c.step = c.step < 0 ? 0 : Math.min(limit, c.step + (Math.random() < skipP * level ? 2 : 1));
      show(c, c.step);
      return state(c, true);
    },

    /** 限界(最後から2つ目のコマ)で ripePages めくり待った。見出しの無い本は、ここで自分でオチる。 */
    get ripe() {
      return !!cur && !cur.ended && cur.step >= cur.spec.frames - 2 && cur.waited >= cur.ripeAt;
    },

    get state() {
      return state(cur);
    },

    /** いまの話の置き場所(予告の印をこの近くに置く)。置けていなければ null。 */
    get rect() {
      const b = cur && !cur.ended ? cur.box : null;
      return b && { left: b.x, top: b.y, right: b.x + b.w, bottom: b.y + b.h, width: b.w, height: b.h };
    },

    /**
     * 章の終わり(Macro の入り口): 限界まで来ていれば最後のコマに替えて、型どおりにオチる。
     * 途中なら、そのコマのままオチる。解決する値:
     *   progress … どこまで溜まったか(0〜1)。フィーバーの大きさに掛ける(たまった分だけの解放)
     *   aside    … stay の話の、端に置いたままの絵 { src, left, top, width }。フィーバーはくま抜きで出し、この絵を上に重ねる
     */
    async ending() {
      const c = cur;
      if (!c || c.ended) return { progress: 0, aside: null };
      c.ended = true;
      const limit = c.spec.frames - 2;
      const progress = c.step < 0 ? 0 : Math.min(1, (c.step + 1) / (limit + 1));
      if (c.step < 0 || !c.box) return { progress, aside: null };
      let type = c.spec.ending;
      if (c.step >= limit) {
        c.el.classList.add('quick');
        c.step = c.spec.frames - 1;
        show(c, c.step);
        await wait(reduced() ? 0 : 380);
      } else if (type === 'stay' || type === 'crumble') {
        type = 'complete'; // まだ寝ていない・まだ仕上がっていない: ふつうに光って、フィーバーにはくまが出る
      }
      if (type === 'stay') {
        const img = c.imgs[c.step];
        const r = img.getBoundingClientRect();
        return { progress, aside: { src: img.src, left: r.left, top: r.top, width: r.width } };
      }
      paint.motion = Math.max(0.3, c.level);
      if (!reduced()) await ENDINGS[type](c);
      return { progress, aside: null };
    },

    /** 試写室用: いまの話を、決めたコマにする(-1 で何も無い)。 */
    jump(step) {
      const c = cur;
      if (!c || c.ended) return state(c);
      c.step = Math.max(-1, Math.min(c.spec.frames - 2, step));
      c.waited = 0;
      show(c, c.step);
      return state(c);
    },

    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      host.remove();
    },
  };
}
