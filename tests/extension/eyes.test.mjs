import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EYES, headPose, irisOf, frameOf, onScreenOf, createTracker, statsOf, addStats, fitRidge, predict, smooth,
  usable, teacherOf, fitProgress, predictPage, thirds, gateOf, evaluate, FEATURES, vectorOf, createFollower, speedOf, followPage,
} from '../../tools/eyes-lab/signals.js';
import { linesOf, paginate, pageOfPlace } from '../../tools/eyes-lab/layout.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const rad = (d) => (d * Math.PI) / 180;

// 頭の向き → 4×4(列優先・平行移動つき)。y 上・z がカメラ向きの座標で、yaw は y 軸、pitch は x 軸の回転
function matrix({ yaw = 0, pitch = 0 }, rowMajor = false) {
  const [cy, sy, cp, sp] = [Math.cos(rad(yaw)), Math.sin(rad(yaw)), Math.cos(rad(-pitch)), Math.sin(rad(-pitch))];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
  const R = Ry.map((r) => [0, 1, 2].map((j) => r.reduce((a, v, k) => a + v * Rx[k][j], 0)));
  const M = [[...R[0], 1.5], [...R[1], -2], [...R[2], -42], [0, 0, 0, 1]];
  return rowMajor ? M.flat() : [0, 1, 2, 3].flatMap((c) => M.map((r) => r[c]));
}

test('頭の向き: 列優先でも行優先でも、正面は 0、下を向くと pitch が負、横を向くと yaw が出る', () => {
  for (const rowMajor of [false, true]) {
    const z = headPose(matrix({}, rowMajor));
    close(z.yaw, 0);
    close(z.pitch, 0);
    const down = headPose(matrix({ pitch: -20 }, rowMajor));
    close(down.pitch, -20, 1e-9);
    close(down.yaw, 0, 1e-9);
    const side = headPose(matrix({ yaw: 30 }, rowMajor));
    close(Math.abs(side.yaw), 30, 1e-9);
    close(side.pitch, 0, 1e-9);
  }
  assert.equal(headPose(matrix({ pitch: -20 }), -1).pitch > 0, true, 'pitchSign で逆にできる');
  assert.equal(headPose(null), null);
});

// 478 点の顔を作る。目は横 40px、虹彩は目の中の (ix, iy) に置く(iy は目の幅に対する下向き)
function face({ ix = 0.5, iy = 0, swapIris = false, w = 640, h = 480 } = {}) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const put = (i, x, y) => (lm[i] = { x: x / w, y: y / h, z: 0 });
  // 画像の左にある目(本人の右目)と右にある目(本人の左目)
  const eyes = { right: { inner: 133, outer: 33, x0: 260, lids: [159, 145] }, left: { inner: 362, outer: 263, x0: 340, lids: [386, 374] } };
  put(eyes.right.outer, 260, 200);
  put(eyes.right.inner, 300, 200);
  put(eyes.left.inner, 340, 200);
  put(eyes.left.outer, 380, 200);
  for (const e of Object.values(eyes)) {
    put(e.lids[0], e.x0 + 20, 192);
    put(e.lids[1], e.x0 + 20, 208);
  }
  const iris = [
    [260 + ix * 40, 200 + iy * 40],
    [340 + ix * 40, 200 + iy * 40],
  ];
  if (swapIris) iris.reverse();
  put(468, ...iris[0]);
  put(473, ...iris[1]);
  put(234, 200, 240);
  put(454, 440, 240);
  return lm;
}

test('虹彩: 目の幅で割った位置になり、両目とも画像の左が 0。虹彩の番号の左右が入れ替わっても、近いほうの目に結ぶ', () => {
  for (const swapIris of [false, true]) {
    const a = irisOf(face({ ix: 0.25, iy: 0.1, swapIris }));
    close(a.right.x, 0.25);
    close(a.left.x, 0.25);
    close(a.right.y, 0.1);
    close(a.left.y, 0.1);
    close(a.right.open, 0.4);
  }
  assert.equal(irisOf([]), null);
});

const result = ({ blink = 0.05, lookDown = 0, jaw = 0, yaw = 0, pitch = -5, ix = 0.5, iy = 0 } = {}) => ({
  faceLandmarks: [face({ ix, iy })],
  faceBlendshapes: [
    {
      categories: [
        ['eyeBlinkLeft', blink],
        ['eyeBlinkRight', blink],
        ['eyeLookDownLeft', lookDown],
        ['eyeLookDownRight', lookDown],
        ['jawOpen', jaw],
      ].map(([categoryName, score]) => ({ categoryName, score })),
    },
  ],
  facialTransformationMatrixes: [{ rows: 4, columns: 4, data: matrix({ yaw, pitch }) }],
});

test('1コマ: 顔が無ければ face だけ。あれば、まぶた・下を見る・頭の向き・虹彩・顔の幅が入り、画面に向いているかが決まる', () => {
  assert.deepEqual(frameOf({ faceLandmarks: [] }), { face: false, luma: null });
  const f = frameOf(result({ blink: 0.3, lookDown: 0.6, pitch: -10 }), { luma: 120 });
  close(f.blink, 0.3);
  close(f.lookDown, 0.6);
  close(f.pitch, -10, 1e-9);
  close(f.irisRX, 0.5);
  close(f.faceWidth, 240 / 640);
  assert.equal(onScreenOf(f), true);
  assert.equal(onScreenOf(frameOf(result({ yaw: 40 }))), false, '横を向いた');
  assert.equal(onScreenOf(frameOf(result({ pitch: -40 }))), false, '下を向きすぎ(手元・スマホ)');
  assert.equal(onScreenOf({ face: false }), false);
  assert.deepEqual(vectorOf(f, FEATURES.base).length, 6);
  assert.equal(vectorOf({ face: false }, FEATURES.base), null);
});

// 追跡器に、6fps で数字を流す
function run(steps, C = EYES) {
  const tr = createTracker(C);
  const events = [];
  const rows = [];
  let t = 0;
  let last;
  for (const [ms, opts] of steps) {
    const f = opts === null ? { face: false } : frameOf(result(opts));
    for (const end = t + ms; t < end; t += 1000 / 6) {
      last = tr.push(t, f);
      events.push(...last.events);
      rows.push(...last.rows);
    }
  }
  return { events, rows, last, types: events.map((e) => e.type) };
}
const OPEN = { blink: 0.05 };
const SHUT = { blink: 0.95 };

test('閉じ: 0.4秒未満はまばたき、以上は長い閉じ。いつもの開きを基準に伸ばす', () => {
  const r = run([[30_000, OPEN], [300, SHUT], [5000, OPEN], [800, SHUT], [5000, OPEN]]);
  assert.equal(r.types.filter((x) => x === 'blink').length, 1);
  assert.equal(r.types.filter((x) => x === 'long_close').length, 1);
  close(r.last.now.open, 0.05);
});

test('閉じ: 下の行を読んでいてまぶたが下がっても(0.6)、閉じと数えない。下を見ていなければ閉じ', () => {
  const down = run([[30_000, OPEN], [3000, { blink: 0.6, lookDown: 0.7 }]]);
  assert.equal(down.last.now.closed, false);
  assert.equal(down.types.includes('long_close'), false);
  const flat = run([[30_000, OPEN], [3000, { blink: 0.6, lookDown: 0 }]]);
  assert.equal(flat.last.now.closed, true);
});

test('画面にあるか: 外れて0.5秒で away、戻って0.3秒で back。0.3秒だけ外れても away にしない', () => {
  const short = run([[5000, OPEN], [300, { ...OPEN, yaw: 45 }], [3000, OPEN]]);
  assert.equal(short.types.includes('away'), false);
  const long = run([[5000, OPEN], [1500, { ...OPEN, yaw: 45 }], [3000, OPEN]]);
  assert.deepEqual(long.types.filter((x) => x === 'away' || x === 'back'), ['away', 'back']);
  const gone = run([[5000, OPEN], [1500, null]]);
  assert.equal(gone.last.now.onScreen, false, '顔が無いのも外れ');
});

test('うとうと: 60秒に長い閉じ2回で on、90秒下回って off。まばたきだけでは on にならない', () => {
  const blinks = [[30_000, OPEN]];
  for (let i = 0; i < 40; i += 1) blinks.push([200, SHUT], [3000, OPEN]);
  assert.equal(run(blinks).types.includes('drowsy_on'), false);
  const r = run([[30_000, OPEN], [600, SHUT], [10_000, OPEN], [600, SHUT], [10_000, OPEN], [200_000, OPEN]]);
  const on = r.events.find((e) => e.type === 'drowsy_on');
  assert.ok(on, 'on');
  assert.match(on.why, /long_close/);
  const first = r.events.find((e) => e.type === 'long_close');
  const off = r.events.find((e) => e.type === 'drowsy_off');
  assert.ok(off, 'off');
  close(off.t - first.t, EYES.windowMs + EYES.drowsy.offMs, 400); // 1回目の長い閉じが窓から出て、さらに90秒
});

test('うとうと: 目を半分閉じ続ける(perclos が高い)と、60秒続いたところで on', () => {
  const r = run([[30_000, OPEN], [100_000, SHUT]]);
  const on = r.events.find((e) => e.type === 'drowsy_on');
  assert.ok(on);
  assert.ok(on.t - 30_000 <= 60_000 + 15_000, `${on.t}`);
});

test('うとうと: あくび(あごが1.5秒)+ perclos > 0.08 で on', () => {
  const yawnOnly = run([[30_000, OPEN], [2000, { ...OPEN, jaw: 0.8 }], [5000, OPEN]]);
  assert.ok(yawnOnly.types.includes('yawn'));
  assert.equal(yawnOnly.types.includes('drowsy_on'), false, 'perclos が低ければあくびだけでは on にしない');
  // perclos を 0.08〜0.15 にする(長い閉じは数えない短い閉じを重ねる: 5秒ごとに 0.33秒)
  const half = [[30_000, OPEN]];
  for (let i = 0; i < 14; i += 1) half.push([340, SHUT], [3000, OPEN]);
  half.push([2000, { ...OPEN, jaw: 0.8 }], [3000, OPEN]);
  const yawned = run(half);
  assert.equal(yawned.types.includes('long_close'), false);
  const on = yawned.events.find((e) => e.type === 'drowsy_on');
  assert.ok(on, 'on');
  assert.equal(on.why, 'yawn');
});

test('1秒ごとの行: #6 の信号の形(t・face・on_screen・progress・closed_ms・perclos・drowsy・conf)', () => {
  const r = run([[5000, OPEN]]);
  assert.ok(r.rows.length >= 4);
  assert.deepEqual(Object.keys(r.rows[0]).sort(), ['closed_ms', 'conf', 'drowsy', 'face', 'on_screen', 'perclos', 'progress', 't'].sort());
  assert.equal(r.rows[0].face, true);
  assert.equal(r.rows[1].t - r.rows[0].t, 1000);
});

test('リッジ回帰: 雑音の無い一次式を取り戻す。ページを抜いた統計は、足し引きで作り直したものと同じ', () => {
  const rows = [];
  for (let i = 0; i < 200; i += 1) {
    const x = [Math.sin(i), Math.cos(i * 1.3) * 5, (i % 7) / 7];
    rows.push({ x, y: 0.3 * x[0] - 0.02 * x[1] + 0.5 * x[2] + 0.1 });
  }
  const m = fitRidge(statsOf(rows), 1e-9);
  close(m.w[0], 0.3, 1e-4);
  close(m.w[1], -0.02, 1e-4);
  close(m.w[2], 0.5, 1e-4);
  close(m.b, 0.1, 1e-4);
  close(predict(m, [1, 1, 1]), 0.88, 1e-4);
  const a = statsOf(rows.slice(0, 120));
  const b = statsOf(rows.slice(120));
  const back = addStats(addStats(a, b), b, -1);
  close(back.sxx[1][2], a.sxx[1][2], 1e-6);
  assert.equal(fitRidge(statsOf(rows.slice(0, 3)), 0.1), null, '数が足りなければ当てはめない');
});

test('なめらかにする: 直近1秒の中央値(後ろ向きだけ)', () => {
  assert.deepEqual(smooth([0, 100, 200, 1150, 1300], [0, 1, 0.5, 0.9, 0.2], 1000), [0, 0.5, 0.5, 0.7, 0.55]);
});

// 合成したページ: 虹彩の y・下を見る・まぶたの開きが、本当の位置に沿って動く(+ 雑音)。
// path は経過の割合 → 本当の位置(既定は同じ速さ)。頭の向き(yaw)は位置と関係なく揺れる
function pageOf(start, ms, { slope = 0.2, noise = 0.01, seed = 1, fill = 1, path = (u) => u, ...rest } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const frames = [];
  for (let t = start; t <= start + ms; t += 1000 / 6) {
    const p = path((t - start) / ms) * fill;
    const n = () => rnd() * noise;
    const f = {
      face: true, irisRX: 0.5 + n(), irisRY: -0.05 + slope * p + n(), irisLX: 0.5 + n(), irisLY: -0.05 + slope * p + n(),
      yaw: rnd() * 2, pitch: -8 - 30 * slope * p + rnd(),
      lookDownR: 0.1 + 1.5 * slope * p + n(), lookDownL: 0.1 + 1.5 * slope * p + n(), lookUpR: 0.1 - 0.5 * slope * p + n(), lookUpL: 0.1 - 0.5 * slope * p + n(),
      lookInR: 0.1 + n(), lookInL: 0.1 + n(), lookOutR: 0.1 + n(), lookOutL: 0.1 + n(), openR: 0.3 - 0.2 * slope * p + n(), openL: 0.3 - 0.2 * slope * p + n(),
    };
    frames.push({ t, on: true, x: Object.fromEntries(Object.entries(FEATURES).map(([k, names]) => [k, vectorOf(f, names)])), truth: rest.guided ? p : undefined });
  }
  return { start, end: start + ms, awayMs: 0, fill, frames, ...rest };
}

test('読み進み: 使えるページ(途中から・戻った・なぞった・短すぎ・長く離れたは除く)が4枚たまってから当てはめる', () => {
  assert.equal(usable(pageOf(0, 30_000)), true);
  assert.equal(usable(pageOf(0, 30_000, { skip: true })), false);
  assert.equal(usable(pageOf(0, 30_000, { guided: true })), false);
  assert.equal(usable(pageOf(0, 2000)), false);
  assert.equal(usable({ ...pageOf(0, 30_000), awayMs: 5000 }), false);
  const three = [0, 1, 2].map((i) => pageOf(i * 40_000, 30_000, { seed: i + 1 }));
  assert.equal(fitProgress(three), null);
  assert.ok(fitProgress([...three, pageOf(200_000, 30_000, { seed: 9 })]));
  close(teacherOf({ start: 0, end: 10_000, fill: 0.5 }, 10_000), 0.5);
});

test('読み進み: 目が読み進みに沿って動けば、ページを抜いて当てても上1/3と下1/3を見分け、門が開き、なぞったページも当たる', () => {
  const pages = [0, 1, 2, 3, 4, 5].map((i) => pageOf(i * 40_000, 30_000 + i * 2000, { seed: i + 1 }));
  pages.push(pageOf(300_000, 25_000, { seed: 42, guided: true }));
  const e = evaluate(pages, 'base');
  assert.equal(e.pages, 6);
  assert.ok(e.lopo.acc > 0.95, `lopo ${e.lopo.acc}`);
  assert.ok(e.guided.acc > 0.95, `guided ${e.guided.acc}`);
  assert.equal(e.guided.pages, 1);
  const m = fitProgress(pages);
  assert.equal(gateOf(m, pages).open, true);
  const est = predictPage(m, pages[0]);
  assert.ok(est.at(-1).est > 0.8 && est[3].est < 0.2, `${est[3].est} → ${est.at(-1).est}`);
});

test('読み進み: 目が読み進みと関係なく動くなら、門は閉じる', () => {
  const pages = [0, 1, 2, 3, 4, 5].map((i) => pageOf(i * 40_000, 30_000, { slope: 0, noise: 0.05, seed: i + 7 }));
  const m = fitProgress(pages);
  assert.equal(gateOf(m, pages).open, false);
  const e = evaluate(pages, 'base');
  assert.ok(e.lopo.acc < 0.8, `${e.lopo.acc}`);
});

test('追う: 目が無ければ、めくってからの時間 × ふだんの速さで進み、画面から外れている間は止まり、ページの外へ出ない', () => {
  const f = createFollower();
  f.open(0, { speed: 0.05, fill: 1 });
  for (let t = 0; t <= 10_000; t += 100) f.step(t);
  assert.ok(Math.abs(f.value.x - 0.5) < 1e-9, `${f.value.x}`);
  for (let t = 10_100; t <= 20_000; t += 100) f.step(t, null, 0.04, true);
  assert.ok(Math.abs(f.value.x - 0.5) < 1e-9, 'よそ見の間は止まる');
  for (let t = 20_100; t <= 60_000; t += 100) f.step(t);
  assert.equal(f.value.x, 1);
  const half = createFollower();
  half.open(0, { speed: 0.05, fill: 0.4 });
  for (let t = 0; t <= 30_000; t += 100) half.step(t);
  assert.equal(half.value.x, 0.4, '章の終わりの短いページは、字のある所まで');
  assert.ok(f.value.sd > 0);
});

test('追う: なぞる速さを揺らし途中で止めたページでは、時間だけより、時間と目を合わせたほうが当たる', () => {
  const natural = [0, 1, 2, 3, 4, 5].map((i) => pageOf(i * 40_000, 30_000, { seed: i + 1, noise: 0.03 }));
  assert.ok(Math.abs(speedOf(natural) - 1 / 30) < 1e-3, 'ふだんの速さ = 1ページ30秒');
  // 1.5倍の速さで読み、真ん中で4秒止まる(20秒のページ)
  const path = (u) => (u < 0.4 ? u * 1.25 : u < 0.6 ? 0.5 : 0.5 + (u - 0.6) * 1.25);
  const guided = pageOf(300_000, 20_000, { seed: 42, noise: 0.03, guided: true, path });
  const e = evaluate([...natural, guided], 'eyes');
  assert.equal(e.guided.pages, 1);
  assert.ok(e.guided.both.mae < e.guided.time.mae, `合わせた ${e.guided.both.mae} / 時間だけ ${e.guided.time.mae}`);
  assert.ok(e.guided.both.mae < e.guided.mae + 0.02, `合わせた ${e.guided.both.mae} / 目だけ ${e.guided.mae}`);
  const rows = followPage(fitProgress(natural), speedOf(natural), guided);
  assert.ok(rows.every((r) => r.both >= 0 && r.both <= 1 && r.sd > 0));
});

test('当てはめの残差: 統計量から出した残差の2乗平均が、実際に当てて測ったものと同じ', () => {
  const pages = [0, 1, 2, 3].map((i) => pageOf(i * 40_000, 30_000, { seed: i + 3, noise: 0.05 }));
  const m = fitProgress(pages);
  const res = pages.flatMap((p) => p.frames.map((f) => (teacherOf(p, f.t) - predict(m, f.x.eyes)) ** 2));
  assert.ok(Math.abs(m.r2 - res.reduce((a, b) => a + b) / res.length) < 1e-9);
});

test('上1/3と下1/3: 真ん中の1/3は数えない。推定が 0.5 のどちら側か', () => {
  const r = thirds([
    { y: 0.1, est: 0.2 },
    { y: 0.9, est: 0.7 },
    { y: 0.5, est: 0.9 },
    { y: 0.2, est: 0.6 },
  ]);
  assert.equal(r.n, 3);
  close(r.acc, 2 / 3);
});

test('組み方: 行は字の数で切り、句読点と閉じ括弧はぶら下げる。字を落とさない', () => {
  const paras = ['あいうえおかきくけこ。」さしすせそ', '「たちつてと」', ''];
  const lines = linesOf(paras, 10);
  assert.equal(lines.map((l) => l.text).join(''), `　${paras[0]}${paras[1]}`);
  assert.equal(lines[0].text, '　あいうえおかきくけ', '段落の頭は一字下げ(括弧で始まる段落は下げない)');
  assert.ok(lines.every((l) => l.text.length <= 12));
  assert.ok(lines.every((l) => !/^[、。」』]/.test(l.text)), '行頭に句読点・閉じ括弧が来ない');
  const ended = linesOf(['あいうえおかきくけこ。」さ'], 11, { indent: false });
  assert.equal(ended[0].text, 'あいうえおかきくけこ。」');
  assert.equal(ended[1].at, 12);
});

test('組み方: 章はページの頭から。組み直しても同じ所を含むページへ戻る', () => {
  const { books } = JSON.parse(readFileSync(new URL('../../tools/eyes-lab/books.json', import.meta.url), 'utf8'));
  const ginga = books.find((b) => b.id === 'ginga');
  const pages = paginate(ginga, 24, 16);
  const flat = (s) => s.replace(/[\s　]/g, '');
  const body = pages.flat().filter((l) => !l.title).map((l) => l.text).join('');
  assert.equal(flat(body), flat(ginga.chapters.flatMap((c) => c.paras).join('')));
  for (let i = 1; i < pages.length; i += 1) {
    if (pages[i][0].chapter !== pages[i - 1][0].chapter) assert.equal(pages[i][0].title, true, `${i}`);
  }
  const target = pages[40].find((l) => l.para >= 0);
  const again = paginate(ginga, 30, 20);
  const k = pageOfPlace(again, target);
  const has = (p) => p.some((l) => l.chapter === target.chapter && l.para === target.para && l.at <= target.at && target.at < l.at + l.text.length);
  assert.ok(has(again[k]) || has(again[k + 1]) || (k > 0 && has(again[k - 1])), `${k}`);
});
