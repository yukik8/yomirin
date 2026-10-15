// MV3 Service Worker。
// リスナー登録はすべてこのファイルのトップレベルで同期的に行う(MV3の再起動要件)。
// tabs系のハンドラはsession.jsの中で必ずセッションの存在を確認し、
// セッションが無いときは何も読まず何も書かずに戻る — 「計測はセッション中のみ」。
// セッションが無いときにするのは、Play ブックスの本を開いたタブに「計測しますか?」を出すこと
// (prompt.js の offerStart・#32)だけ。そこでも計測はしない。

import { Msg, EventType, SessionState, EndReason } from '../shared/events.js';
import {
  GOALS,
  DIAGNOSIS,
  SERVER,
  IS_STORE_BUILD,
  readServerConsent,
  writeServerConsent,
  writeTelemetryConsent,
  readTextConsent,
  writeTextConsent,
} from '../shared/config.js';
import { pickTerms, acceptQuiz, sharesTermWith } from './ai.js';
import {
  serverTrivia,
  serverQuiz,
  serverAnswer,
  resetInstallId,
  flushTelemetry,
  forgetTelemetry,
  dropTelemetryOutbox,
  resetTelemetryHello,
} from './server.js';
import { helloRow } from './telemetry.js';
import {
  startSession,
  startSessionIfIdle,
  endSession,
  getCurrent,
  onSessionEnded,
  onReport,
  onTabActivated,
  onWindowFocusChanged,
  onTabRemoved,
  onTabUpdated,
  onWatchdog,
  recoverSession,
  setTheta,
  getBookPosition,
  WATCHDOG_ALARM,
} from './session.js';
import { offerStart, markAsked, forgetAsked, isPromptSender } from './prompt.js';
import { buildMirror } from './mirror.js';
import { buildLibrary } from './library.js';
import {
  wipeAll,
  getState,
  putState,
  getAllSessions,
  sha256Hex,
  getQuizByHash,
  addQuiz,
  addQuestion,
  appendEvent,
} from './store.js';

/** 拡張自身のページ(popup・ダッシュボード・オンボーディング)からのメッセージか。 */
function fromExtensionPage(sender) {
  return sender.id === chrome.runtime.id && (sender.url ?? '').startsWith(chrome.runtime.getURL(''));
}

// 拡張のページだけが送れる操作(content script からは受けない — 読んでいるページに入った
// スクリプトから、全消去やθの書き換えをさせない)
const PAGE_ONLY = new Set([
  Msg.START_SESSION,
  Msg.END_SESSION,
  Msg.SET_THETA,
  Msg.COMPLETE_ONBOARDING,
  Msg.SET_GOAL,
  Msg.WIPE_ALL,
  Msg.GET_LIBRARY,
  Msg.GET_MIRROR,
  Msg.SET_TELEMETRY,
  Msg.FORGET_TELEMETRY,
]);

/**
 * 生成の依頼は、いま計測中の Play ブックスのタブからだけ受ける(セッション外・別タブからは
 * 何も作らない — 終わった後に届いた先読みも含めて)。条件に合わなければ null。
 */
async function sessionOf(sender) {
  const current = await getCurrent();
  if (!current || current.site !== 'play_books' || current.state === SessionState.ENDED) return null;
  return sender.tab?.id === current.tab_id ? current : null;
}

/** 環境の行(hello)の中身(#28)。版・ストア版か・Chrome のメジャー版・θ の初期値・目標・うんちくの同意だけ。 */
async function helloNow() {
  const state = await getState();
  return helloRow({
    ext: chrome.runtime.getManifest().version,
    store: IS_STORE_BUILD,
    userAgent: navigator.userAgent,
    theta0: state.theta0,
    goal: state.goal,
    trivia: await readServerConsent(),
  });
}

/**
 * 使われ方の要約を送る(#28・server.js)。読書中は送らない(読書を遅くしない・計測の範囲を広げない)。
 * 同意が無ければ、消してほしい ID だけを送る。届かなければ送り待ちに残り、次の機会に送り直す。
 */
async function sendTelemetry() {
  if (await getCurrent()) return;
  await flushTelemetry({ hello: helloNow });
}
const sendTelemetryLater = () => {
  sendTelemetry().catch(() => {});
};

// セッションを閉じたあと(終える・タブを閉じた・無操作・取り残されていた、のどれでも)。
// 無操作で閉じたときは「計測しますか?」の印を外す — 席を外して戻り、めくったときにまたたずねる(#32)
onSessionEnded((session, reason) => {
  if (reason === EndReason.IDLE) forgetAsked(session.tab_id).catch(() => {});
  sendTelemetryLater();
});

// 新規インストール時だけオンボーディング(診断+目標選択)を開く。更新では開かない。
// 更新のときは、ページに残った古い content script はもう SW と話せないので、進行中の
// セッションを最後の記録の時点で閉じる。送り待ちがあれば送り直す(版が変わったので hello も)。
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/onboarding.html') });
  } else if (details.reason === 'update') {
    recoverSession().finally(sendTelemetryLater);
  }
});

// ブラウザの起動: 前回ブラウザを閉じたときに読んでいたセッションが残っていれば閉じる。送り待ちを送り直す
chrome.runtime.onStartup.addListener(() => {
  recoverSession().finally(sendTelemetryLater);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  onTabActivated(activeInfo);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  onWindowFocusChanged(windowId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  onTabRemoved(tabId);
  forgetAsked(tabId).catch(() => {});
});

// セッションのハンドラのあとで「計測しますか?」を考える: 同じタブで別の本へ移ってセッションが
// 閉じたときも、新しい本でたずねられるように
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  onTabUpdated(tabId, changeInfo).finally(() => offerStart(tabId, changeInfo, tab).catch(() => {}));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) onWatchdog();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (PAGE_ONLY.has(msg?.type) && !fromExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'forbidden' });
      return;
    }
    switch (msg?.type) {
      case Msg.START_SESSION: {
        const session = await startSession(msg.tabId ?? sender.tab?.id);
        // popup から始めた本は、終えたあとにめくっても「計測しますか?」とたずねない
        await markAsked(session.tab_id, session.page_url).catch(() => {});
        sendResponse({ ok: true, session });
        break;
      }
      case Msg.START_PROMPTED: {
        // 本を開いたときの「計測しますか?」の「はい」(content/prompt.js・#32)。拡張のページ以外から
        // 受ける開始は、これだけ。送り元が Play ブックスのリーダーの最上位のフレームの自分の content script で、
        // 最初の設定が済んでいるときだけ。セッションがあれば何もしない(ページ側からほかのセッションを終わらせない)
        if (!isPromptSender(sender, chrome.runtime.id) || !(await getState()).onboarded_at) {
          sendResponse({ ok: false, error: 'forbidden' });
          break;
        }
        const session = await startSessionIfIdle(sender.tab.id);
        if (!session) {
          sendResponse({ ok: false, error: 'ほかのタブで計測しています' });
          break;
        }
        await markAsked(session.tab_id, session.page_url).catch(() => {});
        sendResponse({ ok: true });
        break;
      }
      case Msg.END_SESSION: {
        const ended = await endSession(msg.reason);
        sendResponse({ ok: true, session: ended });
        break;
      }
      case Msg.REPORT:
        await onReport(msg.event, msg.payload ?? {}, sender);
        sendResponse({ ok: true });
        break;

      case Msg.GET_STATUS:
        sendResponse({ ok: true, session: await getCurrent(), state: await getState() });
        break;

      case Msg.GET_LIBRARY:
        sendResponse({ ok: true, library: await buildLibrary() });
        break;

      case Msg.SET_THETA:
        // 開発用(θの手動上書き)。ストア版では受けない — θを動かすのは読書の実績だけ
        if (IS_STORE_BUILD) {
          sendResponse({ ok: false, error: 'forbidden' });
          break;
        }
        sendResponse({ ok: true, ...(await setTheta(msg.theta)) });
        break;

      case Msg.COMPLETE_ONBOARDING: {
        // 診断スコア→初期θのルックアップと保存。
        // 既にセッション実績かオンボーディング完了があるプロファイルでは、θを上書き
        // しない(進行中の漸減を診断のやり直しで壊さない)。目標と回答は常に更新する。
        // 各問 0〜2 点の整数に丸める(小数や範囲外で θ の表引きが壊れないように)
        const answers = Array.isArray(msg.answers)
          ? msg.answers.slice(0, 4).map((v) => Math.min(2, Math.max(0, Math.round(Number(v) || 0))))
          : [];
        const score = answers.reduce((a, v) => a + v, 0);
        const state = await getState();
        const sessions = await getAllSessions();
        const fresh = sessions.length === 0 && !state.onboarded_at;
        if (fresh) {
          const table = DIAGNOSIS.thetaByScore;
          state.theta = table[Math.min(Math.max(score, 0), table.length - 1)];
          state.day_start_theta = state.theta;
          state.theta0 = state.theta; // 診断で置いた初期値(使われ方の要約の hello に載せる。制御器は読まない)
        }
        state.diag_answers = answers;
        if (typeof msg.goal === 'string' && msg.goal in GOALS) state.goal = msg.goal;
        state.onboarded_at = state.onboarded_at ?? Date.now();
        await putState(state);
        // 外へ送るかどうかは本人が最後の画面で選んだもの(本文を AI のサーバに送る・使われ方の要約)
        if (typeof msg.text === 'boolean') await writeTextConsent(msg.text);
        if (typeof msg.trivia === 'boolean') await writeServerConsent(msg.trivia);
        if (typeof msg.telemetry === 'boolean') await writeTelemetryConsent(msg.telemetry);
        if (msg.telemetry === false) await dropTelemetryOutbox();
        // θ の初期値と目標が決まったので、環境の行(hello)を積み直して送る(同意があれば)
        await resetTelemetryHello();
        sendTelemetryLater();
        sendResponse({ ok: true, theta_applied: fresh });
        break;
      }

      case Msg.SET_GOAL: {
        // 週次目標(評価レイヤー)。stateへの書き込みはSW経由に揃える(制御器との競合回避)。
        // 制御器はgoalを読まないので、θの力学には一切影響しない。
        const goal = typeof msg.goal === 'string' && msg.goal in GOALS ? msg.goal : null;
        const state = await getState();
        state.goal = goal;
        await putState(state);
        sendResponse({ ok: true, goal });
        break;
      }

      case Msg.GET_MIRROR:
        sendResponse({ ok: true, mirror: await buildMirror() });
        break;

      case Msg.QUIZ_REQUEST: {
        // クイズ生成。読み終えたページの本文からサーバで作る — 本人が「本文を AI のサーバに送る」を
        // オンにしたときだけ。作れなければ静かに諦め、content 側は何も出さない — クイズの都合で読書を壊さない。
        const current = await sessionOf(sender);
        const text = (msg.paragraph_text ?? '').trim().slice(0, 2000);
        if (!current || text.length < 60) {
          sendResponse({ ok: false, error: 'no-material' });
          break;
        }
        // 同じ段落から作って出したことのあるクイズがあれば、それをもう一度出す(作り直さない)
        const hash = await sha256Hex(text);
        const existing = await getQuizByHash(hash).catch(() => null);
        const focus = String(msg.focus_text ?? '').trim().slice(0, 600);
        if (!existing && !(await readTextConsent())) {
          sendResponse({ ok: false, error: 'text-off' });
          break;
        }
        const quiz = existing ? acceptQuiz(existing) : await serverQuiz(text, focus);
        if (!quiz) {
          sendResponse({ ok: false, error: 'unavailable' });
          break;
        }
        // 記録はまだしない: 先に作っておくだけで、出さずに終わることがある。出したときに QUIZ_SHOWN で残す
        sendResponse({ ok: true, quiz, source: existing ? 'saved' : 'server' });
        break;
      }

      case Msg.QUIZ_SHOWN: {
        // 突然クイズを出した。ここで初めて記録層に残す(出した時点の本のページと一緒に)。
        // 回答の記録(QUIZ_ANSWERED)は返した quiz_id に付く
        const current = await sessionOf(sender);
        const text = (msg.paragraph_text ?? '').trim().slice(0, 2000);
        const quiz = acceptQuiz(msg.quiz);
        if (!current || !quiz || text.length < 60) {
          sendResponse({ ok: false, error: 'no-material' });
          break;
        }
        const hash = await sha256Hex(text);
        const existing = await getQuizByHash(hash).catch(() => null);
        if (existing) {
          sendResponse({ ok: true, quiz_id: existing.quiz_id });
          break;
        }
        const pos = await getBookPosition();
        const quizId = await addQuiz({
          page_id: current.page_id ?? null,
          paragraph_hash: hash,
          paragraph_excerpt: text.slice(0, 80),
          // 出したときのページと総ページ数(総ページ数は倍率で変わる。本棚で今の尺度に換算する・#33)
          book_page: pos?.page ?? null,
          book_total: pos?.total ?? null,
          question: quiz.question,
          choices: quiz.choices,
          answer_index: quiz.answer_index,
          created_at: Date.now(),
        });
        sendResponse({ ok: true, quiz_id: quizId });
        break;
      }

      case Msg.ASK_REQUEST: {
        // 自分からの問い(道具カテゴリ・1問1答)。答えはサーバで作る — 本人が「本文を AI のサーバに送る」を
        // オンにしたときだけ。回答に演出はつけない(質問をレバーにしない)。制御器にも一切入れない。
        const current = await sessionOf(sender);
        if (!current) {
          sendResponse({ ok: false, error: 'no-session' });
          break;
        }
        const question = String(msg.question ?? '').slice(0, 300);
        const selection = String(msg.selection ?? '').slice(0, 500);
        const context = Array.isArray(msg.context)
          ? msg.context
              .slice(0, 8)
              .map((c) => ({ i: Number(c?.i) || 0, text: String(c?.text ?? '').slice(0, 800) }))
          : [];
        if (!question.trim()) {
          sendResponse({ ok: false, error: 'empty' });
          break;
        }
        if (!(await readTextConsent())) {
          sendResponse({ ok: false, error: 'text-off' });
          break;
        }
        // 本文を選んで問うた・問いの言葉が本文と重なるなら、本についての問い。そうでなければ、
        // 本と関係のない頼みごとか(コードを書いて等)を、答えと同じ1回の呼び出しでサーバに決めさせる
        const known = Boolean(selection.trim()) || sharesTermWith(question, context.map((c) => c.text).join('\n'));
        const res = await serverAnswer({ question, selection, context, judge: !known });
        if (!res) {
          sendResponse({ ok: false, error: 'unavailable' });
          break;
        }
        if (res.off_topic) {
          // 本と関係のない頼みごと(コードを書いて等)には答えない。問いの記録にも復習にも入れない
          sendResponse({ ok: false, error: 'off-topic' });
          break;
        }
        // 計測層には文字数だけ(層の分離: 文面は記録層のquestionsにのみ置く)
        try {
          await appendEvent(current.session_id, EventType.QUESTION_ASKED, {
            chars: question.length,
          });
          const pos = await getBookPosition();
          await addQuestion({
            page_id: current.page_id ?? null,
            session_id: current.session_id,
            // 問いを投げた時点の本のページ(と総ページ数)と、選んでいた箇所(本人が指したところ)
            book_page: pos?.page ?? null,
            book_total: pos?.total ?? null,
            selection: selection.trim() || null,
            question,
            answer: res.answer,
            created_at: Date.now(),
          });
        } catch {
          /* 記録失敗は回答を妨げない */
        }
        sendResponse({ ok: true, answer: res.answer, source_index: res.source_index });
        break;
      }

      case Msg.TRIVIA_REQUEST: {
        // くまのうんちく(読み終えたページから・道具ではなく演出の一部)。
        // 本人の同意(うんちくの単語・本文を AI のサーバに送る のどちらか。単語は本文より少ない)があれば、
        // 端末で本文から選んだ「単語の候補」だけをサーバへ送り、辞書・事典の知識が確かなモデルに話させる
        // (本文・書名・URL は送らない)。同意が無い・サーバが黙った・届かないときは ok:false で何も出さない。
        // 文面は記録層にも計測層にも残さない(出したことだけを content 側が計測層に報告する)。
        const current = await sessionOf(sender);
        const text = (msg.paragraph_text ?? '').trim().slice(0, 2000);
        if (!current || text.length < 60) {
          sendResponse({ ok: false, error: 'no-material' });
          break;
        }
        const trivia = (await readServerConsent()) || (await readTextConsent())
          ? await serverTrivia(pickTerms(text, { max: SERVER.maxTerms, maxChars: SERVER.maxTermChars }))
          : null;
        sendResponse(trivia ? { ok: true, trivia } : { ok: false, error: 'unavailable' });
        break;
      }

      case Msg.SET_TELEMETRY: {
        // 使われ方の要約を送るか(ダッシュボード)。オフにしたら、積んでいたものも送らない
        const on = msg.on === true;
        await writeTelemetryConsent(on);
        if (on) sendTelemetryLater();
        else await dropTelemetryOutbox();
        sendResponse({ ok: true, on });
        break;
      }

      case Msg.FORGET_TELEMETRY:
        // 送ったものを消す(ダッシュボード)。サーバの行を消し、次からは新しい ID で送る
        sendResponse({ ok: true, deleted: await forgetTelemetry() });
        break;

      case Msg.WIPE_ALL: {
        // 終了処理が失敗しても(記録の書き込みエラー等)、消去はやり切る。サーバに送った使われ方の要約も消す
        // (届かなければ、消してほしい ID だけを残して、次の起動で送り直す)
        const deleted = await forgetTelemetry(async () => {
          await endSession('manual').catch(() => {});
          await wipeAll();
          await resetInstallId().catch(() => {});
        });
        sendResponse({ ok: true, deleted });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })().catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true; // 非同期応答
});
