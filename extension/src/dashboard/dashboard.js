// ダッシュボード(拡張内フルページ)。記録層・計測層の閲覧と、データ管理の置き場。
// 拡張ページはSWと同じIndexedDBを見られるので、集計は直接読む。
// θ変更と全消去だけはSW経由(進行中セッションへの反映・後片付けがSWの仕事なので)。

import { Msg } from '../shared/events.js';
import {
  THETA_MAX,
  GOALS,
  PASS,
  IS_STORE_BUILD,
  readDemoFlag,
  writeDemoFlag,
  readServerConsent,
  writeServerConsent,
  readTelemetryChoice,
  readTextConsent,
  writeTextConsent,
  readStartPrompt,
  writeStartPrompt,
} from '../shared/config.js';
import { bearImg, showBear } from '../content/bear.js';
import { buildMirror } from '../background/mirror.js';
import { buildKpi } from '../background/kpi.js';
import {
  buildBookshelf,
  isBookPage,
  buildLibrary,
  buildQuizLog,
  buildTotals,
  buildThetaHistory,
  buildStabilityReport,
} from '../background/library.js';
import {
  getState,
  getAllSessions,
  getAllEvents,
  getAllPages,
  getAllQuizzes,
  getAllQuizAttempts,
  getAllQuestions,
  getAllReadings,
  getAllMarks,
  getAllMemoryItems,
  getAllRecalls,
} from '../background/store.js';
import { buildDue, recordRecall, buildRetention } from '../background/memory.js';

const $ = (id) => document.getElementById(id);

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

function shortDate(t) {
  if (!t) return '';
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function thetaText(theta) {
  const note = theta === 0 ? '(補助なし)' : theta >= THETA_MAX ? '(補助が最大)' : '';
  return `θ=${theta.toFixed(1)}/1,000語${note}`;
}

// 自立度 = 1 − θ/θmax。帯は自立度の節目(白→黄→緑→茶、卒業=黒)。
// 言葉で褒めない — 色が段位を語る(武道の帯)。
function independence(theta) {
  return Math.min(1, Math.max(0, 1 - theta / THETA_MAX));
}

// ヘッダのくまは、補助の量で居場所が変わる(状態を示すだけ。動きもご褒美もない):
// 隣で一緒に読む → 自分の本を読む → 背を向ける → 卒業したら本だけが残る
function mascotFor(theta) {
  if (theta === 0) return 'book';
  const i = independence(theta);
  if (i < 1 / 3) return 'read';
  if (i < 2 / 3) return 'read-side';
  return 'turn';
}

// 記録の画面なので、くすんだ色で塗る(金・虹はフィーバーの合図なので使わない)
function rankFor(theta) {
  if (theta === 0) return { name: '黒', color: '#4f3a2c' };
  const i = independence(theta);
  if (i < 0.25) return { name: '白', color: '#fbf6ec' };
  if (i < 0.5) return { name: '黄', color: '#e9d08f' };
  if (i < 0.75) return { name: '緑', color: '#a9bf9c' };
  return { name: '茶', color: '#b98257' };
}

/** 帯セクションの表示をθから更新する(スライダー含む)。 */
function renderTheta(theta) {
  $('theta-label').textContent = thetaText(theta);
  $('theta').value = String(theta);
  const rank = rankFor(theta);
  const belt = $('belt');
  belt.style.background = rank.color;
  belt.title = `帯: ${rank.name}`;
  showBear($('mascot'), mascotFor(theta));
  $('indep-pct').textContent = `${Math.round(independence(theta) * 100)}%`;
  $('obi-ring').style.left = `${(theta / THETA_MAX) * 100}%`;
}

// ---- θダイヤル ------------------------------------------------------------

$('theta').addEventListener('input', () => {
  $('theta-label').textContent = thetaText(Number($('theta').value));
});

$('theta').addEventListener('change', async () => {
  const res = await send(Msg.SET_THETA, { theta: Number($('theta').value) });
  if (res?.ok) renderTheta(res.theta);
});

// ---- 週次目標(達成率×θ) ---------------------------------------------------

// 目標セレクタ。選択は評価レイヤーだけを変える(θの力学には影響しない)。
for (const [key, g] of Object.entries(GOALS)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = `${g.name} — ${g.desc}`;
  $('goal').append(opt);
}

$('goal').addEventListener('change', async () => {
  await send(Msg.SET_GOAL, { goal: $('goal').value });
  drawKpi(await buildKpi());
});

/**
 * 達成率(棒・左軸0〜100%)とθ(茶色の線・右軸8〜0)の二軸グラフ。
 * 「棒が高いままで線が下がる」= 補助に依存せず読めている、が読み取りたい形。
 * 責めない: 未達の棒も色を変えない・警告を出さない。
 */
function drawKpi(kpi) {
  $('goal').value = kpi.goalKey;

  const hasData = kpi.weeks.some((w) => w.sessions > 0);
  $('kpi-empty').hidden = hasData;
  $('kpi-wrap').hidden = !hasData;
  $('kpi-line').hidden = !hasData;
  if (!hasData) return;

  const svg = $('kpi');
  svg.textContent = '';
  const ns = 'http://www.w3.org/2000/svg';
  const W = 600;
  const padX = 10;
  const top = 14;
  const bottom = 146;
  const n = kpi.weeks.length;
  const slot = (W - padX * 2) / n;

  for (const gy of [top, (top + bottom) / 2, bottom]) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', padX);
    line.setAttribute('x2', W - padX);
    line.setAttribute('y1', gy);
    line.setAttribute('y2', gy);
    line.setAttribute('class', 'growth-grid');
    svg.append(line);
  }

  // 合格ライン(達成率80%)。事実として引くだけで、下回っても色は変えない(責めない)
  const passY = bottom - PASS.achievementFloor * (bottom - top);
  const passLine = document.createElementNS(ns, 'line');
  passLine.setAttribute('x1', padX);
  passLine.setAttribute('x2', W - padX);
  passLine.setAttribute('y1', passY);
  passLine.setAttribute('y2', passY);
  passLine.setAttribute('class', 'kpi-pass');
  svg.append(passLine);

  // 達成率の棒
  kpi.weeks.forEach((w, i) => {
    if (w.sessions === 0) return;
    const h = w.achievement * (bottom - top);
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', padX + i * slot + slot * 0.18);
    rect.setAttribute('width', slot * 0.64);
    rect.setAttribute('y', bottom - h);
    rect.setAttribute('height', Math.max(h, w.achievement > 0 ? 2 : 0));
    rect.setAttribute('class', w.achievement >= 1 ? 'kpi-bar kpi-bar-full' : 'kpi-bar');
    svg.append(rect);
  });

  // θの線(データのある週だけ結ぶ)。右軸はθ8が上・0が下 — 卒業に向かって線が沈む
  const pts = kpi.weeks
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => w.theta_avg !== null)
    .map(({ w, i }) => ({
      x: padX + i * slot + slot / 2,
      y: top + (1 - w.theta_avg / THETA_MAX) * (bottom - top),
    }));
  if (pts.length >= 2) {
    const poly = document.createElementNS(ns, 'polyline');
    poly.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('class', 'growth-line');
    svg.append(poly);
  }
  for (const p of pts) {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', p.x);
    dot.setAttribute('cy', p.y);
    dot.setAttribute('r', 3);
    dot.setAttribute('class', 'growth-dot');
    svg.append(dot);
  }

  const xAxis = $('kpi-x');
  xAxis.textContent = '';
  for (const w of kpi.weeks) {
    const span = document.createElement('span');
    span.textContent = w.label;
    xAxis.append(span);
  }

  // 今週の事実(警告なし・比較は自分の全期間のみ)
  const thisWeek = kpi.weeks[kpi.weeks.length - 1];
  const line = $('kpi-line');
  line.textContent = '';
  const add = (text, strong = false) => {
    if (strong) {
      const b = document.createElement('b');
      b.textContent = text;
      line.append(b);
    } else {
      line.append(document.createTextNode(text));
    }
  };
  add('今週 成功 ');
  add(`${thisWeek.success_count}回`, true);
  add(' · 連続の中央値 ');
  add(`${thisWeek.streak_median_min}分`, true);
  add(' · 補助なし ');
  add(`${thisWeek.unassisted_min}分`, true);
  // 合格ラインの維持: 直近4週のうち達成率80%以上だった週数(目標は3週)
  const recent = kpi.weeks.slice(-PASS.weeksWindow);
  const kept = recent.filter((w) => w.achievement >= PASS.achievementFloor).length;
  add(` · 直近${PASS.weeksWindow}週で${Math.round(PASS.achievementFloor * 100)}%以上 `);
  add(`${kept}週`, true);
  if (kpi.quiz.week.total > 0) {
    add(' · クイズ ');
    add(`${kpi.quiz.week.correct}/${kpi.quiz.week.total}`, true);
    if (kpi.quiz.all.total > 0) {
      add(`(全期間 ${Math.round((kpi.quiz.all.correct / kpi.quiz.all.total) * 100)}%)`);
    }
  }
}

// ---- 本棚 -----------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function durationText(min) {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h}時間${min % 60}分` : `${h}時間`;
}

/** 本の中の位置(ページ境界)を帯の左端からの割合に。 */
function at(page, total) {
  return `${(page / total) * 100}%`;
}

const pageRange = (from, to) => (from === to ? `p.${from}` : `p.${from}–${to}`);
const attemptMarks = (attempts) => attempts.map((c) => (c ? '○' : '×')).join('');

/** 余白1件の一行説明(帯の点のツールチップ)。 */
function markLine(m) {
  if (m.kind === 'claim') return `p.${m.page} 主張: ${m.text}`;
  if (m.kind === 'question') {
    return `p.${m.page} 問い: ${m.text}${m.selection ? `\n  「${m.selection}」` : ''}`;
  }
  return `p.${m.page} クイズ: ${m.text}${m.attempts.length ? ` ${attemptMarks(m.attempts)}` : ''}`;
}

/**
 * 帯: 本の長さを横棒にし、読んだ所を読んだ回数の濃淡で塗る(1回・2回・3回以上)。
 * 上の2段に問い(輪)とクイズ(点)、横棒の上にしおり(今の位置)。数字はツールチップに任せる。
 */
function bookBand(book) {
  const { total } = book;
  const band = el('div', 'band');
  const placed = book.marks.filter((m) => m.page !== null && m.page >= 1 && m.page <= total);

  for (const kind of ['claim', 'question', 'quiz']) {
    const groups = new Map();
    for (const m of placed.filter((x) => x.kind === kind)) {
      groups.set(m.page, [...(groups.get(m.page) ?? []), m]);
    }
    if (groups.size === 0) continue;
    const lane = el('div', 'band-lane');
    for (const [page, items] of groups) {
      const dot = el('span', `band-mark mk-${kind}`);
      dot.style.left = at(page - 0.5, total); // ページの真ん中
      dot.title = items.map(markLine).join('\n');
      lane.append(dot);
    }
    band.append(lane);
  }

  const track = el('div', 'band-track');
  for (const r of book.runs) {
    const run = el('span', `band-run band-run-${Math.min(r.count, 3)}`);
    run.style.left = at(r.from - 1, total);
    run.style.width = at(r.to - r.from + 1, total);
    run.title = `${pageRange(r.from, r.to)} · ${r.count}回`;
    track.append(run);
  }
  if (book.position !== null) {
    const mark = el('span', 'band-bookmark');
    mark.style.left = at(book.position, total);
    mark.title = `しおり p.${book.position}`;
    track.append(mark);
  }
  band.append(track);

  const ends = el('div', 'band-ends');
  ends.append(el('span', null, '1'), el('span', null, `${total}`));
  band.append(ends);

  const read = book.runs.map((r) => pageRange(r.from, r.to)).join('、');
  const count = (kind) => placed.filter((m) => m.kind === kind).length;
  band.setAttribute('role', 'img');
  band.setAttribute(
    'aria-label',
    `全${total}ページ。読んだ所 ${read || 'なし'}。` +
      (book.position !== null ? `しおり p.${book.position}。` : '') +
      `主張${count('claim')}・問い${count('question')}・クイズ${count('quiz')}`,
  );
  return band;
}

/** 余白: 問いとクイズを本の中の位置順に。本人の問いを地の色、クイズは薄墨(責めない)。 */
function marginalia(marks) {
  const list = el('ol', 'marginalia');
  for (const m of marks) {
    const li = el('li', `mg mg-${m.kind}`);
    li.append(el('span', 'mg-page', m.page !== null ? `p.${m.page}` : '—'));
    li.append(el('span', `mg-glyph mk-${m.kind}`));
    const body = el('div', 'mg-body');
    const text = el('span', 'mg-text', m.text);
    body.append(text);
    if (m.kind === 'claim') {
      /* 本人の一文だけ。答えも採点も無い */
    } else if (m.kind === 'question') {
      if (m.selection) body.append(el('span', 'mg-sel', `「${m.selection}」`));
      if (m.answer) body.append(el('span', 'mg-ans', m.answer));
    } else {
      if (m.answer) text.title = `正解: ${m.answer}`;
      const marks = el('span', 'mk');
      if (m.attempts.length === 0) marks.textContent = ' 未回答';
      for (const c of m.attempts) marks.append(el('span', c ? 'mk-o' : 'mk-x', c ? '○' : '×'));
      body.append(marks);
    }
    li.append(body);
    list.append(li);
  }
  return list;
}

/** 読んだ日: 区間ごとに一行(新しい順)。帯と同じ横軸の細い棒で、どこを読んだかを並べる。 */
function readingDays(book) {
  const list = el('ol', 'days');
  for (const r of book.readings) {
    const li = el('li');
    li.append(el('span', 'day-date', shortDate(r.started_at)));
    const track = el('span', 'day-track');
    const seg = el('i');
    seg.style.left = at(r.from - 1, book.total);
    seg.style.width = at(r.to - r.from + 1, book.total);
    track.append(seg);
    li.append(track);
    li.append(el('span', 'day-meta', `${pageRange(r.from, r.to)} · ${r.read_min}分`));
    list.append(li);
  }
  return list;
}

function drawShelf(books) {
  const list = $('shelf');
  list.textContent = '';
  for (const book of books) {
    const li = el('li', 'book');
    const title = el('a', 'row-title', book.title || '(書名なし)');
    title.href = book.url;
    title.target = '_blank';
    title.rel = 'noopener';

    const parts = [shortDate(book.last_read_at)];
    if (book.finished) {
      parts.push(book.finished_at ? `読了 ${shortDate(book.finished_at)}` : '読了');
    } else if (book.position !== null && book.total) {
      parts.push(`p.${book.position} / ${book.total}`);
    }
    if (book.remaining_min !== null) {
      // 見積もりなので1時間を超えたら10分単位に丸める(「3時間1分」のような細かさを出さない)
      const m = book.remaining_min;
      parts.push(`あと約${durationText(m >= 60 ? Math.round(m / 10) * 10 : m)}`);
    }
    parts.push(`計${durationText(book.total_read_min)}`);
    li.append(title, el('span', 'row-meta', parts.filter(Boolean).join(' · ')));

    if (book.total) li.append(bookBand(book));

    if (book.marks.length > 0 || book.readings.length > 0) {
      const details = el('details', 'margin');
      details.append(
        el('summary', null, `余白 ${book.marks.length} · 読んだ日 ${book.readings.length}`),
      );
      if (book.marks.length > 0) {
        details.append(el('span', 'sub', '余白'), marginalia(book.marks));
      }
      if (book.readings.length > 0 && book.total) {
        details.append(el('span', 'sub', '読んだ日'), readingDays(book));
      }
      li.append(details);
    }
    list.append(li);
  }
}

// ---- 描画 -----------------------------------------------------------------

function drawChart(weeks) {
  const chart = $('chart');
  chart.textContent = '';
  const peak = Math.max(...weeks.map((w) => w.unassisted_min + w.assisted_min), 1);
  for (const w of weeks) {
    const col = document.createElement('div');
    col.className = 'col';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const un = document.createElement('div');
    un.className = 'unassisted';
    un.style.height = `${(w.unassisted_min / peak) * 100}%`;
    const as = document.createElement('div');
    as.className = 'assisted';
    as.style.height = `${(w.assisted_min / peak) * 100}%`;
    bar.append(as, un);
    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = w.unassisted_min + w.assisted_min > 0 ? `${w.unassisted_min}` : '';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = w.label;
    col.append(value, bar, label);
    chart.append(col);
  }
}

function drawLibrary(items) {
  const list = $('library');
  list.textContent = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'clickable';
    li.title = item.url;
    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = item.title || item.domain;
    const meta = document.createElement('span');
    meta.className = 'row-meta';
    const parts = [
      shortDate(item.last_read_at),
      item.domain,
      `${item.total_read_min}分`,
      item.read_count > 1 ? `${item.read_count}回` : null,
    ];
    if (item.best_completion_pct > 0) parts.push(`${item.best_completion_pct}%`);
    if (item.quiz.total > 0) parts.push(`クイズ ${item.quiz.correct}/${item.quiz.total}`);
    meta.textContent = parts.filter(Boolean).join(' · ');
    li.append(title, meta);
    li.addEventListener('click', () => chrome.tabs.create({ url: item.url }));
    list.append(li);
  }
}

function drawQuizzes(items) {
  const list = $('quizzes');
  list.textContent = '';
  for (const q of items) {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = q.question;
    title.title = q.choices?.[q.answer_index]
      ? `正解: ${q.choices[q.answer_index]}`
      : q.question;
    const meta = document.createElement('span');
    meta.className = 'row-meta';
    const parts = [shortDate(q.created_at), q.page_title].filter(Boolean);
    meta.textContent = `${parts.join(' · ')} · `;
    // 回答履歴は ○× の並び(事実)。○=はなまるの赤、×=薄墨(責めない)
    const marks = document.createElement('span');
    marks.className = 'mk';
    if (q.attempts.length === 0) {
      marks.textContent = '未回答';
    } else {
      for (const a of q.attempts) {
        const m = document.createElement('span');
        m.className = a.correct ? 'mk-o' : 'mk-x';
        m.textContent = a.correct ? '○' : '×';
        marks.append(m);
      }
    }
    meta.append(marks);
    li.append(title, meta);
    list.append(li);
  }
}

// ---- 思い出す(記憶の層) -----------------------------------------------------

const GRADE_LABELS = [
  [1, '思い出せなかった'],
  [2, 'おぼろげに'],
  [3, 'はっきり'],
];

/** 想起の結果を書いたあと、カードを事実の一行に置き換える(演出なし)。 */
function finishRecall(li, nextDays) {
  li.replaceChildren(el('span', 'rc-done', `また${nextDays}日ほどたったら`));
}

function recallCard(item) {
  const li = el('li');
  const head = [item.title ? `『${item.title}』` : null, item.book_page ? `p.${item.book_page}` : null,
    `読んでから${item.days_since_read}日`]
    .filter(Boolean)
    .join(' · ');
  li.append(el('span', 'rc-head', head));
  li.append(el('p', 'rc-cue', item.cue));

  if (item.kind === 'quiz') {
    // クイズ: 選ぶ → 正解を示す → 正誤で自動評価(自己評価は聞かない)
    const buttons = item.choices.map((c, i) => {
      const b = el('button', 'rc-choice', c);
      b.type = 'button';
      b.addEventListener('click', async () => {
        buttons.forEach((x) => (x.disabled = true));
        buttons[item.answer_index].classList.add('is-answer');
        const { next_days } = await recordRecall({ item_id: item.item_id, chosen_index: i });
        setTimeout(() => finishRecall(li, next_days), 1_200);
      });
      return b;
    });
    li.append(...buttons);
    return li;
  }

  // 主張・問い: 自分で思い出す(書いても書かなくてもよい)→ 見る → 自分で評価
  const input = el('textarea', 'rc-input');
  input.placeholder = '思い出して書く(書かなくてもよい)';
  li.append(input);
  const actions = el('div', 'rc-actions');
  const show = el('button', null, '見る');
  show.type = 'button';
  actions.append(show);
  li.append(actions);
  show.addEventListener('click', () => {
    show.remove();
    input.readOnly = true;
    const reveal = el('div', 'rc-reveal', item.reveal.text);
    if (item.reveal.selection) reveal.append(el('span', 'mg-sel', `「${item.reveal.selection}」`));
    li.insertBefore(reveal, actions);
    for (const [grade, label] of GRADE_LABELS) {
      const b = el('button', null, label);
      b.type = 'button';
      b.addEventListener('click', async () => {
        actions.querySelectorAll('button').forEach((x) => (x.disabled = true));
        const { next_days } = await recordRecall({
          item_id: item.item_id,
          grade,
          response: input.value.trim() || null,
        });
        finishRecall(li, next_days);
      });
      actions.append(b);
    }
  });
  return li;
}

function drawRecall(items) {
  const list = $('recall');
  list.textContent = '';
  $('recall-sec').hidden = items.length === 0;
  for (const item of items) list.append(recallCard(item));
}

function drawTotals(t, memory) {
  const dl = $('totals');
  dl.textContent = '';
  const rows = [
    ['読んだ本', `${t.books}冊`],
    ['読み終えた本', `${t.books_finished}冊`],
    ...(t.articles > 0 ? [['読んだ記事', `${t.articles}`]] : []),
    ['セッション', `${t.sessions}`],
    ['読書時間', `${t.read_min}分`],
    ['うち補助なし', `${t.unassisted_min}分`],
    ['クイズ回答', `${t.quiz_total}`],
    ['クイズ正解', `${t.quiz_correct}`],
    ['自分からの問い', `${t.questions}`],
    ['残した主張', `${memory.claims}`],
    // 時間がたっても残っていること(その場の正答率の代わりの事実)
    ...memory.retention
      .filter((r) => r.total > 0)
      .map((r) => [`${r.days}日後に思い出せた`, `${r.recalled} / ${r.total}`]),
  ];
  for (const [k, v] of rows) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = k;
    const leader = document.createElement('span');
    leader.className = 'leader';
    const dd = document.createElement('dd');
    dd.textContent = v;
    div.append(dt, leader, dd);
    dl.append(div);
  }
}

// ---- データ管理 -----------------------------------------------------------

$('export').addEventListener('click', async () => {
  const [state, sessions, events, pages, readings, quizzes, attempts, questions, marks, items, recalls] =
    await Promise.all([
      getState(),
      getAllSessions(),
      getAllEvents(),
      getAllPages(),
      getAllReadings(),
      getAllQuizzes(),
      getAllQuizAttempts(),
      getAllQuestions(),
      getAllMarks(),
      getAllMemoryItems(),
      getAllRecalls(),
    ]);
  const data = {
    format: 'reading-scaffold-export',
    version: chrome.runtime.getManifest?.().version ?? null,
    exported_at: new Date().toISOString(),
    state,
    sessions,
    events,
    pages,
    readings,
    quizzes,
    quiz_attempts: attempts,
    questions,
    marks,
    memory_items: items,
    recalls,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `reading-scaffold-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// 本を開いたら「計測しますか?」とたずねるか(#32・既定オン)。次に本を開いたときから効く
readStartPrompt().then((on) => {
  $('start-prompt').checked = on;
});
$('start-prompt').addEventListener('change', () => writeStartPrompt($('start-prompt').checked));

// うんちくのサーバ利用(本人の同意・既定オフ)。切り替えると次のうんちくから効く。
readServerConsent().then((on) => {
  $('consent').checked = on;
});
$('consent').addEventListener('change', () => writeServerConsent($('consent').checked));

// 使われ方の要約(#28)。切り替えと「送ったものを消す」は SW 経由(送り待ちを捨てる・サーバの行を消すのは SW の仕事)
async function refreshTelemetryUI() {
  $('telemetry').checked = (await readTelemetryChoice()) === true;
}
async function setTelemetry(on) {
  await send(Msg.SET_TELEMETRY, { on });
  await refreshTelemetryUI();
}
$('telemetry').addEventListener('change', () => setTelemetry($('telemetry').checked));

function telemetryStatus(text) {
  $('tm-status').textContent = text;
  $('tm-status').hidden = !text;
}

$('tm-forget').addEventListener('click', async () => {
  if (!confirm('よみりんのサーバに送った使われ方の要約を消します。この端末の記録は消えません。')) return;
  $('tm-forget').disabled = true;
  const res = await send(Msg.FORGET_TELEMETRY).catch(() => null);
  $('tm-forget').disabled = false;
  telemetryStatus(
    res?.deleted
      ? '送った使われ方の要約を消しました。'
      : 'いまはサーバに届かず、消せませんでした。次にブラウザを起動したときなどに、もう一度消しにいきます。',
  );
});

// この版より前から使っていて、まだ選んでいない人に一度だけ知らせる(選ぶまで送らない・催促しない)
const NOTICE_KEY = 'telemetry_notice_seen';
async function maybeShowTelemetryNotice() {
  const seen = (await chrome.storage.local.get(NOTICE_KEY))[NOTICE_KEY] === true;
  const state = await getState();
  if (seen || !state.onboarded_at || (await readTelemetryChoice()) !== null) return;
  $('tm-notice').hidden = false;
  await chrome.storage.local.set({ [NOTICE_KEY]: true });
}
for (const [id, on] of [
  ['tm-notice-on', true],
  ['tm-notice-off', false],
]) {
  $(id).addEventListener('click', async () => {
    $('tm-notice').hidden = true;
    await setTelemetry(on);
  });
}
refreshTelemetryUI();
maybeShowTelemetryNotice();

// 開発用の欄(θの手動上書き・デモ・デモデータ投入)はストア版では出さない
$('dev-tools').hidden = IS_STORE_BUILD;

// 本文を AI のサーバに送る(#13・PRIVACY.md §2-2)。前から使っていてまだ選んでいない人はオフのまま
readTextConsent().then((on) => {
  $('text-server').checked = on;
});
$('text-server').addEventListener('change', () => writeTextConsent($('text-server').checked));

// デモモード(このプロフィール限定・storage.local)。切り替えると次のセッションから効く。
async function refreshDemoUI() {
  const on = await readDemoFlag();
  $('demo').checked = on;
  $('seed-demo').hidden = !on; // 玄人デモデータの投入はデモON時だけ見せる
}
$('demo').addEventListener('change', async () => {
  await writeDemoFlag($('demo').checked);
  await refreshDemoUI();
});
refreshDemoUI();

$('seed-demo').addEventListener('click', async () => {
  if (!confirm('約10週間分の玄人デモ履歴を投入します(既存データに追記されます)。')) return;
  $('seed-demo').disabled = true;
  const { seedDemoData } = await import('./demo-seed.js'); // 開発用。ストア版では読み込まない
  await seedDemoData();
  await render();
  $('seed-demo').disabled = false;
});

// 診断のやり直し(Recalibrate)。オンボーディングを再実行するが、SW側の
// COMPLETE_ONBOARDING はセッション実績があれば θ を上書きしない(目標と回答だけ更新)。
$('recalibrate').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/onboarding.html') });
});

/** S の並走レポート(dev)。二値successと並べて閾値を決めるための数字。 */
function drawStabilityReport(r) {
  const el = $('s-report');
  if (!r || r.n === 0) {
    el.textContent = 'S(読書安定度)の並走計測: まだ記録がありません(v0.14以降のセッションから)。';
    return;
  }
  const f = (v) => (v === null ? '—' : v.toFixed(2));
  const pct = r.agreement === null ? '—' : `${Math.round(r.agreement * 100)}%`;
  el.textContent =
    `S並走 ${r.n}件: 成功セッションの平均S ${f(r.mean_success)}(${r.n_success}) · ` +
    `失敗の平均S ${f(r.mean_fail)}(${r.n_fail}) · 中間帯 ${r.n_mid}件 · ` +
    `二値との一致 ${pct}(判定${r.n_decided}件)`;
}

$('wipe').addEventListener('click', async () => {
  if (!confirm('計測・読書メモリ・クイズ・θの状態をすべて消します。サーバに送った使われ方の要約も消します。元に戻せません。')) return;
  if (!confirm('本当に消しますか?(エクスポートしていない記録は失われます)')) return;
  await send(Msg.WIPE_ALL);
  await refreshTelemetryUI();
  telemetryStatus('');
  await render();
});

// ---- 初期描画 -------------------------------------------------------------

/** 自立の推移。θ日次履歴から上昇曲線を描く(SVG折れ線+下に水彩の塗り)。目盛りはHTML側。 */
function drawGrowth(points) {
  const svg = $('growth');
  svg.textContent = '';
  const hasEnough = points.length >= 2;
  $('growth-empty').hidden = hasEnough;
  $('growth-wrap').hidden = !hasEnough;
  if (!hasEnough) return;

  const W = 600;
  const padX = 10;
  const top = 14;
  const bottom = 146;
  const x = (i) => padX + (i / (points.length - 1)) * (W - padX * 2);
  const y = (theta) => bottom - independence(theta) * (bottom - top);
  const ns = 'http://www.w3.org/2000/svg';

  // 基準線(100% / 50% / 0% — 左の目盛りと対応)
  for (const gy of [top, (top + bottom) / 2, bottom]) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', padX);
    line.setAttribute('x2', W - padX);
    line.setAttribute('y1', gy);
    line.setAttribute('y2', gy);
    line.setAttribute('class', 'growth-grid');
    svg.append(line);
  }

  // 横軸の目盛り(日付・最大5点を等間隔に)
  const xAxis = $('growth-x');
  xAxis.textContent = '';
  const labelCount = Math.min(5, points.length);
  for (let k = 0; k < labelCount; k += 1) {
    const idx = Math.round((k / (labelCount - 1)) * (points.length - 1));
    const span = document.createElement('span');
    span.textContent = shortDate(points[idx].t);
    xAxis.append(span);
  }

  const linePts = points.map((p, i) => `${x(i)},${y(p.theta)}`).join(' ');
  const area = document.createElementNS(ns, 'polygon');
  area.setAttribute('points', `${x(0)},${bottom} ${linePts} ${x(points.length - 1)},${bottom}`);
  area.setAttribute('class', 'growth-area');
  svg.append(area);

  const poly = document.createElementNS(ns, 'polyline');
  poly.setAttribute('points', linePts);
  poly.setAttribute('class', 'growth-line');
  svg.append(poly);

  points.forEach((p, i) => {
    const last = i === points.length - 1;
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x(i));
    dot.setAttribute('cy', y(p.theta));
    dot.setAttribute('r', last ? 5.5 : 2.5);
    dot.setAttribute('class', last ? 'growth-dot growth-dot-now' : 'growth-dot');
    svg.append(dot);
  });
}

function drawWeekLine(week) {
  const line = $('week-line');
  line.textContent = '';
  const add = (text, strong = false) => {
    if (strong) {
      const b = document.createElement('b');
      b.textContent = text;
      line.append(b);
    } else {
      line.append(document.createTextNode(text));
    }
  };
  add('今週 ');
  add(`${week.read_min}分`, true);
  add(' · ');
  add(`${week.sessions}`, true);
  add('セッション');
  if (week.escape_rate !== null) {
    add(' · 離脱率 ');
    add(`${Math.round(week.escape_rate * 100)}%`, true);
  }
}

// ヘッダのくまは renderTheta が θ に合わせて置く。本がまだ無い本棚には、箱に入ったくま
$('shelf-empty').insertAdjacentHTML('afterbegin', bearImg('box', 'empty-bear'));

async function render() {
  $('ver').textContent = `v${chrome.runtime.getManifest?.().version ?? '?'}`;

  const shelf = await buildBookshelf();
  $('shelf-empty').hidden = shelf.length > 0;
  $('shelf-legend').hidden = !shelf.some((b) => b.total);
  drawShelf(shelf);
  drawRecall(await buildDue());

  const state = await getState();
  renderTheta(state.theta);
  drawGrowth(await buildThetaHistory());
  drawKpi(await buildKpi());

  const mirror = await buildMirror();
  const hasData = mirror.total_sessions > 0;
  $('chart-empty').hidden = hasData;
  $('chart').hidden = !hasData;
  if (hasData) drawChart(mirror.weeks);
  drawWeekLine(mirror.this_week);

  // 本以外(Web記事)と、そのクイズ。本のクイズは本棚の余白に出ている
  const articles = (await buildLibrary(200)).filter((p) => !isBookPage(p));
  $('library-sec').hidden = articles.length === 0;
  drawLibrary(articles);

  const bookIds = new Set(shelf.map((b) => b.page_id));
  const quizzes = (await buildQuizLog()).filter((q) => !bookIds.has(q.page_id));
  $('quizzes-sec').hidden = quizzes.length === 0;
  drawQuizzes(quizzes);

  drawTotals(await buildTotals(), await buildRetention());
  drawStabilityReport(await buildStabilityReport());
}

render();
