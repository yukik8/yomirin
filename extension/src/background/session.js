// セッション状態機械。
//
//   IDLE   --[読むボタン押下 / 本を開いたときの「計測しますか?」の「はい」]--> ACTIVE
//   ACTIVE --[タブ切替/ウィンドウ非フォーカス]--> ESCAPED
//   ESCAPED--[復帰]--> ACTIVE
//   ACTIVE --[終了ボタン / タブclose]--> ENDED
//   ACTIVE --[無操作 3分]--> ENDED(auto)
//   ESCAPED--[復帰なし 3分]--> ENDED(auto)
//
// 離脱はセッションを終わらせない。離脱→復帰のパターンが制御器の主要シグナルであるため。
//
// 「計測はセッション中のみ」の守り方(設計ドキュメントからの変更):
// 設計ではtabs系リスナーを開始時に登録・終了時に解除する方式だったが、MV3のService
// Workerは停止・再起動があり、動的に登録したリスナーは再起動で消えて復帰を取り逃がす。
// そのため登録はservice-worker.jsのトップレベル(常設)とし、代わりに全ハンドラが
// このファイルを通り、最初にセッションの存在を確認してから動く。セッションが無ければ
// 何も読まず何も書かずに戻る。観測コードパスがセッション中しか走らないことは変わらない。
//
// セッションの現在値はchrome.storage.localに置く(SW再起動もブラウザの終了も跨いで残る)。
// storage.session だとブラウザを閉じた瞬間に消え、そのセッションの読書時間・読んだ区間・θの更新が
// 失われる。取り残されたセッションは、ブラウザの起動時と拡張の更新時に recoverSession が
// 最後の記録の時点で閉じる。

import { EventType, EndReason, SessionState } from '../shared/events.js';
import {
  SESSION,
  SUCCESS,
  THETA_MAX,
  CONTROLLER,
  STABILITY,
  RETENTION,
  readDemoFlag,
  readTelemetryConsent,
  PACE,
  PAGE_EVENTS,
  PAGE_ZOOM,
} from '../shared/config.js';
import { dateKey } from '../shared/time.js';
import {
  appendEvent,
  putSession,
  getState,
  putState,
  getPage,
  putPage,
  addQuizAttempt,
  getAllSessions,
  getEventsBySession,
  putReading,
  pruneEvents,
  sha256Hex,
} from './store.js';
import {
  effectiveTheta,
  nextState,
  applyHomeostat,
  isSuccess,
  stabilityScore,
  paceSummary,
  blendPace,
} from './controller.js';
import { nextStateStaircase } from './staircase.js';
import { onQuizAnswered } from './memory.js';
import { sessionRow, sessionCounts } from './telemetry.js';
import { queueTelemetry } from './server.js';
import { applyZoom, retuneZoom, reapplyZoom, restoreZoom, restoreZoomLater, flushZoomRestore } from './zoom.js';
import { scaleRange } from './book-scale.js';

const CURRENT_KEY = 'currentSession';
const store = chrome.storage.local;
// 本の中の位置(Play ブックス)。currentSession とは別キーに置く — currentSession は複数の
// ハンドラが読んで書き戻すので、ページ送りの直後に古い写しで上書きされうる。位置は
// book_progress だけが書くので、別キーなら取りこぼさない。
const BOOK_POS_KEY = 'bookPosition';
export const WATCHDOG_ALARM = 'rs-watchdog';

// セッションを閉じたあとに走らせる処理(service-worker.js が、使われ方の要約を送る・#28。
// 無操作で閉じたら「計測しますか?」の印を外す・#32)。閉じたセッションと終了理由を渡す。
// 1本の列の外で、待たずに走らせる(送るのを待って次の開始や終了を止めない)
let afterEnd = (_session, _reason) => {};
export function onSessionEnded(fn) {
  afterEnd = fn;
}

export async function getCurrent() {
  const got = await store.get(CURRENT_KEY);
  return got[CURRENT_KEY] ?? null;
}

function setCurrent(session) {
  if (session === null) return store.remove(CURRENT_KEY);
  return store.set({ [CURRENT_KEY]: session });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 1ページの長さ(#33・zoom.js)を、この回で初めて掛けたら演出を1回数える(掛けた回は補助なしに数えない)。
 * session.zoom に、戻すための元の倍率と掛けた倍率を置く(currentSession に入るので、取り残されても戻せる)。
 */
async function noteZoom(session, zoom) {
  if (zoom && !session.zoom) {
    session.effects_shown += 1;
    await appendEvent(session.session_id, EventType.EFFECT_SHOWN, {
      effect_id: 'page_zoom',
      factor: zoom.applied,
    });
  }
  session.zoom = zoom;
}

/** このセッションの本の中の位置 { from, page, furthest, total }。無ければ null。 */
async function readBookPos(sessionId) {
  const got = await store.get(BOOK_POS_KEY);
  const pos = got[BOOK_POS_KEY];
  return pos && pos.session_id === sessionId ? pos : null;
}

/** 今のセッションで開いている本のページ { page, total }(クイズ・問いの記録用)。無ければ null。 */
export async function getBookPosition() {
  const session = await getCurrent();
  const pos = session ? await readBookPos(session.session_id) : null;
  return pos ? { page: pos.page, total: pos.total } : null;
}

function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Google Play ブックスのリーダー(本文は books.googleusercontent.com のフレームの中にある)。 */
function isPlayBooksReader(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'play.google.com' && u.pathname.startsWith('/books/reader');
  } catch {
    return false;
  }
}

/**
 * 「同じ読み物か」を判定するキー。Play ブックスはページを送るたびに pg= が変わるので、
 * 本の id= だけで識別する(ページ送りでセッションを切らない・本ごとに記録を分ける)。
 */
function pageKey(url) {
  if (isPlayBooksReader(url)) {
    const u = new URL(url);
    const id = u.searchParams.get('id');
    if (id) return `${u.origin}${u.pathname}?id=${id}`;
  }
  return url.split('#')[0];
}

/** Play ブックスのタブのタイトル「書名 - Google Play Books」から書名だけを取り出す。 */
function bookTitle(tabTitle) {
  return tabTitle.replace(/\s*[-–—|]\s*Google\s*Play\s*(?:Books|ブックス)\s*$/i, '').trim();
}

const BOOK_FRAME_HOST = 'books.googleusercontent.com';

/**
 * loader を全フレームに入れる。本文のフレームに入ったら true(本文のフレームがまだ無ければ false)。
 * loader は文書ごとに版で二重注入を止めるので、何度入れても1回だけ動く。結果は loader の最後の式(location.hostname)
 */
async function injectLoader(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['src/content/loader.js'],
  });
  return results.some((r) => r.result === BOOK_FRAME_HOST);
}

/**
 * 本文のフレームに入るまで、少し待っては loader を入れ直す(#38)。列の外で走らせる(待つ間に報告を止めない)。
 * 待つたびに同じセッションが続いているかを確かめ、終わっていたらやめる。入ったら true。
 */
export async function injectUntilBook(tabId, sessionId, waits = SESSION.injectRetryMs) {
  for (const ms of waits) {
    await new Promise((r) => setTimeout(r, ms));
    const current = await getCurrent();
    if (current?.session_id !== sessionId || current.state === SessionState.ENDED) return false;
    try {
      if (await injectLoader(tabId)) return true;
    } catch {
      return false; // タブが閉じた・別のページへ移った(セッションのハンドラが閉じる)
    }
  }
  return false;
}

/**
 * ユーザージェスチャー起点(popup の「読む」か、本を開いたときの「計測しますか?」の「はい」)でのみ
 * 呼ばれる。Play ブックス専用 — host 権限が
 * Play ブックスにしか無いので、他のタブでは URL も読めない(tab.url が undefined)。
 */
async function startSessionImpl(tabId) {
  const existing = await getCurrent();
  if (existing) await endSessionImpl(EndReason.MANUAL);
  await flushZoomRestore(); // 前の回の倍率を戻すのを待っていたら、いま戻してから始める

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !isPlayBooksReader(tab.url)) {
    throw new Error('Play ブックスで本を開いてから押してください');
  }
  const domain = domainOf(tab.url);

  const state = await getState();
  const now = Date.now();
  const playBooks = isPlayBooksReader(tab.url);

  // 記録層: URL正規化(クエリ・フラグメント除去。Play ブックスは本の id= だけ残す)→ page_id
  const u = new URL(tab.url);
  const normalizedUrl = playBooks ? pageKey(tab.url) : u.origin + u.pathname;
  const pageId = await sha256Hex(normalizedUrl);

  const session = {
    session_id: crypto.randomUUID(),
    tab_id: tabId,
    window_id: tab.windowId,
    // タブ内遷移の判定にだけ使う。currentSession 限りで、IndexedDBには書かない。
    page_url: pageKey(tab.url),
    page_id: pageId,
    // 本文が端末の外へ出るのは、本人が「本文を AI のサーバに送る」をオンにしたときのクイズと問いだけ(うんちくは単語だけ)
    site: playBooks ? 'play_books' : 'web',
    state: SessionState.ACTIVE,
    started_at: now,
    last_event_at: now,
    escaped_at: null,
    domain,
    theta_base: state.theta, // 制御器が持つ基準θ
    theta: effectiveTheta(state.theta), // このセッションの実効θ(±ノイズ=迷彩)
    article_len_words: null,
    mode: null, // 'full' | 'measure-only'(本文検出失敗)
    read_ms: 0,
    escapes: 0,
    completion_pct: 0,
    hints_shown: 0,
    effects_shown: 0,
    // 連続読書ストリーク(評価レイヤー用)。鼓動が途切れず・離脱しない間を一続きと数える
    longest_streak_ms: 0,
    cur_streak_ms: 0,
    last_dwell_at: null,
    // 読書安定度 S の素材: 離れていた累計と、すぐ(60秒以内に)戻った回数
    away_total_ms: 0,
    quick_returns: 0,
    // 読む速さの素材: ページごとの { words, ms }(content の page_read)。戻った回数は book_progress で数える
    pace_samples: [],
    backs: 0,
    zoom: null, // 1ページの長さ(#33): 掛けた倍率と、戻すための元の倍率・設定
  };
  await setCurrent(session);
  await appendEvent(session.session_id, EventType.SESSION_START, {
    url_domain: domain,
    article_len_words: null,
    theta: session.theta,
    theta_base: session.theta_base,
  });

  // 記録層: pagesをupsert(読書メモリの台帳。ローカルのみ)
  const page = (await getPage(pageId)) ?? {
    page_id: pageId,
    url: normalizedUrl,
    title: null,
    domain,
    lang: null,
    word_count: null,
    summary: null,
    first_read_at: now,
    last_read_at: now,
    read_count: 0,
    total_read_ms: 0,
    best_completion_pct: 0,
  };
  if (tab.title) page.title = (playBooks && bookTitle(tab.title)) || tab.title;
  page.last_read_at = now;
  await putPage(page);

  // 1ページの長さ(#33): 補助の多いうちは、このタブを大きく映して1ページに入る字数を減らす(実効θで決める)。
  // 掛けたら、Play ブックスがページを組み直すのを待ってから注入する(本文と位置は組み直した後のものを読む)
  await noteZoom(session, await applyZoom(tabId, session.theta));
  if (session.zoom) {
    await setCurrent(session);
    await sleep(PAGE_ZOOM.settleMs);
  }

  // content script注入はセッション保存の後。注入されたスクリプトは起動直後に
  // GET_STATUSでθを取りに来るため、先に注入するとセッション未保存の瞬間に
  // 問い合わせが届いて θ=0 になる(ヒントが一枚も出なくなる)。
  // モジュールを直接注入できないためローダーを挟む。
  // Play ブックスは本文が別ドメインのフレームにあるので全フレームへ入れ、
  // 本文のないフレームではローダーが何もせずに戻る。
  let inBook;
  try {
    inBook = await injectLoader(tabId);
  } catch (err) {
    await setCurrent(null); // 注入できなかった。セッションを残さない
    await restoreZoom(tabId, session.zoom);
    throw err;
  }
  // 本文のフレームがまだ無かった(読み込み直後の「計測しますか?」ですぐ「はい」を押した等)。列の外で入れ直す
  if (!inBook) injectUntilBook(tabId, session.session_id).catch(() => {});

  // 無操作・未復帰の監視。SWが止まってもalarmで起こされる。
  await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
  await chrome.action.setBadgeText({ text: '●' });
  return session;
}

/**
 * @param {string} reason - 終了理由
 * @param {{ at?: number, notify?: boolean }} [opts] - at: 終わった時刻(取り残されたセッションは
 *   最後の記録の時刻)。notify: ページの content script に片付けとお祝いを頼むか
 */
async function endSessionImpl(reason, { at = Date.now(), notify = true } = {}) {
  const session = await getCurrent();
  if (!session || session.state === SessionState.ENDED) return null;

  // 離脱したまま終わった場合、その離脱時間も「離れていた累計」に足す(すぐ戻ったには数えない)
  if (session.state === SessionState.ESCAPED && session.escaped_at) {
    session.away_total_ms = (session.away_total_ms ?? 0) + Math.max(0, at - session.escaped_at);
  }
  // 最初に「終了中」を保存する: 終了が二重に走らない(SW の再起動を跨いでも)・
  // 終了処理の途中に届いた報告でセッションが生き返らない
  session.state = SessionState.ENDED;
  await setCurrent(session);
  let celebrated = false;
  try {
    const ended = await finishSession(session, reason, { at, notify });
    celebrated = ended.celebrate;
    return ended;
  } finally {
    // 記録の書き込みが途中で失敗しても、セッションは必ず閉じる(次の開始・全消去を塞がない)
    await setCurrent(null);
    // 1ページの長さ(#33)を元の倍率に戻す(本人が途中で変えていたら触らない)。お祝いは出し終えてから
    await restoreZoomLater(session.tab_id, session.zoom, celebrated ? PAGE_ZOOM.afterCelebrateMs : 0);
    afterEnd(session, reason);
  }
}

/** 終了の本体: 記録・制御器・content script への片付けの依頼。 */
async function finishSession(session, reason, { at, notify }) {
  await chrome.alarms.clear(WATCHDOG_ALARM);
  await chrome.action.setBadgeText({ text: '' });

  const success =
    session.read_ms >= SUCCESS.minReadMs && session.escapes <= SUCCESS.maxEscapes;
  // 読む速さの要約(ページごとの語数/分)。S の steady 項と、ダッシュボードの事実表示に使う
  const pace = paceSummary(session.pace_samples);
  session.pace_cv = pace?.cv ?? null;
  // 読書安定度 S。SUCCESS.judge が 'stability' なら制御器はこれを3値に切って読む(outcomeOf)
  const stability = stabilityScore(session, reason);
  session.stability = stability;

  // 読了お祝いは「セッション成功、かつθ>0」のときだけ。演出もθの配下にあり、
  // θ=0では何も出さない — 補助なし読書時間の定義を汚さないため。
  // デモ中だけは成功条件を待たず必ず出す(見せるためのモード)。
  // ページに届けられない終わり方(取り残されたセッション)では出さない — 出していない演出を数えない
  const demoEnabled = await readDemoFlag();
  const celebrate = notify && (success || demoEnabled) && session.theta > 0;
  if (celebrate) {
    session.effects_shown += 1;
    await appendEvent(session.session_id, EventType.EFFECT_SHOWN, {
      effect_id: 'session_success',
    });
  }

  await appendEvent(session.session_id, EventType.SESSION_END, {
    reason,
    read_ms: session.read_ms,
    completion_pct: session.completion_pct,
  });
  const record = {
    session_id: session.session_id,
    date: dateKey(session.started_at),
    started_at: session.started_at,
    domain: session.domain,
    page_id: session.page_id ?? null, // 記録層への橋(ローカル内のみ)
    theta: session.theta, // このセッションの実効θ
    theta_base: session.theta_base, // 制御器の基準θ
    read_ms: session.read_ms,
    escapes: session.escapes,
    completion_pct: session.completion_pct,
    success,
    stability, // 読書安定度 S(並走計測)
    reason, // 終了理由(S の並走分析用)
    away_total_ms: session.away_total_ms ?? 0,
    quick_returns: session.quick_returns ?? 0,
    // 補助なし判定に使う。
    hints_shown: session.hints_shown,
    effects_shown: session.effects_shown,
    // 最長連続読書(評価レイヤー用)
    longest_streak_ms: session.longest_streak_ms ?? 0,
    // 読む速さ(v0.22): ページ数・語数/分の中央値・ばらつき・詰まった/流したページ・読み返し
    pages_read: pace?.pages ?? 0,
    pace_wpm: pace?.wpm ?? null,
    pace_cv: pace?.cv ?? null,
    slow_pages: pace?.slow ?? 0,
    fast_pages: pace?.fast ?? 0,
    backs: session.backs ?? 0,
  };
  await putSession(record);

  // 読む速さの持ち越し(v0.24): 次のセッションの最初のページから、速さに合わせた出し方ができるように。
  // 制御には使わない(state.pace は content script が GET_STATUS で読むだけ)
  if (pace && pace.pages >= 2) {
    try {
      const st = await getState();
      st.pace = blendPace(st.pace, pace, PAGE_EVENTS.paced.priorWeight);
      await putState(st);
    } catch {
      /* 持ち越せなくても終了処理は続ける */
    }
  }

  // 記録層: 読んだ区間(Play ブックスで位置が読めたセッションだけ)
  const endedAt = at;
  const bookPos = await readBookPos(session.session_id);
  await store.remove(BOOK_POS_KEY);
  // 読了: このセッションで、1ページずつ進んで最後のページに着いた(pager の book_end)。
  // スライダーや目次で最後へ飛んだ・最後のページで開き直した、では読了にしない
  const reachedEnd = Boolean(session.book_end_at);
  if (bookPos && session.page_id) {
    try {
      const events = await getEventsBySession(session.session_id);
      await putReading({
        session_id: session.session_id,
        page_id: session.page_id,
        date: dateKey(session.started_at),
        started_at: session.started_at,
        ended_at: endedAt,
        range: {
          from: bookPos.from,
          to: bookPos.page,
          furthest: bookPos.furthest,
          total: bookPos.total,
        },
        page_turns: events.filter((e) => e.type === EventType.PAGE_TURN).length,
        read_ms: session.read_ms,
        reached_end: reachedEnd,
      });
    } catch {
      /* 記録失敗は終了処理を妨げない */
    }
  }

  // 記録層: pagesへ累計を積む
  if (session.page_id) {
    try {
      const page = await getPage(session.page_id);
      if (page) {
        page.read_count += 1;
        page.total_read_ms += session.read_ms;
        page.best_completion_pct = Math.max(page.best_completion_pct, session.completion_pct);
        page.last_read_at = endedAt;
        if (bookPos) page.book_position = { page: bookPos.page, total: bookPos.total };
        if (reachedEnd && !page.finished_at) page.finished_at = endedAt;
        await putPage(page);
      }
    } catch {
      /* 記録失敗は終了処理を妨げない */
    }
  }

  // W3: タペリング制御器。セッションの成否で基準θを乗算的に動かす。
  // 本人には通知しない(気づかれない速度で減らす)。変化はtheta_updateとして記録。
  // 再展開中(ホメオスタット)も漸減は通す — 目標は常に0。
  let control = { theta_after: null, controller_reason: null }; // 使われ方の要約に載せる制御器の結果
  if (CONTROLLER.enabled) {
    try {
      const now = Date.now();
      const st = await getState();
      // 固定則(fixed)か閾値推定(staircase)か。切り替えは config の CONTROLLER.policy だけ
      let next =
        CONTROLLER.policy === 'staircase'
          ? nextStateStaircase(st, session, dateKey(now))
          : nextState(st, session, dateKey(now));
      let reason = null;
      if (next.theta !== st.theta) reason = isSuccess(session) ? 'success' : 'fail';
      // 階段法は判断の種類(down/up/hold/explore_hold)を残す。探索の保留は θ が動かなくても記録する
      // (「下げたときと据え置いたときで次が違うか」を後で比べるため)
      if (CONTROLLER.policy === 'staircase' && next.last_decision) reason = next.last_decision;
      if (st.theta > 0 && next.theta === 0) {
        reason = 'graduate';
        next.homeostat = st.homeostat?.active
          ? // 再展開からの再卒業: ベースラインは最初の卒業のものを使い続ける
            { ...st.homeostat, active: false, graduated_at: now }
          : // 卒業の瞬間: 見守りのベースライン(直近4週の補助なし読書時間の週平均)を記録
            { baseline: await unassistedWeeklyAvgMin(), active: false, graduated_at: now };
      }
      // 卒業後(と再展開中)の見守り
      if (next.theta === 0 || next.homeostat?.active) {
        const after = applyHomeostat(next, await unassistedWeeklyAvgMin(), now);
        if (after.theta !== next.theta) {
          reason = after.homeostat.active ? 'homeostat_redeploy' : 'homeostat_recover';
        }
        next = after;
      }
      if (next.theta !== st.theta || reason === 'explore_hold') {
        await appendEvent(session.session_id, EventType.THETA_UPDATE, {
          from: st.theta,
          to: next.theta,
          reason,
        });
      }
      await putState(next);
      control = { theta_after: next.theta, controller_reason: reason };
    } catch {
      /* 制御の失敗は終了処理を妨げない */
    }
  }

  // 使われ方の要約(#28): 同意があれば、この回の要約を送り待ちに積む。送るのはセッションを閉じたあと(afterEnd)。
  // 行の項目は telemetry.js の表のとおりで、本・本文・問いの中身は入らない。制御器には何も戻らない
  try {
    if (await readTelemetryConsent()) {
      await queueTelemetry(
        sessionRow(record, {
          ext: chrome.runtime.getManifest().version,
          ...control,
          ...sessionCounts(await getEventsBySession(session.session_id)),
          position_read: Boolean(bookPos),
          reached_end: reachedEnd,
        }),
      );
    }
  } catch {
    /* 積めなくても終了処理は続ける */
  }

  // 細かい計測(20秒ごとの鼓動・スクロール)は保持期間を過ぎたら消す。セッションの集計は残る
  try {
    const cutoff = Date.now() - RETENTION.detailEventsDays * 86_400_000;
    await pruneEvents(cutoff, RETENTION.detailEventTypes);
  } catch {
    /* 掃除の失敗は終了処理を妨げない */
  }

  // content scriptに片付けを頼む。タブが既に無ければそれでよい。
  if (notify) {
    try {
      await chrome.tabs.sendMessage(session.tab_id, {
        type: 'rs_stop',
        celebrate,
        read_min: Math.round(session.read_ms / 60_000),
      });
    } catch {
      /* タブclose済み */
    }
  }

  return { ...session, state: SessionState.ENDED, success, reason, celebrate };
}

/** content scriptからの計測報告。送信元がセッションのタブであることを必ず確認する。 */
async function onReportImpl(event, payload, sender) {
  const session = await getCurrent();
  if (!session || session.state === SessionState.ENDED || sender.tab?.id !== session.tab_id) return;

  const now = Date.now();
  session.last_event_at = now;

  switch (event) {
    case 'content_ready':
      session.article_len_words = payload.article_len_words;
      session.mode = payload.mode;
      // 記録層: 本文の言語と語数をページに反映
      if (session.page_id) {
        try {
          const page = await getPage(session.page_id);
          if (page) {
            page.word_count = payload.article_len_words ?? page.word_count;
            page.lang = payload.lang ?? page.lang;
            await putPage(page);
          }
        } catch {
          /* 記録失敗は計測を妨げない */
        }
      }
      break;

    case EventType.DWELL_TICK:
      // 読書時間の操作的定義に合致した鼓動だけがread_msに積まれる。
      if (session.state === SessionState.ACTIVE) {
        session.read_ms += SESSION.dwellTickMs;
        const contiguous =
          session.last_dwell_at != null && now - session.last_dwell_at <= SESSION.dwellTickMs * 2;
        session.cur_streak_ms = contiguous
          ? (session.cur_streak_ms ?? 0) + SESSION.dwellTickMs
          : SESSION.dwellTickMs;
        session.last_dwell_at = now;
        session.longest_streak_ms = Math.max(session.longest_streak_ms ?? 0, session.cur_streak_ms);
        await appendEvent(session.session_id, EventType.DWELL_TICK, {
          visible_paragraph_range: payload.visible_paragraph_range ?? null,
        });
      }
      break;

    case 'book_progress': {
      // Play ブックス: 本全体での位置(playbooks-pager.js が読むページ表示「11 / 17」から)。
      // 読了率は本の中での到達点。本文フレームにも渡し、ヒントの「%」に使わせる。
      const page = Number(payload.page);
      const total = Number(payload.total);
      const valid = total > 0 && total <= 100_000 && page >= 0 && page <= total;
      if (session.site !== 'play_books' || !valid) return;
      const pct = Math.round((page / total) * 100);
      // 記録層: 読んだ区間の素材(開始位置・最も先まで)。別キーに置く(BOOK_POS_KEY の注)
      let pos = await readBookPos(session.session_id);
      // 総ページ数が変わった(倍率を掛けた・戻した・窓の大きさを変えた・#33): それまでの位置を今の尺度に換算する。
      // 換算で動いたページは読み返しに数えない
      const rescaled = Boolean(pos) && pos.total !== total;
      if (rescaled) {
        const r = scaleRange({ from: pos.from, to: pos.page, furthest: pos.furthest, total: pos.total }, total);
        pos = { ...pos, from: r.from, page: r.to, furthest: r.furthest, total };
      }
      // 読み返し: 前のページより手前へ戻った回数(読む速さの素材と並ぶ行動シグナル)
      if (pos && !rescaled && page < pos.page) session.backs = (session.backs ?? 0) + 1;
      await store.set({
        [BOOK_POS_KEY]: {
          session_id: session.session_id,
          from: pos?.from ?? page,
          page,
          furthest: Math.max(pos?.furthest ?? page, page),
          total,
        },
      });
      session.book_pct = pct;
      session.completion_pct = Math.max(session.completion_pct, pct);
      try {
        await chrome.tabs.sendMessage(session.tab_id, { type: 'rs_progress', pct });
      } catch {
        /* 本文フレームが応答しなければ次のページ表示の変化で届く */
      }
      break;
    }

    case 'book_end':
      // Play ブックス: 最後のページに進んで着いた(ページ表示のあるフレームが1回だけ報告する)。
      // 読了として到達点を100%にし、本文フレームに読了フィナーレを頼む。
      if (session.site !== 'play_books' || session.book_end_at) return;
      session.book_end_at = now;
      session.completion_pct = 100;
      try {
        await chrome.tabs.sendMessage(session.tab_id, { type: 'rs_book_end' });
      } catch {
        /* 本文フレームが応答しなければそれでよい */
      }
      break;

    case 'book_end_screen':
      // 最後のページの次の「読み終えた」画面に進んだ。読了フィナーレはここで出す(記録は book_end のまま)
      if (session.site !== 'play_books' || !session.book_end_at) return;
      try {
        await chrome.tabs.sendMessage(session.tab_id, { type: 'rs_book_end_screen' });
      } catch {
        /* 本文フレームが応答しなければ、本文が消えたことで拾う */
      }
      break;

    case EventType.PAGE_READ: {
      // 読む速さの標本: めくる直前まで見えていたページの語数と滞在時間
      const words = Number(payload.words);
      const ms = Number(payload.ms);
      if (!(words > 0 && words < 100_000 && ms > 0 && ms < 24 * 3_600_000)) return;
      const d = Number.isFinite(Number(payload.d)) ? Math.min(1, Math.max(0, Number(payload.d))) : null;
      if (!Array.isArray(session.pace_samples)) session.pace_samples = [];
      if (session.pace_samples.length < PACE.maxSamples) session.pace_samples.push({ words, ms, d });
      await appendEvent(session.session_id, EventType.PAGE_READ, { words, ms, d });
      break;
    }

    case EventType.SCROLL:
      // Play ブックスの読了率は本の中の位置(book_progress)だけで見る。content 側の段落の比率は
      // 読み込まれた分の中での位置なので、本の途中でも100%になりうる
      if (session.site !== 'play_books') {
        session.completion_pct = Math.max(session.completion_pct, payload.completion_pct ?? 0);
      }
      await appendEvent(session.session_id, EventType.SCROLL, {
        depth_pct: payload.depth_pct ?? 0,
      });
      break;

    case EventType.HINT_SHOWN:
      session.hints_shown += 1;
      await appendEvent(session.session_id, EventType.HINT_SHOWN, {
        hint_id: payload.hint_id,
        kind: payload.kind ?? 'canned',
        // くま・うんちくの出し方(v0.24): めくった直後(turn)か、読む速さに合わせて(paced)か
        ...(payload.timing ? { timing: payload.timing } : {}),
      });
      break;

    case EventType.HINT_CLICKED:
      await appendEvent(session.session_id, EventType.HINT_CLICKED, {
        hint_id: payload.hint_id,
      });
      break;

    case EventType.QUIZ_ANSWERED:
      await appendEvent(session.session_id, EventType.QUIZ_ANSWERED, {
        quiz_id: payload.quiz_id ?? null,
        correct: payload.correct === true,
      });
      // 記録層: 回答の記録
      try {
        await addQuizAttempt({
          quiz_id: payload.quiz_id ?? null,
          page_id: session.page_id ?? null,
          session_id: session.session_id,
          answered_at: now,
          chosen_index: payload.chosen_index ?? null,
          correct: payload.correct === true,
          latency_ms: payload.latency_ms ?? null,
        });
        // 記憶の層: 最初の回答が最初の復習(以後はダッシュボードの「思い出す」で間隔を空けて出る)
        await onQuizAnswered({
          quiz_id: payload.quiz_id ?? null,
          page_id: session.page_id ?? null,
          correct: payload.correct === true,
          now,
        });
      } catch {
        /* 記録失敗は計測を妨げない */
      }
      break;

    case EventType.EFFECT_SHOWN: // レア演出(金の雨)。補助の一種として数える
      session.effects_shown += 1;
      await appendEvent(session.session_id, EventType.EFFECT_SHOWN, {
        effect_id: payload.effect_id,
      });
      break;

    default:
      return; // 未知の報告は捨てる
  }
  await setCurrent(session);
}

/** タブ切替。セッションタブへ戻れば復帰、別タブへ移れば離脱。 */
async function onTabActivatedImpl(activeInfo) {
  const session = await getCurrent();
  if (!session || session.state === SessionState.ENDED) return;

  if (activeInfo.tabId === session.tab_id) {
    await returnFromEscape(session);
  } else {
    // 行き先は見ない(tabs 権限を持たないので、Play ブックス以外のタブの URL は読めない)。
    // 行き先が別の Play ブックスのときだけドメインが残る
    let toDomain = null;
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      toDomain = domainOf(tab.url);
    } catch {
      /* 取得できなければ行き先なしで記録 */
    }
    await escape(session, toDomain);
  }
}

/** ウィンドウのフォーカス移動。全ウィンドウ非フォーカス=OSの別アプリへの離脱。 */
async function onWindowFocusChangedImpl(windowId) {
  const session = await getCurrent();
  if (!session || session.state === SessionState.ENDED) return;

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await escape(session, null);
    return;
  }
  try {
    const [active] = await chrome.tabs.query({ active: true, windowId });
    if (active?.id === session.tab_id) {
      await returnFromEscape(session);
    } else {
      await escape(session, domainOf(active?.url));
    }
  } catch {
    /* ウィンドウが消えた等は次のイベントに任せる */
  }
}

async function onTabRemovedImpl(tabId) {
  const session = await getCurrent();
  if (!session || tabId !== session.tab_id) return;
  await endSessionImpl(EndReason.CLOSE);
}

/**
 * セッションタブ内の別ページへの遷移。v0は1セッション=1記事なので終了扱い。
 * ハッシュだけの変化(記事内の脚注・目次ジャンプ)は遷移とみなさない。
 * Play ブックスのページ送り(pg= の変化)は同じ本の中の移動として、終了ではなく
 * page_turn として記録する。
 */
async function onTabUpdatedImpl(tabId, changeInfo) {
  const session = await getCurrent();
  if (!session || session.state === SessionState.ENDED || tabId !== session.tab_id) return;
  // 同じ本を読み込み直し終えた(#38)。ページに入れていたものを入れ直す
  if (changeInfo.status === 'complete' && session.reloading) {
    await resumeAfterReload(session);
    return;
  }
  let url = changeInfo.url;
  if (!url) {
    // Play ブックスの外へ移ると、host 権限が無いので changeInfo に URL が載らない。
    // 読み込みが始まったらタブの URL を確かめ、読めなければ本から離れたとみなす
    if (changeInfo.status !== 'loading') return;
    try {
      url = (await chrome.tabs.get(tabId)).url ?? null;
    } catch {
      url = null;
    }
    if (url && pageKey(url) === session.page_url) {
      // 同じ本の再読み込み。終わりにはしない。読み込み終わり(status=complete)で入れ直す(#38)
      session.reloading = true;
      await setCurrent(session);
      return;
    }
    if (!url) {
      await endSessionImpl(EndReason.CLOSE);
      return;
    }
  }
  if (pageKey(url) === session.page_url) {
    // URL が変わる知らせはページ送りとして扱い、入れ直さない(めくるたびに入れ直すと、本人が途中で変えた
    // 倍率まで掛け直してしまう)。入れ直すのは、URL が変わらない読み込み(再読み込み)だけ(#38)
    if (session.site === 'play_books') await onPageTurn(session);
    return;
  }
  await endSessionImpl(EndReason.CLOSE);
}

/**
 * 計測中のタブで、同じ本を読み込み直した(再読み込み・#38)。ページに入れていたもの(計測の鼓動・くま・話・
 * ページ表示の見張り)は前の文書と一緒に消え、倍率は Chrome が戻している。同じセッションのまま(θ も数も
 * 引き継ぐ)、倍率を掛け直して loader を入れ直す。入れ直しは列の外で、本文のフレームに入るまで。
 * main.js は resumed_at を見て、開始の合図を「計測を続けています」にする。
 */
async function resumeAfterReload(session) {
  session.reloading = false;
  session.resumed_at = Date.now();
  session.last_event_at = session.resumed_at; // 読み込み直したのは本人の操作。無操作に数えない
  await setCurrent(session);
  const { tab_id: tabId, session_id: sessionId, zoom } = session;
  (async () => {
    await reapplyZoom(tabId, zoom);
    await injectUntilBook(tabId, sessionId, [0, ...SESSION.injectRetryMs]);
  })().catch(() => {});
}

/**
 * ページ送りは読んでいる証拠なので無操作の判定を延ばし、content scriptにも伝える
 * (送りボタンは最上位のフレームにあり、本文フレームからは操作が見えないため)。
 */
async function onPageTurn(session) {
  session.last_event_at = Date.now();
  await appendEvent(session.session_id, EventType.PAGE_TURN, {});
  await setCurrent(session);
  try {
    await chrome.tabs.sendMessage(session.tab_id, { type: 'rs_page_turn' });
  } catch {
    /* 本文フレームが応答しなければそれでよい */
  }
}

/** 30秒ごとの見回り。無操作3分/復帰なし3分の自動終了はここで判定する。 */
async function onWatchdogImpl() {
  const session = await getCurrent();
  if (!session) {
    await chrome.alarms.clear(WATCHDOG_ALARM); // 迷子のalarmを掃除
    return;
  }
  // タブを閉じた知らせを取りこぼしていたら(SW の停止中など)、最後の記録の時点で閉じる
  const tabAlive = await chrome.tabs.get(session.tab_id).then(() => true, () => false);
  if (!tabAlive) {
    await endSessionImpl(EndReason.CLOSE, { at: session.last_event_at, notify: false });
    return;
  }
  if (Date.now() - session.last_event_at > SESSION.idleTimeoutMs) {
    await endSessionImpl(EndReason.IDLE);
  }
}

/**
 * ブラウザの再起動・拡張の更新で取り残されたセッションを閉じる(service-worker.js の onStartup と
 * onInstalled から)。ページの content script はもう居ないので片付けは頼まず、終わった時刻は
 * 最後の記録の時刻にする(閉じていた間を読書時間や離脱時間に数えない)。
 */
async function recoverImpl() {
  const session = await getCurrent();
  if (!session) return;
  if (session.state === SessionState.ENDED) {
    await setCurrent(null); // 終了処理の途中で止まっていた
    await restoreZoom(session.tab_id, session.zoom);
    return;
  }
  await endSessionImpl(EndReason.CLOSE, { at: session.last_event_at ?? Date.now(), notify: false });
}

/**
 * θ手動ダイヤル(ドッグフーディング用、W3で自動化)。連続値[0, THETA_MAX]。
 * 進行中のセッションがあれば即時反映する — 「θを変えると読書体験が変わる」の確認用。
 * 1ページの長さ(倍率・#33)もその場で掛け直す。
 */
async function setThetaImpl(value) {
  const clamped = Math.min(Math.max(Number(value) || 0, 0), THETA_MAX);
  const state = await getState();
  state.theta = clamped;
  state.day_start_theta = clamped; // 手動設定は1日上限の基準もリセット
  await putState(state);

  const session = await getCurrent();
  if (session) {
    session.theta_base = clamped;
    session.theta = clamped; // 手動時はノイズなしの直値(ダイヤルの体感確認用)
    await noteZoom(session, await retuneZoom(session.tab_id, session.zoom ?? null, clamped));
    await setCurrent(session);
    try {
      await chrome.tabs.sendMessage(session.tab_id, { type: 'rs_theta', theta: clamped });
    } catch {
      /* タブが応答しなければ次のセッションから効く */
    }
  }
  return { theta: clamped };
}

/** 補助なし読書時間の週平均(直近4週・分)。ホメオスタットの入力。 */
async function unassistedWeeklyAvgMin() {
  const sessions = await getAllSessions();
  const cutoff = Date.now() - CONTROLLER.homeostatWindowWeeks * 7 * 86_400_000;
  let ms = 0;
  for (const s of sessions) {
    if ((s.started_at ?? 0) < cutoff) continue;
    if ((s.hints_shown ?? 0) === 0 && (s.effects_shown ?? 0) === 0) ms += s.read_ms ?? 0;
  }
  return ms / 60_000 / CONTROLLER.homeostatWindowWeeks;
}

async function escape(session, toDomain) {
  if (session.state !== SessionState.ACTIVE) return;
  session.state = SessionState.ESCAPED;
  session.escaped_at = Date.now();
  session.last_event_at = session.escaped_at;
  session.escapes += 1;
  session.cur_streak_ms = 0; // 離脱で連続は途切れる
  await appendEvent(session.session_id, EventType.TAB_ESCAPE, { to_domain: toDomain });
  await setCurrent(session);
}

async function returnFromEscape(session) {
  if (session.state !== SessionState.ESCAPED) return;
  const now = Date.now();
  const awayMs = now - session.escaped_at;
  await appendEvent(session.session_id, EventType.TAB_RETURN, { away_ms: awayMs });
  // S の素材: 離れていた累計と、すぐ戻った回数
  session.away_total_ms = (session.away_total_ms ?? 0) + awayMs;
  if (awayMs <= STABILITY.quickReturnMs) session.quick_returns = (session.quick_returns ?? 0) + 1;
  session.state = SessionState.ACTIVE;
  session.escaped_at = null;
  session.last_event_at = now;
  await setCurrent(session);
}

// ---- 1本の列に並べる ---------------------------------------------------------
// currentSession を読んで書き戻す処理は、同時に走ると古い写しで上書きし合う(読了の瞬間に
// book_progress・book_end・dwell が重なる、タブを閉じるのと終了ボタンが重なる等)。
// SW の中で1本の列に並べ、1つずつ最後まで走らせる。列の中から公開関数を呼ぶと
// 待ち合って止まるので、中では *Impl を直接呼ぶ。
let queue = Promise.resolve();
function serial(fn) {
  return (...args) => {
    const run = queue.then(() => fn(...args));
    queue = run.catch(() => {});
    return run;
  };
}

export const startSession = serial(startSessionImpl);
// 「計測しますか?」の「はい」(#32)。セッションが無いときだけ始める(ページ側から、ほかのタブの
// セッションを終わらせない)。あれば null。確かめてから始めるまでを列の中で1つにする
export const startSessionIfIdle = serial(async (tabId) =>
  (await getCurrent()) ? null : startSessionImpl(tabId),
);
export const endSession = serial(endSessionImpl);
export const onReport = serial(onReportImpl);
export const onTabActivated = serial(onTabActivatedImpl);
export const onWindowFocusChanged = serial(onWindowFocusChangedImpl);
export const onTabRemoved = serial(onTabRemovedImpl);
export const onTabUpdated = serial(onTabUpdatedImpl);
export const onWatchdog = serial(onWatchdogImpl);
export const recoverSession = serial(recoverImpl);
export const setTheta = serial(setThetaImpl);
