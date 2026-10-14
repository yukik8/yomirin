// 使われ方の要約(#28・docs/design.md §9)で送る行を作る。純関数(chrome の API も storage も触らない)。
// 積むのと送るのは server.js、呼ぶのは session.js(セッションを閉じたあと)と service-worker.js(hello)。
//
// 送るのは下の SESSION_FIELDS / HELLO_FIELDS だけ。値は数・真偽・決まった語・版の番号・UUID・日付だけにして、
// 本文や書名が混ざる余地を型で無くす(自由な文字列の項目は作らない)。本・本文・問い・クイズの中身(記録層)は、
// 項目を1つずつ拾って作るので、引数に混ざっていても出ていかない。
// 値はサーバ(server/main.py の TmSession / TmHello)と同じ範囲に丸める(範囲の外れで行ごと断られないように)。
// 項目を変えるときは、server/main.py・server/sql/・tests/fixtures/telemetry.json・PRIVACY.md もそろえる。

import { TELEMETRY, THETA_MAX, GOALS } from '../shared/config.js';
import { EventType } from '../shared/events.js';
import { dateKey } from '../shared/time.js';

// 制御器が残す理由(session.js の固定則・ホメオスタット、staircase.js の判断)
export const CONTROLLER_REASONS = [
  'success',
  'fail',
  'graduate',
  'homeostat_redeploy',
  'homeostat_recover',
  'down',
  'up',
  'hold',
  'explore_hold',
];
export const END_REASONS = ['manual', 'close', 'idle'];

export const SESSION_FIELDS = [
  'kind',
  'v',
  'ext',
  'session_id',
  'date',
  'hour',
  'theta',
  'theta_base',
  'theta_after',
  'controller_reason',
  'read_ms',
  'escapes',
  'away_total_ms',
  'quick_returns',
  'longest_streak_ms',
  'completion_pct',
  'success',
  'stability',
  'end_reason',
  'hints_shown',
  'effects_shown',
  'pages_read',
  'pace_wpm',
  'pace_cv',
  'slow_pages',
  'fast_pages',
  'backs',
  'quiz_answered',
  'quiz_correct',
  'questions_asked',
  'position_read',
  'reached_end',
];
export const HELLO_FIELDS = ['kind', 'v', 'ext', 'build', 'chrome', 'theta0', 'goal', 'trivia'];

const DAY_MS = 86_400_000;
const MAX_COUNT = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^\d{1,4}(\.\d{1,4}){0,3}$/;

/** 0〜max の整数(数でなければ 0)。 */
function int(v, max) {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : 0;
}

/** 0〜max の小数を digits 桁に丸める(数でなければ null)。 */
function real(v, max, digits = 3) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const k = 10 ** digits;
  return Math.round(Math.min(max, Math.max(0, v)) * k) / k;
}

const oneOf = (v, list) => (list.includes(v) ? v : null);

/** そのセッションのクイズの回答数・正解数と、問いの数(計測層の events から。中身は見ない)。 */
export function sessionCounts(events) {
  let quiz_answered = 0;
  let quiz_correct = 0;
  let questions_asked = 0;
  for (const e of events ?? []) {
    if (e?.type === EventType.QUIZ_ANSWERED) {
      quiz_answered += 1;
      if (e.payload?.correct === true) quiz_correct += 1;
    } else if (e?.type === EventType.QUESTION_ASKED) {
      questions_asked += 1;
    }
  }
  return { quiz_answered, quiz_correct, questions_asked };
}

/**
 * セッションの要約の行。送れる形にならなければ null(送らない)。
 * @param {object} rec - sessions に書いた行(session.js の finishSession)
 * @param {object} extra - { ext: 拡張の版, theta_after, controller_reason, quiz_answered, quiz_correct,
 *   questions_asked, position_read: ページ表示が読めたか, reached_end }
 */
export function sessionRow(rec, extra) {
  if (!UUID.test(String(rec?.session_id)) || !VERSION.test(String(extra?.ext))) return null;
  const started = typeof rec.started_at === 'number' ? rec.started_at : NaN;
  const date = DATE.test(String(rec.date)) ? rec.date : Number.isFinite(started) ? dateKey(started) : null;
  if (!date) return null;
  return {
    kind: 'session',
    v: TELEMETRY.v,
    ext: extra.ext,
    session_id: rec.session_id,
    date,
    hour: Number.isFinite(started) ? new Date(started).getHours() : 0,
    theta: real(rec.theta, THETA_MAX) ?? 0,
    theta_base: real(rec.theta_base, THETA_MAX) ?? 0,
    theta_after: real(extra.theta_after, THETA_MAX),
    controller_reason: oneOf(extra.controller_reason, CONTROLLER_REASONS),
    read_ms: int(rec.read_ms, DAY_MS),
    escapes: int(rec.escapes, MAX_COUNT),
    away_total_ms: int(rec.away_total_ms, DAY_MS),
    quick_returns: int(rec.quick_returns, MAX_COUNT),
    longest_streak_ms: int(rec.longest_streak_ms, DAY_MS),
    completion_pct: int(rec.completion_pct, 100),
    success: rec.success === true,
    stability: real(rec.stability, 1),
    end_reason: oneOf(rec.reason, END_REASONS),
    hints_shown: int(rec.hints_shown, MAX_COUNT),
    effects_shown: int(rec.effects_shown, MAX_COUNT),
    pages_read: int(rec.pages_read, MAX_COUNT),
    pace_wpm: real(rec.pace_wpm, MAX_COUNT, 1),
    pace_cv: real(rec.pace_cv, 100),
    slow_pages: int(rec.slow_pages, MAX_COUNT),
    fast_pages: int(rec.fast_pages, MAX_COUNT),
    backs: int(rec.backs, MAX_COUNT),
    quiz_answered: int(extra.quiz_answered, MAX_COUNT),
    quiz_correct: int(extra.quiz_correct, MAX_COUNT),
    questions_asked: int(extra.questions_asked, MAX_COUNT),
    position_read: extra.position_read === true,
    reached_end: extra.reached_end === true,
  };
}

/** UA の文字列から Chrome のメジャー版だけを取り出す(UA の全文は送らない)。 */
export function chromeMajor(userAgent) {
  const m = /\bChrome\/(\d{1,3})\./.exec(String(userAgent ?? ''));
  const n = m ? Number(m[1]) : 0;
  return n >= 1 ? n : null;
}

/**
 * 環境の行(オンボーディングの完了・版が変わったとき)。送れる形にならなければ null。
 * @param {object} env - { ext, store: ストア版か, userAgent, theta0: 診断で置いた θ, goal, trivia: うんちくのサーバを使うか }
 */
export function helloRow(env) {
  if (!VERSION.test(String(env?.ext))) return null;
  return {
    kind: 'hello',
    v: TELEMETRY.v,
    ext: env.ext,
    build: env.store === true ? 'store' : 'dev',
    chrome: chromeMajor(env.userAgent),
    theta0: real(env.theta0, THETA_MAX),
    goal: typeof env.goal === 'string' && Object.hasOwn(GOALS, env.goal) ? env.goal : null,
    trivia: env.trivia === true,
  };
}
