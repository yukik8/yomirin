// 目の実験室(#6)の画面。カメラ → Face Landmarker → signals.js → 表示・ラベル・判定・書き出し。
// 映像はこのページの中で数字にするだけで、保存も送信もしない(書き出すのは数字の CSV だけ)。

import { EYES, frameOf, createTracker, FEATURES, vectorOf, fitProgress, gateOf, evaluate, predict, median, speedOf, createFollower } from './signals.js';
import { paginate, pageOfPlace } from './layout.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const LABELS = [
  ['1', 'top', '上の行'],
  ['2', 'bottom', '下の行'],
  ['3', 'left', '左ページ'],
  ['4', 'right', '右ページ'],
  ['5', 'off', '画面の外'],
  ['6', 'sleepy', '眠いふり'],
  ['7', 'yawn', 'あくび'],
];
const NAME = Object.fromEntries(LABELS.map(([, k, n]) => [k, n]));
const READING = new Set(['', 'top', 'bottom', 'left', 'right']);
const SETS = ['eyes', 'base', 'plus'];

const $ = (id) => document.getElementById(id);
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));

// ---- 設定(このブラウザに覚える) ------------------------------------------

const opt = {
  book: 'ginga',
  vertical: false,
  spread: false,
  fs: 20,
  fps: 6,
  res: 640,
  show: true,
  guided: false,
  speed: 0, // なぞる速さ(字/秒)。0 は、ふつうに読んだページから測った速さ
  set: 'eyes',
  flip: false,
  note: '',
  ...JSON.parse(localStorage.getItem('eyes-lab') || '{}'),
};
// 版2: 読み進みの既定を、頭の向きを外した eyes にした(前に覚えた base を引き継がない)
if (opt.v !== 2) Object.assign(opt, { v: 2, set: 'eyes' });
const save = () => localStorage.setItem('eyes-lab', JSON.stringify(opt));

// ---- 状態 -----------------------------------------------------------------

const S = {
  running: false,
  landmarker: null,
  delegate: '',
  stream: null,
  t0: performance.now(),
  due: 0, //       次のコマを処理する時刻
  lastT: null,
  tracker: createTracker(EYES),
  frames: [],
  seconds: [],
  events: [],
  pages: [], //    ページ(見開きなら2ページ)ごとの記録。signals.js の page の形
  log: null, //    いま開いているページの記録
  visited: new Set(),
  label: '',
  changeT: 0, //   ラベルを変えた・めくった時刻(直後の1秒は判定に入れない)
  eps: [], //      ラベルの区間 { label, start, end }
  models: { eyes: null, base: null, plus: null },
  gates: { eyes: null, base: null, plus: null },
  evals: { eyes: null, base: null, plus: null },
  recent: { eyes: [], base: [], plus: [] },
  est: { eyes: null, base: null, plus: null }, // 目だけの推定(直近1秒の中央値)
  both: createFollower(), //  時間と目を合わせた推定(帯に出すのはこれ)
  time: createFollower(), //  時間だけ(比べるため)
  pace: null, //              ふだんの速さ(ページ/秒)
  infer: [],
  procT: [],
  saved: true,
  guide: null,
  now: null,
  f: null,
  res: null,
};
const now = () => performance.now() - S.t0;

let books = [];
let book = null;
let L = null; //       組み方 { perLine, perPage, slots, ... }
let pages = [];
let units = [];
let unit = 0;
let lineEls = []; //   [ページ][行] の要素

// ---- 本と組み方 -------------------------------------------------------------

async function loadBooks() {
  const res = await fetch('./books.json');
  books = (await res.json()).books;
  const sel = $('book');
  sel.innerHTML = books.map((b) => `<option value="${b.id}">${b.title}(${b.author})</option>`).join('');
  if (!books.some((b) => b.id === opt.book)) opt.book = books[0].id;
  sel.value = opt.book;
  book = books.find((b) => b.id === opt.book);
}

function placeOfUnit() {
  const p = units[unit]?.[0];
  const first = p?.find((l) => l.para >= 0) ?? p?.[0];
  return first ? { chapter: first.chapter, para: first.para, at: first.at } : null;
}

function relayout(keep = true) {
  const place = keep ? placeOfUnit() : null;
  const stage = $('stage').getBoundingClientRect();
  const slots = opt.spread ? 2 : 1;
  const gap = 18;
  const pad = 44;
  const fs = opt.fs;
  const lh = Math.round(fs * 1.9);
  const pageH = Math.floor(stage.height - 36);
  const pageW = Math.floor(Math.min((stage.width - 36 - gap * (slots - 1)) / slots, pageH * 0.72));
  const cw = pageW - pad * 2;
  const ch = pageH - pad * 2 - 14;
  const perLine = Math.max(8, Math.floor((opt.vertical ? ch : cw) / fs));
  const perPage = Math.max(4, Math.floor((opt.vertical ? cw : ch) / lh));
  L = { slots, gap, pad, fs, lh, pageW, pageH, perLine, perPage };
  pages = paginate(book, perLine, perPage);
  units = [];
  for (let i = 0; i < pages.length; i += slots) units.push(pages.slice(i, i + slots));
  unit = place ? Math.min(units.length - 1, Math.floor(pageOfPlace(pages, place) / slots)) : 0;
  render();
}

function render() {
  const el = $('book');
  el.className = `${opt.vertical ? 'v' : 'h'}${opt.spread ? ' spread' : ''}${opt.guided ? ' guiding' : ''}`;
  el.style.setProperty('--fs', `${L.fs}px`);
  el.style.setProperty('--lh', `${L.lh}px`);
  el.style.setProperty('--pad', `${L.pad}px`);
  el.style.gap = `${L.gap}px`;
  el.innerHTML = '';
  lineEls = [];
  for (let s = 0; s < L.slots; s += 1) {
    const lines = units[unit]?.[s] ?? [];
    const page = document.createElement('div');
    page.className = 'page';
    page.style.width = `${L.pageW}px`;
    page.style.height = `${L.pageH}px`;
    const body = document.createElement('div');
    body.className = 'body';
    const els = lines.map((l) => {
      const d = document.createElement('div');
      d.className = `line${l.title ? ' title' : ''}`;
      d.textContent = l.text;
      body.append(d);
      return d;
    });
    lineEls.push(els);
    page.append(body);
    const foot = document.createElement('div');
    foot.className = 'foot';
    const n = unit * L.slots + s + 1;
    foot.textContent = lines.length ? `${n} / ${pages.length}` : '';
    page.append(foot);
    el.append(page);
  }
  $('where').textContent = `${book.title} ・ ${opt.vertical ? '縦書き' : '横書き'}${opt.spread ? '・見開き' : ''} ・ 1行 ${L.perLine} 字 × ${L.perPage} 行`;
}

// ページのうち字がある所の割合(0〜1。見開きは2ページで1)
function fillOf() {
  let f = 0;
  for (let s = 0; s < L.slots; s += 1) f += (units[unit]?.[s]?.length ?? 0) / L.perPage;
  return clamp(f / L.slots);
}

const charsOf = () => (units[unit] ?? []).flat().reduce((a, l) => a + l.text.length, 0);

// ---- めくりとページの記録 ---------------------------------------------------

function openLog(skip) {
  if (!S.running) return;
  S.log = { unit, start: now(), end: null, guided: opt.guided, skip: skip || S.visited.has(unit), awayMs: 0, fill: fillOf(), chars: charsOf(), frames: [] };
  S.visited.add(unit);
  S.pages.push(S.log);
  S.changeT = S.log.start;
  S.pace = speedOf(S.pages);
  if (S.pace) {
    S.both.open(S.log.start, { speed: S.pace, fill: S.log.fill });
    S.time.open(S.log.start, { speed: S.pace, fill: S.log.fill });
  }
  if (opt.guided) startGuide();
}

function closeLog(back = false) {
  stopGuide();
  if (!S.log) return;
  S.log.end = now();
  if (back) S.log.skip = true;
  S.log = null;
  refit();
}

function turn(step) {
  const to = unit + step;
  if (to < 0 || to >= units.length) return;
  closeLog(step < 0);
  if (S.running) event({ t: now(), type: step > 0 ? 'turn' : 'back', detail: to });
  unit = to;
  render();
  openLog(step < 0);
}

// ---- なぞる(本当の位置が分かるページ) --------------------------------------

function speed() {
  if (opt.speed > 0) return opt.speed;
  const use = S.pages.filter((p) => !p.guided && !p.skip && p.end != null && p.end - p.start > 3000);
  const ms = use.reduce((a, p) => a + (p.end - p.start), 0);
  const chars = use.reduce((a, p) => a + p.chars, 0);
  return ms > 20_000 ? clamp((chars / ms) * 1000, 3, 30) : 8;
}

// なぞる速さはページごとに揺らし、途中で一度止める。一定の速さだと「時間だけ」でも当たってしまい、
// 目が効いているかを確かめられない(正解が時間に比例しないページで比べる)
const FACTORS = [0.6, 0.8, 1, 1.25, 1.5];
function startGuide() {
  stopGuide();
  const factor = FACTORS[Math.floor(Math.random() * FACTORS.length)];
  const sp = speed() * factor;
  const steps = lineEls.flatMap((els, s) => els.map((el, i) => ({ s, i, el })));
  const pauseAt = Math.floor(steps.length * (0.3 + Math.random() * 0.4));
  const pauseMs = 2500;
  const plan = [];
  let t = 0;
  steps.forEach((st, k) => {
    if (k === pauseAt) {
      plan.push({ ...st, from: t, to: t + pauseMs, pause: true });
      t += pauseMs;
    }
    const n = st.el.textContent.length;
    const d = n ? (n / sp) * 1000 : 250;
    plan.push({ ...st, from: t, to: t + d });
    t += d;
  });
  S.guide = { t0: now(), plan, total: t, speed: sp, factor };
  if (S.log) Object.assign(S.log, { factor, pauseLine: pauseAt });
  const tick = () => {
    const g = S.guide;
    if (!g) return;
    const t = now() - g.t0;
    for (const st of g.plan) {
      const on = t >= st.from && t < st.to;
      st.el.classList.toggle('guide', on);
      if (on) st.el.style.setProperty('--g', st.pause ? '0%' : `${((t - st.from) / (st.to - st.from)) * 100}%`);
    }
    if (t > g.total + 600) {
      turn(1);
      return;
    }
    g.raf = requestAnimationFrame(tick);
  };
  S.guide.raf = requestAnimationFrame(tick);
}

function stopGuide() {
  if (S.guide?.raf) cancelAnimationFrame(S.guide.raf);
  for (const st of S.guide?.plan ?? []) st.el.classList.remove('guide');
  S.guide = null;
}

// なぞっている位置(ページの上から 0〜1。見開きは2ページで1)
function truthAt(t) {
  const g = S.guide;
  if (!g) return null;
  const tt = t - g.t0;
  const st = g.plan.find((p) => tt >= p.from && tt < p.to) ?? (tt >= g.total ? g.plan.at(-1) : g.plan[0]);
  if (!st) return null;
  const frac = st.pause ? 0 : clamp((tt - st.from) / Math.max(1, st.to - st.from));
  return clamp((st.s + (st.i + frac) / L.perPage) / L.slots);
}

// ---- 読み進みの推定 -----------------------------------------------------------

function refit() {
  for (const set of SETS) {
    S.models[set] = fitProgress(S.pages, set);
    S.gates[set] = gateOf(S.models[set], S.pages, set);
    S.evals[set] = evaluate(S.pages, set);
    S.recent[set] = [];
  }
  showJudge();
}

function estimate(set, t, x) {
  const m = S.models[set];
  if (!m || !x) return null;
  const buf = S.recent[set];
  buf.push({ t, v: clamp(predict(m, x)) });
  while (buf.length && buf[0].t < t - EYES.progress.smoothMs) buf.shift();
  return median(buf.map((b) => b.v));
}

// 帯: 時間と目を合わせた位置の行を濃く、確からしさ(±1σ)の範囲の行を薄く。1行の精度は無いので幅で見せる
let bandEls = [];
function lineAt(pos) {
  const k = Math.max(0, Math.min(L.slots * L.perPage - 1, Math.floor(pos * L.slots * L.perPage)));
  const s = Math.floor(k / L.perPage);
  return lineEls[s]?.[k - s * L.perPage] ?? null;
}
function showBand() {
  for (const el of bandEls) el.classList.remove('est', 'near', 'closed');
  bandEls = [];
  const b = S.both.value;
  if (!opt.show || !S.running || !S.models[opt.set] || !S.pace || !S.log) return;
  const per = 1 / (L.slots * L.perPage);
  const span = Math.min(3 * per, b.sd);
  const closed = !S.gates[opt.set]?.open;
  for (let pos = Math.max(0, b.x - span); pos <= Math.min(1, b.x + span) + 1e-9; pos += per) {
    const el = lineAt(pos);
    if (el && !bandEls.includes(el)) bandEls.push(el);
  }
  const center = lineAt(b.x);
  for (const el of bandEls) el.classList.add(el === center ? 'est' : 'near');
  if (center && !bandEls.includes(center)) {
    center.classList.add('est');
    bandEls.push(center);
  }
  if (closed) for (const el of bandEls) el.classList.add('closed');
}

// ---- カメラと1コマ ----------------------------------------------------------

async function createLandmarker() {
  const { FaceLandmarker, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`);
  const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
  const make = (delegate) =>
    FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  try {
    const lm = await make('GPU');
    S.delegate = 'GPU';
    return lm;
  } catch (e) {
    console.warn('GPU が使えないので CPU にする', e);
    S.delegate = 'CPU';
    return make('CPU');
  }
}

async function start() {
  const btn = $('start');
  if (S.running) return stop();
  btn.disabled = true;
  try {
    status('カメラを開いています…');
    const [w, h] = opt.res === 320 ? [320, 240] : [640, 480];
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: w }, height: { ideal: h }, facingMode: 'user' }, audio: false });
    const video = $('video');
    video.srcObject = S.stream;
    await video.play();
    if (!S.landmarker) {
      status('顔のモデルを読み込んでいます…(はじめは 20MB ほど)');
      S.landmarker = await createLandmarker();
    }
    S.running = true;
    S.lastT = null;
    openLog(true);
    video.requestVideoFrameCallback(loop);
    status(`動いています(${S.delegate}・${video.videoWidth}×${video.videoHeight})`);
    btn.textContent = 'カメラを止める';
    $('export').disabled = false;
  } catch (e) {
    console.error(e);
    status(`使えませんでした: ${e.message}`);
    S.stream?.getTracks().forEach((t) => t.stop());
  } finally {
    btn.disabled = false;
  }
}

function stop() {
  closeLog(true);
  S.running = false;
  S.stream?.getTracks().forEach((t) => t.stop());
  S.stream = null;
  $('video').srcObject = null;
  $('start').textContent = 'カメラを始める';
  status('止めました(数字は残っています。書き出せます)');
  showBand();
}

const lumaCanvas = document.createElement('canvas');
lumaCanvas.width = 32;
lumaCanvas.height = 24;
const lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });
function lumaOf(video) {
  lumaCtx.drawImage(video, 0, 0, 32, 24);
  const d = lumaCtx.getImageData(0, 0, 32, 24).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (d.length / 4);
}

function loop(when) {
  if (!S.running) return;
  const video = $('video');
  video.requestVideoFrameCallback(loop);
  // 1秒に fps コマに間引く(カメラのコマの間隔の端数を持ち越して、平均がちょうど fps になるように)
  const iv = 1000 / opt.fps;
  if (when + 8 < S.due) return;
  S.due = S.due + iv < when ? when + iv : S.due + iv;
  const a = performance.now();
  let res;
  try {
    res = S.landmarker.detectForVideo(video, when);
  } catch (e) {
    console.warn(e);
    return;
  }
  const ms = performance.now() - a;
  const t = when - S.t0;
  const f = frameOf(res, { width: video.videoWidth, height: video.videoHeight, luma: lumaOf(video), pitchSign: opt.flip ? -1 : 1 });
  const x = { base: vectorOf(f, FEATURES.base), plus: vectorOf(f, FEATURES.plus) };
  const out = S.tracker.push(t, f, { progress: S.gates[opt.set]?.open ? S.est[opt.set] : null });
  // まばたき中のコマは虹彩の位置が狂うので、読み進みには使わない
  const seeing = out.now.onScreen && f.face && !out.now.lidShut;
  for (const set of SETS) S.est[set] = seeing ? estimate(set, t, x[set]) : S.est[set];
  const m = S.models[opt.set];
  const z = m && seeing && x[opt.set] ? predict(m, x[opt.set]) : null;
  const both = S.pace ? S.both.step(t, z, m?.r2, !out.now.onScreen) : null;
  const time = S.pace ? S.time.step(t, null, m?.r2, !out.now.onScreen) : null;
  const dt = S.lastT == null ? 0 : Math.min(500, t - S.lastT);
  S.lastT = t;
  const truth = S.guide ? truthAt(t) : null;
  if (S.log) {
    S.log.frames.push({ t, on: seeing, away: !out.now.onScreen, x, truth });
    if (!out.now.onScreen) S.log.awayMs += dt;
  }
  const mode = opt.guided ? 'guided' : 'natural';
  S.frames.push({
    t: Math.round(t),
    unit,
    mode,
    label: S.label,
    settle: t - S.changeT >= 1000,
    ...pick(f),
    closedNorm: out.now.closedNorm,
    closed: out.now.closed,
    onRaw: out.now.onRaw,
    onScreen: out.now.onScreen,
    perclos: out.now.perclos,
    drowsy: out.now.drowsy,
    conf: out.now.conf,
    lidRatio: out.now.lidRatio,
    lidShut: out.now.lidShut,
    est_eyes: S.est.eyes,
    est_base: S.est.base,
    est_plus: S.est.plus,
    est_time: time?.x ?? null,
    est_both: both?.x ?? null,
    both_sd: both?.sd ?? null,
    truth,
    infer_ms: ms,
  });
  for (const r of out.rows) S.seconds.push({ ...r, unit, mode, label: S.label, note: opt.note });
  for (const e of out.events) event({ t: e.t, type: e.type, detail: e.why ?? e.ms ?? '' });
  S.infer.push(ms);
  S.procT.push(when);
  if (S.infer.length > 120) S.infer.shift();
  while (S.procT.length && S.procT[0] < when - 3000) S.procT.shift();
  S.saved = false;
  S.now = out.now;
  S.f = f;
  S.res = res;
}

const FIELDS = ['face', 'blink', 'lookDown', 'lookUp', 'gazeX', 'jaw', 'yaw', 'pitch', 'roll', 'irisRX', 'irisRY', 'irisLX', 'irisLY', 'openR', 'openL', 'lookDownR', 'lookDownL', 'lookUpR', 'lookUpL', 'lookInR', 'lookInL', 'lookOutR', 'lookOutL', 'faceWidth', 'luma'];
const pick = (f) => Object.fromEntries(FIELDS.map((k) => [k, f[k] ?? null]));

function event(e) {
  S.events.push({ ...e, unit, label: S.label, note: opt.note });
  if (e.type === 'drowsy_on' || e.type === 'drowsy_off') showJudge();
}

// ---- ラベル -----------------------------------------------------------------

function setLabel(key) {
  const t = now();
  const next = S.label === key ? '' : key;
  const open = S.eps.at(-1);
  if (open && open.end == null) open.end = t;
  S.label = next;
  S.changeT = t;
  if (next) S.eps.push({ label: next, start: t, end: null });
  if (S.running) event({ t, type: 'label', detail: next || 'none' });
  for (const b of document.querySelectorAll('#labels button')) b.classList.toggle('on', b.dataset.key === next);
}

// ---- 表示 -------------------------------------------------------------------

function status(s) {
  $('status').textContent = s;
}

function draw() {
  const c = $('overlay');
  const v = $('video');
  const ctx = c.getContext('2d');
  c.width = v.clientWidth;
  c.height = v.clientHeight;
  ctx.clearRect(0, 0, c.width, c.height);
  const lm = S.res?.faceLandmarks?.[0];
  if (!lm || lm.length < 478) return;
  const dot = (i, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lm[i].x * c.width, lm[i].y * c.height, r, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const i of [33, 133, 362, 263, 159, 145, 386, 374]) dot(i, 1.6, 'rgba(255,255,255,.9)');
  for (const i of [468, 473]) dot(i, 2.6, S.now?.closed ? '#e3a596' : '#94a888');
}

function showNow() {
  const n = S.now;
  const f = S.f;
  const fps = S.procT.length > 1 ? (S.procT.length - 1) / ((S.procT.at(-1) - S.procT[0]) / 1000) : 0;
  const rows = [
    ['顔', f?.face ? 'ある' : 'ない'],
    ['画面に', n ? `${n.onScreen ? '向いている' : '外れている'}(このコマ ${n.onRaw ? '○' : '×'})` : '—'],
    ['まぶたの閉じ', n?.closedNorm == null ? '—' : `${num(n.closedNorm)}(生 ${num(f.blink)}・いつもの開き ${num(n.open)})${n.closed ? ' 閉' : ''}`],
    ['下を見る', `${num(f?.lookDown)}${n?.lookingDown ? '(下の行の罠に注意)' : ''}`],
    ['頭', f?.face ? `yaw ${num(f.yaw, 0)}°・pitch ${num(f.pitch, 0)}°・roll ${num(f.roll, 0)}°` : '—'],
    ['左右の視線', num(f?.gazeX)],
    ['perclos(60秒)', n ? `${pct(n.perclos)}・長い閉じ ${n.longs} 回・まばたき ${n.blinks}` : '—'],
    ['あご', num(f?.jaw)],
    ['うとうと', n?.drowsy ? 'on' : 'off'],
    ['信頼度', n ? `${num(n.conf)}(明るさ ${num(f?.luma, 0)}・顔の幅 ${num(f?.faceWidth)})` : '—'],
    ['読み進み', progressText()],
    ['処理', `1コマ ${num(median(S.infer), 0)}ms・${num(fps, 1)} fps・${S.delegate || '—'}`],
  ];
  $('now').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  draw();
  showBand();
}

function progressText() {
  const g = S.gates[opt.set];
  const usable = S.evals[opt.set]?.pages ?? 0;
  if (!S.models[opt.set]) return `まだ(使えるページ ${usable} / ${EYES.progress.minPages})`;
  const b = S.both.value;
  const guide = S.guide ? `<br>なぞり ${num(truthAt(now()))}(×${S.guide.factor})` : '';
  return `合わせた ${num(b.x)} ±${num(b.sd)}(目だけ ${num(S.est[opt.set])}・時間だけ ${num(S.time.value.x)})・門 ${g?.open ? '開' : '閉'}(${g?.pass}/${g?.of})${guide}`;
}

const mark = (ok) => (ok == null ? '' : ok ? ' <b class="ok">○</b>' : ' <b class="ng">×</b>');

function showJudge() {
  const F = S.frames;
  let offN = 0;
  let offOk = 0;
  let onN = 0;
  let onOk = 0;
  for (const fr of F) {
    if (!fr.settle) continue;
    if (fr.label === 'off') {
      offN += 1;
      if (!fr.onScreen) offOk += 1;
    } else if (READING.has(fr.label)) {
      onN += 1;
      if (fr.onScreen) onOk += 1;
    }
  }
  const acc = offN + onN ? (offOk + onOk) / (offN + onN) : null;
  const t = now();
  const offEps = S.eps.filter((e) => e.label === 'off' && (e.end ?? t) - e.start >= 1000);
  const caught = offEps.filter((e) => S.events.some((v) => v.type === 'away' && v.t >= e.start - 200 && v.t <= (e.end ?? t) + 500)).length;
  const falseOn = S.events.filter((v) => v.type === 'drowsy_on' && READING.has(v.label));
  const falseDown = falseOn.filter((v) => v.label === 'bottom').length;
  const sleepy = S.eps
    .filter((e) => e.label === 'sleepy')
    .map((e) => {
      const before = S.frames.findLast((fr) => fr.t <= e.start);
      if (before?.drowsy) return 'はじめから on';
      const on = S.events.find((v) => v.type === 'drowsy_on' && v.t >= e.start);
      if (on) return `${Math.round((on.t - e.start) / 1000)}秒${mark(on.t - e.start <= 60_000)}`;
      return e.end == null ? `待っている(${Math.round((t - e.start) / 1000)}秒)` : `出ず${mark(false)}`;
    });
  const pass = (r) => mark(r?.acc == null ? null : r.acc >= 0.8);
  const ev = (set) => {
    const e = S.evals[set];
    if (!e) return '—';
    const l = e.lopo;
    const g = e.guided;
    return `ページを抜いて当てる ${pct(l.acc)}${pass(l)}(ずれ ${num(l.mae)})/ なぞり ${pct(g.acc)}${pass(g)}(ずれ ${num(g.mae)})`;
  };
  const g = S.evals[opt.set]?.guided;
  const vs = g?.pages
    ? `目だけ ${pct(g.acc)}・ずれ ${num(g.mae)} / 時間だけ ${pct(g.time.acc)}・ずれ ${num(g.time.mae)} / <b>合わせた ${pct(g.both.acc)}・ずれ ${num(g.both.mae)}</b>`
    : 'G でなぞると出る(速さを揺らし、途中で止まる)';
  const rows = [
    ['画面にあるか', `${pct(acc)}${mark(acc == null ? null : acc >= 0.95)}(外: ${offOk}/${offN}・読書: ${onOk}/${onN} コマ)`],
    ['わざと離れた', `${caught} / ${offEps.length} 回を検出`],
    ['うとうと誤検知', `${falseOn.length} 回${mark(F.length ? falseOn.length === 0 : null)}(うち下の行 ${falseDown})`],
    ['眠いふり → on', sleepy.length ? sleepy.join('、') : '—'],
    ['上1/3と下1/3(eyes)', ev('eyes')],
    ['同(base)', ev('base')],
    ['同(plus)', ev('plus')],
    [`なぞりで比べる(${opt.set})`, vs],
    ['使えるページ', `${S.evals.eyes?.pages ?? 0}(なぞり ${S.pages.filter((p) => p.guided && p.end != null).length})・速さ ${num(speed(), 1)} 字/秒・1ページ ${S.pace ? num(1 / S.pace, 1) : '—'} 秒`],
    ['CPU', 'アクティビティモニタで見る(1コアの25%未満)'],
  ];
  $('judge').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---- 書き出し ---------------------------------------------------------------

function csv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const cell = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4);
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${keys.join(',')}\n${rows.map((r) => keys.map((k) => cell(r[k])).join(',')).join('\n')}\n`;
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportAll() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const meta = { book: opt.book, vertical: opt.vertical, spread: opt.spread, fs: opt.fs, fps: opt.fps, res: opt.res, delegate: S.delegate, note: opt.note };
  const pagesCsv = S.pages.map((p) => ({ unit: p.unit, start: Math.round(p.start), end: p.end == null ? null : Math.round(p.end), ms: p.end == null ? null : Math.round(p.end - p.start), guided: p.guided, factor: p.factor ?? null, pauseLine: p.pauseLine ?? null, skip: p.skip, awayMs: Math.round(p.awayMs), fill: p.fill, chars: p.chars, frames: p.frames.length }));
  const files = [
    ['frames', S.frames.map((r) => ({ ...r, ...meta }))],
    ['seconds', S.seconds],
    ['events', S.events],
    ['pages', pagesCsv],
  ];
  files.forEach(([name, rows], i) => setTimeout(() => download(`eyes-${stamp}-${name}.csv`, csv(rows)), i * 300));
  S.saved = true;
}

// ---- 設定の画面 ---------------------------------------------------------------

function bindSettings() {
  const bind = (id, key, parse = (v) => v, after = () => relayout()) => {
    const el = $(id);
    const isBox = el.type === 'checkbox';
    if (isBox) el.checked = !!opt[key];
    else el.value = String(opt[key]);
    el.addEventListener('change', () => {
      closeLog(true);
      opt[key] = isBox ? el.checked : parse(el.value);
      save();
      after();
      openLog(true);
    });
  };
  bind('book', 'book', String, () => {
    book = books.find((b) => b.id === opt.book);
    relayout(false);
  });
  bind('vertical', 'vertical', (v) => v === 'true');
  bind('spread', 'spread');
  bind('fs', 'fs', Number);
  bind('fps', 'fps', Number, () => {});
  bind('res', 'res', Number, () => status(S.running ? 'カメラの大きさは、止めて始め直すと変わります' : $('status').textContent));
  bind('show', 'show', Boolean, () => showBand());
  bind('guided', 'guided', Boolean, () => render());
  bind('speed', 'speed', Number, () => {});
  bind('set', 'set', String, () => showJudge());
  bind('flip', 'flip', Boolean, () => {});
  const note = $('note');
  note.value = opt.note;
  note.addEventListener('input', () => {
    opt.note = note.value;
    save();
  });
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const label = LABELS.find(([key]) => key === k);
    if (label) setLabel(label[1]);
    else if (k === '0') setLabel('');
    else if (k === ' ' || k === 'PageDown' || k === (opt.vertical ? 'ArrowLeft' : 'ArrowRight')) turn(1);
    else if (k === 'PageUp' || k === (opt.vertical ? 'ArrowRight' : 'ArrowLeft')) turn(-1);
    else if (k === 'e' || k === 'E') {
      opt.show = !opt.show;
      $('show').checked = opt.show;
      save();
      showBand();
    } else if (k === 'g' || k === 'G') {
      $('guided').click();
    } else return;
    e.preventDefault();
  });
  $('stage').addEventListener('click', (e) => {
    if (e.target.closest('.page')) turn(1);
  });
}

// ---- はじめ -------------------------------------------------------------------

async function main() {
  $('labels').innerHTML = LABELS.map(([key, k, n]) => `<button data-key="${k}"><kbd>${key}</kbd>${n}</button>`).join('');
  for (const b of document.querySelectorAll('#labels button')) b.addEventListener('click', () => setLabel(b.dataset.key));
  // 押したボタンに焦点を残さない(スペースでめくったつもりが、カメラを止めてしまわないように)
  document.addEventListener('click', (e) => e.target.closest?.('button')?.blur());
  $('start').addEventListener('click', start);
  $('export').addEventListener('click', exportAll);
  await loadBooks();
  bindSettings();
  bindKeys();
  relayout(false);
  showJudge();
  let timer = null;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      closeLog(true);
      relayout();
      openLog(true);
    }, 200);
  });
  window.addEventListener('beforeunload', (e) => {
    if (!S.saved && S.frames.length) e.preventDefault();
  });
  setInterval(() => {
    if (S.running) showNow();
  }, 150);
  setInterval(() => {
    if (S.running) showJudge();
  }, 1000);
  status('カメラは止まっています。「カメラを始める」で始まります');
  globalThis.eyesLab = { S, opt, NAME };
}

main();
