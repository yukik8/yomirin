// Micro・めくりの演出(#42。型と描画は #43 の試写室で比べたもの)。margin.js の層に描き、試写室(tools/preview/turn/)でも使う。
// 本文上は早い検知だけ・360msまで。粒は720msまで。以降は余白の残光だけ。
export const BODY_MS = 360;
export const PARTICLE_MS = 720;
export const END_MS = 1800;
export const GAP_MS = 1000;
export const MOODS = {
  calm: { label: '穏やか', motion: 'wind', note: '大きな葉と横風が、ゆったり通り抜ける。', colors: ['#579b7d', '#b4cf9b', '#dbe4c8'] },
  warm: { label: 'あたたかい', motion: 'ripple', note: 'あたたかな輪が、ふわっと広がる。', colors: ['#e8a45f', '#df8f77', '#f2c8a5'] },
  sad: { label: 'しんみり', motion: 'rain', note: '長い雨の筋が、斜めに流れ落ちる。', colors: ['#5b95c5', '#8597bd', '#abc9df'] },
  tense: { label: '緊迫', motion: 'slash', note: '細く鋭い斜線が、一気に駆け抜ける。', colors: ['#a85b4c', '#58637a', '#d0a18b'] },
  eerie: { label: '不思議な気配', motion: 'vortex', note: 'にじんだ輪と粒が、渦を巻いて広がる。', colors: ['#487f84', '#8664a6', '#9db5b3'] },
  joyful: { label: 'うれしい', motion: 'burst', note: '花びらが扇状に弾け、くるっと跳ねる。', colors: ['#e884a6', '#65b7a1', '#a0aee0'] },
  wonder: { label: '驚き・発見', motion: 'rise', note: '光の柱と羽根が、下から空へ昇る。', colors: ['#70b7df', '#a58bd1', '#c3dcec'] },
};
// 雰囲気が分からないとき(#42 の /mood がまだ無い・本文を送らない・サーバに届かない)の、ふだんの型。
// 色はいつもの水彩(margin.js の PASTEL)から3色。金・虹は使わない
export const PLAIN = { label: 'ふだん', motion: 'ripple', note: '水彩の輪が、本文のまわりにふわっと広がる。', colors: ['#f7a1b4', '#8fdcc0', '#94c6f0'] };
export const turnType = (mood) => MOODS[mood] ?? PLAIN;
export const MOTIFS = { rain: '雨粒', snow: '雪', sea: '泡', forest: '葉', night: '小さな光', city: '紙片', fire: '火の粉', flower: '花びら', sky: '羽根', none: '水彩の粒' };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const PAD = 16; // 余白案で描かない、本文の紙面の周りの幅
const finite = (n, fallback) => Number.isFinite(n) ? n : fallback;
const ease = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;

/**
 * 描かない枠(本文の紙面+PAD)を、本文の枠 rect が入るまで広げる(狭めない)。cut が null なら rect から作る。
 * めくった直後は前のページの枠で始めているので、新しいページの本文が見えたら広げる。
 */
export function widenCut(cut, rect, width, height) {
  const next = { left: clamp(rect.left - PAD, 0, width), right: clamp(rect.right + PAD, 0, width), top: clamp(rect.top - PAD, 0, height), bottom: clamp(rect.bottom + PAD, 0, height) };
  if (!cut) return next;
  return { left: Math.min(cut.left, next.left), right: Math.max(cut.right, next.right), top: Math.min(cut.top, next.top), bottom: Math.max(cut.bottom, next.bottom) };
}

export function mixPalette(from, to, amount = .55) {
  return to.map((color, i) => {
    const a = from[i] ?? color;
    const rgb = [1, 3, 5].map((j) => Math.round(parseInt(a.slice(j, j + 2), 16) * (1 - amount) + parseInt(color.slice(j, j + 2), 16) * amount));
    return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  });
}

export function planTurn(options = {}) {
  const width = Math.max(1, finite(options.width, 1200));
  const height = Math.max(1, finite(options.height, 800));
  const intensity = clamp(finite(options.theta, 8) / 8, 0, 1);
  const mood = Object.hasOwn(MOODS, options.mood) ? options.mood : 'plain';
  const motif = Object.hasOwn(MOTIFS, options.motif) ? options.motif : 'none';
  const size = Object.hasOwn({ small: 1, medium: 1, large: 1 }, options.size) ? options.size : 'large';
  const weight = { small: .45, medium: .72, large: 1 }[size];
  const reduced = options.reduced === true;
  const mode = options.mode === 'full' && options.timing !== 'late' && !reduced ? 'full' : 'edge';
  const energy = clamp(finite(options.energy, 1), 0, 2);
  const rect = options.rect ?? { left: width * .3, right: width * .7, top: 60, bottom: height - 60 };
  const cut = widenCut(null, rect, width, height);
  let state = (finite(options.seed, 43) >>> 0) || 43;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const colors = options.colors ?? turnType(mood).colors;
  const particles = [];
  const count = reduced ? 0 : Math.round(112 * intensity * weight * (.75 + energy * .25));
  for (let i = 0; i < count; i += 1) {
    particles.push({ u: random(), v: random(), side: i % 4, size: (5 + random() * 13) * (.5 + intensity * .5) * weight,
      delay: random() * 95, angle: random() * Math.PI * 2, spin: (random() - .5) * 2,
      color: colors[i % colors.length] });
  }
  return { width, height, intensity, mood, motion: turnType(mood).motion, motif, size, weight, mode, reduced, colors, cut, particles, energy };
}

/** 同じ粒でも、場面ごとに出発点・軌道・時間の進み方を変える。 */
export function particleAt(plan, p, elapsed) {
  const age = clamp((elapsed - p.delay) / (PARTICLE_MS - p.delay), 0, 1);
  const active = elapsed >= p.delay && elapsed < PARTICLE_MS && !plan.reduced && plan.intensity > 0;
  const reach = (.3 + .7 * plan.intensity) * plan.weight * (.8 + .2 * plan.energy);
  const W = plan.width, H = plan.height, r = plan.cut;
  const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
  const full = plan.mode === 'full';
  const laneX = p.side % 2 ? r.right + 35 + p.u * 150 : r.left - 35 - p.u * 150;
  let x = 0, y = 0, angle = p.angle, sx = 1, sy = 1;
  switch (plan.motion) {
    case 'wind':
      x = (full ? W * p.u : laneX) + (age * 190 + Math.sin(age * Math.PI) * 65) * reach;
      y = H * p.v + Math.sin(age * Math.PI * 1.4 + p.u * 4) * 65 * reach;
      angle = -.7 + Math.sin(age * Math.PI + p.u * 6) * .7;
      sx = 1.3; sy = .85;
      break;
    case 'ripple': {
      const a = p.u * Math.PI * 2;
      const radius = (25 + 230 * Math.sin(age * Math.PI / 2)) * reach;
      const originX = full ? cx : p.side % 2 ? r.right + 25 : r.left - 25;
      x = originX + Math.cos(a) * radius;
      y = H * (.4 + .25 * p.v) + Math.sin(a) * radius * .8 - age * 45;
      angle = p.angle + age * .5; sx = sy = .7 + Math.sin(age * Math.PI) * .5;
      break;
    }
    case 'rain':
      x = (full ? W * p.u : laneX) - age * 160 * reach;
      y = H * p.v - 100 + age * 450 * reach;
      angle = .35; sx = .28; sy = 1.5 + p.u;
      break;
    case 'slash':
      x = W * (p.u + .25) - ease(age) * 610 * reach;
      y = H * p.v - 80 + ease(age) * 180 * reach;
      angle = 1.22; sx = .18; sy = 3.5 + p.v * 2;
      break;
    case 'vortex': {
      const a = p.angle + age * 2.5;
      const radius = (30 + p.u * 155 + age * 110) * reach;
      const originX = full ? cx : p.side % 2 ? r.right + 70 : r.left - 70;
      x = originX + Math.cos(a) * radius;
      y = H * (.3 + p.v * .45) + Math.sin(a) * radius * .7;
      angle = a + Math.PI / 2; sx = .7; sy = 1.4;
      break;
    }
    case 'burst': {
      const originX = full ? cx : p.side % 2 ? r.right : r.left;
      const a = -Math.PI + p.u * Math.PI;
      x = originX + Math.cos(a) * (50 + p.v * 280) * ease(age) * reach;
      y = H * .82 + Math.sin(a) * (110 + p.v * 260) * Math.sin(age * Math.PI * .75) * reach + age * age * 100;
      angle = p.angle + age * p.spin * 7;
      break;
    }
    case 'rise':
      x = (full ? W * p.u : laneX) + Math.sin(age * 4 + p.v * 6) * 25 * reach;
      y = H * (.65 + p.v * .4) - age * (350 + p.u * 200) * reach;
      angle = Math.sin(age * 3 + p.v * 4) * .4;
      sx = .65; sy = 1.3;
      break;
  }
  const fade = plan.motion === 'slash' ? Math.sin(Math.PI * Math.sqrt(age)) : Math.sin(Math.PI * age);
  return { active, x, y, angle, sx, sy, alpha: active ? fade * .95 : 0 };
}

export function frameAt(plan, elapsed) {
  const t = Math.max(0, elapsed);
  const active = plan.intensity > 0 && t < END_MS;
  return { active, body: active && !plan.reduced && plan.mode === 'full' && t < BODY_MS,
    particles: active && !plan.reduced && t < PARTICLE_MS,
    bodyAlpha: active && t < BODY_MS && plan.mode === 'full' && !plan.reduced ? Math.sin(Math.PI * clamp(t / BODY_MS, 0, 1)) * .3 * plan.intensity * plan.weight : 0,
    haloAlpha: active ? (plan.reduced ? .12 : .24 * (1 - t / END_MS)) * plan.intensity * plan.weight : 0 };
}

// 手描きの粒は色・形ごとに一度だけ焼く。毎フレームは画像を移動・回転するだけ。
const sprites = new Map();
function sprite(motif, color) {
  const key = motif + color;
  if (sprites.has(key)) return sprites.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 80;
  const g = canvas.getContext('2d');
  g.translate(40, 40); g.scale(2, 2);
  g.fillStyle = color; g.strokeStyle = color; g.lineWidth = 1.2; g.lineCap = 'round';
  g.beginPath();
  if (motif === 'rain') {
    g.moveTo(0, -15); g.quadraticCurveTo(3, -3, 3, 6); g.quadraticCurveTo(0, 12, -3, 6); g.quadraticCurveTo(-3, -3, 0, -15);
  } else if (motif === 'fire') {
    g.moveTo(0, -13); g.bezierCurveTo(11, -2, 10, 10, 0, 11); g.bezierCurveTo(-10, 10, -8, -2, 0, -13);
  } else if (motif === 'forest') {
    g.moveTo(0, -13); g.bezierCurveTo(13, -7, 11, 7, 0, 13); g.bezierCurveTo(-10, 7, -11, -8, 0, -13);
  } else if (motif === 'flower') {
    g.moveTo(-2, -12); g.bezierCurveTo(5, -19, 15, -9, 10, 0); g.bezierCurveTo(7, 9, -3, 15, -7, 9); g.bezierCurveTo(-12, 2, -7, -8, -2, -12);
  } else if (motif === 'sky') {
    g.moveTo(-3, 15); g.bezierCurveTo(-9, 2, -6, -11, 5, -16); g.bezierCurveTo(14, -6, 9, 7, -3, 15);
  } else if (motif === 'night') {
    g.moveTo(0, -12); g.quadraticCurveTo(2, -2, 10, 0); g.quadraticCurveTo(2, 2, 0, 12); g.quadraticCurveTo(-2, 2, -10, 0); g.quadraticCurveTo(-2, -2, 0, -12);
  } else if (motif === 'city') { g.rect(-8, -11, 16, 22); }
  else { g.arc(0, 0, motif === 'sea' ? 9 : 7, 0, Math.PI * 2); }
  if (motif === 'sea') { g.globalAlpha = .85; g.stroke(); }
  else {
    g.save(); g.clip(); g.fill();
    const wash = g.createRadialGradient(-4, -5, 0, 0, 0, 17);
    wash.addColorStop(0, '#fffdf366'); wash.addColorStop(1, '#fffdf300');
    g.fillStyle = wash; g.fillRect(-20, -20, 40, 40);
    // 固定した小さなムラ。ランダムを描画ループに持ち込まない。
    g.fillStyle = '#fffdf3'; g.globalAlpha = .14;
    for (let i = 0; i < 34; i += 1) g.fillRect((i * 17 % 29) - 14, (i * 11 % 31) - 15, .7, .7);
    g.restore(); g.globalAlpha = .6; g.stroke();
  }
  if (motif === 'forest' || motif === 'sky') {
    g.globalAlpha = .5; g.beginPath(); g.moveTo(3, -12); g.lineTo(-3, 14);
    for (let i = 0; i < 4; i += 1) { const y = -7 + i * 5; g.moveTo(1, y + 4); g.lineTo(motif === 'sky' ? 9 : 7, y - 2); }
    g.stroke();
  }
  if (motif === 'snow') {
    g.globalAlpha = .7;
    for (let i = 0; i < 3; i += 1) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(0, -12); g.lineTo(0, 12); g.stroke(); }
  }
  if (sprites.size >= 96) sprites.delete(sprites.keys().next().value);
  sprites.set(key, canvas);
  return canvas;
}

// 切り抜きは clip(本文の枠に合わせて広げたもの)。粒の軌道と構図は始めの cut のまま(途中で飛ばない)
function outside(g, plan) {
  const r = plan.clip ?? plan.cut;
  g.beginPath(); g.rect(0, 0, plan.width, plan.height); g.rect(r.left, r.top, r.right - r.left, r.bottom - r.top); g.clip('evenodd');
}

function inside(g, plan) {
  const r = plan.clip ?? plan.cut;
  g.beginPath(); g.rect(r.left, r.top, r.right - r.left, r.bottom - r.top); g.clip();
}

// 粒の形だけでなく、画面を占める筆あとも場面ごとに変える。
function field(g, plan, elapsed) {
  const W = plan.width, H = plan.height, r = plan.cut;
  const t = clamp(elapsed / PARTICLE_MS, 0, 1), k = (.35 + .65 * plan.intensity) * plan.weight;
  const center = (r.left + r.right) / 2;
  const origin = (i) => plan.mode === 'full' ? center : i % 2 ? r.right + 45 : r.left - 45;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const count = { wind: 4, ripple: 6, rain: 38, slash: 14, vortex: 4, burst: 9, rise: 10 }[plan.motion];
  for (let i = 0; i < count; i += 1) {
    g.fillStyle = g.strokeStyle = plan.colors[i % 3];
    g.beginPath();
    switch (plan.motion) {
      case 'wind': {
        const y = H * (.15 + i * .22), offset = (t * 140 - 70) * k;
        g.moveTo(-100 + offset, y + 45); g.bezierCurveTo(W * .25, y - 110 * k, W * .65, y + 135 * k, W + 100 + offset, y - 55);
        g.lineWidth = (7 + i * 3) * k; g.stroke();
        break;
      }
      case 'ripple': {
        const radius = (35 + ease(t) * 260 + (i % 3) * 58) * k;
        g.ellipse(origin(i), H * .55, radius, radius * .8, 0, .1, Math.PI * 1.92);
        g.lineWidth = (4 + i % 3 * 2) * k; g.stroke();
        break;
      }
      case 'rain': {
        const x = ((i * 131) % (W + 120)) - t * 155 * k;
        const y = ((i * 211) % (H + 160)) - 100 + t * 220 * k;
        g.moveTo(x, y); g.lineTo(x - (18 + i % 4 * 8) * k, y + (60 + i % 5 * 20) * k);
        g.lineWidth = (1 + i % 3) * k; g.stroke();
        break;
      }
      case 'slash': {
        const x = W * (1.1 - ease(t) * .55) + (i % 4) * 90;
        const y = H * (i / count) - 70 + t * 130;
        const length = (190 + (i % 5) * 75) * k;
        g.moveTo(x, y); g.lineTo(x - length, y + length * .32); g.lineTo(x - length * .35, y + length * .09); g.closePath(); g.fill();
        break;
      }
      case 'vortex': {
        const cx = origin(i), cy = H * (.33 + (i % 2) * .3);
        for (let j = 0; j <= 60; j += 1) {
          const angle = j / 60 * Math.PI * 3.1 + t * 1.8 + i;
          const radius = (j * 3.5 + t * 70) * k;
          const x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius * .7;
          if (!j) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.lineWidth = (3 + i * 2) * k; g.stroke();
        break;
      }
      case 'burst': {
        const x = origin(i), spread = ((i / (count - 1)) - .5) * 650 * k;
        const lift = Math.sin(t * Math.PI * .7) * 430 * k;
        g.moveTo(x, H + 20); g.bezierCurveTo(x + spread * .2, H - lift, x + spread * .7, H - lift * 1.5, x + spread, H - lift);
        g.lineWidth = (3 + i % 3 * 3) * k; g.stroke();
        break;
      }
      case 'rise': {
        const x = plan.mode === 'full' ? W * (.15 + i * .075) : origin(i) + ((i % 5) - 2) * 40;
        const top = H * (.3 + i % 3 * .12) - ease(t) * 260 * k;
        const width = (12 + i % 3 * 16) * k;
        const light = g.createLinearGradient(0, H, 0, top);
        light.addColorStop(0, plan.colors[i % 3] + '00'); light.addColorStop(.55, plan.colors[i % 3]); light.addColorStop(1, plan.colors[i % 3] + '00');
        g.fillStyle = light; g.moveTo(x - width, H); g.lineTo(x - width * .2, top); g.quadraticCurveTo(x, top - 20, x + width * .2, top); g.lineTo(x + width, H); g.closePath(); g.fill();
        break;
      }
    }
  }
}

function drawParticles(g, plan, elapsed, opacity) {
  for (const p of plan.particles) {
    const at = particleAt(plan, p, elapsed);
    if (!at.active) continue;
    g.save(); g.translate(at.x, at.y); g.rotate(at.angle);
    g.globalAlpha = at.alpha * opacity;
    const s = p.size * (plan.motif === 'fire' ? .65 : 1);
    g.scale(at.sx, at.sy);
    g.drawImage(sprite(plan.motif, p.color), -s, -s, s * 2, s * 2); g.restore();
  }
}

export function drawTurn(g, plan, elapsed) {
  elapsed = Math.max(0, elapsed);
  const frame = frameAt(plan, elapsed);
  g.clearRect(0, 0, plan.width, plan.height);
  if (!frame.active) return frame;
  const r = plan.cut;
  g.save(); outside(g, plan);
  const points = [[r.left, plan.height * .38], [r.right, plan.height * .65], [plan.width * .5, r.top], [plan.width * .55, r.bottom]];
  for (let i = 0; i < points.length; i += 1) {
    const [x, y] = points[i];
    const radius = Math.min(plan.width, plan.height) * (.22 + plan.weight * .2) * (.5 + plan.intensity * .5);
    const bloom = g.createRadialGradient(x, y, 0, x, y, radius);
    bloom.addColorStop(0, plan.colors[i % 3]); bloom.addColorStop(.4, plan.colors[(i + 1) % 3] + 'b0'); bloom.addColorStop(1, plan.colors[i % 3] + '00');
    g.globalAlpha = frame.haloAlpha; g.fillStyle = bloom; g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  g.restore();
  if (frame.particles) {
    g.save(); outside(g, plan);
    g.globalAlpha = Math.sin(Math.PI * elapsed / PARTICLE_MS) * .4 * plan.intensity * plan.weight;
    field(g, plan, elapsed); drawParticles(g, plan, elapsed, 1);
    g.restore();
  }
  if (frame.body) {
    g.save(); inside(g, plan);
    g.globalAlpha = frame.bodyAlpha; field(g, plan, elapsed);
    drawParticles(g, plan, elapsed, Math.sin(Math.PI * elapsed / BODY_MS) * .85);
    g.restore();
  }
  return frame;
}

/**
 * canvas に描く。getRect は本文の枠。play は出したら plan、出さなければ null を返す。
 * clearOnScroll: 試写室はページごと動くので、スクロールで消す。本物は本文の枠が変わるたびに check() を呼び、
 * 描かない枠を新しいページの本文まで広げる(widenCut)。
 */
export function createTurnFx(canvas, getRect, { clearOnScroll = true } = {}) {
  const g = canvas.getContext('2d');
  let raf = 0, timer = 0, tail = null, lastAt = -Infinity, current = null, destroyed = false;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  function clear() {
    cancelAnimationFrame(raf); clearTimeout(timer); tail?.cancel(); tail = null; raf = timer = 0;
    current = null; canvas.style.opacity = ''; canvas.dataset.phase = 'clear';
    g.clearRect(0, 0, canvas.width, canvas.height);
  }
  function prepare(options) {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * ratio); canvas.height = Math.round(innerHeight * ratio);
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    return planTurn({ ...options, width: innerWidth, height: innerHeight, rect: getRect(), reduced: media.matches || options.reduced === true });
  }
  function draw(plan, ms) {
    const f = drawTurn(g, plan, ms);
    canvas.dataset.phase = f.body ? 'body' : f.particles ? 'particles' : f.active ? 'halo' : 'clear';
  }
  function play(options) {
    const now = performance.now();
    if (destroyed || document.hidden || now - lastAt < GAP_MS) return null;
    clear(); const plan = prepare(options);
    if (!plan.intensity) return null;
    lastAt = now; current = plan;
    if (plan.reduced) { draw(plan, 0); timer = setTimeout(clear, END_MS); return plan; }
    const tick = (time) => {
      raf = 0; // 描いている間だけ 0 でない(check が残光を消すかの目印)
      const elapsed = time - now;
      draw(plan, elapsed);
      if (elapsed < PARTICLE_MS) raf = requestAnimationFrame(tick);
      else if (elapsed >= END_MS) clear();
      else {
        // 残光だけになったらCanvasの描画を止め、合成側で静かに薄める。
        tail = canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: END_MS - elapsed, fill: 'forwards' });
        tail.onfinish = clear;
      }
    };
    raf = requestAnimationFrame(tick); return plan;
  }
  function preview(options, elapsed) { if (destroyed) return; clear(); current = prepare(options); draw(current, elapsed); }
  // 本文の枠が変わったら、描かない枠をすぐ広げる(狭めない)。描いている間は次のコマから効く。
  // 描き直さない残光と動きを減らす設定の静止色は、広げた所をその場で消す
  function check() {
    const plan = current, r = getRect();
    if (!plan || !r) return;
    const before = plan.clip ?? plan.cut;
    const clip = widenCut(before, r, plan.width, plan.height);
    if (clip.left === before.left && clip.right === before.right && clip.top === before.top && clip.bottom === before.bottom) return;
    plan.clip = clip;
    if (!raf) g.clearRect(clip.left, clip.top, clip.right - clip.left, clip.bottom - clip.top);
  }
  const visibility = () => { if (document.hidden) clear(); };
  addEventListener('resize', clear); if (clearOnScroll) addEventListener('scroll', clear, { passive: true });
  document.addEventListener('visibilitychange', visibility); media.addEventListener('change', clear);
  return { play, preview, clear, check, get plan() { return current; }, destroy() {
    clear(); destroyed = true; removeEventListener('resize', clear); removeEventListener('scroll', clear);
    document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', clear); sprites.clear();
  } };
}
