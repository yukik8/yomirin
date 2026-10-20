// 余白の演出(Play ブックス)。本文の枠の外(余白)にだけ描く — 読んでいる文字の上には何も重ねない。
// 描く場所は本文の枠の外の帯(縦書きは上下、横書きは左右)から選び、描画のたびに本文の枠を切り抜く。
// 余白がほとんど無いページでは画面の端に寄せる(それでも本文の枠の中には描かない)。
//
// 読書中の原則(2026-10-09・docs/style.md §7):
//   - 派手さは「動きの速さ」ではなく「色・量・広さ」で出す
//   - 動かすのは「目が文章から離れる瞬間」(めくり・章の終わり)だけ。読んでいる瞬間には動かさない
//   - 読んでいる時間の報酬は「世界が育っていること」で表す。手が止まっても何も減らさない
//
// 3つの階層(どれも θ に比例し、θ=0 では出ない):
//   Micro(めくり中)… めくりの演出(turnfx.js): 色と粒が本文のまわりに広がり、新しいページを読み始める前に消える
//   Meso(読書中)   … 余白の飾り: めくるたびに一つ、ふわっと増えて、あとは静止(芽・葉・花・銀の星・ときどきくま)。
//                      縁の光: めくるたびにごくゆっくり濃くなる(減らない)。予告: 金の星 → くまの耳 → 虹のかけら
//   Macro(章・読了)… 余白の飾りと縁の光が中心へ吸い込まれる(collapse)→ stage.js のフィーバーへ
//
// 文字のカードは出さない — 報酬は言葉でなく雰囲気で伝える。

const PAD = 8; // 本文の枠からこれだけ離す
const MIN_BAND = 26; // これより細い余白の帯は使わない
const GOLD = ['#ffd23f', '#ffb347', '#ffe17a'];
// 余白の花・めくりの光・虹のかけらの色(水彩の6色を薄めに)
const PASTEL = ['#f7a1b4', '#ffc98a', '#ffe27a', '#8fdcc0', '#94c6f0', '#c4b2fb'];
const SILVER = '#d5dbe6';

// 余白の飾り。asset はくまのポーズ集から切り抜いた絵(extension/assets/bear/)、sprite は paint.js で焼く形。
// size は幅(px、θ=8 のとき)、aspect は絵の高さ/幅。zone は帯の中の高さの好み(low=下から生える / high=上の方)。
// ふだん増えるのは GROW の中から重みつきの乱数で。半分ほどは、もう置いてある飾りの近くに置く(まとまって育つ)
const ITEMS = {
  leaf: { asset: 'fx-leaf', size: 30, aspect: 1.46, zone: 'low' },
  tulip: { asset: 'fx-tulip', size: 38, aspect: 1.16, zone: 'low' },
  sprig: { asset: 'fx-sprig', size: 34, aspect: 0.96, zone: 'low' },
  flower: { asset: 'fx-flower', size: 40, aspect: 0.92 },
  orange: { asset: 'fx-orange', size: 28, aspect: 0.84 },
  blossom: { asset: 'fx-blossom', size: 52, aspect: 0.65 },
  petals: { asset: 'fx-petals', size: 56, aspect: 0.7 },
  bloom: { sprite: 'flower', size: 38 }, // 色は PASTEL から
  sparkle: { sprite: 'star', color: SILVER, size: 22, zone: 'high' }, // 銀=いつも
  bear: { asset: 'read', size: 84, aspect: 0.71, low: true }, // 余白で一緒に読むくま(章ごとに一度)
  // 予告と当たり(色の語彙: 金=レア / 虹=激レア)
  'gold-star': { asset: 'fx-star', size: 36, aspect: 1.22, zone: 'high' },
  'gold-flower': { sprite: 'flower', color: '#ffd23f', size: 40 },
  'gold-sparkle': { asset: 'fx-sparkles', size: 48, aspect: 0.96, zone: 'high' },
  ears: { asset: 'nyo', size: 96, aspect: 0.54, edge: true }, // 画面の下の縁から、くまの耳だけ
  rainbow: { rainbow: true, size: 76, zone: 'high' },
};
// zone ごとの、帯の中の高さ(帯の上端 0 〜 下端 1)
const ZONES = { low: [0.62, 0.96], high: [0.04, 0.4], any: [0.12, 0.88] };
// 画面の下の縁から見せる割合(残りは画面の外)
const EDGE_SHOW = 0.42;
const GROW = [
  ['leaf', 3],
  ['sprig', 2],
  ['bloom', 3],
  ['flower', 2],
  ['tulip', 2],
  ['orange', 2],
  ['blossom', 1],
  ['petals', 1],
  ['sparkle', 3],
];

const CSS = `
canvas.paint, canvas.turn { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }
/* 縁の光: 画面の四隅と上下から水彩の色がにじむ。2枚を14秒かけて入れ替えて、色がゆっくり移ろう。
   本文の枠(--tx --ty --tw --th)はマスクでくり抜き、文字の上には決して乗せない。
   濃さが変わるのはめくった瞬間だけで、4秒かけてゆっくり(目を奪わない) */
.glow {
  position: fixed; inset: 0; pointer-events: none; opacity: 0; transition: opacity 4s ease-out;
  -webkit-mask: linear-gradient(#000 0 0), linear-gradient(#000 0 0) var(--tx, 0) var(--ty, 0) / var(--tw, 0) var(--th, 0) no-repeat;
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0), linear-gradient(#000 0 0) var(--tx, 0) var(--ty, 0) / var(--tw, 0) var(--th, 0) no-repeat;
  mask-composite: exclude;
}
.glow.gone { transition: opacity .4s ease-in; }
.glow i { position: absolute; inset: 0; }
.glow .a {
  background:
    radial-gradient(55% 45% at 0% 100%, rgba(247, 161, 180, .9), transparent 70%),
    radial-gradient(55% 45% at 100% 100%, rgba(148, 198, 240, .9), transparent 70%),
    radial-gradient(70% 30% at 50% 0%, rgba(255, 226, 122, .8), transparent 70%);
}
.glow .b {
  background:
    radial-gradient(55% 45% at 0% 0%, rgba(143, 220, 192, .9), transparent 70%),
    radial-gradient(55% 45% at 100% 0%, rgba(196, 178, 251, .9), transparent 70%),
    radial-gradient(70% 30% at 50% 100%, rgba(255, 201, 138, .85), transparent 70%);
  animation: swap 14s ease-in-out infinite alternate;
}
@keyframes swap { from { opacity: 0 } to { opacity: 1 } }
/* 余白の飾り: めくった瞬間に、ふわっと現れて、あとは動かない */
.item { position: fixed; pointer-events: none; height: auto; transform: rotate(var(--r)); animation: appear 1.4s ease-out both; }
.item.edge { animation-name: appear-edge; }
@keyframes appear { from { opacity: 0; transform: translateY(4px) scale(.7) rotate(var(--r)) } to { opacity: .95; transform: rotate(var(--r)) } }
@keyframes appear-edge { from { opacity: 0; transform: translateY(40%) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) {
  .glow { transition: none; }
  .glow .b { animation: none; opacity: .5; }
  .item { animation-duration: .001s; }
}
`;

/** 虹のかけら(小さな水彩の弧を4本)を canvas に描く。 */
function rainbowShard(width) {
  const k = 2;
  const w = width;
  const h = Math.round(width * 0.55);
  const cv = document.createElement('canvas');
  cv.width = w * k;
  cv.height = h * k;
  const g = cv.getContext('2d');
  g.scale(k, k);
  g.lineCap = 'round';
  g.lineWidth = Math.max(3, w * 0.08);
  g.globalAlpha = 0.85;
  ['#f7a1b4', '#ffe27a', '#8fdcc0', '#94c6f0'].forEach((c, i) => {
    g.strokeStyle = c;
    g.beginPath();
    g.arc(w / 2, h * 1.05, w * 0.45 - i * g.lineWidth * 1.05, Math.PI * 1.08, Math.PI * 1.92);
    g.stroke();
  });
  return cv;
}

/**
 * @param {*} Paint paint.js の Paint
 * @param {{ bearURL?: Function, staticSprite?: Function, fx?: object, createTurnFx?: Function }} o
 *   bearURL はくまの絵の URL、staticSprite は paint.js の静かな形、fx は config の READING_FX、
 *   createTurnFx は turnfx.js のめくりの演出(無ければ、めくりの演出は出さない)
 */
export function createMargin(Paint, { bearURL, staticSprite, fx = {}, createTurnFx } = {}) {
  const host = document.createElement('div');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483645; pointer-events: none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style><div class="glow"><i class="a"></i><i class="b"></i></div><canvas class="turn"></canvas><canvas class="paint"></canvas>`;
  document.documentElement.append(host);
  const paint = new Paint(root.querySelector('canvas.paint'), 320);
  paint.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const glowEl = root.querySelector('.glow');
  const maxAlpha = fx.glow?.maxAlpha ?? 0.5;
  const maxItems = fx.garden?.maxItems ?? 36;
  const items = []; // { el, x, y, w, h }

  let text = null; // 本文の枠 { left, right, top, bottom, vertical }
  const turnFx = createTurnFx?.(root.querySelector('canvas.turn'), () => text, { clearOnScroll: false });
  let raf = 0;
  let last = 0;

  // 描くものがある間だけ回す(何も無いときは描画を止めて CPU を使わない)
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    paint.update(dt);
    paint.draw();
    raf = paint.busy ? requestAnimationFrame(loop) : 0;
  }
  function kick() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  /** 本文の枠の外の帯。{ x0, y0, x1, y1, along, side } の配列(太さ MIN_BAND 未満は除く)。 */
  function bands() {
    if (!text) return [];
    const W = innerWidth;
    const H = innerHeight;
    const out = [];
    const add = (x0, y0, x1, y1, along, side) => {
      if (x1 - x0 >= MIN_BAND && y1 - y0 >= MIN_BAND) out.push({ x0, y0, x1, y1, along, side });
    };
    add(0, 0, W, text.top - PAD, 'x', 'top');
    add(0, text.bottom + PAD, W, H, 'x', 'bottom');
    add(0, 0, text.left - PAD, H, 'y', 'left');
    add(text.right + PAD, 0, W, H, 'y', 'right');
    return out;
  }

  /** 描く場所を1つ。余白の帯から面積に比例して選び、帯が無ければ画面の端に寄せる。 */
  function spot() {
    const list = bands();
    if (list.length === 0) {
      const W = innerWidth;
      const H = innerHeight;
      const edge = Math.floor(Math.random() * 4);
      const r = Math.random();
      if (edge === 0) return { x: W * r, y: 14, along: 'x', band: null };
      if (edge === 1) return { x: W * r, y: H - 14, along: 'x', band: null };
      if (edge === 2) return { x: 14, y: H * r, along: 'y', band: null };
      return { x: W - 14, y: H * r, along: 'y', band: null };
    }
    const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
    let pickAt = Math.random() * list.reduce((sum, b) => sum + area(b), 0);
    let band = list[0];
    for (const b of list) {
      pickAt -= area(b);
      if (pickAt < 0) {
        band = b;
        break;
      }
    }
    const x = band.x0 + (band.x1 - band.x0) * (0.12 + Math.random() * 0.76);
    const y = band.y0 + (band.y1 - band.y0) * (0.2 + Math.random() * 0.6);
    return { x, y, along: band.along, band };
  }

  /** 矩形(中心 x,y・幅 w・高さ h)が本文の枠(少し広げた範囲)にかかるか。 */
  function overText(x, y, w = 0, h = w) {
    if (!text) return false;
    return x + w / 2 > text.left - PAD && x - w / 2 < text.right + PAD && y + h / 2 > text.top - PAD && y - h / 2 < text.bottom + PAD;
  }

  /** 点を含む余白の帯(無ければ null)。 */
  function bandAt(x, y) {
    return bands().find((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) ?? null;
  }

  /**
   * 飾りの置き場所(中心): 本文にかからず、ほかの飾りと重ならない所。
   * zone は帯の中の高さの好み、low は帯のいちばん下(くま)、edge は画面の下の縁
   * (見えている部分 = 高さの EDGE_SHOW だけで判定する)。半分ほどは、もう置いてある飾りの隣に寄せる。
   * near(矩形)を渡すと、まずその近く(左か上、少し重ねて)を探す — 予告の印を、よみりんの話のオブジェクトに添える。
   */
  function placeFor(w, h, { low = false, edge = false, zone = 'any' } = {}, near = null) {
    const W = innerWidth;
    const H = innerHeight;
    const vh = edge ? h * EDGE_SHOW : h;
    const [z0, z1] = ZONES[zone] ?? ZONES.any;
    for (let i = 0; i < 24; i += 1) {
      let x;
      let y;
      let band;
      if (near) {
        // 話のオブジェクトの左か上に、少し重ねて(画面の中で、本文にかからない所)。埋まっていたら少しずつ離れる。
        // 見つからなければ置かない(離れた所に置くと、話の印に見えない)
        const away = (i / 24) * 1.2;
        const onTop = !edge && Math.random() < 0.5;
        x = onTop ? near.left + near.width * (0.1 + Math.random() * 0.7) : near.left - w * (0.05 + Math.random() * 0.45 + away);
        y = edge ? H - vh / 2 : onTop ? near.top - h * (0.05 + Math.random() * 0.4 + away) : near.top + near.height * (0.1 + Math.random() * 0.6);
        if (x - w / 2 < 0 || x + w / 2 > W || y - vh / 2 < 0) continue;
        if (overText(x, y, w, vh)) continue;
        if (items.some((it) => Math.abs(it.x - x) < (it.w + w) * 0.45 && Math.abs(it.y - y) < (it.h + vh) * 0.45)) continue;
        return { x, y, vh };
      }
      if (!edge && !low && items.length > 0 && i < 12 && Math.random() < 0.5) {
        // 隣に寄せる: 置いてある飾りから、少し離れた所
        const it = items[Math.floor(Math.random() * items.length)];
        const a = Math.random() * Math.PI * 2;
        const d = (it.w + w) * (0.55 + Math.random() * 0.35);
        x = it.x + Math.cos(a) * d;
        y = it.y + Math.sin(a) * d;
        band = bandAt(x, y);
        if (!band) continue;
      } else {
        const s = spot();
        band = s.band;
        x = s.x;
        y = band ? band.y0 + (band.y1 - band.y0) * (z0 + Math.random() * (z1 - z0)) : s.y;
      }
      if (band) x = Math.min(Math.max(x, band.x0 + w / 2 + 2), band.x1 - w / 2 - 2);
      if (edge) y = H - vh / 2;
      else if (band) y = low ? band.y1 - h / 2 - 6 : Math.min(Math.max(y, band.y0 + h / 2 + 2), band.y1 - h / 2 - 2);
      if (overText(x, y, w, vh)) continue;
      if (items.some((it) => Math.abs(it.x - x) < (it.w + w) * 0.45 && Math.abs(it.y - y) < (it.h + vh) * 0.45)) continue;
      return { x, y, vh };
    }
    return null;
  }

  /** 飾りを一つ置く(ふわっと現れて、あとは静止)。near(矩形)があれば、その近くに。置けなければ false。 */
  function place(kind, intensity = 1, near = null) {
    const spec = ITEMS[kind];
    if (!spec || items.length >= maxItems) return false;
    const k = 0.7 + 0.3 * Math.min(1, Math.max(0, intensity));
    const w = Math.round(spec.size * k);
    let el;
    let h;
    if (spec.asset) {
      if (!bearURL) return false;
      el = document.createElement('img');
      el.src = bearURL(spec.asset);
      el.alt = '';
      h = Math.round(w * (spec.aspect ?? 1));
    } else if (spec.rainbow) {
      el = rainbowShard(w);
      h = Math.round(w * 0.55);
    } else {
      if (!staticSprite) return false;
      const color = spec.color ?? PASTEL[Math.floor(Math.random() * PASTEL.length)];
      const { cv } = staticSprite(spec.sprite, color);
      el = document.createElement('canvas');
      el.width = cv.width;
      el.height = cv.height;
      el.getContext('2d').drawImage(cv, 0, 0);
      h = w;
    }
    const at = placeFor(w, h, spec, near);
    if (!at) return false;
    const r = spec.edge || spec.low ? 0 : Math.round(Math.random() * 50 - 25);
    el.className = spec.edge ? 'item edge' : 'item';
    el.style.cssText = `width:${w}px; left:${at.x - w / 2}px; ${spec.edge ? `bottom:${-Math.round(h * (1 - EDGE_SHOW))}px` : `top:${at.y - h / 2}px`}; --r:${r}deg`;
    root.append(el);
    items.push({ el, x: at.x, y: at.y, w, h: at.vh });
    return true;
  }

  return {
    /** 本文の枠(見えている段落の外接矩形)。null なら本文の位置が分からない=端だけに描く。 */
    setText(rect) {
      text = rect;
      paint.avoid = rect
        ? { x: rect.left - PAD / 2, y: rect.top - PAD / 2, w: rect.right - rect.left + PAD, h: rect.bottom - rect.top + PAD }
        : null;
      // 縁の光のくり抜き(本文の枠を少し広げて)
      const s = glowEl.style;
      if (rect) {
        s.setProperty('--tx', `${rect.left - PAD}px`);
        s.setProperty('--ty', `${rect.top - PAD}px`);
        s.setProperty('--tw', `${rect.right - rect.left + PAD * 2}px`);
        s.setProperty('--th', `${rect.bottom - rect.top + PAD * 2}px`);
      } else {
        for (const k of ['--tx', '--ty', '--tw', '--th']) s.setProperty(k, '0px');
      }
      // 本文の枠が動いて、飾りが文字にかかるようになったら外す
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const it = items[i];
        if (overText(it.x, it.y, it.w, it.h)) {
          it.el.remove();
          items.splice(i, 1);
        }
      }
      turnFx?.check(); // めくりの演出も、新しいページの本文にかかるなら消す
    },

    /**
     * Meso・縁の光: 世界がどれだけ育ったか(level 0〜1)と θ/8(intensity)で濃さを決める。
     * めくった瞬間にだけ呼ぶ(4秒かけてゆっくり変わる)。手が止まっても薄くしない。
     */
    world(level, intensity = 1) {
      glowEl.classList.remove('gone');
      glowEl.style.opacity = String(Math.round(maxAlpha * Math.max(0, intensity) * Math.min(1, Math.max(0, level)) * 100) / 100);
    },

    /** Meso・余白の飾り: めくったときに増やす(芽・葉・花・銀の星から乱数で)。θ が高いと二つ三つ増える。 */
    grow(intensity = 1) {
      const total = GROW.reduce((sum, [, w]) => sum + w, 0);
      const n = 1 + (Math.random() < intensity * 0.8 ? 1 : 0) + (Math.random() < intensity * 0.4 ? 1 : 0);
      let placed = false;
      for (let i = 0; i < n; i += 1) {
        let r = Math.random() * total;
        for (const [kind, w] of GROW) {
          r -= w;
          if (r < 0) {
            placed = place(kind, intensity) || placed;
            break;
          }
        }
      }
      return placed;
    },

    /** 決まった飾りを一つ置く(bear・gold-star・ears・rainbow など。ITEMS の名前)。near(矩形)を渡すと、その近くに。 */
    add(kind, intensity = 1, { near = null } = {}) {
      return place(kind, intensity, near);
    },

    get itemCount() {
      return items.length;
    },

    /**
     * Macro の入り口: 余白の飾りと縁の光が、画面の真ん中へ吸い込まれて消える(約0.45秒)。
     * 吸い込み終わったら解決する(そこからフィーバーが広がる)。
     */
    collapse() {
      turnFx?.clear();
      const list = items.splice(0);
      glowEl.classList.add('gone');
      glowEl.style.opacity = '0';
      if (paint.reduced || list.length === 0) {
        for (const it of list) it.el.remove();
        return Promise.resolve();
      }
      const cx = innerWidth / 2;
      const cy = innerHeight / 2;
      for (const it of list) {
        it.el.style.animation = 'none';
        it.el.animate(
          [
            { transform: 'none', opacity: 1 },
            { transform: `translate(${cx - it.x}px, ${cy - it.y}px) scale(.15) rotate(200deg)`, opacity: 0.2 },
          ],
          { duration: 380, delay: Math.random() * 80, easing: 'cubic-bezier(.6, 0, .9, .5)', fill: 'forwards' },
        ).onfinish = () => it.el.remove();
      }
      return new Promise((r) => setTimeout(r, 460));
    },

    /**
     * Micro・めくりの演出(turnfx.js の planTurn の options: theta・mood・size・mode・timing・seed)。
     * mode 'edge' は本文の紙面+16px を描かない。'full' は紙面の内側からも広がり、本文の上は 0.36 秒まで
     * (早く拾えためくりだけ。timing 'late' なら 'edge' になる)。本文の位置が分からなければ出さない。
     * 出したら plan(実際の mode が入る)、出さなければ null。
     */
    turn(options) {
      if (!text || !turnFx) return null;
      return turnFx.play(options);
    },

    /** 地のきらきら: 余白の一点で小さな星がふっと瞬く(読んでいる最中に動くので、READING_FX.still では使わない)。 */
    ambient(stars = 'silver', count = 3) {
      const s = spot();
      paint.motion = 1;
      paint.twinkle(s.x, s.y, { count, stars, radius: 14 });
      kick();
    },

    /**
     * ヒント(θの枠)。めくって段落が見えた瞬間に出る。
     * still(読んでいる瞬間には動かさない)なら、余白の飾りとして静かに置く:
     *   normal: 花が一輪 / rare: 金の花が3つと金のきらきら / epic: 虹のかけらと金のきらきら(くまの駆け抜けは stage.js)
     * still でなければ、前の版の舞う演出(花びらが流れる・金の花・虹の帯)。near(矩形)は still の飾りを置く近く。
     */
    hint(tier = 'normal', intensity = 1, { still = false, near = null } = {}) {
      if (still) {
        if (tier === 'normal') place('bloom', intensity, near);
        else if (tier === 'rare') {
          for (let i = 0; i < 3; i += 1) place('gold-flower', intensity, near);
          place('gold-sparkle', intensity, near);
        } else {
          place('rainbow', intensity, near);
          place('gold-sparkle', intensity, near);
        }
        return;
      }
      const s = spot();
      paint.motion = Math.min(1, Math.max(0.3, intensity));
      if (tier === 'normal') {
        paint.bloom(s.x, s.y, { count: 1, radius: 0, size: 0.42 });
        paint.drift(s.x, s.y, { count: 5, along: s.along });
        paint.twinkle(s.x, s.y, { count: 2, stars: 'silver', radius: 20 });
      } else if (tier === 'rare') {
        for (let i = 0; i < 3; i += 1) {
          const k = (i - 1) * 46;
          const x = s.along === 'x' ? s.x + k : s.x;
          const y = s.along === 'x' ? s.y : s.y + k;
          paint.bloom(x, y, { count: 1, radius: 0, size: 0.5, colors: GOLD });
        }
        paint.twinkle(s.x, s.y, { count: 6, stars: 'gold', radius: 50 });
        paint.drift(s.x, s.y, { count: 8, along: s.along });
      } else {
        paint.twinkle(s.x, s.y, { count: 5, stars: 'rainbow', radius: 40 });
        setTimeout(() => {
          paint.twinkle(s.x, s.y, { count: 5, stars: 'rainbow', radius: 40 });
          kick();
        }, 450);
        setTimeout(() => {
          const b = s.band;
          if (b && s.along === 'x') {
            const y = (b.y0 + b.y1) / 2;
            paint.stripe({ x0: b.x0 + 18, y0: y, x1: b.x1 - 18, y1: y, width: Math.min(22, b.y1 - b.y0 - 6) });
          } else if (b) {
            const x = (b.x0 + b.x1) / 2;
            paint.stripe({ x0: x, y0: b.y0 + 18, x1: x, y1: b.y1 - 18, width: Math.min(22, b.x1 - b.x0 - 6) });
          }
          paint.drift(s.x, s.y, { count: 10, along: s.along });
          paint.twinkle(s.x, s.y, { count: 6, stars: 'rainbow', radius: 60 });
          kick();
        }, 900);
      }
      kick();
    },

    destroy() {
      cancelAnimationFrame(raf);
      turnFx?.destroy();
      host.remove();
    },
  };
}
