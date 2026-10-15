// #43 / #42: めくりの試写用。まだ本番の main.js には接続しない。
// 本文上は早い検知だけ・360msまで。粒は720msまで。以降は余白の残光だけ。
export const BODY_MS = 360;
export const PARTICLE_MS = 720;
export const END_MS = 1800;
export const GAP_MS = 1000;
export const MOODS = {
  calm: { label: '穏やか', colors: ['#94b9a3', '#c8d8b2', '#dce5cf'], speed: .65, drift: -.15 },
  warm: { label: 'あたたかい', colors: ['#dba580', '#e7b5a5', '#edcfb8'], speed: .75, drift: -.25 },
  sad: { label: 'しんみり', colors: ['#81a9cc', '#a6a0c2', '#c0cfdc'], speed: .8, drift: .8 },
  tense: { label: '緊迫', colors: ['#ac6f67', '#7b8799', '#c5a494'], speed: 1.3, drift: -.1 },
  eerie: { label: '不思議な気配', colors: ['#729c9e', '#9c8eaf', '#b6c5bf'], speed: .7, drift: -.1 },
  joyful: { label: 'うれしい', colors: ['#e9a1b2', '#90c5b6', '#aabbe0'], speed: 1.05, drift: -.55 },
  wonder: { label: '驚き・発見', colors: ['#85b9da', '#b2a3d2', '#c1d9e6'], speed: .9, drift: -.9 },
};
export const MOTIFS = { rain: '雨粒', snow: '雪', sea: '泡', forest: '葉', night: '小さな光', city: '紙片', fire: '火の粉', flower: '花びら', sky: '羽根', none: '水彩の粒' };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const finite = (n, fallback) => Number.isFinite(n) ? n : fallback;
const ease = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;

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
  const mood = Object.hasOwn(MOODS, options.mood) ? options.mood : 'calm';
  const motif = Object.hasOwn(MOTIFS, options.motif) ? options.motif : 'none';
  const size = Object.hasOwn({ small: 1, medium: 1, large: 1 }, options.size) ? options.size : 'large';
  const weight = { small: .45, medium: .72, large: 1 }[size];
  const reduced = options.reduced === true;
  const mode = options.mode === 'full' && options.timing !== 'late' && !reduced ? 'full' : 'edge';
  const energy = clamp(finite(options.energy, 1), 0, 2);
  const rect = options.rect ?? { left: width * .3, right: width * .7, top: 60, bottom: height - 60 };
  const cut = { left: clamp(rect.left - 16, 0, width), right: clamp(rect.right + 16, 0, width), top: clamp(rect.top - 16, 0, height), bottom: clamp(rect.bottom + 16, 0, height) };
  let state = (finite(options.seed, 43) >>> 0) || 43;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const colors = options.colors ?? MOODS[mood].colors;
  const particles = [];
  const count = reduced ? 0 : Math.round(112 * intensity * weight * (.75 + energy * .25));
  for (let i = 0; i < count; i += 1) {
    const side = i % 4;
    const x = side < 2 ? (side ? cut.right : cut.left) : cut.left + random() * (cut.right - cut.left);
    const y = side >= 2 ? (side === 2 ? cut.top : cut.bottom) : cut.top + random() * (cut.bottom - cut.top);
    const reach = (.2 + .8 * intensity) * weight;
    const dx = (side < 2 ? (side ? 1 : -1) * (90 + random() * 270) : (random() - .5) * 260) * reach;
    const dy = (side >= 2 ? (side === 2 ? -1 : 1) * (90 + random() * 180) : (random() - .5) * 150) * reach;
    particles.push({ x, y, dx, dy, size: (5 + random() * 13) * (.5 + intensity * .5) * weight,
      delay: random() * 95, angle: random() * Math.PI * 2, spin: (random() - .5) * 2,
      color: colors[i % colors.length] });
  }
  return { width, height, intensity, mood, motif, size, weight, mode, reduced, colors, cut, particles, energy };
}

export function frameAt(plan, elapsed) {
  const t = Math.max(0, elapsed);
  const active = plan.intensity > 0 && t < END_MS;
  return { active, body: active && !plan.reduced && plan.mode === 'full' && t < BODY_MS,
    particles: active && !plan.reduced && t < PARTICLE_MS,
    bodyAlpha: active && t < BODY_MS && plan.mode === 'full' && !plan.reduced ? Math.sin(Math.PI * clamp(t / BODY_MS, 0, 1)) * .16 * plan.intensity : 0,
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
  if (motif === 'rain' || motif === 'fire') {
    g.moveTo(0, -13); g.bezierCurveTo(11, -2, 10, 10, 0, 11); g.bezierCurveTo(-10, 10, -8, -2, 0, -13);
  } else if (motif === 'forest' || motif === 'flower' || motif === 'sky') {
    g.moveTo(0, -13); g.bezierCurveTo(13, -7, 11, 7, 0, 13); g.bezierCurveTo(-10, 7, -11, -8, 0, -13);
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
  if (motif === 'forest' || motif === 'sky') { g.globalAlpha = .5; g.beginPath(); g.moveTo(0, -9); g.lineTo(0, 11); g.stroke(); }
  if (motif === 'snow') {
    g.globalAlpha = .7;
    for (let i = 0; i < 3; i += 1) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(0, -12); g.lineTo(0, 12); g.stroke(); }
  }
  if (sprites.size >= 96) sprites.delete(sprites.keys().next().value);
  sprites.set(key, canvas);
  return canvas;
}

function outside(g, plan) {
  const r = plan.cut;
  g.beginPath(); g.rect(0, 0, plan.width, plan.height); g.rect(r.left, r.top, r.right - r.left, r.bottom - r.top); g.clip('evenodd');
}

export function drawTurn(g, plan, elapsed) {
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
  if (frame.body) {
    g.save();
    const sweep = ease(elapsed / BODY_MS);
    const x = plan.width * (1.15 - sweep * 1.3);
    const wash = g.createLinearGradient(x - plan.width * .55, 0, x + plan.width * .55, 0);
    wash.addColorStop(0, plan.colors[0] + '00'); wash.addColorStop(.4, plan.colors[0]); wash.addColorStop(.7, plan.colors[1]); wash.addColorStop(1, plan.colors[2] + '00');
    g.fillStyle = wash; g.globalAlpha = frame.bodyAlpha; g.fillRect(0, 0, plan.width, plan.height); g.restore();
  }
  if (frame.particles) {
    g.save(); outside(g, plan);
    const style = MOODS[plan.mood];
    for (const p of plan.particles) {
      const age = clamp((elapsed - p.delay) / (PARTICLE_MS - p.delay), 0, 1);
      if (elapsed < p.delay) continue;
      const travel = ease(age) * style.speed;
      const bounce = plan.mood === 'joyful' ? Math.sin(age * Math.PI) * -55 : 0;
      g.save(); g.translate(p.x + p.dx * travel, p.y + p.dy * travel + age * age * 95 * style.drift + bounce);
      g.rotate(p.angle + p.spin * age); g.globalAlpha = Math.sin(Math.PI * age) * .9;
      const s = p.size * (plan.motif === 'fire' ? .65 : 1);
      g.drawImage(sprite(plan.motif, p.color), -s, -s, s * 2, s * 2); g.restore();
    }
    g.restore();
  }
  return frame;
}

export function createTurnFx(canvas, getRect) {
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
    if (destroyed || document.hidden || now - lastAt < GAP_MS) return false;
    clear(); const plan = prepare(options);
    if (!plan.intensity) return false;
    lastAt = now; current = plan;
    if (plan.reduced) { draw(plan, 0); timer = setTimeout(clear, END_MS); return true; }
    const tick = (time) => {
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
    raf = requestAnimationFrame(tick); return true;
  }
  function preview(options, elapsed) { if (destroyed) return; clear(); current = prepare(options); draw(current, elapsed); }
  const visibility = () => { if (document.hidden) clear(); };
  addEventListener('resize', clear); addEventListener('scroll', clear, { passive: true });
  document.addEventListener('visibilitychange', visibility); media.addEventListener('change', clear);
  return { play, preview, clear, get plan() { return current; }, destroy() {
    clear(); destroyed = true; removeEventListener('resize', clear); removeEventListener('scroll', clear);
    document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', clear); sprites.clear();
  } };
}
