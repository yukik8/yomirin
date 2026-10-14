// よみりんのサーバ(Vercel)との通信。端末の外へ出る経路はこのファイルだけ(docs/design.md §9・§11)。
//
// 1. うんちく: 送るのは pickTerms で選んだ単語の候補と、インストールごとのランダムな ID(回数制限のため)だけ。
//    本の本文・書名・URL は送らない。本人の同意が無ければ呼ばない。
// 2. 使われ方の要約(#28): セッションを閉じたあとの要約(telemetry.js の行。値は数・真偽・決まった語だけ)を
//    送り待ちに積み、まとめて送る。届かなければ残して、次の機会に送り直す。同意が無ければ積まない・送らない。
//    ID はうんちくの install_id とは別(あちらは「回数制限にだけ使う」と約束している)。

import { SERVER, TELEMETRY, readTelemetryConsent } from '../shared/config.js';
import { acceptTrivia } from './ai.js';

const INSTALL_KEY = 'install_id';

/** インストールごとのランダムな ID(サーバの回数制限にだけ使う。個人とは結びつかない)。 */
async function installId() {
  const got = await chrome.storage.local.get(INSTALL_KEY);
  if (typeof got[INSTALL_KEY] === 'string') return got[INSTALL_KEY];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_KEY]: id });
  return id;
}

/** 全消去のときに ID も作り直す(以前の利用と結びつかないように)。 */
export async function resetInstallId() {
  await chrome.storage.local.remove(INSTALL_KEY);
}

/**
 * 単語の候補からうんちくを1つ。話せることが無い・サーバに届かないときは null。
 * サーバが選んだ言葉が候補に無い・擬音らしい・言い切れないものは捨てる。
 */
export async function serverTrivia(terms) {
  const list = (terms ?? [])
    .map((t) => String(t).trim())
    .filter((t) => t && t.length <= SERVER.maxTermChars)
    .slice(0, SERVER.maxTerms);
  if (list.length === 0) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SERVER.timeoutMs);
  try {
    const r = await fetch(`${SERVER.base}/trivia`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rs-install': await installId() },
      body: JSON.stringify({ terms: list }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const data = await r.json(); // 本文の受信もタイムアウトの内側で待つ
    if (!data?.ok) return null;
    const trivia = acceptTrivia(data.trivia);
    return trivia && list.includes(trivia.term) ? trivia : null;
  } catch {
    return null; // 届かない・タイムアウト。うんちくは出さないだけ
  } finally {
    clearTimeout(timer);
  }
}

// ---- 使われ方の要約(#28) -----------------------------------------------------

const TM_ID_KEY = 'telemetry_id'; // 送るときの ID(ランダムな UUID)。「送ったものを消す」で作り直す
const TM_OUTBOX_KEY = 'telemetry_outbox'; // 送り待ちの行(古い順・TELEMETRY.maxOutbox まで)
const TM_HELLO_KEY = 'telemetry_hello'; // いまの ID で環境の行(hello)を積んだ版
const TM_FORGET_KEY = 'telemetry_forget'; // サーバの行を消してほしい ID(届くまで持つ。全消去も跨ぐ)

/** 送り待ちの中で同じ行か(セッションは session_id、hello は最後の1つだけ残す)。 */
const rowKey = (row) => (row?.kind === 'session' ? `session:${row.session_id}` : row?.kind);

// 送り待ちの読み書きは1本の列で(積むのと、届いた行を外すのが重なって、片方を取りこぼさないように)。
// 送る処理も1本の列で(送り直しが二重に走らないように)。どちらも SW の中だけで使う
let outboxQueue = Promise.resolve();
function editOutbox(fn) {
  const run = outboxQueue.then(async () => {
    const got = await chrome.storage.local.get([TM_ID_KEY, TM_OUTBOX_KEY]);
    const next = fn(Array.isArray(got[TM_OUTBOX_KEY]) ? got[TM_OUTBOX_KEY] : [], got[TM_ID_KEY]);
    if (next) await chrome.storage.local.set(next);
  });
  outboxQueue = run.catch(() => {});
  return run;
}

let sendQueue = Promise.resolve();
function inLine(fn) {
  const run = sendQueue.then(fn);
  sendQueue = run.catch(() => {});
  return run;
}

let paused = false; // 消している間は送らない

/** 送る行を送り待ちに積む。同意が無い・行が無ければ何もしない。上限を超えたら古い順に捨てる。 */
export async function queueTelemetry(row) {
  if (!row || !(await readTelemetryConsent())) return;
  await editOutbox((outbox, id) => ({
    [TM_ID_KEY]: typeof id === 'string' ? id : crypto.randomUUID(),
    [TM_OUTBOX_KEY]: [...outbox.filter((r) => rowKey(r) !== rowKey(row)), row].slice(-TELEMETRY.maxOutbox),
  }));
}

/** 送り待ちを捨てる(同意をオフにしたとき。積んでいたものも送らない)。 */
export async function dropTelemetryOutbox() {
  await editOutbox(() => ({ [TM_OUTBOX_KEY]: [] }));
}

/** 次に送るときに、環境の行(hello)を積み直す(オンボーディングの完了で、θ の初期値と目標が決まったとき)。 */
export async function resetTelemetryHello() {
  await chrome.storage.local.remove(TM_HELLO_KEY);
}

/**
 * POST / DELETE /telemetry。'done'(届いた)/ 'rejected'(4xx。直しても通らないので諦める)/
 * 'retry'(届かない・429・5xx。残して次の機会に)。
 */
async function tmFetch(method, id, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TELEMETRY.timeoutMs);
  try {
    const r = await fetch(`${SERVER.base}/telemetry`, {
      method,
      headers: body ? { 'content-type': 'application/json', 'x-rs-telemetry': id } : { 'x-rs-telemetry': id },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (r.status === 429 || r.status >= 500) return 'retry';
    return r.ok ? 'done' : 'rejected';
  } catch {
    return 'retry';
  } finally {
    clearTimeout(timer);
  }
}

/** 消してほしい ID をサーバに送る(同意とは関係なく。消すのは送ることではない)。全部消せたら true。 */
async function sendForgets() {
  const got = await chrome.storage.local.get(TM_FORGET_KEY);
  const ids = Array.isArray(got[TM_FORGET_KEY]) ? got[TM_FORGET_KEY] : [];
  if (ids.length === 0) return true;
  const left = [];
  for (const id of ids) if ((await tmFetch('DELETE', id)) === 'retry') left.push(id);
  if (left.length > 0) await chrome.storage.local.set({ [TM_FORGET_KEY]: left });
  else await chrome.storage.local.remove(TM_FORGET_KEY);
  return left.length === 0;
}

async function flushOnce(hello) {
  if (paused) return;
  await sendForgets();
  if (!(await readTelemetryConsent())) return;
  if (hello) {
    const row = await hello();
    const got = await chrome.storage.local.get(TM_HELLO_KEY);
    if (row && got[TM_HELLO_KEY] !== row.ext) {
      await queueTelemetry(row);
      await chrome.storage.local.set({ [TM_HELLO_KEY]: row.ext });
    }
  }
  const got = await chrome.storage.local.get([TM_ID_KEY, TM_OUTBOX_KEY]);
  const rows = Array.isArray(got[TM_OUTBOX_KEY]) ? got[TM_OUTBOX_KEY].slice(0, TELEMETRY.maxOutbox) : [];
  if (typeof got[TM_ID_KEY] !== 'string' || rows.length === 0) return;
  if ((await tmFetch('POST', got[TM_ID_KEY], { rows })) === 'retry') return;
  // 届いた行と、サーバが形を断った行(拡張が古い・新しすぎる)は送り待ちから外す
  const sent = new Set(rows.map(rowKey));
  await editOutbox((outbox) => ({ [TM_OUTBOX_KEY]: outbox.filter((r) => !sent.has(rowKey(r))) }));
}

/**
 * 送り待ちを送る。先に、消してほしい ID を送る。同意が無ければそこまで。
 * hello(環境の行を返す関数)を渡すと、いまの ID でこの版の hello をまだ積んでいなければ積んでから送る。
 * 呼ばれた順に1つずつ走る。読書中かどうかは呼ぶ側が確かめる(読書中は送らない)。
 */
export function flushTelemetry({ hello } = {}) {
  return inLine(() => flushOnce(hello));
}

/**
 * サーバに送った行を消す(ダッシュボードの「送ったものを消す」と全消去)。送るのを止め、送っている途中の
 * ものを待ってから、いまの ID を「消してほしい ID」に移し、ID・送り待ち・hello の印を捨てる(次に送るときは
 * 新しい ID になり、前の行と結びつかない)。during には全消去の本体を渡す(storage が空になっても、
 * 消してほしい ID は残す)。サーバで消せたら true。届かなければ false で、ID を持ち続けて次の機会に送り直す。
 */
export async function forgetTelemetry(during) {
  paused = true;
  try {
    await sendQueue;
    const got = await chrome.storage.local.get([TM_ID_KEY, TM_FORGET_KEY]);
    const ids = [...(Array.isArray(got[TM_FORGET_KEY]) ? got[TM_FORGET_KEY] : []), got[TM_ID_KEY]].filter(
      (id, i, all) => typeof id === 'string' && all.indexOf(id) === i,
    );
    if (during) await during();
    await outboxQueue;
    await chrome.storage.local.remove([TM_ID_KEY, TM_OUTBOX_KEY, TM_HELLO_KEY]);
    if (ids.length > 0) await chrome.storage.local.set({ [TM_FORGET_KEY]: ids });
  } finally {
    paused = false;
  }
  return inLine(sendForgets);
}
