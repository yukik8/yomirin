// 目の実験室(#6)の計算。カメラにも画面にも触らない。
//
// - frameOf: Face Landmarker の1コマの答え → 数字(まぶた・視線・頭の向き・虹彩の位置)
// - createTracker: 1コマずつ数字を受け、閉じ・あくび・こっくり・画面にあるか・うとうとを追い、
//   1秒ごとに #6 の信号(rs_eyes)の行を出す
// - ページの読み進み(#8): めくりの時刻を教師にしたリッジ回帰・門・ページを一つ抜いた検証
// - createFollower: 時間(ふだんの速さで進む)と目(リッジの推定)を合わせて、ページのどこにいるかを追う
//
// 閾値は #6 の「測る信号」に置いた仮の値。この実験室で測って決め、#7 がそのまま拡張へ移す。

export const EYES = {
  closed: 0.5, //               補正したまぶたの閉じ(0=いつもの開き・1=閉じ)がこれを超えたら閉じ
  closedLookingDown: 0.7, //    下の行を読んでいる(eyeLookDown > lookingDown)ときは、これを超えないと閉じにしない
  lookingDown: 0.5,
  baselineMs: 120_000, //       最初の2分で「開いているときの中央値」を取る
  blinkMs: 400, //              これ未満の閉じはまばたき(数えるだけ)。以上は長い閉じ
  yawn: { jaw: 0.5, ms: 1500 },
  nod: { deg: 15, ms: 1000, back: 5 }, // 1秒以内に15°以上下がり、1秒以内に5°の差まで戻る
  screen: { yaw: 25, pitchDown: -30, pitchUp: 20, gazeSide: 0.6 },
  awayMs: 500, //               画面から外れたのがこれだけ続いたら away
  backMs: 300, //               戻ったのがこれだけ続いたら back
  windowMs: 60_000, //          perclos と長い閉じ・あくびを数える窓
  drowsy: { perclos: 0.15, holdMs: 60_000, longClosures: 2, yawnPerclos: 0.08, offMs: 90_000, lockMs: 20_000 },
  // 頭の向きの pitch の符号。下を向くと負になる向きにそろえる(実験室で下を向いて確かめ、逆なら -1)
  pitchSign: 1,
  progress: {
    minPages: 4, //             使えるページがこれだけたまってから推定を始める
    minPageMs: 3000,
    maxPageMs: 600_000,
    maxAwayMs: 2000, //         ページの途中で画面から外れていた時間がこれを超えたら教師にしない
    ridge: 0.05, //             標準化した特徴に掛けるリッジの強さ
    smoothMs: 1000, //          推定は直近1秒の中央値
    gatePages: 3, //            門: 直近3ページで
    gateEnd: 0.7, //            めくる直前の推定が 0.7 を超えていた割合が
    gatePass: 2 / 3, //         2/3 以上なら使う
    endMs: 1500, //             「めくる直前」= めくる前の 1.5 秒
    lidShut: 0.5, //            まぶたの開きがふだんのこれ未満のコマ(まばたき中)は、虹彩の位置が狂うので使わない
  },
  // 時間と目を合わせる(カルマンフィルタ。位置と速さの2つを追う)。単位はページ(0〜1)と秒
  follow: {
    startSd: 0.03, //           めくった直後の位置のばらつき
    speedSpread: 0.3, //        ページごとの読む速さのばらつき(ふだんの速さに対して)
    posNoise: 0.03, //          位置の揺れ(1秒あたり。行を戻る・考えて止まる)
    speedNoise: 0.1, //         速さの揺れ(ふだんの速さに対して、1秒あたり)
    // 目の推定の誤差は数秒続く(頭が少し動くと、しばらく同じ向きにずれる)。この長さの間のコマは
    // 1コマぶんの証拠として数える(6fps なら1コマの誤差を15倍に見る)。時間の教師では決められないので、
    // 速さを揺らしてなぞったページ(正解が時間に比例しない)で合わせ直す
    measCorrMs: 2500,
  },
};

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
export const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---- 1コマ → 数字 ---------------------------------------------------------

export function blendOf(categories = []) {
  const b = {};
  for (const c of categories) b[c.categoryName] = c.score;
  return b;
}

// 顔の変換行列(4×4)から頭の向き(度)。顔の正面の向き = 回転の3列目。
// 列優先か行優先かは、平行移動(z は数十 cm)がどちらの位置に入っているかで見分ける。
export function headPose(d, sign = EYES.pitchSign) {
  if (!d || d.length < 16) return null;
  const col = Math.abs(d[14]) >= Math.abs(d[11]);
  const R = (r, c) => (col ? d[c * 4 + r] : d[r * 4 + c]);
  const deg = 180 / Math.PI;
  const [fx, fy, fz] = [R(0, 2), R(1, 2), R(2, 2)];
  return {
    yaw: Math.atan2(fx, fz) * deg,
    pitch: Math.asin(clamp(fy, -1, 1)) * deg * sign,
    roll: Math.atan2(R(1, 0), R(0, 0)) * deg,
  };
}

// Face Landmarker の 478 点のうち、目尻・目頭・まぶた・虹彩の中心。right/left は本人から見た左右
const EYE = {
  right: { corners: [33, 133], lids: [159, 145] },
  left: { corners: [362, 263], lids: [386, 374] },
};
const IRIS = [468, 473];
const CHEEK = [234, 454];
const NOSE = 1;

// 虹彩の中心を、目の幅で割った目の中の位置にする。
// x: 画像の左の端 0 → 右の端 1(両目とも同じ向き)。y: 目尻と目頭を結ぶ線から画像の下向きを正。
// open: まぶたの開き(上下の幅 ÷ 目の幅)
export function irisOf(lm, width = 640, height = 480) {
  if (!lm || lm.length < 478) return null;
  const P = (i) => ({ x: lm[i].x * width, y: lm[i].y * height });
  const eyes = {};
  for (const [side, e] of Object.entries(EYE)) {
    const [a, b] = e.corners.map(P).sort((p, q) => p.x - q.x);
    const w = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(w > 0)) return null;
    eyes[side] = { a, b, w, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, up: P(e.lids[0]), down: P(e.lids[1]) };
  }
  // 虹彩の中心は近いほうの目に結ぶ(左右の呼び名の取り違えに強くする)
  const [c0, c1] = IRIS.map(P);
  const dist = (c, e) => Math.hypot(c.x - e.mid.x, c.y - e.mid.y);
  const straight = dist(c0, eyes.right) + dist(c1, eyes.left) <= dist(c1, eyes.right) + dist(c0, eyes.left);
  const [ir, il] = straight ? [c0, c1] : [c1, c0];
  const inEye = (c, e) => {
    const ux = (e.b.x - e.a.x) / e.w;
    const uy = (e.b.y - e.a.y) / e.w;
    return {
      x: ((c.x - e.a.x) * ux + (c.y - e.a.y) * uy) / e.w,
      y: ((c.x - e.mid.x) * -uy + (c.y - e.mid.y) * ux) / e.w,
      open: Math.hypot(e.down.x - e.up.x, e.down.y - e.up.y) / e.w,
    };
  };
  return { right: inEye(ir, eyes.right), left: inEye(il, eyes.left) };
}

// Face Landmarker の答え(faceLandmarks・faceBlendshapes・facialTransformationMatrixes)→ 1コマの数字
export function frameOf(result, { width = 640, height = 480, luma = null, pitchSign = EYES.pitchSign } = {}) {
  const lm = result?.faceLandmarks?.[0];
  if (!lm) return { face: false, luma };
  const b = blendOf(result.faceBlendshapes?.[0]?.categories);
  const pose = headPose(result.facialTransformationMatrixes?.[0]?.data, pitchSign);
  const iris = irisOf(lm, width, height);
  const g = (k) => b[k] ?? 0;
  return {
    face: true,
    luma,
    blink: (g('eyeBlinkLeft') + g('eyeBlinkRight')) / 2,
    lookDown: (g('eyeLookDownLeft') + g('eyeLookDownRight')) / 2,
    lookUp: (g('eyeLookUpLeft') + g('eyeLookUpRight')) / 2,
    // 本人の左へ向くと正: 左目は外、右目は内
    gazeX: (g('eyeLookOutLeft') - g('eyeLookInLeft') + (g('eyeLookInRight') - g('eyeLookOutRight'))) / 2,
    jaw: g('jawOpen'),
    yaw: pose?.yaw ?? null,
    pitch: pose?.pitch ?? null,
    roll: pose?.roll ?? null,
    irisRX: iris?.right.x ?? null,
    irisRY: iris?.right.y ?? null,
    irisLX: iris?.left.x ?? null,
    irisLY: iris?.left.y ?? null,
    openR: iris?.right.open ?? null,
    openL: iris?.left.open ?? null,
    lookDownR: g('eyeLookDownRight'),
    lookDownL: g('eyeLookDownLeft'),
    lookUpR: g('eyeLookUpRight'),
    lookUpL: g('eyeLookUpLeft'),
    lookInR: g('eyeLookInRight'),
    lookInL: g('eyeLookInLeft'),
    lookOutR: g('eyeLookOutRight'),
    lookOutL: g('eyeLookOutLeft'),
    faceWidth: Math.abs(lm[CHEEK[1]].x - lm[CHEEK[0]].x),
    noseX: lm[NOSE].x,
    noseY: lm[NOSE].y,
  };
}

// 目が画面に向いているか(1コマ。ゆらぎ止めは追跡器で掛ける)
export function onScreenOf(f, C = EYES) {
  if (!f?.face || f.yaw == null || f.pitch == null) return false;
  const s = C.screen;
  return Math.abs(f.yaw) <= s.yaw && f.pitch >= s.pitchDown && f.pitch <= s.pitchUp && Math.abs(f.gazeX) < s.gazeSide;
}

// 信頼度 0〜1(仮): 顔の大きさ × 明るさ × 検出の安定さ
export function confOf(f, jitter = 0) {
  if (!f?.face) return 0;
  const size = clamp((f.faceWidth - 0.08) / 0.12);
  const light = f.luma == null ? 1 : clamp((f.luma - 40) / 50);
  const steady = 1 - clamp(jitter / 0.03);
  return size * light * steady;
}

// ---- 1コマずつ追う ---------------------------------------------------------

export function createTracker(C = EYES) {
  const s = {
    start: null,
    lastT: null,
    base: [],
    open: null,
    closedSince: null,
    longCounted: false,
    longs: [],
    jawSince: null,
    yawnCounted: false,
    yawns: [],
    win: [],
    rawOff: null,
    rawOn: null,
    away: false,
    highSince: null,
    drowsy: false,
    onAt: null,
    lowSince: null,
    pitches: [],
    dip: null,
    nose: null,
    sec: null,
    blinks: 0,
    lids: [],
    lidOpen: null,
  };
  const D = C.drowsy;

  function perclosAt(t) {
    while (s.win.length && s.win[0].t < t - C.windowMs) s.win.shift();
    let all = 0;
    let shut = 0;
    for (const w of s.win) {
      all += w.dt;
      if (w.closed) shut += w.dt;
    }
    return all > 0 ? shut / all : 0;
  }
  const recent = (list, t) => list.filter((x) => x > t - C.windowMs).length;

  function push(t, f, extra = {}) {
    const events = [];
    const rows = [];
    if (s.start == null) s.start = t;
    const dt = s.lastT == null ? 0 : Math.min(500, Math.max(0, t - s.lastT));
    s.lastT = t;
    const face = !!f?.face;

    // まぶたの基準: 最初の2分の中央値を「いつもの開き」にする(2分までは途中の中央値)
    if (face && t - s.start <= C.baselineMs) {
      s.base.push(f.blink);
      if (s.base.length >= 10) s.open = median(s.base);
    }
    const closedNorm = face ? (s.open == null ? f.blink : clamp((f.blink - s.open) / Math.max(1e-6, 1 - s.open))) : null;
    // まぶたの開き(座標で測った上下の幅)も、最初の2分の中央値を「ふだん」にする。
    // 6fps だとまばたきの瞬間の blendshape はほとんど上がりきらないが、開きの幅では見える(#6 の最初の記録)
    const lid = face && Number.isFinite(f.openR) && Number.isFinite(f.openL) ? (f.openR + f.openL) / 2 : null;
    if (lid != null && t - s.start <= C.baselineMs) {
      s.lids.push(lid);
      if (s.lids.length >= 10) s.lidOpen = median(s.lids);
    }
    const lidRatio = lid != null && s.lidOpen ? lid / s.lidOpen : null;
    const lidShut = lidRatio != null && lidRatio < C.progress.lidShut;
    const lookingDown = face && f.lookDown > C.lookingDown;
    const closed = face && closedNorm > (lookingDown ? C.closedLookingDown : C.closed);

    // 閉じの区切り: 0.4秒未満はまばたき、以上は長い閉じ(閉じている途中で数える)
    if (closed) {
      if (s.closedSince == null) s.closedSince = t;
      if (!s.longCounted && t - s.closedSince >= C.blinkMs) {
        s.longCounted = true;
        s.longs.push(t);
        events.push({ t, type: 'long_close' });
      }
    } else if (s.closedSince != null) {
      if (face && !s.longCounted) {
        s.blinks += 1;
        events.push({ t, type: 'blink', ms: t - s.closedSince });
      }
      s.closedSince = null;
      s.longCounted = false;
    }

    // あくび
    if (face && f.jaw > C.yawn.jaw) {
      if (s.jawSince == null) s.jawSince = t;
      if (!s.yawnCounted && t - s.jawSince >= C.yawn.ms) {
        s.yawnCounted = true;
        s.yawns.push(t);
        events.push({ t, type: 'yawn' });
      }
    } else {
      s.jawSince = null;
      s.yawnCounted = false;
    }

    // こっくり(数えるだけ。うとうとの判定には使わない)
    if (face && f.pitch != null) {
      s.pitches = s.pitches.filter((p) => p.t >= t - C.nod.ms);
      const top = Math.max(f.pitch, ...s.pitches.map((p) => p.v));
      s.pitches.push({ t, v: f.pitch });
      if (s.dip) {
        if (f.pitch >= s.dip.ref - C.nod.back && t - s.dip.t <= C.nod.ms) {
          events.push({ t, type: 'nod' });
          s.dip = null;
        } else if (t - s.dip.t > C.nod.ms) s.dip = null;
      } else if (f.pitch <= top - C.nod.deg) s.dip = { t, ref: top };
    }

    // perclos(顔があるコマだけで数える)
    if (face) s.win.push({ t, dt, closed });
    const perclos = perclosAt(t);

    // 画面にあるか(外れて0.5秒で away、戻って0.3秒で back)
    const onRaw = onScreenOf(f, C);
    if (onRaw) {
      s.rawOff = null;
      if (s.rawOn == null) s.rawOn = t;
      if (s.away && t - s.rawOn >= C.backMs) {
        s.away = false;
        events.push({ t, type: 'back' });
      }
    } else {
      s.rawOn = null;
      if (s.rawOff == null) s.rawOff = t;
      if (!s.away && t - s.rawOff >= C.awayMs) {
        s.away = true;
        events.push({ t, type: 'away' });
      }
    }

    // うとうと: ① perclos > 0.15 が60秒 ② 60秒に長い閉じ2回 ③ あくび+perclos > 0.08
    const high = perclos > D.perclos;
    if (high) s.highSince ??= t;
    else s.highSince = null;
    const longs = recent(s.longs, t);
    const yawned = recent(s.yawns, t) > 0 && perclos > D.yawnPerclos;
    const why = [s.highSince != null && t - s.highSince >= D.holdMs && 'perclos', longs >= D.longClosures && 'long_close', yawned && 'yawn'].filter(Boolean);
    if (!s.drowsy) {
      if (why.length) {
        s.drowsy = true;
        s.onAt = t;
        s.lowSince = null;
        events.push({ t, type: 'drowsy_on', why: why.join('+') });
      }
    } else if (t - s.onAt >= D.lockMs) {
      const low = !high && longs < D.longClosures && !yawned;
      if (!low) s.lowSince = null;
      else {
        s.lowSince ??= t;
        if (t - s.lowSince >= D.offMs) {
          s.drowsy = false;
          s.lowSince = null;
          events.push({ t, type: 'drowsy_off' });
        }
      }
    }

    // 信頼度(鼻の動きで安定さを見る)
    let jitter = 0;
    if (face) {
      if (s.nose) jitter = Math.hypot(f.noseX - s.nose.x, f.noseY - s.nose.y);
      s.nose = { x: f.noseX, y: f.noseY };
    } else s.nose = null;
    const conf = confOf(f, jitter);

    // 1秒ごとの行
    const idx = Math.floor((t - s.start) / 1000);
    if (s.sec && idx > s.sec.idx) {
      rows.push(rowOf(s.sec));
      s.sec = null;
    }
    s.sec ??= { idx, closedMs: 0, faceN: 0, n: 0, conf: 0, progress: null };
    s.sec.n += 1;
    s.sec.faceN += face ? 1 : 0;
    s.sec.closedMs += closed ? dt : 0;
    s.sec.conf += conf;
    if (extra.progress != null) s.sec.progress = extra.progress;
    s.sec.perclos = perclos;
    s.sec.drowsy = s.drowsy;
    s.sec.on = !s.away;

    return {
      now: { face, closedNorm, closed, lookingDown, onRaw, onScreen: !s.away, perclos, drowsy: s.drowsy, conf, open: s.open, longs, blinks: s.blinks, lidRatio, lidShut },
      events,
      rows,
    };
  }

  function rowOf(sec) {
    return {
      t: Math.round(s.start + (sec.idx + 1) * 1000),
      face: sec.faceN * 2 >= sec.n,
      on_screen: sec.on,
      progress: sec.progress == null ? null : round(sec.progress, 3),
      closed_ms: Math.round(sec.closedMs),
      perclos: round(sec.perclos, 3),
      drowsy: sec.drowsy,
      conf: round(sec.conf / sec.n, 2),
    };
  }

  return { push, state: s };
}

// ---- ページの読み進み(#8) -------------------------------------------------

// eyes(既定)は目だけ: 虹彩の位置と、blendshape の視線と、まぶたの開き。
// base は #8 に書いた6つ(虹彩の位置+頭の yaw・pitch)。plus は eyes + 頭の向き。
// 最初の記録では、頭の向きと読み進みの相関がページごとに符号まで入れ替わり(雑音)、目の数字はそろっていた
const IRIS_XY = ['irisRX', 'irisRY', 'irisLX', 'irisLY'];
const GAZE = ['lookDownR', 'lookDownL', 'lookUpR', 'lookUpL', 'lookInR', 'lookInL', 'lookOutR', 'lookOutL', 'openR', 'openL'];
export const FEATURES = {
  eyes: [...IRIS_XY, ...GAZE],
  base: [...IRIS_XY, 'yaw', 'pitch'],
  plus: [...IRIS_XY, 'yaw', 'pitch', ...GAZE],
};

export function vectorOf(f, names) {
  if (!f?.face) return null;
  const x = names.map((k) => f[k]);
  return x.every(Number.isFinite) ? x : null;
}

// 十分統計量(ページごとに持てば、ページを一つ抜いた当てはめが足し引きで済む)
export function statsOf(rows, d = rows[0]?.x.length ?? 0) {
  const st = { n: 0, d, sx: Array(d).fill(0), sy: 0, syy: 0, sxx: Array.from({ length: d }, () => Array(d).fill(0)), sxy: Array(d).fill(0) };
  for (const { x, y } of rows) {
    st.n += 1;
    st.sy += y;
    st.syy += y * y;
    for (let i = 0; i < d; i += 1) {
      st.sx[i] += x[i];
      st.sxy[i] += x[i] * y;
      for (let j = 0; j < d; j += 1) st.sxx[i][j] += x[i] * x[j];
    }
  }
  return st;
}

export function addStats(a, b, sign = 1) {
  if (!a) return b && addStats(statsOf([], b.d), b, sign);
  const d = a.d;
  return {
    n: a.n + sign * b.n,
    d,
    sx: a.sx.map((v, i) => v + sign * b.sx[i]),
    sy: a.sy + sign * b.sy,
    syy: a.syy + sign * b.syy,
    sxx: a.sxx.map((r, i) => r.map((v, j) => v + sign * b.sxx[i][j])),
    sxy: a.sxy.map((v, i) => v + sign * b.sxy[i]),
  };
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j += 1) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// 特徴を標準化してからのリッジ回帰。返すのは元の尺度の w と b
export function fitRidge(st, lambda = EYES.progress.ridge) {
  if (!st || st.n < st.d + 2) return null;
  const { n, d } = st;
  const mu = st.sx.map((v) => v / n);
  const my = st.sy / n;
  const cov = st.sxx.map((r, i) => r.map((v, j) => v / n - mu[i] * mu[j]));
  const sd = cov.map((r, i) => (r[i] > 1e-12 ? Math.sqrt(r[i]) : 1));
  const cxy = st.sxy.map((v, i) => v / n - mu[i] * my);
  const A = cov.map((r, i) => r.map((v, j) => v / (sd[i] * sd[j]) + (i === j ? lambda : 0)));
  const ws = solve(
    A,
    cxy.map((v, i) => v / sd[i]),
  );
  if (!ws) return null;
  const w = ws.map((v, i) => v / sd[i]);
  const b = my - w.reduce((acc, v, i) => acc + v * mu[i], 0);
  // 当てはめた式の残差の2乗平均(Σ(y − b − w·x)² を統計量から)
  let sse = st.syy - 2 * b * st.sy + n * b * b;
  for (let i = 0; i < d; i += 1) {
    sse += -2 * w[i] * st.sxy[i] + 2 * b * w[i] * st.sx[i];
    for (let j = 0; j < d; j += 1) sse += w[i] * w[j] * st.sxx[i][j];
  }
  return { w, b, n, r2: Math.max(1e-4, sse / n) };
}

export const predict = (m, x) => m.b + m.w.reduce((acc, v, i) => acc + v * x[i], 0);

// 直近 ms の中央値(後ろ向きだけ。読んでいる最中に使えるのと同じ形)
export function smooth(times, values, ms = EYES.progress.smoothMs) {
  const out = [];
  let lo = 0;
  for (let i = 0; i < values.length; i += 1) {
    while (times[lo] < times[i] - ms) lo += 1;
    out.push(median(values.slice(lo, i + 1).filter(Number.isFinite)));
  }
  return out;
}

// page = { start, end, guided, skip, awayMs, fill, frames: [{ t, on, x: { base, plus }, truth? }] }
//   skip: 途中から読み始めた・戻った・読み直したページ(教師にしない)
//   fill: ページのうち字がある所の割合(章の終わりの短いページは、読み終えても下まで行かない)
export function usable(page, P = EYES.progress) {
  if (page.guided || page.skip || page.end == null) return false;
  const ms = page.end - page.start;
  return ms >= P.minPageMs && ms <= P.maxPageMs && (page.awayMs ?? 0) <= P.maxAwayMs;
}

// ふだんの速さ(1ページを読み切る速さ・ページ/秒)。使えるページの「字のある所 ÷ 時間」の中央値
export function speedOf(pages, P = EYES.progress) {
  const v = pages.filter((p) => usable(p, P)).map((p) => (p.fill ?? 1) / ((p.end - p.start) / 1000));
  return median(v);
}

// 時間の教師: ページの中を同じ速さで読んだとみなす
export const teacherOf = (page, t) => clamp((t - page.start) / (page.end - page.start)) * (page.fill ?? 1);

export function pageStats(page, set) {
  const rows = page.frames.filter((f) => f.on && f.x?.[set]).map((f) => ({ x: f.x[set], y: teacherOf(page, f.t) }));
  return rows.length ? statsOf(rows) : null;
}

export function fitProgress(pages, set = 'eyes', P = EYES.progress) {
  const use = pages.filter((p) => usable(p, P));
  if (use.length < P.minPages) return null;
  let st = null;
  for (const p of use) {
    const s = pageStats(p, set);
    if (s) st = addStats(st, s);
  }
  return fitRidge(st, P.ridge);
}

// ページの各コマの推定(直近1秒の中央値・0〜1 に切る)と、比べる正解(なぞったページは truth、ほかは時間の教師)
export function predictPage(model, page, set = 'eyes', P = EYES.progress) {
  const fr = page.frames.filter((f) => f.on && f.x?.[set]);
  const est = smooth(
    fr.map((f) => f.t),
    fr.map((f) => clamp(predict(model, f.x[set]))),
    P.smoothMs,
  );
  return fr.map((f, i) => ({ t: f.t, est: est[i], y: page.guided ? f.truth : page.end != null ? teacherOf(page, f.t) : null }));
}

// ---- 時間と目を合わせて追う ------------------------------------------------
//
// 位置 x(0〜1)と速さ v(ページ/秒)を追う。めくると x=0・v=ふだんの速さから始め、
// 時間が経つと v で進み(画面から外れている間は止まる)、目の推定 z が来るたびに x と v を直す。
// 目が使えないコマ(z が null)は時間だけで進む。目を一度も使わなければ「時間だけ」の推定になる。
export function createFollower(F = EYES.follow) {
  let x = 0;
  let v = 0;
  let v0 = 0;
  let fill = 1;
  let Pxx = 0;
  let Pxv = 0;
  let Pvv = 0;
  let last = null;
  const out = () => ({ x, sd: Math.sqrt(Math.max(0, Pxx)), v });
  return {
    open(t, { speed, fill: f = 1 }) {
      x = 0;
      v = v0 = speed;
      fill = f;
      Pxx = F.startSd ** 2;
      Pxv = 0;
      Pvv = (F.speedSpread * speed) ** 2;
      last = t;
      return out();
    },
    step(t, z = null, r2 = 0.04, away = false) {
      if (last == null) return null;
      const dt = Math.max(0, Math.min(2, (t - last) / 1000));
      last = t;
      if (!away) {
        x += v * dt;
        Pxx += 2 * dt * Pxv + dt * dt * Pvv + F.posNoise ** 2 * dt;
        Pxv += dt * Pvv;
        Pvv += (F.speedNoise * v0) ** 2 * dt;
        if (z != null) {
          const S = Pxx + r2 * Math.max(1, F.measCorrMs / Math.max(1, dt * 1000));
          const kx = Pxx / S;
          const kv = Pxv / S;
          const e = clamp(z, -0.2, 1.2) - x;
          x += kx * e;
          v += kv * e;
          Pvv -= kv * Pxv;
          Pxx *= 1 - kx;
          Pxv *= 1 - kx;
        }
      }
      // ページの外へは出ない。逆向きには読まない(戻り読みは位置の揺れで受ける)
      if (x < 0) x = 0;
      if (x > fill) x = fill;
      if (v < 0) v = 0;
      return out();
    },
    get value() {
      return out();
    },
  };
}

// 1ページを、目だけ・時間だけ・合わせた推定でなぞる(検証用)
export function followPage(model, speed, page, set = 'eyes', P = EYES.progress, F = EYES.follow) {
  const eyes = predictPage(model, page, set, P);
  const both = createFollower(F);
  const time = createFollower(F);
  both.open(page.start, { speed, fill: page.fill ?? 1 });
  time.open(page.start, { speed, fill: page.fill ?? 1 });
  let k = 0;
  const out = [];
  for (const f of page.frames) {
    const usable = f.on && f.x?.[set];
    const z = usable ? predict(model, f.x[set]) : null;
    const b = both.step(f.t, z, model.r2, !!f.away);
    const tm = time.step(f.t, null, model.r2, !!f.away);
    const y = page.guided ? f.truth : page.end != null ? teacherOf(page, f.t) : null;
    const e = usable ? eyes[k++]?.est : null;
    out.push({ t: f.t, y, eyes: e, time: tm.x, both: b.x, sd: b.sd });
  }
  return out;
}

// ページの上1/3と下1/3の見分け(#6 の判定基準): 正解が 1/3 未満か 2/3 超のコマで、推定が 0.5 のどちら側か
export function thirds(pairs) {
  const xs = pairs.filter((p) => p.y != null && p.est != null && (p.y < 1 / 3 || p.y > 2 / 3));
  const ok = xs.filter((p) => p.y < 1 / 3 === p.est < 0.5).length;
  const all = pairs.filter((p) => p.y != null && p.est != null);
  const mae = all.length ? all.reduce((a, p) => a + Math.abs(p.est - p.y), 0) / all.length : null;
  return { acc: xs.length ? ok / xs.length : null, n: xs.length, mae };
}

// 門: 直近3ページで、めくる直前1.5秒の推定の中央値が 0.7 を超えていた割合が 2/3 以上
export function gateOf(model, pages, set = 'eyes', P = EYES.progress) {
  if (!model) return { open: false, pass: 0, of: 0 };
  const last = pages.filter((p) => usable(p, P)).slice(-P.gatePages);
  let pass = 0;
  for (const p of last) {
    const end = predictPage(model, p, set, P)
      .filter((q) => q.t >= p.end - P.endMs)
      .map((q) => q.est);
    if (median(end) > P.gateEnd * (p.fill ?? 1)) pass += 1;
  }
  return { open: last.length > 0 && pass / last.length >= P.gatePass, pass, of: last.length };
}

// 検証: ふつうに読んだページは、そのページを抜いて当てはめた式で当てる(時間の教師と比べる)。
// なぞったページは、ふつうに読んだページ全部で当てはめた式で当て、なぞった位置(本当の位置)と比べる。
export function evaluate(pages, set = 'eyes', P = EYES.progress) {
  const use = pages.filter((p) => usable(p, P));
  const stats = use.map((p) => pageStats(p, set));
  let total = null;
  for (const s of stats) if (s) total = addStats(total, s);
  const lopo = [];
  if (use.length >= P.minPages) {
    use.forEach((p, i) => {
      const m = stats[i] ? fitRidge(addStats(total, stats[i], -1), P.ridge) : null;
      if (m) lopo.push(...predictPage(m, p, set, P));
    });
  }
  const model = use.length >= P.minPages ? fitRidge(total, P.ridge) : null;
  const speed = speedOf(pages, P);
  const done = pages.filter((q) => q.guided && q.end != null);
  const rows = model ? done.flatMap((p) => followPage(model, speed, p, set, P)) : [];
  const as = (k) => thirds(rows.map((r) => ({ y: r.y, est: r[k] })));
  // なぞったページ(正解はなぞった位置): 目だけ・時間だけ・合わせた
  return { pages: use.length, lopo: thirds(lopo), guided: { ...as('eyes'), pages: done.length, time: as('time'), both: as('both') } };
}
