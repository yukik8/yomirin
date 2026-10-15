// ライブラリ(読書メモリの一覧)。記録層だけを読む。
// これは「記録」カテゴリの表示: 事実の蓄積のみで、可変報酬・比較・警告は載せない。

import { STABILITY } from '../shared/config.js';
import { scalePage, scaleRange, markTotal, remainingMinutes } from './book-scale.js';
import {
  getAllPages,
  getAllQuestions,
  getAllQuizAttempts,
  getAllQuizzes,
  getAllReadings,
  getAllSessions,
  getAllMarks,
} from './store.js';

const BOOK_READER = 'https://play.google.com/books/reader';
// 残り時間を出すのに要る、ペースの素材(前へ進んだページ数の合計・今の尺度で)の最小値
const MIN_PACE_PAGES = 3;

/** pages の1行が Play ブックスの本か(本は id= 単位で1行。docs/design.md §8)。 */
export function isBookPage(page) {
  return (page.url ?? '').startsWith(BOOK_READER);
}

/**
 * 読了か。読んだ区間(readings)の記録がある本は finished_at だけで見る(最後のページへ飛んだだけでは
 * 読了にしない)。区間の記録が始まる前(v0.19 より前)に読んだ本だけ、読了率で見る。
 */
function isFinished(page, hasReadings) {
  return Boolean(page.finished_at) || (!hasReadings && (page.best_completion_pct ?? 0) >= 100);
}

/** ページごとの読んだ回数を、同じ回数が続く区間にまとめる(帯の塗り)。ranges は今の尺度に換算したもの。 */
function coverageRuns(ranges, total) {
  const counts = new Array(total).fill(0);
  for (const range of ranges) {
    const from = Math.max(1, range.from);
    const to = Math.min(total, range.furthest);
    for (let p = from; p <= to; p += 1) counts[p - 1] += 1;
  }
  const runs = [];
  counts.forEach((count, i) => {
    const last = runs[runs.length - 1];
    if (count === 0) return;
    if (last && last.count === count && last.to === i) last.to = i + 1;
    else runs.push({ from: i + 1, to: i + 1, count });
  });
  return runs;
}

/**
 * 本棚(ダッシュボード用)。本ごとに位置・残り時間・読んだ区間・余白(問いとクイズ)をまとめる。
 * 記録カテゴリの表示: 事実だけ。残り時間はその本での自分のペースから出す(他人と比べない)。
 * 総ページ数は倍率や窓の大きさで変わる(#33)ので、読んだ区間と印のページは今の総ページ数に比で換算して描く。
 *
 * @returns {Promise<Array<{
 *   page_id, url, title, last_read_at, total_read_min,
 *   finished: boolean, finished_at: number|null,
 *   position: number|null, total: number|null, remaining_min: number|null,
 *   runs: Array<{ from, to, count }>,
 *   readings: Array<{ started_at, from, to, read_min }>,
 *   marks: Array<{ kind: 'claim'|'question'|'quiz', page: number|null, t, text, selection?, answer?, attempts? }>,
 * }>>}
 */
export async function buildBookshelf() {
  const [pages, readings, quizzes, attempts, questions, allMarks] = await Promise.all([
    getAllPages(),
    getAllReadings(),
    getAllQuizzes(),
    getAllQuizAttempts(),
    getAllQuestions(),
    getAllMarks(),
  ]);
  const attemptsByQuiz = new Map();
  for (const a of attempts) {
    const list = attemptsByQuiz.get(a.quiz_id) ?? [];
    list.push(a);
    attemptsByQuiz.set(a.quiz_id, list);
  }

  const books = pages.filter(isBookPage).map((p) => {
    const rs = readings
      .filter((r) => r.page_id === p.page_id && r.range?.total > 0)
      .sort((a, b) => a.started_at - b.started_at);
    const latest = rs[rs.length - 1];
    const total = p.book_position?.total ?? latest?.range.total ?? null;
    const position = p.book_position?.page ?? latest?.range.to ?? null;
    const finished = isFinished(p, rs.length > 0);
    // 読んだ区間を今の尺度に
    const ranges = rs.map((r) => (total ? scaleRange(r.range, total) : r.range));
    // 印のページを今の尺度に(印を付けたときの総ページ数が分からなければそのまま)
    const markPage = (mark) => {
      const page = mark.book_page ?? null;
      const from = page && total ? markTotal(mark, rs) : null;
      return from ? scalePage(page, from, total, 'mid') : page;
    };

    // その本での自分のペース(進んだ割合あたりの読書時間)
    const remainingMin = finished ? null : remainingMinutes(rs, position, total, MIN_PACE_PAGES);

    const marks = [
      // 本人が残した主張(本人起点の痕跡。問いと同じく上に置く)
      ...allMarks
        .filter((m) => m.page_id === p.page_id && m.kind === 'claim')
        .map((m) => ({ kind: 'claim', page: markPage(m), t: m.created_at, text: m.text })),
      ...questions
        .filter((q) => q.page_id === p.page_id)
        .map((q) => ({
          kind: 'question',
          page: markPage(q),
          t: q.created_at,
          text: q.question,
          selection: q.selection ?? null,
          answer: q.answer ?? null,
        })),
      ...quizzes
        .filter((q) => q.page_id === p.page_id)
        .map((q) => ({
          kind: 'quiz',
          page: markPage(q),
          t: q.created_at,
          text: q.question,
          answer: q.choices?.[q.answer_index] ?? null,
          attempts: (attemptsByQuiz.get(q.quiz_id) ?? [])
            .sort((a, b) => (a.answered_at ?? 0) - (b.answered_at ?? 0))
            .map((a) => a.correct),
        })),
    ].sort((a, b) => (a.page ?? Infinity) - (b.page ?? Infinity) || a.t - b.t); // 位置なしは末尾

    return {
      page_id: p.page_id,
      url: p.url,
      title: p.title,
      last_read_at: p.last_read_at,
      total_read_min: Math.round((p.total_read_ms ?? 0) / 60_000),
      finished,
      finished_at: p.finished_at ?? null,
      position,
      total,
      remaining_min: remainingMin,
      runs: total ? coverageRuns(ranges, total) : [],
      readings: rs
        .map((r, i) => ({
          started_at: r.started_at,
          from: ranges[i].from,
          to: ranges[i].furthest,
          read_min: Math.round((r.read_ms ?? 0) / 60_000),
        }))
        .reverse(),
      marks,
    };
  });

  // 読みかけを上に(最後に読んだ順)、読み終えた本はその下
  return books.sort(
    (a, b) =>
      Number(a.finished) - Number(b.finished) || (b.last_read_at ?? 0) - (a.last_read_at ?? 0),
  );
}

/**
 * @returns {Promise<Array<{
 *   page_id, url, title, domain, last_read_at, read_count,
 *   total_read_min, best_completion_pct,
 *   quiz: { total: number, correct: number },
 * }>>}
 */
export async function buildLibrary(limit = 30) {
  const [pages, attempts] = await Promise.all([getAllPages(), getAllQuizAttempts()]);

  const quizByPage = new Map();
  for (const a of attempts) {
    if (!a.page_id) continue;
    const q = quizByPage.get(a.page_id) ?? { total: 0, correct: 0 };
    q.total += 1;
    if (a.correct) q.correct += 1;
    quizByPage.set(a.page_id, q);
  }

  return pages
    .sort((a, b) => (b.last_read_at ?? 0) - (a.last_read_at ?? 0))
    .slice(0, limit)
    .map((p) => ({
      page_id: p.page_id,
      url: p.url,
      title: p.title,
      domain: p.domain,
      last_read_at: p.last_read_at,
      read_count: p.read_count ?? 0,
      total_read_min: Math.round((p.total_read_ms ?? 0) / 60_000),
      best_completion_pct: p.best_completion_pct ?? 0,
      quiz: quizByPage.get(p.page_id) ?? { total: 0, correct: 0 },
    }));
}

/** クイズ履歴(ダッシュボード用)。問題+回答の時系列+出題元ページ名。 */
export async function buildQuizLog() {
  const [quizzes, attempts, pages] = await Promise.all([
    getAllQuizzes(),
    getAllQuizAttempts(),
    getAllPages(),
  ]);
  const titleByPage = new Map(pages.map((p) => [p.page_id, p.title || p.domain]));
  const byQuiz = new Map();
  for (const a of attempts) {
    const list = byQuiz.get(a.quiz_id) ?? [];
    list.push(a);
    byQuiz.set(a.quiz_id, list);
  }
  return quizzes
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .map((q) => ({
      quiz_id: q.quiz_id,
      page_id: q.page_id ?? null,
      question: q.question,
      choices: q.choices,
      answer_index: q.answer_index,
      page_title: titleByPage.get(q.page_id) ?? null,
      created_at: q.created_at,
      attempts: (byQuiz.get(q.quiz_id) ?? [])
        .sort((a, b) => (a.answered_at ?? 0) - (b.answered_at ?? 0))
        .map((a) => ({ correct: a.correct, answered_at: a.answered_at })),
    }));
}

/**
 * θの推移(日次平均・古い順)。自立の推移グラフの素材。
 * theta_base(制御器の基準値)を使う — 実効θのノイズを均して傾向だけを見る。
 */
export async function buildThetaHistory() {
  const sessions = await getAllSessions();
  const byDay = new Map();
  for (const s of sessions) {
    const t = s.theta_base ?? s.theta;
    if (typeof t !== 'number' || !s.started_at) continue;
    const d = new Date(s.started_at);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const b = byDay.get(key) ?? { sum: 0, n: 0, t: s.started_at };
    b.sum += t;
    b.n += 1;
    if (s.started_at < b.t) b.t = s.started_at;
    byDay.set(key, b);
  }
  return [...byDay.values()]
    .sort((a, b) => a.t - b.t)
    .map((b) => ({ t: b.t, theta: b.sum / b.n }));
}

/**
 * 読書安定度 S の並走レポート(ダッシュボードdev用)。
 * 二値 success と S を並べ、閾値を決めるための材料を出す。制御には使わない。
 */
export async function buildStabilityReport() {
  const rows = (await getAllSessions()).filter((s) => typeof s.stability === 'number');
  const n = rows.length;
  if (n === 0) return { n: 0 };
  const succ = rows.filter((s) => s.success);
  const fail = rows.filter((s) => !s.success);
  const mean = (xs) => (xs.length ? xs.reduce((a, s) => a + s.stability, 0) / xs.length : null);
  const hi = STABILITY.successAt;
  const lo = STABILITY.failAt;
  // 一致: 成功↔S≥hi、失敗↔S≤lo。中間帯(据え置き)は不一致に数えない
  const decided = rows.filter((s) => s.stability >= hi || s.stability <= lo);
  const agree = decided.filter((s) => (s.success ? s.stability >= hi : s.stability <= lo));
  return {
    n,
    mean_success: mean(succ),
    mean_fail: mean(fail),
    n_success: succ.length,
    n_fail: fail.length,
    n_mid: rows.filter((s) => s.stability > lo && s.stability < hi).length,
    agreement: decided.length ? agree.length / decided.length : null,
    n_decided: decided.length,
  };
}

/** 累計(ダッシュボード用)。 */
export async function buildTotals() {
  const [sessions, attempts, pages, questions, readings] = await Promise.all([
    getAllSessions(),
    getAllQuizAttempts(),
    getAllPages(),
    getAllQuestions(),
    getAllReadings(),
  ]);
  const withReadings = new Set(readings.map((r) => r.page_id));
  let readMs = 0;
  let unassistedMs = 0;
  for (const s of sessions) {
    readMs += s.read_ms ?? 0;
    if ((s.hints_shown ?? 0) === 0 && (s.effects_shown ?? 0) === 0) unassistedMs += s.read_ms ?? 0;
  }
  const books = pages.filter(isBookPage);
  return {
    sessions: sessions.length,
    books: books.length,
    books_finished: books.filter((p) => isFinished(p, withReadings.has(p.page_id))).length,
    articles: pages.length - books.length,
    read_min: Math.round(readMs / 60_000),
    unassisted_min: Math.round(unassistedMs / 60_000),
    quiz_total: attempts.length,
    quiz_correct: attempts.filter((a) => a.correct).length,
    // 自分からの問い = 興味の指標(帯とは別軸の「問いの自立」。制御器には入れない)
    questions: questions.length,
  };
}
