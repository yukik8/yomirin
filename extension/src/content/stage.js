// 読書中の「舞台」(Play ブックス): くまが顔を出す・うんちく・突然クイズ・読了フィナーレ・めくった瞬間の花びら。
//
// 出すかどうか・何を出すかは main.js が決め、ここは見た目と操作だけを持つ。
// 独立した Shadow DOM に描き、ページの DOM は改変しない。
//
//   画面の下の隅(corner)… くまが顔を出す / うんちく。読書を止めない(本文は触れたまま)
//   画面全体(modal)     … 突然クイズ / 読了フィナーレ。開いている間は下のページをめくらない
//   めくった瞬間(shower) … 花びら・ことば吹雪が上から数秒降る。操作は素通し
//
// ふだん(隅のくま)は静かに、正解と読了の瞬間だけ「フィーバー」で思いきり派手にする:
// くまが驚いて、打ち上がり、天井にぶつかって潰れ、くるくる落ちてきて、
// 何事もなかったように本を開く(台本は fever() の中。時刻と姿勢の表なので、数字を変えれば動きが変わる)。
// 派手さは intensity(0〜1、θに比例)で4段に分かれる。高い=祭り、低い=寝そべって読むだけ — タペリングを壊さない。
// 責めない: クイズは間違えても「おしい!」で答え直せる。減点・残り時間・連続記録・得点は持たない。
// 正解・読了の言葉(「大当たり!!」等)は words=false で消せる。擬音(ぎゅいーん・すとん等)は出さない — 絵と動きだけで伝える。

const CSS = `
.wrap {
  position: fixed; inset: 0; --ink: #4f3a2c; --line: #6b4b37; --paper: #fffaf1; --i: 1; --veil: 1;
  font-family: "Hiragino Maru Gothic ProN", "Zen Maru Gothic", "M PLUS Rounded 1c", "Hiragino Sans", sans-serif;
  color: var(--ink);
}
.modal { animation: fade-in .2s ease-out both; }
.modal.out, .corner.out { animation: fade-out .25s ease-in both; }
@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes fade-out { to { opacity: 0 } }

.veil {
  position: absolute; inset: 0;
  background: radial-gradient(circle at 50% 45%, rgba(255, 250, 240, .93), rgba(250, 232, 210, .96));
  opacity: calc((.82 + .18 * var(--i)) * var(--veil));
}

/* 光の筋: 外側が開き(バーン)、内側が回る。縁はぼかし(filter)ではなく色の移り変わりで柔らかくする
   — 画面より大きい面にぼかしを掛けて回し続けると重い */
.rays {
  position: absolute; left: 50%; top: 52%; width: 160vmax; height: 160vmax; margin: -80vmax 0 0 -80vmax;
  opacity: 0; pointer-events: none;
}
.rays i {
  position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 0deg, transparent 0deg,
    rgba(255, 210, 63, .5) 6deg 24deg, transparent 30deg 60deg,
    rgba(242, 107, 138, .42) 66deg 84deg, transparent 90deg 120deg,
    rgba(76, 201, 163, .42) 126deg 144deg, transparent 150deg 180deg,
    rgba(79, 163, 227, .42) 186deg 204deg, transparent 210deg 240deg,
    rgba(167, 139, 250, .42) 246deg 264deg, transparent 270deg 300deg,
    rgba(255, 179, 71, .48) 306deg 324deg, transparent 330deg 360deg);
  -webkit-mask: radial-gradient(circle, #000 0, #000 30%, transparent 70%);
  mask: radial-gradient(circle, #000 0, #000 30%, transparent 70%);
}
.rays.calm { opacity: calc(.25 + .45 * var(--i)); }
.rays.calm i { animation: spin 30s linear 2; }
.rays.burst { animation: rays-in .55s cubic-bezier(.2, 1.3, .4, 1) both; }
.rays.burst i { animation: spin 7s linear infinite; }
.rays.soft { --peak: .45; }
@keyframes rays-in { from { transform: scale(.05); opacity: 0 } to { transform: scale(1); opacity: var(--peak, 1) } }
@keyframes spin { to { transform: rotate(360deg) } }
canvas.paint { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

/* クイズのカード */
.label {
  position: absolute; left: 50%; top: -17px; transform: translateX(-50%);
  background: var(--paper); border: 2.5px solid var(--line); border-radius: 999px; padding: 5px 20px 4px;
  font-weight: 800; font-size: 15px; letter-spacing: .1em; white-space: nowrap;
  box-shadow: 0 3px 0 rgba(107, 75, 55, .12);
}
.card {
  position: absolute; left: 50%; top: 46%; width: min(92vw, 500px); box-sizing: border-box;
  transform: translate(-50%, -50%);
  background: var(--paper); border: 2.5px solid var(--line); border-radius: 26px;
  box-shadow: 0 14px 40px rgba(79, 58, 44, .18), 0 2px 0 rgba(79, 58, 44, .06);
  padding: 34px 18px 18px;
  animation: pop .55s cubic-bezier(.2, 1.4, .4, 1) both;
}
@keyframes pop {
  0% { transform: translate(-50%, -42%) scale(.6); opacity: 0 }
  60% { transform: translate(-50%, -50%) scale(1.03); opacity: 1 }
  100% { transform: translate(-50%, -50%) scale(1) }
}
.win .card { animation: settle .4s ease-out both; }
@keyframes settle { to { transform: translate(-50%, -50%) scale(.96); opacity: .55 } }
.close {
  position: absolute; right: 10px; top: 10px; width: 32px; height: 32px; border-radius: 50%;
  border: 2px solid rgba(107, 75, 55, .35); background: var(--paper); color: var(--ink);
  font-family: inherit; font-weight: 700; font-size: 16px; line-height: 1; cursor: pointer; padding: 0;
}
.q { margin: 2px 4px 14px; font-size: clamp(16px, 4.2vw, 20px); line-height: 1.6; font-weight: 700; }
.choices { display: grid; gap: 10px; }
.choice {
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px;
  padding: 11px 14px; border: 2px solid rgba(107, 75, 55, .45); border-radius: 16px;
  font-size: clamp(15px, 3.8vw, 18px); font-weight: 700; color: var(--ink); cursor: pointer;
  transition: transform .12s, opacity .3s, border-color .12s;
  animation: slide .4s cubic-bezier(.2, 1.3, .4, 1) both;
}
.choice:nth-child(1) { background: #ffe3e6; animation-delay: .1s; }
.choice:nth-child(2) { background: #fff0c9; animation-delay: .16s; }
.choice:nth-child(3) { background: #e1eefb; animation-delay: .22s; }
.choice:hover { transform: translateY(-1px); border-color: var(--line); }
.choice:focus-visible { outline: 2.5px dashed var(--line); outline-offset: 3px; }
@keyframes slide { from { transform: translateY(8px); opacity: 0 } to { transform: none; opacity: 1 } }
.mark {
  flex: none; width: 26px; height: 26px; border-radius: 50%; border: 2px solid rgba(107, 75, 55, .45); background: var(--paper);
  display: grid; place-items: center; font-weight: 800; font-size: 13px;
}
.choice.wrong { background: #efe9e1; color: #a4968a; cursor: default; animation: shake .4s; }
@keyframes shake { 20% { transform: translateX(-7px) } 40% { transform: translateX(7px) } 60% { transform: translateX(-4px) } 80% { transform: translateX(4px) } }
.choice.right { background: linear-gradient(100deg, #ffe3e6, #fff0c9, #dff3e9, #e1eefb, #ece5ff, #ffe3e6); background-size: 300% 100%; animation: wash 1.6s linear infinite; }
@keyframes wash { to { background-position: 300% 0 } }
.win .choice:not(.right) { opacity: .35; }
.oops {
  position: absolute; font-weight: 900; font-size: 22px; color: #e0708a; pointer-events: none;
  -webkit-text-stroke: 5px var(--paper); paint-order: stroke fill;
  animation: oops .9s ease-out both;
}
@keyframes oops { 0% { transform: translate(-50%, 0) scale(.6); opacity: 0 } 20% { transform: translate(-50%, -14px) scale(1.1); opacity: 1 } 100% { transform: translate(-50%, -40px); opacity: 0 } }

/* 本の帯(大): 正解・読了の言葉 */
.obi {
  position: absolute; left: -14%; right: -14%; top: 50%; height: clamp(84px, 20vh, 128px);
  transform: translateY(-50%) rotate(-6deg) translateX(-135%);
  background: #fffaf0; border-top: 3px solid var(--line); border-bottom: 3px solid var(--line);
  display: grid; place-items: center; pointer-events: none;
  box-shadow: 0 10px 30px rgba(79, 58, 44, .16);
}
.obi::before, .obi::after {
  content: ""; position: absolute; left: 0; right: 0; height: 12px;
  background: linear-gradient(90deg, #f7a1b4, #ffc98a, #ffe27a, #8fdcc0, #94c6f0, #c4b2fb, #f7a1b4);
}
.obi::before { top: 9px; }
.obi::after { bottom: 9px; }
.obi.show { animation: obi-in .5s cubic-bezier(.2, 1.2, .3, 1) both; }
@keyframes obi-in {
  from { transform: translateY(-50%) rotate(-6deg) translateX(-135%) }
  to { transform: translateY(-50%) rotate(-6deg) translateX(0) }
}
.word {
  position: relative; font-size: clamp(38px, 11vw, 72px); font-weight: 900; letter-spacing: .04em; color: #ffd23f;
  -webkit-text-stroke: 7px var(--ink); paint-order: stroke fill; text-shadow: 0 5px 0 var(--ink);
  animation: word .5s .2s cubic-bezier(.2, 1.8, .4, 1) both;
}
@keyframes word { from { transform: scale(2.2); opacity: 0 } to { transform: scale(1); opacity: 1 } }

/* 水彩の虹(読了) */
.rainbow { position: absolute; left: 50%; top: 9%; width: min(96vw, 560px); transform: translateX(-50%); pointer-events: none; }
/* 破線の「すき間」から描き始める(長さ0の線が丸い端だけの点になって残らないように、すき間を長めに取る) */
.rainbow { opacity: 0; }
.rainbow.draw { opacity: 1; }
.rainbow path { stroke-dasharray: 1 2; stroke-dashoffset: 1.02; }
.rainbow.draw path { animation: draw .9s ease-out forwards; }
.rainbow.draw path:nth-child(2) { animation-delay: .08s; }
.rainbow.draw path:nth-child(3) { animation-delay: .16s; }
.rainbow.draw path:nth-child(4) { animation-delay: .24s; }
.rainbow.draw path:nth-child(5) { animation-delay: .32s; }
.rainbow.draw path:nth-child(6) { animation-delay: .4s; }
@keyframes draw { to { stroke-dashoffset: 0 } }

/* フィーバーのくま: 外側(.actor)が位置、内側(.body)が伸び縮みと回転、絵(img)はポーズごとに重ねて切り替える */
.actor { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform; transform: translateY(200vh); }
.actor .body { position: absolute; inset: 0; will-change: transform; }
.actor img { position: absolute; left: 50%; bottom: 0; height: auto; transform: translateX(-50%); opacity: 0; user-select: none; }
.actor img.on { opacity: 1; }
.actor .idle { position: absolute; inset: 0; }
/* 端に置いたままの話の絵(寝床で寝ているくまなど)。幕の上に、元の場所のまま重ねる */
.aside { position: absolute; height: auto; pointer-events: none; user-select: none; }
.actor.resting .idle { animation: idle 2.4s ease-in-out infinite; }
.actor.waving .idle { animation: wave 1.1s ease-in-out infinite; transform-origin: 50% 100%; }
@keyframes idle { 50% { transform: translateY(-3px) } }
@keyframes wave { 0%, 100% { transform: rotate(-3deg) } 50% { transform: rotate(3deg) } }

/* 小さな言葉(段2・1の「読了!」「正解」。帯を出さない代わりに、くまの横にぽんと置く) */
.small-word {
  position: absolute; pointer-events: none; white-space: nowrap; font-weight: 900; letter-spacing: .02em;
  color: #ffd23f; -webkit-text-stroke: 6px var(--ink); paint-order: stroke fill; text-shadow: 0 4px 0 var(--ink);
  transform: translate(-50%, -50%) rotate(-8deg);
  animation: small-word .5s cubic-bezier(.2, 1.6, .4, 1) both;
}
@keyframes small-word {
  from { transform: translate(-50%, -50%) rotate(-8deg) scale(.3); opacity: 0 }
  to { transform: translate(-50%, -50%) rotate(-8deg) scale(1); opacity: 1 }
}
/* 打ち上がりの効果線 */
.streak { position: absolute; width: 5px; border-radius: 5px; pointer-events: none; transform-origin: 50% 100%; }

/* つむじ風: 楕円の輪を下から上へ広げて重ね、破線を流して回って見せる */
.twister {
  position: absolute; left: 50%; bottom: -2vh; width: min(94vw, 640px); height: 96vh; pointer-events: none;
  transform: translateX(-50%); transform-origin: 50% 100%;
  animation: tw-in .35s cubic-bezier(.2, 1.2, .4, 1) both, sway 1.1s ease-in-out infinite;
}
.twister.out { animation: tw-out .45s ease-in both; }
.twister svg { width: 100%; height: 100%; overflow: visible; }
.twister ellipse { animation: whirl .55s linear infinite; }
@keyframes tw-in { from { transform: translateX(-50%) scale(.2, 0); opacity: 0 } to { transform: translateX(-50%) scale(1); opacity: .95 } }
@keyframes tw-out { from { transform: translateX(-50%) scale(1); opacity: .95 } to { transform: translateX(-50%) scale(1.25, 1.1); opacity: 0 } }
@keyframes sway { 50% { transform: translateX(-50%) skewX(-4deg) } }
@keyframes whirl { to { stroke-dashoffset: -120 } }

/* 画面の隅: くまが顔を出す / うんちく(読書は止めない)。下の縁から(bottom)か、左右の縁から(side)。
   絵はポーズごとに重ね、まばたき・耳ぴこは表示の切り替えだけ。大きさは JS が絵の元の大きさ×一定の倍率で決める
   (どのポーズでも、くまの大きさがそろう) */
.corner { pointer-events: none; }
.corner .bear { position: absolute; pointer-events: auto; cursor: pointer; }
.corner .bear .flip { position: absolute; inset: 0; }
.corner .bear img { position: absolute; left: 0; bottom: 0; height: auto; opacity: 0; user-select: none; }
.corner .bear img.on { opacity: 1; }
.corner .bear.bottom { bottom: -6px; transform: translateY(115%); }
.corner .bear.bottom.right { right: 3%; }
.corner .bear.bottom.left { left: 3%; }
.corner .bear.bottom.show { animation: rise .55s cubic-bezier(.2, 1.5, .4, 1) forwards; }
.corner .bear.bottom.peek.show { animation: rise .55s cubic-bezier(.2, 1.5, .4, 1) forwards, wiggle .5s .7s ease-in-out 2; }
.corner .bear.bottom.show.bye { animation: sink .4s ease-in forwards; }
.corner .bear.side { bottom: 16vh; }
.corner .bear.side.left { left: -2px; transform: translateX(-105%); }
.corner .bear.side.right { right: -2px; transform: translateX(105%); }
.corner .bear.side.right .flip { transform: scaleX(-1); }
.corner .bear.side.show { animation: slide-in .5s cubic-bezier(.2, 1.4, .4, 1) forwards; }
.corner .bear.side.left.show.bye { animation: out-left .4s ease-in forwards; }
.corner .bear.side.right.show.bye { animation: out-right .4s ease-in forwards; }
@keyframes rise { to { transform: translateY(0) } }
@keyframes sink { from { transform: translateY(0) } to { transform: translateY(120%) } }
@keyframes wiggle { 25% { transform: rotate(-4deg) } 75% { transform: rotate(4deg) } }
@keyframes slide-in { to { transform: translateX(0) } }
@keyframes out-left { from { transform: translateX(0) } to { transform: translateX(-105%) } }
@keyframes out-right { from { transform: translateX(0) } to { transform: translateX(105%) } }
.bubble {
  position: absolute; right: 5%; bottom: 110px; max-width: min(80vw, 360px); box-sizing: border-box;
  background: var(--paper); border: 2px solid rgba(107, 75, 55, .5); border-radius: 22px;
  box-shadow: 0 8px 24px rgba(79, 58, 44, .14);
  padding: 18px 16px 12px; pointer-events: auto; cursor: pointer;
  transform-origin: 82% 115%; animation: bubble .45s .3s cubic-bezier(.2, 1.5, .4, 1) both;
}
.bubble::after {
  content: ""; position: absolute; right: 22%; bottom: -12px; width: 18px; height: 15px;
  background: var(--paper); border-right: 2px solid rgba(107, 75, 55, .5); border-bottom: 2px solid rgba(107, 75, 55, .5);
  transform: skewX(-28deg) rotate(28deg); border-bottom-right-radius: 5px;
}
/* 左側に出すときは吹き出しも左に(しっぽを鏡写しにする) */
.bubble.left { right: auto; left: 5%; transform-origin: 18% 115%; }
.bubble.left::after { right: auto; left: 22%; transform: scaleX(-1) skewX(-28deg) rotate(28deg); }
@keyframes bubble { from { transform: scale(.3); opacity: 0 } to { transform: scale(1); opacity: 1 } }
.bubble .tag {
  position: absolute; left: 14px; top: -12px; background: #e3eadb; color: #5f7752;
  border-radius: 999px; padding: 2px 12px; font-size: 12px; font-weight: 800; letter-spacing: .08em;
}
.bubble .text { font-size: clamp(15px, 3.9vw, 18px); font-weight: 700; line-height: 1.6; }
.bubble .from { margin-top: 4px; font-size: 12px; color: #8a7462; }

.reduced *, .reduced { animation-duration: .001s !important; animation-iteration-count: 1 !important; animation-delay: 0s !important; }
.reduced .rays, .reduced .twister, .reduced .streak { display: none; }
.reduced .obi.show { animation: none !important; transform: translateY(-50%) rotate(-6deg); }
`;

const MARKS = ['A', 'B', 'C'];
// 隅で顔を出すときの出方。どれが出るかは乱数で、レア度(main.js が先に決める)で中身が変わる:
// ふつう=いろいろな顔の出し方 / レア=小物と一緒(金の星)/ 激レア=積読の上(虹の星)。
// frames は [時刻ms, 絵] の並び(まばたき・耳ぴこは絵の差し替え)。edge: 'bottom' 下の縁から / 'side' 左右の縁から
const PEEKS = {
  normal: [
    { edge: 'bottom', frames: [[0, 'head'], [1100, 'head-blink'], [1230, 'head'], [1900, 'head-blink'], [2030, 'head']] },
    { edge: 'bottom', frames: [[0, 'read']] },
    { edge: 'bottom', frames: [[0, 'chin']] },
    { edge: 'bottom', frames: [[0, 'turn-page']] },
    { edge: 'bottom', frames: [[0, 'focus']] },
    { edge: 'bottom', frames: [[0, 'chira']] },
    { edge: 'side', frames: [[0, 'nozoku']] },
    { edge: 'side', frames: [[0, 'hyo'], [900, 'ear']] },
  ],
  rare: [
    { edge: 'bottom', frames: [[0, 'mug']] },
    { edge: 'bottom', frames: [[0, 'box']] },
    { edge: 'bottom', frames: [[0, 'stack']] },
  ],
  epic: [{ edge: 'bottom', frames: [[0, 'tower']] }],
};
// 隅のくまの倍率(絵の元の大きさに掛ける)。画面が小さいほど小さく
// 切り抜いた絵は元の絵の4倍(v0.26。前は2倍)なので、表示の倍率は前の半分
const cornerScale = () => Math.min(0.31, Math.max(0.21, Math.min(innerWidth, innerHeight) / 2200));
// フィーバーで使うポーズ(層を作るときに全部読み込んでおき、切り替えで絵が消えないようにする)
const FEVER_POSES = ['wait', 'surprise', 'jump', 'launch', 'tumble', 'spin', 'hop', 'fall', 'land', 'back', 'flag', 'read-lying'];
// 打ち上がりの効果線・つむじ風の色(水彩の6色を薄めに)
const PASTEL = ['#f7a1b4', '#ffc98a', '#ffe27a', '#8fdcc0', '#94c6f0', '#c4b2fb'];

// 台本の行のうち、動きを変える値
const MOTION = ['x', 'y', 'sx', 'sy', 'rot', 'at', 'ease'];

const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * 派手さの段(1〜4)。θ/8 の intensity から決める(1枚目の絵コンテの下の段):
 *   4 … 打ち上げ(またはつむじ風)・光の筋・虹・本の帯   θ ≥ 6.4
 *   3 … 大ジャンプで一回転・本の帯                     θ ≥ 4.4
 *   2 … ぴょんぴょん跳ねる・小さな言葉                 θ ≥ 2.8
 *   1 … 寝そべって読むだけ                            それ未満
 */
export const tierOf = (a) => (a >= 0.8 ? 4 : a >= 0.55 ? 3 : a >= 0.35 ? 2 : 1);

export function createStage({ Paint, bearImg }) {
  let modal = null; // mount() の層
  let corner = null;

  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ampOf = (intensity) => Math.min(1, Math.max(0.15, intensity));

  /**
   * Shadow DOM の層を1枚作る。水彩の canvas の描画ループは、舞っているものがある間だけ回す
   * (答えを待つクイズの間など、何も舞っていなければ止めておく。部品が足されると回り出す)。
   */
  function mount(className, amp, html) {
    const host = document.createElement('div');
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
    const root = host.attachShadow({ mode: 'open' });
    const reduced = reducedMotion();
    root.innerHTML = `<style>${CSS}</style><div class="wrap ${className}${reduced ? ' reduced' : ''}">${html}</div>`;
    const wrap = root.querySelector('.wrap');
    wrap.style.setProperty('--i', String(amp));
    document.documentElement.append(host);
    const paint = new Paint(root.querySelector('canvas.paint'));
    paint.motion = amp;
    paint.reduced = reduced;
    const layer = {
      host,
      root,
      wrap,
      paint,
      reduced,
      raf: 0,
      autoClose: 0,
      timers: [],
      onKey: null,
      onClose: null,
      prevFocus: null, // 開く前にフォーカスがあった要素(閉じたら返す)
    };
    let last = 0;
    const loop = (t) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      paint.update(dt);
      paint.draw();
      layer.raf = paint.busy ? requestAnimationFrame(loop) : 0;
    };
    paint.onWake = () => {
      if (layer.raf) return;
      last = performance.now();
      layer.raf = requestAnimationFrame(loop);
    };
    return layer;
  }

  function unmount(layer) {
    if (!layer) return;
    clearTimeout(layer.autoClose);
    for (const t of layer.timers) clearTimeout(t);
    if (layer.onKey) removeEventListener('keydown', layer.onKey, true);
    // フォーカスが層の中にあれば、開く前の場所へ返す
    const focused = layer.root.activeElement;
    if (focused) {
      focused.blur();
      if (layer.prevFocus?.isConnected) layer.prevFocus.focus?.({ preventScroll: true });
    }
    layer.wrap.classList.add('out');
    setTimeout(() => {
      layer.paint.onWake = null;
      cancelAnimationFrame(layer.raf);
      layer.host.remove();
    }, 260);
    layer.onClose?.();
  }

  function closeModal() {
    const m = modal;
    modal = null;
    unmount(m);
  }

  function dismissCorner() {
    const c = corner;
    if (!c) return;
    corner = null;
    for (const b of c.root.querySelectorAll('.bear')) b.classList.add('bye');
    unmount(c);
  }

  // ---- 画面の下の隅 ----------------------------------------------------------

  /**
   * 隅にくまを置く。絵を読み込んでから大きさを決めて出す(layer.ready は {w, h} か、もう消えていれば undefined)。
   * frames の時刻に絵を差し替える(まばたき・耳ぴこ)。
   */
  function cornerBear(kind, { edge = 'bottom', frames }, side, extraHtml = '') {
    dismissCorner();
    const poses = [...new Set(frames.map(([, pose]) => pose))];
    const layer = mount(
      'corner',
      1,
      `<canvas class="paint"></canvas>${extraHtml}<div class="bear ${kind} ${edge} ${side}"><div class="flip">${poses.map((pose) => bearImg(pose)).join('')}</div></div>`,
    );
    layer.wrap.style.pointerEvents = 'none';
    corner = layer;
    const bear = layer.root.querySelector('.bear');
    const imgs = [...bear.querySelectorAll('img')];
    const show = (pose) => {
      for (const img of imgs) img.classList.toggle('on', img.dataset.pose === pose);
    };
    const k = cornerScale();
    layer.ready = Promise.all(imgs.map((img) => img.decode().catch(() => {}))).then(() => {
      if (corner !== layer) return undefined;
      let w = 0;
      let h = 0;
      for (const img of imgs) {
        img.style.width = `${img.naturalWidth * k}px`;
        w = Math.max(w, img.naturalWidth * k);
        h = Math.max(h, img.naturalHeight * k);
      }
      bear.style.width = `${w}px`;
      bear.style.height = `${h}px`;
      for (const [t, pose] of frames) {
        if (t === 0) show(pose);
        else layer.timers.push(setTimeout(() => show(pose), t));
      }
      bear.classList.add('show');
      return { w, h };
    });
    return layer;
  }

  /**
   * くまが隅から顔を出して、少し揺れて、花びらを散らして引っ込む。
   * rarity('normal' | 'rare' | 'epic')で出方と星の色が変わる(色の語彙: 銀=ふつう / 金=レア / 虹=激レア)。
   */
  function peek({ intensity = 1, side, rarity = 'normal', onClose } = {}) {
    const amp = ampOf(intensity);
    if (side !== 'left' && side !== 'right') side = Math.random() < 0.5 ? 'left' : 'right';
    const pool = PEEKS[rarity] ?? PEEKS.normal;
    const layer = cornerBear('peek', pool[Math.floor(Math.random() * pool.length)], side);
    layer.onClose = onClose;
    layer.paint.motion = amp;
    const bear = layer.root.querySelector('.bear');
    bear.addEventListener('click', dismissCorner);
    const stars = rarity === 'epic' ? 'rainbow' : rarity === 'rare' ? 'gold' : 'silver';
    layer.ready.then((size) => {
      if (!size) return;
      layer.timers.push(setTimeout(() => {
        if (corner !== layer) return;
        const r = bear.getBoundingClientRect();
        const x = r.left + r.width / 2;
        layer.paint.scatter(x, r.top + 10, { count: rarity === 'normal' ? 10 : 16, kinds: ['petal', 'star'], speed: 260, spread: 1.6, stars });
        if (rarity !== 'normal') layer.paint.twinkle(x, r.top + r.height * 0.4, { count: rarity === 'epic' ? 8 : 5, radius: r.width * 0.6, stars });
      }, 550));
      layer.autoClose = setTimeout(() => corner === layer && dismissCorner(), rarity === 'normal' ? 2_900 : 3_600);
    });
  }

  /**
   * くまがひらめいて、うんちくを一言。クリックかページ送りで消える。
   * side は出す側(main.js が本文の枠と読んでいる位置から決める)。caption は出どころの一行。
   */
  function trivia({ text, term = '' }, { intensity = 1, side = 'right', caption, onClose } = {}) {
    const amp = ampOf(intensity);
    if (side !== 'left' && side !== 'right') side = 'right';
    const from = caption ?? (term ? `さっきのページの「${term}」より` : '');
    // 言葉の意味・読みの話は「なにそれ?」、物事の豆知識は「ひらめき」(電球)
    const pose = /意味|読み|と読む|のこと|語源/.test(text) ? 'what' : 'idea';
    const layer = cornerBear(
      'talk',
      { edge: 'bottom', frames: [[0, pose]] },
      side,
      `<div class="bubble ${side}" role="status"><span class="tag">うんちく</span><div class="text"></div>${from ? '<div class="from"></div>' : ''}</div>`,
    );
    layer.onClose = onClose;
    layer.paint.motion = amp;
    layer.root.querySelector('.text').textContent = text;
    if (from) layer.root.querySelector('.from').textContent = from;
    const bubble = layer.root.querySelector('.bubble');
    bubble.addEventListener('click', dismissCorner);
    layer.root.querySelector('.bear').addEventListener('click', dismissCorner);
    // 吹き出しはくまの頭の上に(くまの高さが決まってから)
    layer.ready.then((size) => size && (bubble.style.bottom = `${Math.round(size.h * 0.9)}px`));
    layer.timers.push(setTimeout(() => {
      if (corner !== layer) return;
      const r = bubble.getBoundingClientRect();
      layer.paint.twinkle(side === 'left' ? r.left + 20 : r.right - 20, r.top, { count: 4, radius: 22, stars: 'silver' });
    }, 700));
    // 読む長さに合わせて出しておく(1文字あたり約0.12秒、4〜12秒)
    const ms = Math.min(12_000, Math.max(4_000, 2_500 + text.length * 120));
    layer.autoClose = setTimeout(() => corner === layer && dismissCorner(), ms);
  }

  // ---- めくった瞬間 ----------------------------------------------------------

  let shower = null;

  function endShower() {
    const s = shower;
    shower = null;
    unmount(s);
  }

  /**
   * ページをめくった瞬間に、花びら・ことば吹雪・星を上から降らせる。
   * 操作は素通しで読書を止めない。続けてめくれば同じ層に足していく。
   * 星は銀: 金・虹はレア・激レアの先触れの色なので、毎回のめくりで薄めない。
   */
  function pageShower({ intensity = 1, glyphs = [] } = {}) {
    const amp = ampOf(intensity);
    if (!shower) shower = mount('shower', amp, '<canvas class="paint"></canvas>');
    const layer = shower;
    layer.paint.motion = amp;
    layer.paint.shower(innerWidth, { count: 100, kinds: ['petal', 'glyph', 'star'], stars: 'silver', glyphs, depth: 0.8 });
    clearTimeout(layer.autoClose);
    layer.autoClose = setTimeout(() => shower === layer && endShower(), 5_000);
  }

  // ---- フィーバー(正解・読了) ------------------------------------------------

  /** フィーバーのくまを層に置く。ポーズの絵を全部重ねておき、切り替えは表示だけ変える。 */
  function makeActor(layer) {
    const size = Math.round(Math.min(260, Math.max(140, Math.min(innerWidth, innerHeight) * 0.34)));
    const el = document.createElement('div');
    el.className = 'actor';
    el.style.width = el.style.height = `${size}px`;
    el.innerHTML = `<div class="body"><div class="idle">${FEVER_POSES.map((p) => bearImg(p)).join('')}</div></div>`;
    // 本の帯より奥に置く(落ちてくるくまが「読了!!」の字を隠さず、帯の向こうから顔を出す)
    layer.wrap.insertBefore(el, layer.root.querySelector('.obi'));
    const imgs = [...el.querySelectorAll('img')];
    return {
      el,
      body: el.firstElementChild,
      size,
      show(pose) {
        for (const img of imgs) img.classList.toggle('on', img.dataset.pose === pose);
      },
      // 全部の絵が読み込まれるまで待つ(途中で差し替えたときに絵が消えないように)。最長 0.4 秒。
      // クイズは出したときに置くので、答えるころには読み込み終わっている。
      // 大きさは絵の元の大きさ×倍率(箱の一辺 230 の絵を、箱いっぱいに)— どのポーズでもくまの大きさがそろう
      ready: Promise.race([
        Promise.all(imgs.map((img) => img.decode().catch(() => {}))),
        new Promise((r) => setTimeout(r, 400)),
      ]).then(() => {
        for (const img of imgs) if (img.naturalWidth) img.style.width = `${(img.naturalWidth * size) / 460}px`;
      }),
    };
  }

  /**
   * 台本どおりにくまを動かす。台本は時刻(ms)順の行の並びで、書かなかった値は前の行から引き継ぐ:
   *   x, y   … くまの箱(正方形・一辺 size)の左上の位置(px)
   *   sx, sy … 伸び縮み。at='top' なら上の辺、'bottom' なら下の辺を動かさずに潰す
   *   rot    … 回転(度)
   *   pose   … その時刻に差し替える絵
   *   ease   … この行から次の行までの動き方
   *   fx     … その時刻に起こすこと(効果線・花火・帯など)
   */
  function play(layer, actor, script, rest = 'resting') {
    script = [...script].sort((a, b) => a.t - b.t);
    const total = script.at(-1).t;
    const half = actor.size / 2;
    const outer = [];
    const inner = [];
    let cur = { x: 0, y: 0, sx: 1, sy: 1, rot: 0, at: 'center' };
    script.forEach((step, i) => {
      // 絵の差し替えや効果だけの行は、動きの区切りにしない(前後の動きをそのままつなぐ)
      const moves = MOTION.some((k) => k in step) || i === 0 || i === script.length - 1;
      if (moves) cur = { ...cur, ease: 'linear', ...step };
      const offset = step.t / total;
      if (moves) {
        const dy = cur.at === 'top' ? -(1 - cur.sy) * half : cur.at === 'bottom' ? (1 - cur.sy) * half : 0;
        outer.push({ offset, transform: `translate(${cur.x}px, ${cur.y}px)`, easing: cur.ease });
        inner.push({ offset, transform: `translateY(${dy}px) rotate(${cur.rot}deg) scale(${cur.sx}, ${cur.sy})`, easing: cur.ease });
      }
      const { pose, fx } = step;
      if (step.t === 0) {
        if (pose) actor.show(pose);
        fx?.();
      } else if (pose || fx) {
        layer.timers.push(setTimeout(() => {
          if (pose) actor.show(pose);
          fx?.();
        }, step.t));
      }
    });
    actor.el.animate(outer, { duration: total, fill: 'forwards' });
    actor.body.animate(inner, { duration: total, fill: 'forwards' });
    layer.timers.push(setTimeout(() => actor.el.classList.add(rest), total));
  }

  /** 小さな言葉を一つ置く(閉じるまで残す)。 */
  function smallText(layer, text, { x, y, size }) {
    const el = document.createElement('div');
    el.className = 'small-word';
    el.textContent = text;
    el.style.cssText = `left:${x}px; top:${y}px; font-size:${size}px`;
    layer.wrap.append(el);
  }

  /** 打ち上がりの効果線: くまの下から上へ、色鉛筆の線を何本か走らせる。 */
  function streaks(layer, cx, bottom, spread, count) {
    if (layer.reduced) return;
    for (let i = 0; i < count; i += 1) {
      const el = document.createElement('div');
      el.className = 'streak';
      const h = rnd(110, 260);
      const color = PASTEL[i % PASTEL.length];
      el.style.cssText = `left:${cx + rnd(-spread, spread)}px; top:${bottom - h}px; height:${h}px; background:linear-gradient(${color}, ${color}00)`;
      layer.wrap.append(el);
      el.animate(
        [
          { transform: 'translateY(40px) scaleY(.2)', opacity: 0 },
          { transform: 'translateY(-60px) scaleY(1)', opacity: 1, offset: 0.3 },
          { transform: `translateY(${-rnd(260, 420)}px) scaleY(.6)`, opacity: 0 },
        ],
        { duration: rnd(420, 620), delay: i * 25, easing: 'ease-out', fill: 'both' },
      ).onfinish = () => el.remove();
    }
  }

  /** つむじ風を画面の下から立ち上げる。返り値の関数で消す。 */
  function twister(layer) {
    if (layer.reduced) return () => {};
    const el = document.createElement('div');
    el.className = 'twister';
    const rings = [];
    const n = 10;
    for (let i = 0; i < n; i += 1) {
      const u = i / (n - 1);
      const y = 300 - u * 300; // 下(300)から上(0)へ
      const rx = 16 + u * 140;
      const ry = 4 + u * 15;
      const cx = Math.sin(u * 5) * 12;
      rings.push(
        `<ellipse cx="${cx.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" stroke="${PASTEL[i % PASTEL.length]}" vector-effect="non-scaling-stroke" stroke-dasharray="${(40 + u * 50).toFixed(0)} ${(20 + u * 30).toFixed(0)}" style="animation-duration:${(0.35 + u * 0.4).toFixed(2)}s"/>`,
      );
    }
    el.innerHTML = `<svg viewBox="-170 -20 340 340" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke-width="7" stroke-linecap="round">${rings.join('')}</g></svg>`;
    layer.wrap.append(el);
    return () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 500);
    };
  }

  /** 画面を少し揺らす(天井にぶつかった瞬間)。 */
  function shake(layer) {
    if (layer.reduced) return;
    layer.wrap.animate(
      [
        { transform: 'translate(0, 0)' },
        { transform: 'translate(-7px, 5px)' },
        { transform: 'translate(6px, -4px)' },
        { transform: 'translate(-3px, 2px)' },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 260, easing: 'ease-out' },
    );
  }

  function showObi(layer, text) {
    const obi = layer.root.querySelector('.obi');
    layer.root.querySelector('.word').textContent = text;
    obi.classList.add('show');
  }

  /**
   * フィーバー本体。kind は 'finale'(読了)か 'win'(クイズ正解)。
   * word は段4・3では本の帯に、段2・1では小さな言葉としてくまの横に出す(空なら出さない)。
   * variant は段4の出し方('launch' 打ち上げ / 'tornado' つむじ風)。省けば読了は打ち上げ、正解は半々。
   * 返り値は、くまが着地して落ち着くまでの時間(ms)。
   */
  async function fever(layer, actor, { kind, amp, word, glyphs = [], variant }) {
    const { paint, wrap, root } = layer;
    const W = innerWidth;
    const H = innerHeight;
    const tier = tierOf(amp);
    const { size } = actor;
    const x = W / 2 - size / 2;
    const yHide = H + 12;
    const yRest = H - size * 0.97;
    const yTop = -size * 0.22;
    const cx = W / 2;
    const rays = root.querySelector('.rays');
    const rainbow = root.querySelector('.rainbow');
    paint.motion = amp;
    if (kind !== 'win') wrap.style.setProperty('--veil', String([0.35, 0.6, 0.85, 1][tier - 1]));
    await actor.ready;
    if (modal !== layer) return 0;

    const stars = amp >= 0.7 ? 'rainbow' : 'gold';
    const burstAt = (px, py, n = 30, speed = 620) => {
      paint.bloom(px, py, { count: 5, radius: Math.min(W, H) * 0.3, size: 1.3 });
      paint.scatter(px, py, { count: n, kinds: ['star', 'petal', 'glyph'], speed, stars, glyphs });
    };
    const fromSides = () => {
      paint.scatter(0, H, { count: 22, kinds: ['petal', 'drop', 'glyph'], speed: 900, angle: -1.05, spread: 0.7, up: 120, glyphs });
      paint.scatter(W, H, { count: 22, kinds: ['petal', 'drop', 'glyph'], speed: 900, angle: -Math.PI + 1.05, spread: 0.7, up: 120, glyphs });
    };
    const confetti = (n) => paint.shower(W, { count: n, kinds: ['petal', 'glyph', 'star'], stars, glyphs, depth: 0.3 });
    const banner = () => {
      if (word !== null) showObi(layer, word);
      paint.ribbons(W, H, 5);
      paint.fireworks(W, H, 3 + Math.round(3 * amp));
    };
    // 締めの絵: 本の読了だけ旗を振る(クイズ正解・章の終わりと見分けがつくように)。ほかは何事もなかったように本を開く
    const endPose = kind === 'finale' ? 'flag' : 'back';
    const smallWord = (fontSize) => word && smallText(layer, word, { x: cx + size * 0.62, y: H - size * 0.95, size: fontSize });
    const land = (t) => [
      { t, y: yRest, sx: 0.9, sy: 1.12, ease: 'ease-out' },
      { t: t + 40, pose: 'land', sx: 1.25, sy: 0.74, ease: 'cubic-bezier(.2, 1.6, .4, 1)', fx: () => paint.scatter(cx, H - 8, { count: 10, kinds: ['star', 'drop'], speed: 360, angle: -Math.PI / 2, spread: 2.2, stars }) },
      { t: t + 200, pose: endPose, sx: 1, sy: 1 },
      { t: t + 260 },
    ];

    // 動きを減らす設定: 動かさず、本を開いたくまを置いて帯を出すだけ
    if (layer.reduced) {
      actor.show(tier >= 2 ? endPose : 'read-lying');
      actor.el.style.transform = `translate(${x}px, ${yRest}px)`;
      if (tier >= 3) banner();
      else smallWord(tier === 2 ? 44 : 26);
      return 0;
    }

    // 驚いて顔を出すまで(段4・3で共通)
    const surprise = [
      { t: 0, x, y: yHide, pose: 'wait', ease: 'cubic-bezier(.2, 1.5, .4, 1)' },
      { t: 150, y: yRest, pose: 'surprise', sx: 1.06, sy: 0.94, at: 'bottom', ease: 'ease-in' },
      { t: 230, sx: 1.16, sy: 0.8, ease: 'ease-out' },
    ];
    const lightUp = (soft) => () => {
      if (rays) {
        rays.classList.toggle('soft', soft);
        rays.classList.add('burst');
      }
      if (!soft && rainbow) rainbow.classList.add('draw');
      burstAt(cx, H - size * 0.5, soft ? 18 : 30, soft ? 480 : 640);
    };

    let script;
    variant ??= kind !== 'win' || Math.random() < 0.5 ? 'launch' : 'tornado';
    // 大当たり(クイズの段4)の打ち上げは、くるくるの代わりに虹に乗って回る
    const ride = kind === 'win';
    if (tier === 4 && variant === 'launch') {
      // 打ち上げ(1枚目の絵コンテ): 打ち上がる → 天井で潰れる → くるくる落ちる → 着地 → 何事もなかったように読む
      script = [
        ...surprise,
        { t: 220, fx: lightUp(false) },
        {
          t: 300, pose: 'jump', y: yRest - size * 0.15, sx: 0.86, sy: 1.2, ease: 'cubic-bezier(.4, 0, .9, .7)',
          fx: () => streaks(layer, cx, H, size * 0.45, 9),
        },
        { t: 380, pose: 'launch', y: H * 0.36, rot: -6, sx: 0.8, sy: 1.28 },
        {
          t: 500, y: yTop, rot: 0, sx: 1.45, sy: 0.5, at: 'top', ease: 'ease-out',
          fx: () => {
            shake(layer);
            paint.scatter(cx, 8, { count: 16, kinds: ['star', 'drop'], speed: 520, angle: Math.PI / 2, spread: 2.4, stars });
          },
        },
        { t: 650, sx: 1.3, sy: 0.64, ease: 'ease-in', fx: banner },
        { t: 780, pose: ride ? 'spin' : 'tumble', y: yTop + size * 0.35, sx: 1, sy: 1, rot: ride ? -8 : 30, ease: 'cubic-bezier(.4, 0, .6, 1)' },
        { t: 900, fx: () => { confetti(70); fromSides(); } },
        { t: 1180, y: H * 0.3, rot: ride ? 8 : 380, ease: 'linear' },
        { t: 1200, pose: 'fall', rot: ride ? 0 : 360, at: 'bottom', ease: 'cubic-bezier(.55, 0, 1, .45)' },
        ...land(1460),
      ];
    } else if (tier === 4) {
      // つむじ風: 竜巻に巻かれてぐるぐる昇り、画面の外へ。帯が出てから、上から落ちてくる
      let calm = () => {};
      const spiral = [];
      const steps = 18;
      const R = Math.min(W, 900) * 0.3;
      for (let i = 0; i <= steps; i += 1) {
        const u = i / steps;
        const turn = Math.sin(Math.PI * 2 * 2.2 * u);
        const depth = 1 - 0.14 * Math.cos(Math.PI * 2 * 2.2 * u);
        spiral.push({
          t: Math.round(300 + u * 850),
          x: x + (0.08 + u) * R * turn,
          y: yRest - Math.pow(u, 1.15) * (yRest + size * 1.4),
          rot: 1080 * u,
          sx: depth,
          sy: depth,
          at: 'center',
        });
      }
      spiral[0].pose = 'tumble';
      script = [
        ...surprise,
        { t: 220, fx: () => { lightUp(false)(); calm = twister(layer); } },
        ...spiral,
        { t: 1160, fx: () => { banner(); confetti(80); fromSides(); } },
        { t: 1300, fx: () => calm() },
        { t: 1420, x, y: -size * 1.1, rot: 0, sx: 1, sy: 1, at: 'bottom', pose: 'fall', ease: 'cubic-bezier(.55, 0, 1, .45)' },
        ...land(1720),
      ];
    } else if (tier === 3) {
      // 大ジャンプ: 跳び上がって一回転し、落ちて戻る
      script = [
        ...surprise,
        { t: 220, fx: lightUp(true) },
        {
          t: 300, pose: 'jump', y: yRest - size * 0.1, sx: 0.88, sy: 1.16, ease: 'cubic-bezier(.2, .6, .4, 1)',
          fx: () => streaks(layer, cx, H, size * 0.35, 5),
        },
        { t: 420, pose: 'hop' },
        { t: 640, y: H * 0.16, rot: 0, sx: 1, sy: 1, at: 'center', ease: 'ease-in-out', fx: banner },
        { t: 900, rot: 360, ease: 'cubic-bezier(.55, 0, 1, .45)', fx: () => confetti(45) },
        { t: 920, pose: 'fall', at: 'bottom', rot: 360 },
        ...land(1140),
      ];
    } else if (tier === 2) {
      // ぴょんぴょん: 下から跳ねて出てきて、二度はねてから本を開く
      const hopY = yRest - size * 0.28;
      script = [
        { t: 0, x, y: yHide, pose: 'hop', at: 'bottom', ease: 'cubic-bezier(.2, .8, .4, 1)' },
        { t: 320, y: hopY, ease: 'cubic-bezier(.5, 0, 1, .5)', fx: () => { burstAt(cx, H - size * 0.6, 14, 420); smallWord(44); } },
        { t: 520, y: yRest, sx: 1.18, sy: 0.82, ease: 'cubic-bezier(.2, .8, .4, 1)' },
        { t: 600, sx: 1, sy: 1, ease: 'cubic-bezier(.2, .8, .4, 1)' },
        { t: 780, y: yRest - size * 0.16, ease: 'cubic-bezier(.5, 0, 1, .5)', fx: () => confetti(20) },
        { t: 960, y: yRest, sx: 1.14, sy: 0.86, ease: 'ease-out' },
        { t: 1000, pose: endPose, sx: 1, sy: 1, ease: 'cubic-bezier(.2, 1.6, .4, 1)' },
        { t: 1100 },
      ];
    } else {
      // 寝そべって読むだけ: ほとんど何も起きない(θ が低い=もう足場が要らない)
      script = [
        { t: 0, x, y: yHide, pose: 'read-lying', ease: 'cubic-bezier(.2, .8, .3, 1)' },
        {
          t: 600, y: yRest,
          fx: () => {
            paint.twinkle(cx + size * 0.5, H - size * 0.7, { count: 3, radius: 30, stars: 'gold' });
            if (amp >= 0.2) smallWord(26);
          },
        },
        { t: 700 },
      ];
    }
    play(layer, actor, script, tier >= 2 && endPose === 'flag' ? 'waving' : 'resting');
    return script.at(-1).t;
  }

  // ---- 画面全体 --------------------------------------------------------------

  /**
   * 突然クイズ。quiz = { question, choices[3], answer_index }
   * onFirstAnswer(correct, chosenIndex, latencyMs) は最初の回答だけ1回(記録用)。
   */
  function quiz(q, { intensity = 1, words = true, glyphs = [], variant, onFirstAnswer, onCelebrate, onClose } = {}) {
    closeModal();
    dismissCorner();
    const prevFocus = document.activeElement;
    const amp = ampOf(intensity);
    const layer = mount(
      'modal',
      amp,
      `<div class="veil"></div><div class="rays calm"><i></i></div><canvas class="paint"></canvas>
       <div class="card" role="dialog" aria-modal="true" aria-label="クイズ">
         <div class="label">クイズ</div>
         <button class="close" type="button" aria-label="閉じる">×</button>
         <p class="q"></p><div class="choices"></div>
       </div>
       <div class="obi"><span class="word"></span></div>`,
    );
    layer.wrap.style.pointerEvents = 'auto';
    layer.onClose = onClose;
    layer.prevFocus = prevFocus;
    modal = layer;
    const { root, wrap, paint } = layer;
    const actor = makeActor(layer);
    root.querySelector('.q').textContent = q.question;
    const list = root.querySelector('.choices');
    const buttons = q.choices.slice(0, 3).map((text, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice';
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = MARKS[i];
      const label = document.createElement('span');
      label.textContent = text;
      b.append(mark, label);
      list.append(b);
      return b;
    });

    // 登場: 左右の上からひらひら
    const W = innerWidth;
    const H = innerHeight;
    paint.scatter(W * 0.12, H * 0.1, { count: 8, kinds: ['petal', 'star'], speed: 300, angle: 0.6, spread: 1.2, stars: 'silver' });
    paint.scatter(W * 0.88, H * 0.1, { count: 8, kinds: ['petal', 'star'], speed: 300, angle: Math.PI - 0.6, spread: 1.2, stars: 'silver' });

    const openedAt = performance.now();
    let answered = false;
    let won = false;

    async function choose(i) {
      if (won) return;
      const b = buttons[i];
      if (!b || b.classList.contains('wrong')) return;
      const correct = i === q.answer_index;
      if (!answered) {
        answered = true;
        onFirstAnswer?.(correct, i, Math.round(performance.now() - openedAt));
      }
      if (correct) {
        won = true;
        b.classList.add('right');
        // 間違えてから当てたときは一段静かに
        const a = amp * (buttons.some((x) => x.classList.contains('wrong')) ? 0.6 : 1);
        wrap.classList.add('win');
        const tier = tierOf(a);
        const word = words ? (tier === 4 ? '大当たり!!' : tier === 1 ? '正解' : '正解!') : tier >= 3 ? '' : null;
        onCelebrate?.();
        const settle = await fever(layer, actor, { kind: 'win', amp: a, word, glyphs, variant });
        if (modal === layer) layer.autoClose = setTimeout(() => modal === layer && closeModal(), settle + (tier >= 3 ? 1_300 : 1_100));
      } else {
        // 責めない: 選び直せる。罰も記録の上書きもしない
        b.classList.add('wrong');
        b.setAttribute('aria-disabled', 'true');
        const r = b.getBoundingClientRect();
        const oops = document.createElement('div');
        oops.className = 'oops';
        oops.textContent = 'おしい!';
        oops.style.left = `${r.left + r.width / 2}px`;
        oops.style.top = `${r.top - 6}px`;
        wrap.append(oops);
        setTimeout(() => oops.remove(), 1_000);
      }
    }

    buttons.forEach((b, i) => b.addEventListener('click', () => choose(i)));
    const closeButton = root.querySelector('.close');
    closeButton.addEventListener('click', closeModal);
    // 開いたら最初の選択肢にフォーカスを移す(キーボードだけでも答えられる)。本文のフレームに
    // フォーカスが無いと移せないことがあるが、そのときもクリックと数字キーで答えられる
    requestAnimationFrame(() => modal === layer && buttons[0]?.focus({ preventScroll: true }));
    // モーダル: 数字キーで回答、Esc で閉じる、Tab はカードの中だけを回る。下のページを矢印でめくらない
    layer.onKey = (e) => {
      if (e.key === 'Escape') {
        closeModal();
      } else if (['1', '2', '3', 'a', 'b', 'c'].includes(e.key.toLowerCase())) {
        choose('123'.includes(e.key) ? Number(e.key) - 1 : 'abc'.indexOf(e.key.toLowerCase()));
      } else if (e.key === 'Tab') {
        const items = [closeButton, ...buttons.filter((b) => !b.classList.contains('wrong'))];
        const i = items.indexOf(root.activeElement);
        items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus({ preventScroll: true });
      } else if (e.key === ' ' || e.key === 'Enter') {
        // 下のページへは渡さず、フォーカスのあるボタンだけを押す
        if (root.activeElement?.tagName === 'BUTTON') root.activeElement.click();
      } else if (!e.key.startsWith('Arrow') && e.key !== 'PageDown' && e.key !== 'PageUp') {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', layer.onKey, true);
  }

  /**
   * 読了フィナーレ: くまが打ち上がって天井にぶつかり、虹と本の帯の「読了!!」、落ちてきて旗を振る。
   * chapter を渡すと章の終わり(Macro): 帯は「〇〇 読了!!」(label が無ければ「章 読了!!」)、締めは本を開く。
   * chapter.label が null なら、見出しの分からない区切り(ページ数)なので帯に言葉を出さない。
   * bear: false ならくまは出さない(光・虹・帯・紙吹雪だけ)。aside { src, left, top, width } は、
   * 画面の端に置いたままの話の絵(寝床で寝ているくま)を幕の上に重ねる — 読了にも気づかずに寝ている。
   */
  async function finale({ intensity = 1, words = true, glyphs = [], variant, chapter = null, bear = true, aside = null, onClose } = {}) {
    closeModal();
    dismissCorner();
    const amp = ampOf(intensity);
    const tier = tierOf(amp);
    const layer = mount(
      'modal finale win',
      amp,
      `<div class="veil"></div><div class="rays"><i></i></div>
       <svg class="rainbow" viewBox="0 0 300 160" aria-hidden="true">
         <defs><filter id="rb" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="4" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="7" xChannelSelector="R" yChannelSelector="G"/></filter></defs>
         <g fill="none" stroke-linecap="round" stroke-width="14" filter="url(#rb)" opacity=".85">
           <path pathLength="1" d="M12 156 A138 138 0 0 1 288 156" stroke="#f7a1b4"/>
           <path pathLength="1" d="M28 156 A122 122 0 0 1 272 156" stroke="#ffc98a"/>
           <path pathLength="1" d="M44 156 A106 106 0 0 1 256 156" stroke="#ffe27a"/>
           <path pathLength="1" d="M60 156 A90 90 0 0 1 240 156" stroke="#8fdcc0"/>
           <path pathLength="1" d="M76 156 A74 74 0 0 1 224 156" stroke="#94c6f0"/>
           <path pathLength="1" d="M92 156 A58 58 0 0 1 208 156" stroke="#c4b2fb"/>
         </g>
       </svg>
       <canvas class="paint"></canvas>
       <div class="obi"><span class="word"></span></div>
       <div class="sr" role="status" aria-label="${chapter ? '章 読了' : '読了'}"></div>`,
    );
    layer.wrap.style.pointerEvents = 'auto';
    layer.onClose = onClose;
    modal = layer;
    const base = chapter ? (chapter.label === null ? null : `${chapter.label ? `${chapter.label} ` : '章 '}読了`) : '読了';
    const word = words && base ? (tier >= 3 ? `${base}!!` : tier === 2 ? `${base}!` : base) : tier >= 3 && base ? '' : null;
    layer.wrap.addEventListener('click', closeModal);
    layer.onKey = (e) => {
      if (e.key !== 'Escape') return;
      closeModal();
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', layer.onKey, true);
    if (aside) {
      const img = document.createElement('img');
      img.className = 'aside';
      img.src = aside.src;
      img.alt = '';
      img.style.cssText = `left:${aside.left}px; top:${aside.top}px; width:${aside.width}px`;
      layer.root.querySelector('canvas.paint').before(img);
    }
    const actor = makeActor(layer);
    if (!bear) actor.el.style.visibility = 'hidden';
    const settle = await fever(layer, actor, { kind: chapter ? 'chapter' : 'finale', amp, word, glyphs, variant });
    // 章の終わりは数秒で「スン…」と本に戻る(本の読了は少し長く見せる)
    const hold = chapter ? (tier >= 3 ? 1_400 : 1_000) : tier >= 3 ? 2_200 : 1_600;
    if (modal === layer) layer.autoClose = setTimeout(() => modal === layer && closeModal(), settle + hold);
  }

  /**
   * 激レアの当たり: くまが下から画面を斜めに駆け抜けて、上へ消える(約0.7秒)。めくった瞬間に出す。
   * 画面は覆わない(幕なし・操作は素通し)。θ が低い(段1)ときは出さない。
   */
  async function flyby({ intensity = 1 } = {}) {
    const amp = ampOf(intensity);
    if (modal || tierOf(amp) < 2 || reducedMotion()) return;
    const layer = mount('flyby', amp, '<canvas class="paint"></canvas>');
    layer.wrap.style.pointerEvents = 'none';
    const actor = makeActor(layer);
    await actor.ready;
    if (!layer.host.isConnected) return;
    const W = innerWidth;
    const H = innerHeight;
    const { size } = actor;
    const fromLeft = Math.random() < 0.5;
    const x0 = fromLeft ? W * 0.12 : W * 0.88 - size;
    const x1 = fromLeft ? W * 0.62 - size / 2 : W * 0.38 - size / 2;
    const at = (u) => ({ x: x0 + (x1 - x0) * u + size / 2, y: H + 10 - (H + size * 1.6) * u + size / 2 });
    play(layer, actor, [
      { t: 0, x: x0, y: H + 10, pose: 'launch', sx: 0.82, sy: 1.25, rot: fromLeft ? 12 : -12, ease: 'cubic-bezier(.3, .1, .7, 1)', fx: () => streaks(layer, x0 + size / 2, H, size * 0.4, 7) },
      { t: 700, x: x1, y: -size * 1.6 },
    ]);
    // 通ったあとに、すぐ消える絵の具の粒を残す(新しいページを読み始める頃には消えている)
    for (const u of [0.25, 0.45, 0.65]) {
      layer.timers.push(setTimeout(() => {
        const p = at(u);
        layer.paint.scatter(p.x, p.y, { count: 8, kinds: ['drop'], speed: 260 });
      }, 700 * u));
    }
    layer.autoClose = setTimeout(() => unmount(layer), 1_600);
  }

  return {
    peek,
    trivia,
    quiz,
    finale,
    flyby,
    pageShower,
    dismissCorner,
    close() {
      closeModal();
      dismissCorner();
      endShower();
    },
    get modalOpen() {
      return modal !== null;
    },
    get busy() {
      return modal !== null || corner !== null;
    },
  };
}
