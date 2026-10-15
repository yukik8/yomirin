// セッション中だけ動くcontent scriptの本体(loader.js経由で注入される)。
//
// このファイルの制約:
//   - ページDOMを変更しない。追加してよいのはShadow DOMに閉じたオーバーレイだけ。
//   - 本文は読み取りのみ。再構成・広告除去はしない。
//   - service worker へ送るのは計測値と、クイズ・問い・うんちくの素材(読み終えた本文)。
//     本文がサーバへ出るのは、本人が「本文を AI のサーバに送る」をオンにしたときのクイズと問いだけ。
//     うんちくのサーバへ送るのは、SW が本文から選んだ単語の候補だけ。

// loader.jsが付けたキャッシュ割りクエリ(?t=...)を配下のモジュールにも伝播させる。
// これがないと、拡張をリロードしても開きっぱなしのページでは古いモジュールが
// ページのモジュールキャッシュから使われ続ける(overlay/hintsだけ更新されない事故)。
const v = new URL(import.meta.url).search;
const mod = (path) => import(chrome.runtime.getURL(path) + v);

const { Msg, EventType, SessionState } = await mod('src/shared/events.js');
const {
  SESSION,
  AMBIENT,
  THETA_MAX,
  EFFECT_TIERS,
  QUIZ,
  PAGE_EVENTS,
  PAGE_SHOWER,
  READING_FX,
  FORESHADOW,
  CEILING,
  PAGE_CURL,
  DIFFICULTY,
  PACE,
  IS_STORE_BUILD,
  readDemoFlag,
} = await mod('src/shared/config.js');
const { difficultyOf, weightedSample } = await mod('src/content/difficulty.js');
const { createOverlay, setTextColumn, setDemoTheta, setDemoEnabled } =
  await mod('src/content/overlay.js');
const { Paint, clearSprites, staticSprite } = await mod('src/content/paint.js');
const { bearImg, bearURL } = await mod('src/content/bear.js');
const { createStage } = await mod('src/content/stage.js');
const { createMargin } = await mod('src/content/margin.js');
const { createStory } = await mod('src/content/story.js');
const { createPageCurl } = await mod('src/content/pagecurl.js');

// デモモードの現在値(プロフィールごと・既定OFF)。セッション開始時にSWから受け取る。
// 演出の増幅にだけ効き、計測・制御・記録には一切影響しない。
let demoEnabled = false;
const { pickHint } = await mod('src/content/hints.js');

// ---- 本文検出(読み取り専用) --------------------------------------------

// 語数の見積もり(ラテン文字は単語、CJKは文字)と、Play ブックスの段落の見つけ方は book-text.js
// (loader.js と同じ判定を使う)。
const { countParts, countWords, bookParagraphs, bookTextOf } = await mod('src/content/book-text.js');

// Google Play ブックス: 本文は books.googleusercontent.com のフレームの中にある。
const PLAY_BOOKS = location.hostname === 'books.googleusercontent.com';

// 段落の本文。Play ブックスはルビの振り仮名を除く(book-text.js)。
function textOf(el) {
  return PLAY_BOOKS ? bookTextOf(el) : (el.innerText ?? '');
}

// Readability相当の簡易版: article/main配下を優先し、一定長以上の<p>を本文段落とみなす。
// 失敗したら「計測のみ」モード(段落可視の条件を外し、操作の有無だけで読書時間を数える)。
// Play ブックスは book-text.js が見つけた段落のうち、空でないものをすべて本文とする
// (先読みされた画面外のページも含め、どれが見えているかは可視の監視で判定する)。
function detectParagraphs() {
  let paragraphs;
  if (PLAY_BOOKS) {
    // 同じページが作り直された要素で何度も DOM に残るので、本文の文字列で1回ずつに絞る
    const seen = new Set();
    paragraphs = [];
    for (const p of bookParagraphs()) {
      const key = textOf(p);
      if (countWords(key) === 0 || seen.has(key)) continue;
      seen.add(key);
      paragraphs.push(p);
    }
  } else {
    const root =
      document.querySelector('article') ?? document.querySelector('main') ?? document.body;
    paragraphs = [...root.querySelectorAll('p')].filter(
      (p) => countWords(p.innerText ?? '') >= 20 && p.offsetParent !== null,
    );
  }
  let latinTotal = 0;
  let cjkTotal = 0;
  for (const p of paragraphs) {
    const { latin, cjk } = countParts(textOf(p));
    latinTotal += latin;
    cjkTotal += cjk;
  }
  const totalWords = latinTotal + cjkTotal;
  const ok = paragraphs.length >= SESSION.minParagraphs && totalWords >= SESSION.minWords;
  return {
    paragraphs: ok ? paragraphs : [],
    totalWords,
    isCJK: cjkTotal >= latinTotal, // 本文の言語判定(ヒントチップの単位に使う)
    mode: ok ? 'full' : 'measure-only',
  };
}

// paragraphs は Play ブックスで後から読み込まれたページの段落が足される(要素の追加のみ)
const detected = detectParagraphs();
const { paragraphs, isCJK, mode } = detected;
let { totalWords } = detected;
// 縦書きでは余白が上下にできるので、星を逃がす場所の計算を切り替える
const isVertical =
  paragraphs.length > 0 && getComputedStyle(paragraphs[0]).writingMode.startsWith('vertical');

// ---- service workerへの報告 ----------------------------------------------

function report(event, payload) {
  try {
    chrome.runtime.sendMessage({ type: Msg.REPORT, event, payload });
  } catch {
    /* 拡張のリロード等でコンテキストが消えた場合。次のセッションで復活する */
  }
}

// ---- 可視段落の追跡 -------------------------------------------------------

const visible = new Set(); // 可視な段落index
let maxDepthIdx = -1; // これまでに可視になった最深段落(読了率用)
// Play ブックスは同じ段落を表す要素が複数ある(ページ送りで作り直される)。出入りの通知の
// 順序が前後しても取りこぼさないよう、段落ごとに「いま見えている要素の数」で可視を判定する。
const visibleEls = new WeakSet();
const visibleCount = new Map(); // idx → 見えている要素の数
// 初めて見えた順の段落番号(突然クイズの素材=読み終えたページを遡るのに使う)
const seenOrder = [];
const seenSet = new Set();

// 段落の要素 → 段落番号。ページの DOM には印を付けない(属性を書くとページを改変することになる)
const idxOf = new WeakMap();

const observer = new IntersectionObserver(
  (entries) => {
    let newlySeen = 0;
    for (const e of entries) {
      const idx = idxOf.get(e.target);
      if (idx === undefined) continue;
      if (e.isIntersecting) {
        if (!visibleEls.has(e.target)) {
          visibleEls.add(e.target);
          visibleCount.set(idx, (visibleCount.get(idx) ?? 0) + 1);
        }
        visible.add(idx);
        if (!seenSet.has(idx)) {
          seenSet.add(idx);
          seenOrder.push(idx);
          newlySeen += 1;
        }
        // 作り直された要素のうち、いま見えている方を段落の代表にする(光の枠・余白の計算用)
        if (PLAY_BOOKS) paragraphs[idx] = e.target;
        if (idx > maxDepthIdx) maxDepthIdx = idx;
        maybeHint(idx);
      } else if (visibleEls.has(e.target)) {
        visibleEls.delete(e.target);
        const n = (visibleCount.get(idx) ?? 1) - 1;
        if (n > 0) {
          visibleCount.set(idx, n);
        } else {
          visibleCount.delete(idx);
          visible.delete(idx);
        }
      }
    }
    // Play ブックスはページ送りで本文の位置が変わるので、見えている段落から余白を測り直す
    if (PLAY_BOOKS) {
      scheduleTextColumn();
      if (newlySeen > 0) noteFlip('seen'); // 初めての段落が見えた = めくって先へ進んだ(読書中の派手さ)
      if (finalePending) maybeFinaleAtEndScreen();
    }
  },
  { threshold: 0.1 },
);

// Play ブックス: 本文の文字列 → 段落番号。ページ送りで作り直された要素も同じ番号で扱う。
// 要素ごとに番号を振ると、いま見えている段落がいつも最後の番号になり読了率が100%に張り付く。
const paragraphKeys = new Map();

paragraphs.forEach((p, i) => {
  if (PLAY_BOOKS) paragraphKeys.set(textOf(p), i);
  idxOf.set(p, i);
  observer.observe(p);
});

// Play ブックスの余白の小さな演出(margin.js)。オーバーレイの後で作る(下の「余白の演出」)
let margin = null;
// よみりんの小さなストーリー(story.js)。画面の右下の角で、めくるたびに少しずつ進み、章の終わりにオチる
let story = null;
// いま見えている本文の枠(くまの置き場所を決めるのに使う)
let textRect = null;

// 本文カラムの位置をオーバーレイへ伝える(日常の星を余白に逃がすため)
// Play ブックスは先読みされた画面外のページも DOM にあるので、見えている段落だけで測る。
function updateTextColumn() {
  const els = PLAY_BOOKS ? [...visible].map((i) => paragraphs[i]) : paragraphs;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of els) {
    const r = p?.getBoundingClientRect();
    if (r && r.width > 0) {
      if (r.left < left) left = r.left;
      if (r.right > right) right = r.right;
      if (r.top < top) top = r.top;
      if (r.bottom > bottom) bottom = r.bottom;
    }
  }
  const rect = Number.isFinite(left) ? { left, right, top, bottom, vertical: isVertical } : null;
  textRect = rect;
  setTextColumn(rect);
  margin?.setText(rect);
  story?.setText(rect);
}

let textColumnQueued = false;
function scheduleTextColumn() {
  if (textColumnQueued) return;
  textColumnQueued = true;
  requestAnimationFrame(() => {
    textColumnQueued = false;
    updateTextColumn();
  });
}
updateTextColumn();
addEventListener('resize', updateTextColumn, { passive: true });

// いま見えている段落の語数(ページ送りの直前の「読んだページ」の大きさ)
function visibleWords() {
  let n = 0;
  for (const i of visible) n += countWords(textOf(paragraphs[i]));
  return n;
}

// 読む速さの素材: このページを開いてからの時間。離脱(非表示)を挟んだページは標本にしない
let pageStartedAt = Date.now();
let pageInterrupted = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pageInterrupted = true;
});

// ---- 読む速さの推定(v0.24) --------------------------------------------------
//
// 本人がこのページのどのあたりを読んでいるかを、めくってからの時間 × 本人の速さ で推定する。
// 速さは、このセッションのページの標本(語数/滞在時間)と、前回までの持ち越し(state.pace)を
// ページ数で重み付けして混ぜる。ばらつき(cv)が大きい人ほど、推定を信じずに遅らせる。
// 使い道は「うんちくを、その語を確実に読み過ぎた頃に出す」と「くまを読んでいる側に置かない」だけ。
// 計測・制御・記録には使わない(速さの正は SW の page_read)。

const PACED = PAGE_EVENTS.paced;
let pacePrior = null; // state.pace = { wpm, cv, pages }(前回までの持ち越し)
const paceLocal = []; // このセッションの標本 { words, ms }

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** 本人の速さ(語/分)とばらつき。標本が足りなければ null。 */
function paceEstimate() {
  const wpms = paceLocal.map((x) => x.words / (x.ms / 60_000));
  const n = wpms.length;
  const k = pacePrior?.wpm > 0 ? Math.min(pacePrior.pages ?? 0, PACED.priorWeight) : 0;
  if (n + k < PACED.minSamples) return null;
  let wpm = 0;
  let cv = 0.5;
  if (n > 0) {
    const med = median(wpms);
    const sd = Math.sqrt(wpms.reduce((a, x) => a + (x - med) ** 2, 0) / n);
    const localCv = n >= 3 ? sd / med : (pacePrior?.cv ?? 0.5);
    wpm = (med * n + (pacePrior?.wpm ?? 0) * k) / (n + k);
    cv = (localCv * n + (pacePrior?.cv ?? 0.5) * k) / (n + k);
  } else {
    wpm = pacePrior.wpm;
    cv = pacePrior.cv ?? 0.5;
  }
  if (!(wpm > 0)) return null;
  return { wpm, cv: Math.min(1.5, Math.max(0.1, cv)) };
}

/** いま見えている段落を読む順に(段落番号順)。 */
function pageOrder() {
  return [...visible].sort((a, b) => a - b);
}

/**
 * いま見えているページの語数と、語 term を読み終えるまでの語数(見つからなければ null)。
 * 語が複数回出るなら最初の場所(そこを過ぎれば「読んだ」)。
 */
function wordsUntil(term) {
  let before = 0;
  let found = null;
  for (const idx of pageOrder()) {
    const t = textOf(paragraphs[idx]);
    if (found === null && term) {
      const at = t.indexOf(term);
      if (at >= 0) found = before + countWords(t.slice(0, at + term.length));
    }
    before += countWords(t);
  }
  return { words: found, total: before };
}

/**
 * ページの先頭から words 語を「確実に読み過ぎた」と見なせる時刻。
 * 本人の速さの slowFactor 倍で読んでいると仮定し、ばらつきの分だけさらに遅らせる。
 * ページの終わり(本人の速さそのままでの推定)の endGuardMs 手前より遅くなるなら null
 * (めくりとぶつけない。読み終えたページの話として次のめくりで出す)。
 */
function pacedFireAt(words, total, est) {
  const slow = (words / (est.wpm * PACED.slowFactor)) * 60_000 * (1 + PACED.cvMargin * est.cv);
  const ms = Math.max(PACED.minMs, slow);
  const endMs = (total / est.wpm) * 60_000 - PACED.endGuardMs;
  if (ms > PACED.maxMs || ms > endMs) return null;
  return pageStartedAt + ms;
}

/**
 * くまを出す側。本文の枠と重ならない側を選び、同じなら読んでいる推定位置から遠い側。
 * 縦書き(右から左)の見開きは前半が右ページなので、前半は左に出す。
 * @param {number|null} progress ページのどこまで読んだかの推定(0〜1)。不明なら null
 */
function bearSide(progress) {
  const coin = () => (Math.random() < 0.5 ? 'left' : 'right');
  if (story?.rect) return 'left'; // 右下の角には、よみりんの話がある
  if (textRect) {
    const w = Math.min(innerWidth * 0.36, 150);
    const h = w * 1.05;
    const overlap = (side) => {
      const left = side === 'left' ? innerWidth * 0.03 : innerWidth * 0.97 - w;
      const dx = Math.min(left + w, textRect.right) - Math.max(left, textRect.left);
      const dy = Math.min(innerHeight, textRect.bottom) - Math.max(innerHeight - h, textRect.top);
      return Math.max(0, dx) * Math.max(0, dy);
    };
    const l = overlap('left');
    const r = overlap('right');
    if (Math.abs(l - r) > 1) return l < r ? 'left' : 'right';
  }
  if (progress === null || progress === undefined) return coin();
  const readerOnLeft = isVertical ? progress >= 0.5 : progress < 0.5;
  return readerOnLeft ? 'right' : 'left';
}

function visibleRange() {
  if (visible.size === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const i of visible) {
    if (i < min) min = i;
    if (i > max) max = i;
  }
  return [min, max];
}

// 読了率: 最深可視段落 / 全段落(v0の定義。飛ばし読みと精読の区別は捨てる)。
// Play ブックスの本全体での位置(%)。リーダーのページ表示「11 / 17」から SW 経由で届く。
let bookPct = null;

function completionPct() {
  if (PLAY_BOOKS && bookPct !== null) return bookPct;
  if (paragraphs.length === 0) return 0;
  return Math.round(((maxDepthIdx + 1) / paragraphs.length) * 100);
}

function depthPct() {
  const max = document.documentElement.scrollHeight - innerHeight;
  if (max <= 0) return 100;
  return Math.round((scrollY / max) * 100);
}

// ---- 操作の追跡 -----------------------------------------------------------

let lastInteractionAt = Date.now();
let lastScrollReportAt = 0;

function markInteraction() {
  lastInteractionAt = Date.now();
}

function onScroll() {
  markInteraction();
  const now = Date.now();
  if (now - lastScrollReportAt < 5_000) return; // 間引き
  lastScrollReportAt = now;
  report(EventType.SCROLL, { depth_pct: depthPct(), completion_pct: completionPct() });
}

const listeners = [
  ['scroll', onScroll, { passive: true }],
  ['wheel', markInteraction, { passive: true }],
  ['keydown', markInteraction, { passive: true }],
  ['keydown', onFlipKey, { passive: true }],
  ['pointerdown', markInteraction, { passive: true }],
  ['touchmove', markInteraction, { passive: true }],
];
for (const [type, fn, opts] of listeners) addEventListener(type, fn, opts);

// ---- dwell(読書時間の鼓動) ----------------------------------------------

// 読書時間の操作的定義:
// 本文段落が可視、かつ直近30秒以内にスクロールまたは操作がある時間。
// 本文検出に失敗したmeasure-onlyモードでは可視条件を外し、操作だけで数える。
function isReading() {
  const windowMs = PLAY_BOOKS ? SESSION.pagedActivityWindowMs : SESSION.activityWindowMs;
  const recentlyActive = Date.now() - lastInteractionAt <= windowMs;
  if (!recentlyActive) return false;
  if (mode === 'measure-only') return true;
  return visible.size > 0;
}

let localReadMs = 0; // ヒント文面用のローカル概算(正はSW側)
let forewarnTicks = 0; // 先触れが続いたdwell tick数(発火保証用)
let premonition = null; // 予告中のレア以上 { idx, tier, step }(READING_FX.premonition)
const queuedHints = []; // めくるまで取っておく余白のヒント(READING_FX.still)
let macroUntil = 0; // 章の終わりのフィーバー(Macro)の間は、クイズやくまを割り込ませない
let readMsSinceStimulus = 0; // 最後の演出からの実読書時間(天井用)

const dwellTimer = setInterval(() => {
  // 拡張が更新・再読み込みされると、このスクリプトは SW と切れたまま残る。演出や監視を残さず畳む
  if (!chrome.runtime?.id) {
    stop();
    return;
  }
  if (document.hidden) return; // 非表示タブの鼓動はSW側の状態機械と二重計上になるため送らない
  if (!isReading()) return;
  localReadMs += SESSION.dwellTickMs;
  readMsSinceStimulus += SESSION.dwellTickMs;
  report(EventType.DWELL_TICK, { visible_paragraph_range: visibleRange() });
  // スクロールが起きないページ(短い記事・全段落が最初から画面内)のための
  // フォールバック: 読んでいる鼓動に合わせて、可視の候補段落からヒントを出す。
  fireHintFromVisible();
  guaranteeForewarn();
  maybeCeilingHint();
}, SESSION.dwellTickMs);

/**
 * 先触れの保証: 金/虹の先触れを見せ始めたのに段落がなかなか来ない場合、
 * guaranteeTicks(約1分)で必ず本演出を出す。予告を裏切らない(ニアミス禁止)。
 */
function guaranteeForewarn() {
  const fw = approachingRare();
  if (!fw) {
    forewarnTicks = 0;
    return;
  }
  forewarnTicks += 1;
  if (forewarnTicks >= FORESHADOW.guaranteeTicks) showHint(fw.idx);
}

/**
 * 天井の一滴: θ>0なのに演出ゼロの実読書が続いたら、いま画面内の段落で
 * normal一回を確定させる(下限保証)。残り時間の表示・示唆はしない —
 * ハマリを期待に変える技法は滞在最大化の道具なので移植しない。
 */
function maybeCeilingHint() {
  if (!CEILING.enabled || mode !== 'full' || theta <= 0) return;
  const ceilingMin = Math.min(
    CEILING.maxMinutes,
    Math.max(CEILING.minMinutes, CEILING.perThetaMinutes / theta),
  );
  if (readMsSinceStimulus < ceilingMin * 60_000) return;
  const range = visibleRange();
  if (!range) return;
  const idx = range[1];
  pendingHintAt.add(idx);
  pendingTierAt.set(idx, 'normal');
  showHint(idx);
}

// ---- オーバーレイとヒント(θ駆動) ---------------------------------------
//
// θ = 本文1,000語あたりの表示回数。目標表示回数 = θ × totalWords / 1000。
// タイミングは「段落境界の候補点から乱数で選ぶ」折衷案(設計 Open Question #3):
// 未読の段落indexからランダムに選んだ集合に印を付け、その段落が初めて可視に
// なった瞬間に表示する。measure-onlyモード(本文検出失敗)ではヒントを出さない。

const overlay = createOverlay();
const overlayStartedAt = Date.now();

// ---- 余白の演出(Play ブックス) --------------------------------------------
// 普段の小さな演出(地のきらきら・ヒント・金/虹のレア)は、本文の枠の外にだけ描く。
if (PLAY_BOOKS && mode === 'full') {
  margin = createMargin(Paint, { bearURL, staticSprite, fx: READING_FX });
  if (READING_FX.story.enabled) {
    story = createStory(Paint, { fx: READING_FX.story });
    story.begin();
  }
  updateTextColumn();
}

// ---- 自分からの問い(道具カテゴリ・常設FAB) ------------------------------
//
// 卒業の定義「刺激の起点が自分になる」の実体化(docs/design.md §7)。
// θ配下に置かない(漸減しない)・回答に演出をつけない・1問1答。
// 文脈は読了済み段落のみ(未読は渡さない=ネタバレ禁止)。制御器には一切入れない。

const ASK_CONTEXT_CHARS = 1500; // 問いに添える本文の字数の上限(文庫で2〜3ページ)

if (mode === 'full') {
  overlay.mountAsk(async (question) => {
    markInteraction(); // 問うことは読書中の活動。セッションを放置終了させない
    const selection = String(getSelection() ?? '').slice(0, 500);
    // いま読んでいるところから遡って、合わせて ASK_CONTEXT_CHARS 字まで(サーバへ送る量を抑える)
    const end = Math.min(maxDepthIdx, paragraphs.length - 1);
    const context = [];
    let budget = ASK_CONTEXT_CHARS;
    for (let i = end; i >= Math.max(0, end - 5) && budget > 0; i -= 1) {
      const text = textOf(paragraphs[i]).slice(0, Math.min(800, budget));
      context.unshift({ i, text });
      budget -= text.length;
    }
    let res = null;
    try {
      res = await chrome.runtime.sendMessage({ type: Msg.ASK_REQUEST, question, selection, context });
    } catch {
      /* SW不在 */
    }
    if (!res?.ok) {
      const known = {
        unavailable: 'サーバに届かなかったため、答えられませんでした',
        'text-off': '「本文を AI のサーバに送る」がオフのため、答えられません(ダッシュボードの「データ」で切り替えられます)',
        'no-session': '計測セッションが見つかりませんでした',
        empty: '質問が空です',
        'off-topic': 'この本についての問いに答えます',
      };
      overlay.showNotice(known[res?.error] ?? `回答できませんでした(${res?.error ?? 'no-response'})`, 4_000);
      return null;
    }
    const src = Number(res.source_index);
    const sourceEl =
      Number.isInteger(src) && src >= 0 && paragraphs[src]?.isConnected ? paragraphs[src] : null;
    overlay.showAnswer(res.answer, { sourceEl });
    return res;
  }, markInteraction);
}
const HINT_GRACE_MS = 8_000; // 開いた瞬間に光らせない+開始通知と重ねない
// ヒントどうしの最小間隔(Play ブックスのみ)。ページ送りの本では1ページ分の段落が一度に
// 見えるので、段落ごとの枠が同じページで続けて発火してしまう。間に合わなかった枠は残し、
// 間隔が空いた後もまだ見えていれば副経路が出す。先触れの保証(予告済みのレア)はこの対象外。
const MIN_HINT_GAP_MS = PLAY_BOOKS ? 30_000 : 0;
let lastHintAt = 0;

function hintCoolingDown() {
  return Date.now() - lastHintAt < MIN_HINT_GAP_MS;
}

/**
 * 通り過ぎた枠の持ち越し(Play ブックスのみ)。間隔待ちの間にページが進むと、枠のある段落が
 * 一度も出ないまま後ろへ流れて頻度が落ちる。そうした枠を、いま見えている段落 idx へ移す。
 * 戻り値: 移したら true。
 */
function carryOverPassedSlot(idx) {
  if (!PLAY_BOOKS || pendingHintAt.has(idx)) return false;
  for (const passed of pendingHintAt) {
    if (passed < idx && !visible.has(passed)) {
      const tier = pendingTierAt.get(passed);
      pendingHintAt.delete(passed);
      pendingTierAt.delete(passed);
      pendingHintAt.add(idx);
      if (tier) pendingTierAt.set(idx, tier);
      return true;
    }
  }
  return false;
}
let theta = 0;
let hintsShown = 0;

// 段落の難しさ(0〜1・遅延計算)。θ が下がるほどヒント枠を難しい段落へ寄せる(易しい所から先に消える)
const difficultyAt = new Map();
function difficultyOfIdx(idx) {
  let d = difficultyAt.get(idx);
  if (d === undefined) {
    d = difficultyOf(textOf(paragraphs[idx]));
    difficultyAt.set(idx, d);
  }
  return d;
}
function pickSlots(candidates, n) {
  if (!DIFFICULTY.enabled) return shuffled(candidates).slice(0, n);
  const k = DIFFICULTY.focusMax * (1 - Math.min(1, theta / THETA_MAX));
  if (k <= 0) return shuffled(candidates).slice(0, n);
  return weightedSample(candidates, (idx) => (0.1 + difficultyOfIdx(idx)) ** k, n);
}
let pendingHintAt = new Set(); // ヒントを出す段落index
// レア度は計画時に事前ロールする(v0.11.0)。発火の瞬間ではなく前から決まっている
// ことで「先触れ」(予期の窓)が作れる。ドーパミンはcueで出る — 待ちを設計する。
let pendingTierAt = new Map(); // idx -> 'normal' | 'rare' | 'epic'

function planHints() {
  pendingHintAt = new Set();
  pendingTierAt = new Map();
  if (mode !== 'full' || theta <= 0) return;
  const target = Math.max(1, Math.round((theta * totalWords) / 1000));
  const remaining = Math.max(0, target - hintsShown);
  if (remaining === 0) return;
  // 未読の段落を優先候補にする。全段落が既に画面に入っていた場合(短い記事)は
  // 全段落を候補にする — でないとヒントの出る機会が永遠に来ない。
  let candidates = [];
  for (let i = Math.max(1, maxDepthIdx + 1); i < paragraphs.length; i += 1) candidates.push(i);
  if (candidates.length === 0) candidates = paragraphs.map((_, i) => i);
  for (const idx of pickSlots(candidates, remaining)) {
    pendingHintAt.add(idx);
    pendingTierAt.set(idx, rollTier());
  }
}

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 後から読み込まれた段落ぶんの枠(Play ブックス)。θ × 語数 / 1000 を、端数を持ち越しながら
// 新しい段落にだけ割り当てる。計画済みの枠(先触れ中のレアを含む)は触らない — 予告を裏切らない。
let hintCarry = 0;
function planHintsFor(idxs, words) {
  if (mode !== 'full' || theta <= 0) return;
  const exact = (theta * words) / 1000 + hintCarry;
  const n = Math.min(idxs.length, Math.floor(exact));
  hintCarry = Math.min(exact - n, 1);
  for (const idx of pickSlots(idxs, n)) {
    pendingHintAt.add(idx);
    pendingTierAt.set(idx, rollTier());
  }
}

// ---- Play ブックス: 後から読み込まれるページ -----------------------------
// 読み進めると先のページが DOM に足されるので、新しい段落にも印を付けて計測と演出の対象にする。
let pageWatcher = null;
let adoptTimer = null;

function adoptNewParagraphs() {
  adoptTimer = null;
  const added = [];
  let words = 0;
  for (const p of bookParagraphs()) {
    if (idxOf.has(p)) continue;
    const key = textOf(p);
    const w = countWords(key);
    if (w === 0) continue;
    let idx = paragraphKeys.get(key);
    if (idx === undefined) {
      // 初めて見る段落(先のページが読み込まれた)
      idx = paragraphs.length;
      paragraphs.push(p);
      paragraphKeys.set(key, idx);
      added.push(idx);
      words += w;
    }
    idxOf.set(p, idx);
    observer.observe(p);
  }
  if (added.length === 0) return;
  totalWords += words;
  planHintsFor(added, words);
}

function watchNewPages() {
  if (!PLAY_BOOKS || mode !== 'full') return;
  pageWatcher = new MutationObserver(() => {
    if (!adoptTimer) adoptTimer = setTimeout(adoptNewParagraphs, 400);
  });
  pageWatcher.observe(document.querySelector('reader-pages') ?? document.body, {
    childList: true,
    subtree: true,
  });
}

/**
 * 先触れの対象: 未読の近い範囲(aheadParagraphs)にレア以上が待っているか。
 * あれば {idx, tier}。虹(epic)優先。
 */
function approachingRare(ahead = FORESHADOW.aheadParagraphs) {
  let best = null;
  for (const idx of pendingHintAt) {
    const tier = pendingTierAt.get(idx);
    if (tier !== 'rare' && tier !== 'epic') continue;
    if (idx <= maxDepthIdx || idx > maxDepthIdx + ahead) continue;
    if (tier === 'epic') return { idx, tier };
    best = { idx, tier };
  }
  return best;
}

// 演出のレア度ロール。頻度はθが決め、ここは「大きさ」だけを予測不能にする。
function rollTier() {
  const r = Math.random();
  if (demoEnabled && theta >= 5) {
    // デモ(高θ=初心者側のみ): レア演出をどんどん出す。玄人は通常確率
    if (r < 0.35) return 'epic';
    if (r < 0.8) return 'rare';
    return 'normal';
  }
  if (r < EFFECT_TIERS.epic.p) return 'epic';
  if (r < EFFECT_TIERS.epic.p + EFFECT_TIERS.rare.p) return 'rare';
  return 'normal';
}

// ---- クイズ(理解連動Micro Content・LLM経由) -----------------------------
//
// ヒント枠の一部が確率でクイズに化ける。素材は読了済み段落のみ(未読からは
// ネタバレになるので出さない)。1セッション1問。サーバ不在・生成失敗は
// 静かに諦める — クイズの都合で読書を止めない。

let quizUsed = false;
let quizInFlight = false;

/**
 * クイズを出したことを SW に知らせ、記録層の quiz_id を受け取る(記録は出した時点で行う —
 * 先に作っただけで出さなかった問題は本棚に残さない)。回答の報告はこの番号を待って付ける。
 */
function recordShownQuiz(quiz, text) {
  try {
    return chrome.runtime
      .sendMessage({ type: Msg.QUIZ_SHOWN, quiz, paragraph_text: text })
      .then((res) => res?.quiz_id ?? null, () => null);
  } catch {
    return Promise.resolve(null); // 拡張のコンテキストが消えている
  }
}

function maybeQuizInsteadOfHint() {
  if (EVENTS_ON) return false; // Play ブックスは「めくった直後の突然クイズ」に一本化する
  if (!QUIZ.enabled || quizUsed || quizInFlight) return false;
  if (mode !== 'full') return false;
  if (maxDepthIdx + 1 < QUIZ.minParagraphsRead) return false;
  // デモでも頻度はθに従う: 初心者側(θ>=5)だけ確実に出し、玄人は通常の30%抽選
  if (!(demoEnabled && theta >= 5) && Math.random() >= QUIZ.p) return false;
  startQuiz();
  return true;
}

async function startQuiz() {
  quizInFlight = true;
  // 素材は「直近に読んだ段落」から選ぶ — いま頭に残っているものについて聞く。
  // 直近4段落のうち最長のもの。短すぎる場合だけ読了済み全体に広げる
  const end = Math.min(maxDepthIdx, paragraphs.length - 1);
  const pick = (from) => {
    let idx = -1;
    for (let i = from; i <= end; i += 1) {
      const t = textOf(paragraphs[i]);
      if (idx < 0 || t.length > textOf(paragraphs[idx]).length) idx = i;
    }
    return idx;
  };
  let sourceIdx = pick(Math.max(0, end - 3));
  if ((paragraphs[sourceIdx] ? textOf(paragraphs[sourceIdx]) : '').length < 80) sourceIdx = pick(0);
  const best = paragraphs[sourceIdx] ? textOf(paragraphs[sourceIdx]) : '';
  let res = null;
  try {
    res = await chrome.runtime.sendMessage({
      type: Msg.QUIZ_REQUEST,
      paragraph_text: best.slice(0, 2000),
    });
  } catch {
    /* SW不在。諦める */
  }
  quizInFlight = false;
  if (!res?.ok || !res.quiz) return;
  if (quizUsed || !isReading()) return; // 生成中に状況が変わっていたら出さない
  quizUsed = true;
  hintsShown += 1;
  readMsSinceStimulus = 0;
  report(EventType.HINT_SHOWN, { hint_id: 'quiz_llm', kind: 'quiz' });
  // 正解時の演出の強さはθ連動: θが高いほど盛大に、卒業に向けて静かになる
  // デモでも強さはθに従う(初心者=大当たり、玄人=静かな二波)。
  const rewardTier =
    theta >= QUIZ.jackpotMinTheta ? 'jackpot' : theta >= QUIZ.rainMinTheta ? 'rain' : 'shower';
  const quizId = recordShownQuiz(res.quiz, best.slice(0, 2000));
  overlay.showQuiz(res.quiz, {
    rewardTier,
    // 出題元の段落を光の枠で指す(言葉ではなく光で「この段落の話」と伝える)
    sourceEl: paragraphs[sourceIdx]?.isConnected ? paragraphs[sourceIdx] : null,
    onAnswer: async (correct, chosenIndex, latencyMs) => {
      report(EventType.QUIZ_ANSWERED, {
        quiz_id: await quizId,
        correct,
        chosen_index: chosenIndex,
        latency_ms: latencyMs,
      });
      if (correct && rewardTier !== 'shower') {
        report(EventType.EFFECT_SHOWN, { effect_id: `quiz_${rewardTier}` });
      }
    },
  });
}

function showHint(idx) {
  const tier = pendingTierAt.get(idx) ?? rollTier();
  pendingHintAt.delete(idx);
  pendingTierAt.delete(idx);
  if (premonition?.idx === idx) premonition = null;
  forewarnTicks = 0;
  readMsSinceStimulus = 0;
  lastHintAt = Date.now();
  // クイズに化けるのはnormal枠だけ。レア以上は先触れで「金/虹が来る」と
  // 予告済みなので、別物にすり替えない(予告を裏切らない)。
  if (tier === 'normal' && maybeQuizInsteadOfHint()) return;
  hintsShown += 1;
  const { hint_id, text } = pickHint({
    min: Math.max(1, Math.round(localReadMs / 60_000)),
    cjk: isCJK,
  });
  report(EventType.HINT_SHOWN, { hint_id, kind: 'canned' });
  if (margin) {
    // Play ブックス: 文字のカードは出さない。読んでいる瞬間には動かさない(READING_FX.still)ので、
    // 余白の飾りとして、めくった瞬間に置く(めくった瞬間でなければ、次にめくるまで取っておく)。
    // 散らばる飾り(READING_FX.garden)を止めている間は、ふつうのヒントの花も置かない(読書中の派手さは、よみりんの話が担う)
    const place = tier !== 'normal' || READING_FX.garden.enabled;
    if (place && READING_FX.still) queuedHints.push(tier);
    else if (place) margin.hint(tier, theta / THETA_MAX);
    if (tier !== 'normal') report(EventType.EFFECT_SHOWN, { effect_id: `margin_${tier}` });
    return;
  }
  const onClick = () => report(EventType.HINT_CLICKED, { hint_id });

  if (tier === 'normal') {
    overlay.showHint(text, { onClick });
    return;
  }
  // レア以上: 予告の光→約1秒後に雨(レア=金、激レア=虹)。予告は必ず当たる。
  // 激レアは予告が二度瞬く(擬似連の1.5秒版) — 二拍の待ちが期待の窓を広げる。
  overlay.showHint(text, { onClick, quiet: true });
  overlay.foreshadow(tier === 'epic' ? 2 : 1);
  setTimeout(
    () => {
      overlay.rain(tier);
      report(EventType.EFFECT_SHOWN, { effect_id: `rain_${tier}` });
    },
    tier === 'epic' ? 1_500 : 950,
  );
}

/** 主経路: 候補段落が新しく画面に入った瞬間(段落境界)。 */
function maybeHint(idx) {
  if (Date.now() - overlayStartedAt < HINT_GRACE_MS) return; // 候補は残す(後で副経路が拾う)
  if (hintCoolingDown()) return; // 候補は残す(間隔が空いたら副経路が拾う)
  if (!pendingHintAt.has(idx) && !carryOverPassedSlot(idx)) return;
  if (!isReading()) return; // 読んでいる最中にだけ出す
  showHint(idx);
}

/** 副経路: dwell tickに合わせて、いま画面内にある候補段落から1つ出す。 */
function fireHintFromVisible() {
  if (Date.now() - overlayStartedAt < HINT_GRACE_MS) return;
  if (hintCoolingDown()) return;
  for (const idx of pendingHintAt) {
    if (visible.has(idx)) {
      showHint(idx);
      return; // 1 tickに1枚まで
    }
  }
  // 見えている段落に枠が無ければ、通り過ぎた枠を持ち越して出す(Play ブックスのみ)
  for (const idx of visible) {
    if (carryOverPassedSlot(idx)) {
      showHint(idx);
      return;
    }
  }
}

// デモ: ヒント枠を待たず、開始直後からクイズを出しにいく(1問出たら止まる)。
// demoEnabledは起動時(GET_STATUS後)に確定するので、生成条件でなくtick内で判定する。
// これも初心者側(θ>=5)のみ — 玄人のクイズは通常経路の頻度に従う
const demoQuizTimer = QUIZ.enabled
  ? setInterval(() => {
        if (quizUsed) {
          clearInterval(demoQuizTimer);
          return;
        }
        if (EVENTS_ON || !demoEnabled || theta < 5) return; // デモOFF or 玄人はデモ加速なし
        if (quizInFlight || mode !== 'full' || maxDepthIdx < 0) return;
        startQuiz();
      }, 3_000)
    : null;

// ---- めくった直後の「突然の出来事」(Play ブックス) -------------------------
//
// くまのうんちく/くまが顔を出す/突然クイズ のどれかが、出たり出なかったりする(可変報酬)。
// うんちくとクイズは生成に数秒かかるので、読み終えたページ(既読で、いま見えていない段落)から
// 先に1つずつ作ってストックしておき、ページ送りのたびに抽選する。
// 頻度も派手さもθに比例し、θ=0では何も起きない。
//
// v0.24: 本人の速さが分かっていれば(上の「読む速さの推定」)、くまは めくった直後ではなく、
// いま見えているページの中で出す — うんちくなら、その語を確実に読み過ぎた頃に、
// 顔を出すだけなら、ページの半分近くを読み過ぎた頃に。抽選と頻度(θ配下)は変えない。

const EVENTS_ON = PLAY_BOOKS && PAGE_EVENTS.enabled;
const stage = createStage({ Paint, bearImg });
const stock = { quiz: null, trivia: null };
const inFlight = { quiz: false, trivia: false };
// 作れなかった後は数ページ空けてから作りに行く(本文を送らない設定・話せることが無いのに毎ページ頼まない)
const retryAt = { quiz: 0, trivia: 0 };
// ストックはこのページ送りの回数を過ぎたら古いとみなして捨てる(「さっきのページ」でなくなる)
const STALE_TURNS = { quiz: 6, trivia: 4 };
const shownTrivia = new Set(); // 同じうんちくを繰り返さない
// 速さに合わせた出し方の予定(いま見えているページ用)。めくったら捨てる
let paced = null; // { turn, timer }
// 間に合わなかったうんちく(語がページの終わり近く・生成が遅かった)。次のめくりで「さっきのページの」として出す
let carry = null; // { text, term, turn }
let lastBearAt = 0;
let lastQuizAt = 0;
let pageTurns = 0;
let stopped = false;

/** 既読で、いま見えていない段落の本文。新しい方から遡って集め、読んだ順に並べる。 */
function readTextForEvents() {
  return readPageForEvents().text;
}

/**
 * 読み終えたページの本文と、その中で最も難しい段落(クイズの焦点)。
 * 焦点を難しい段落に置くのは、θ が下がるにつれ随伴性の重心を「読む→光」から「わかる→光」へ
 * 移すため(docs/research/reward.md 3-3)。クイズの頻度は θ 配下のまま変えない。
 */
function readPageForEvents() {
  const picked = [];
  let chars = 0;
  let focus = '';
  let focusD = -1;
  for (let k = seenOrder.length - 1; k >= 0 && picked.length < 12; k -= 1) {
    const idx = seenOrder[k];
    if (visible.has(idx)) continue;
    const t = textOf(paragraphs[idx]);
    if (!t) continue;
    picked.unshift(t);
    chars += t.length;
    if (DIFFICULTY.enabled && t.length >= 40) {
      const d = difficultyOfIdx(idx);
      if (d > focusD) {
        focusD = d;
        focus = t;
      }
    }
    if (chars >= PAGE_EVENTS.maxTextChars) break;
  }
  return { text: picked.join('\n').slice(-PAGE_EVENTS.maxTextChars), focus };
}

/** いま見えているページの本文(速さに合わせたうんちくの素材。読む順・上限つき)。 */
function visiblePageText() {
  const parts = [];
  let chars = 0;
  for (const idx of pageOrder()) {
    const t = textOf(paragraphs[idx]);
    if (!t) continue;
    parts.push(t);
    chars += t.length;
    if (chars >= PAGE_EVENTS.maxTextChars) break;
  }
  return parts.join('\n').slice(0, PAGE_EVENTS.maxTextChars);
}

/** ことば吹雪の文字: 読み終えたページから漢字を中心に拾う(小書きのかな・記号は除く)。 */
function glyphsFromReading() {
  const text = readTextForEvents();
  const kanji = [...new Set(text.match(/[一-鿿]/g) ?? [])];
  const small = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮー';
  const kana = [...new Set(text.match(/[ぁ-んァ-ン]/g) ?? [])].filter((c) => !small.includes(c));
  const pool = kanji.length >= 6 ? kanji : kanji.concat(kana);
  return shuffled(pool).slice(0, 24);
}

/** 生成されたクイズの形を確かめる(問題文が文字列・選択肢3つ・正解の添字が 0〜2 の整数)。 */
function validQuiz(q) {
  return (
    typeof q?.question === 'string' &&
    q.question.trim() !== '' &&
    Array.isArray(q.choices) &&
    q.choices.length === 3 &&
    q.choices.every((c) => typeof c === 'string' && c.trim() !== '') &&
    Number.isInteger(q.answer_index) &&
    q.answer_index >= 0 &&
    q.answer_index < 3
  );
}

async function prefetch(kind) {
  if (!EVENTS_ON || stopped || theta <= 0 || stock[kind] || inFlight[kind]) return;
  if (pageTurns < retryAt[kind]) return;
  // 速さに合わせた出し方ができるなら、うんちくは出す直前にいま見えているページから作る(前のページの蓄えは要らない)
  if (kind === 'trivia' && PACED.enabled && paceEstimate()) return;
  const { text, focus } = readPageForEvents();
  if (text.length < PAGE_EVENTS.minTextChars) return;
  inFlight[kind] = true;
  const turn = pageTurns;
  try {
    if (kind === 'quiz') {
      const res = await chrome.runtime.sendMessage({
        type: Msg.QUIZ_REQUEST,
        paragraph_text: text,
        focus_text: focus,
      });
      if (res?.ok && validQuiz(res.quiz)) {
        stock.quiz = { quiz: res.quiz, text, turn };
      }
    } else {
      const res = await chrome.runtime.sendMessage({ type: Msg.TRIVIA_REQUEST, paragraph_text: text });
      if (res?.ok && res.trivia?.text && !shownTrivia.has(res.trivia.text)) {
        stock.trivia = { text: res.trivia.text, term: res.trivia.term ?? '', turn };
      }
    }
  } catch {
    /* SW不在・生成失敗は静かに諦める */
  }
  inFlight[kind] = false;
  if (!stock[kind]) retryAt[kind] = pageTurns + PAGE_EVENTS.retryAfterTurns;
}

/** 古くなったストックを捨てる(何ページも前に作ったものを「さっきのページ」として出さない)。 */
function dropStale() {
  for (const kind of ['quiz', 'trivia']) {
    if (stock[kind] && pageTurns - stock[kind].turn > STALE_TURNS[kind]) stock[kind] = null;
  }
}

/**
 * ページ送りのたびに抽選し、当たれば少し間を置いて出す。クイズとくまは別々に抽選し、
 * 同じめくりで両方当たればクイズを優先する。作れていないもの(ストックなし)は抽選しない。
 */
function maybePageEvent() {
  if (!EVENTS_ON || stopped || theta <= 0 || stage.modalOpen || Date.now() < macroUntil) return;
  dropStale();
  if (pageTurns <= PAGE_EVENTS.minTurns) return;
  const now = Date.now();
  const scale = Math.min(1, theta / THETA_MAX) * (demoEnabled ? 2 : 1);
  const later = (fn) => setTimeout(() => !stopped && !stage.modalOpen && Date.now() >= macroUntil && fn(), PAGE_EVENTS.delayMs);

  const q = PAGE_EVENTS.quiz;
  if (stock.quiz && now - lastQuizAt >= q.minGapMs && Math.random() < q.maxP * scale) {
    const item = stock.quiz;
    stock.quiz = null;
    lastQuizAt = now;
    later(() => showQuiz(item));
    return;
  }

  const b = PAGE_EVENTS.bear;
  if (now - lastQuizAt < PAGE_EVENTS.afterQuizMs) return;
  // 前のページで間に合わなかったうんちく: 抽選は済んでいるので、そのまま「さっきのページの」として出す
  if (carry) {
    const item = carry;
    carry = null;
    if (pageTurns - item.turn <= PACED.carryTurns) {
      lastBearAt = now;
      later(() => showTrivia(item, { from: 'prev', side: bearSide(null) }));
      return;
    }
  }
  if (now - lastBearAt < b.minGapMs) return;
  if (Math.random() >= b.maxP * scale) return;
  lastBearAt = now;
  const pTalk = b.weights.trivia / (b.weights.trivia + b.weights.peek);
  const est = PACED.enabled ? paceEstimate() : null;
  if (est) {
    // 速さが分かっている: このページの中で、読み過ぎた頃に出す
    schedulePaced(Math.random() < pTalk, est);
    return;
  }
  const talk = stock.trivia && Math.random() < pTalk;
  if (talk) {
    const item = stock.trivia;
    stock.trivia = null;
    later(() => showTrivia(item, { from: 'prev', side: bearSide(null) }));
  } else {
    later(() => showPeek({ side: bearSide(null) }));
  }
}

function cancelPaced() {
  if (paced?.timer) clearTimeout(paced.timer);
  paced = null;
}

/**
 * 速さに合わせた出し方。めくった直後はまだ前のページが見えているので、可視が更新されてから
 * (0.9秒後)いま見えているページを読み、出す時刻を決める。
 * うんちく: いま見えているページから作り、その語を読み過ぎた頃。語が見つからない・ページの
 * 終わり近く・生成が遅かった、なら次のめくりに持ち越す(ネタバレをしない側に倒す)。
 * 顔を出すだけ: ページの peekAt を読み過ぎた頃。
 */
function schedulePaced(talk, est) {
  cancelPaced();
  const mine = { turn: pageTurns, timer: 0 };
  paced = mine;
  const alive = () => paced === mine && !stopped && !stage.modalOpen;
  const at = (fireAt, fn) => {
    if (!alive()) return;
    mine.timer = setTimeout(() => alive() && fn(), Math.max(0, fireAt - Date.now()));
  };
  mine.timer = setTimeout(async () => {
    if (!alive()) return;
    const { total } = wordsUntil('');
    if (total === 0) return;
    if (!talk) {
      const fireAt = pacedFireAt(total * PACED.peekAt, total, est);
      if (fireAt) at(fireAt, () => showPeek({ side: bearSide(PACED.peekAt), timing: 'paced' }));
      return;
    }
    const text = visiblePageText();
    if (text.length < PAGE_EVENTS.minTextChars) {
      const fireAt = pacedFireAt(total * PACED.peekAt, total, est);
      if (fireAt) at(fireAt, () => showPeek({ side: bearSide(PACED.peekAt), timing: 'paced' }));
      return;
    }
    let item = null;
    try {
      const res = await chrome.runtime.sendMessage({ type: Msg.TRIVIA_REQUEST, paragraph_text: text });
      if (res?.ok && res.trivia?.text && !shownTrivia.has(res.trivia.text)) {
        item = { text: res.trivia.text, term: res.trivia.term ?? '', turn: mine.turn };
      }
    } catch {
      /* SW不在・生成失敗は静かに諦める */
    }
    if (!item || stopped) return;
    if (paced !== mine) {
      // 作っている間にめくられた。次のめくりで「さっきのページの」として出す
      carry = item;
      return;
    }
    const { words } = wordsUntil(item.term);
    const fireAt = words === null ? null : pacedFireAt(words, total, est);
    if (!fireAt) {
      carry = item;
      return;
    }
    at(fireAt, () => showTrivia(item, { from: 'now', side: bearSide(words / total), timing: 'paced' }));
  }, 900);
}

function noteStimulus(hintId, kind, timing = 'turn') {
  hintsShown += 1;
  readMsSinceStimulus = 0;
  lastHintAt = Date.now(); // 直後に通常のヒントを重ねない
  report(EventType.HINT_SHOWN, { hint_id: hintId, kind, timing });
}

function showPeek({ side, timing = 'turn' } = {}) {
  noteStimulus('bear_peek', 'bear', timing);
  // 出方の大きさも乱数(余白のヒントと同じ確率): ふつう=いろいろな顔の出し方 / レア=小物と一緒 / 激レア=積読の上。
  // 頻度はθ、大きさは乱数。先触れは無い(予告しないレアは、予告を裏切らない)
  const rarity = rollTier();
  if (rarity !== 'normal') report(EventType.EFFECT_SHOWN, { effect_id: `bear_${rarity}` });
  stage.peek({ intensity: theta / THETA_MAX, side, rarity });
}

/** @param {{ from?: 'prev'|'now', side?: 'left'|'right', timing?: string }} o */
function showTrivia(item, { from = 'prev', side, timing = 'turn' } = {}) {
  shownTrivia.add(item.text);
  noteStimulus('bear_trivia', 'trivia', timing);
  const caption = item.term ? `${from === 'now' ? 'いま読んだ' : 'さっきのページの'}「${item.term}」より` : '';
  stage.trivia(item, { intensity: theta / THETA_MAX, side, caption, onClose: () => prefetch('trivia') });
}

function showQuiz({ quiz, text }) {
  noteStimulus('quiz_flash', 'quiz');
  const quizId = recordShownQuiz(quiz, text);
  stage.quiz(quiz, {
    intensity: theta / THETA_MAX,
    words: PAGE_EVENTS.words,
    glyphs: glyphsFromReading(),
    onFirstAnswer: async (correct, chosenIndex, latencyMs) => {
      markInteraction();
      report(EventType.QUIZ_ANSWERED, {
        quiz_id: await quizId,
        correct,
        chosen_index: chosenIndex,
        latency_ms: latencyMs,
      });
    },
    onCelebrate: () => report(EventType.EFFECT_SHOWN, { effect_id: 'quiz_flash' }),
    onClose: () => {
      markInteraction();
      prefetch('quiz');
    },
  });
}

// 読了フィナーレ(Play ブックス・1セッション1回)。最後のページに進んで着いたあと(rs_book_end)、
// その次の「読み終えた」画面(You've just finished)に進んだ瞬間に出す。最後のページを読んでいる途中には出さない。
// 拾い方は2つ: ページ表示が「17–20 / 20」→「20 / 20」に変わった(rs_book_end_screen)か、本文が画面から消えた。
// 大きさはθに比例し、θ=0では出さない — 卒業後は静かに読み終える。
let finaleShown = false;
let finalePending = false; // 最後のページに着いた。次の「読み終えた」画面を待っている
let finaleCheck = 0;

/** 本文の段落が、いま画面の中に見えているか(読み終えた画面では消える)。 */
function textOnScreen() {
  for (const i of visible) {
    const p = paragraphs[i];
    if (!p?.isConnected) continue;
    const r = p.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight) return true;
  }
  return false;
}

/** 最後のページのあと、本文が画面から消えた状態が0.6秒続いたら、読み終えた画面に進んだとみなす。 */
function maybeFinaleAtEndScreen() {
  if (!finalePending || finaleShown || finaleCheck) return;
  if (textOnScreen()) return;
  finaleCheck = setTimeout(() => {
    finaleCheck = 0;
    if (finalePending && !textOnScreen()) {
      finalePending = false;
      showBookFinale();
    }
  }, 600);
}
function showBookFinale() {
  if (!PLAY_BOOKS || stopped || finaleShown || theta <= 0) return;
  finaleShown = true;
  lastHintAt = Date.now();
  lastBearAt = Date.now();
  readMsSinceStimulus = 0;
  report(EventType.EFFECT_SHOWN, { effect_id: 'book_finale' });
  // Macro: よみりんの話がオチて、余白の飾りと縁の光が吸い込まれてから、フィーバーへ(寝床の話は寝たまま、くま抜き)。
  // 本の読了の大きさは、話に溜まった分に関係なく θ のまま
  const go = ({ aside = null } = {}) =>
    stage.finale({
      intensity: theta / THETA_MAX,
      words: PAGE_EVENTS.words,
      glyphs: glyphsFromReading(),
      bear: !aside,
      aside,
      onClose: markInteraction,
    });
  if (margin && READING_FX.still) {
    Promise.all([story ? story.ending() : {}, margin.collapse()]).then(([release]) => go(release));
  } else go();
}

// ---- 読書中の派手さ(READING_FX): Micro / Meso / Macro ----------------------------
//
// 読んでいる瞬間には動かさない。動かすのは、めくって新しいページへ進んだ瞬間(目が文章から離れている間)だけ。
//   Micro … めくりの光(抽選・めくっている間に終わる)
//   Meso  … 右下の角のよみりんの話が確率で1コマ進み、縁の光が少し育つ(静止。手が止まっても減らない)。予告の印は話の近くに
//   Macro … 章の終わり(めくった先が章の始まり)で、話がオチて余白が吸い込まれ、フィーバー「章 読了!!」
// めくった合図は3つの入口から拾い、いちばん早く届いたもので1回だけ動く(同じめくりは二重に数えない):
//   seen … 初めての段落が見えた(本文フレームの中・IntersectionObserver)
//   turn … SW からの rs_page_turn(タブの URL の変化。新しいページが出たあとに届くことがある)
//   key  … めくりのキー(矢印・PageUp/Down・スペース)
// 段落の番号は読み込んだ順に振るので、本の順と一致するとは限らない(最深段落の増加では拾わない)。

let cyclePages = 0; // 前の章の区切りから読んだページ(余白の飾りと縁の光が育つ)
let lastAdvanceAt = Date.now();
let advanceTimer = 0;
let flipAt = 0; // いまのめくりを拾った時刻
let seenBatches = 0; // 「初めての段落が見えた」の回数(最初の1回は開いたときのもの)
let headingSeen = false; // この本で見出しを見つけたか(見つからない本は fallbackPages ごとに区切る)
let chapterTitle = ''; // いまの章の見出し(短ければ「〇〇 読了!!」に使う)
let lastTurnFlashAt = 0;
let bearPlaced = false; // 余白で一緒に読むくま(章ごとに一度)

/** 開発版だけ: 読書中の派手さの動きをコンソールに残す(本物の Play ブックスで確かめる用)。 */
function fxLog(...args) {
  if (!IS_STORE_BUILD) console.info('[よみりん演出]', ...args);
}

/**
 * めくった合図(source: 'seen' | 'turn' | 'key')。めくりの光はすぐ(めくっている間に)、
 * 余白の飾り・章の区切りは新しいページの段落が見えてから(0.7秒後)。
 */
function noteFlip(source) {
  if (!PLAY_BOOKS || !margin || stopped || mode !== 'full') return;
  if (source === 'seen' && seenBatches++ === 0) return; // 開いたときに見えた段落
  const now = Date.now();
  if (now - overlayStartedAt < 2_000) return; // 開いた直後はめくりではない
  if (now - flipAt < 1_200) return; // 同じめくり(入口が複数ある)
  flipAt = now;
  fxLog('めくり', source);
  if (theta > 0) maybeTurnFlash(theta / THETA_MAX); // Micro: めくっている間に
  clearTimeout(advanceTimer);
  advanceTimer = setTimeout(onAdvance, 700);
}

function onFlipKey(e) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' '].includes(e.key)) noteFlip('key');
}

/**
 * 章の始まりらしい見出しの文字(無ければ '')。いま見えている最初の段落が、見出し(h1〜h3)か、
 * 本文より字が大きい短い行か。Play ブックスの本文の作りは本ごとに違うので目安。
 */
function chapterHeading() {
  const shown = [...visible].sort((a, b) => a - b);
  if (shown.length === 0) return '';
  const sizeOf = (el) => {
    let max = parseFloat(getComputedStyle(el).fontSize) || 0;
    for (const c of el.querySelectorAll('*')) {
      if (c.closest('rt')) continue;
      max = Math.max(max, parseFloat(getComputedStyle(c).fontSize) || 0);
    }
    return max;
  };
  const sizes = shown.map((i) => (paragraphs[i] ? sizeOf(paragraphs[i]) : 0)).filter((v) => v > 0).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 16;
  for (const i of shown.slice(0, 2)) {
    const p = paragraphs[i];
    if (!p) continue;
    const t = textOf(p);
    if (!t || t.length > 30) continue;
    if (p.matches('h1, h2, h3') || p.querySelector('h1, h2, h3') || sizeOf(p) >= median * 1.3) return t;
  }
  return '';
}

function onAdvance() {
  advanceTimer = 0;
  if (stopped || mode !== 'full' || !margin || theta <= 0) return;
  const level = theta / THETA_MAX;
  const now = Date.now();
  const read = now - lastAdvanceAt >= READING_FX.garden.minPageMs; // めくり飛ばしでない
  lastAdvanceAt = now;
  if (!READING_FX.still || stage.modalOpen) return;

  // Macro: めくった先が章の始まりなら、前の章が終わった
  const heading = chapterHeading();
  if (heading) headingSeen = true;
  const fx = READING_FX.chapter;
  // 見出しが一度も見つからない本: よみりんの話が限界で何めくりか待ったら、自分でオチる(話が無ければ fallbackPages ごと)
  const byPages = !headingSeen && (story ? story.ripe : cyclePages >= READING_FX.garden.fallbackPages);
  if (fx.enabled && (heading || byPages) && cyclePages >= READING_FX.garden.minPages) {
    // 帯の言葉: 終わった章の見出しが短ければ「〇〇 読了!!」、分からなければ「章 読了!!」。ページ数で区切ったときは言葉なし
    const label = heading ? (chapterTitle && chapterTitle.length <= 10 ? chapterTitle : '') : null;
    chapterTitle = heading;
    chapterMacro(label);
    return;
  }
  if (heading) chapterTitle = heading;

  // めくるまで取っておいた余白のヒント(当たり)を、いま置く
  flushMarginHints(level);

  // Meso: ちゃんと読んだページごとに、世界が少し育つ
  fxLog('進んだ', { read, cyclePages, items: margin.itemCount, heading, text: textRect && Math.round(textRect.right - textRect.left) });
  if (read) {
    cyclePages += 1;
    if (READING_FX.glow.enabled) margin.world(cyclePages / READING_FX.glow.fullPages, level);
    // よみりんの話: 確率で1コマ進む(何もない回もある)。前の話がオチたあとなら、次の話が始まる
    if (story) fxLog('話', story.advance(level));
    if (READING_FX.garden.enabled) {
      if (!bearPlaced && cyclePages >= READING_FX.garden.bearAt) bearPlaced = margin.add('bear', level);
      // θ が低いほど増え方もゆっくり。置き場所が無ければ置かない(本文にかけない)
      if (Math.random() < 0.35 + 0.65 * level) fxLog('飾り', margin.grow(level), margin.itemCount);
    }
  } else if (story?.state?.step < 0) {
    fxLog('話', story.advance(level)); // 1コマ目は、最初のめくりで必ず出す(めくり飛ばしでも)
  }

  // 予告: レア以上が近づいてくると、めくるたびに静かな印が増える(金の星 → くまの耳 → 虹のかけら)。
  // 残りのページ数は示さない。外れ予告は無い(印を置いたレアは、その段落に着けば必ず出る)
  const fw = READING_FX.premonition.enabled ? approachingRare(premonitionReach()) : null;
  if (fw) {
    fxLog('予告', fw.tier, premonition?.step ?? 0);
    if (premonition?.idx !== fw.idx) premonition = { idx: fw.idx, tier: fw.tier, step: 0 };
    const seq = fw.tier === 'epic' ? ['gold-star', 'gold-star', 'ears', 'rainbow'] : ['gold-star', 'gold-star'];
    const kind = seq[premonition.step];
    if (kind) margin.add(kind, level, { near: story?.rect });
    premonition.step += 1;
  }
}

/** 予告を始める先読みの段落数: いま見えている段落の数 × aheadPages(だいたい何ページ先か)。 */
function premonitionReach() {
  return Math.max(FORESHADOW.aheadParagraphs, visible.size * READING_FX.premonition.aheadPages);
}

/** めくるまで取っておいた余白のヒントを置く。激レアは、くまが画面を駆け抜ける。 */
function flushMarginHints(level) {
  while (queuedHints.length) {
    const tier = queuedHints.shift();
    margin.hint(tier, level, { still: true, near: story?.rect });
    if (tier === 'epic' && READING_FX.flyby.enabled) stage.flyby({ intensity: level });
  }
}

/**
 * Macro: 章の終わり。よみりんの話がオチて(弾ける・崩れる・飛んでいく・仕上がる・寝たまま…)、余白の飾りと縁の光が
 * 吸い込まれて、フィーバー「章 読了!!」。大きさは話に溜まった分で決まる(途中で章が終われば小さめ)。数秒で本に戻る。
 */
async function chapterMacro(label) {
  macroUntil = Date.now() + 3_000; // オチ〜フィーバーが開くまで(開いてからは modalOpen が守る)
  report(EventType.EFFECT_SHOWN, { effect_id: label === null ? 'chapter_pages' : 'chapter_end' });
  cyclePages = 0;
  bearPlaced = false;
  premonition = null;
  queuedHints.length = 0;
  lastHintAt = Date.now();
  lastBearAt = Date.now();
  stage.dismissCorner();
  const [{ progress = 1, aside = null } = {}] = await Promise.all([story?.ending(), margin.collapse()]);
  if (stopped || stage.modalOpen) return;
  const min = READING_FX.story.minRelease;
  stage.finale({
    intensity: (theta / THETA_MAX) * (story ? min + (1 - min) * progress : 1),
    words: PAGE_EVENTS.words,
    glyphs: glyphsFromReading(),
    chapter: { label },
    bear: !aside,
    aside,
    onClose: markInteraction,
  });
}

function maybeTurnFlash(level) {
  const fx = READING_FX.turnFlash;
  if (!fx.enabled || stage.modalOpen) return;
  const now = Date.now();
  if (now - lastTurnFlashAt < fx.minGapMs) return;
  if (Math.random() >= fx.maxP * level) return;
  lastTurnFlashAt = now;
  margin.turnFlash(level);
}

// めくった瞬間の花びら(Play ブックス)。クイズ正解と同じ降り方を、めくるたびに数秒。
// 確率も量もθに比例し、θ=0では出ない。
function maybePageShower() {
  if (!PLAY_BOOKS || !PAGE_SHOWER.enabled || stopped || mode !== 'full' || theta <= 0) return;
  if (stage.modalOpen) return;
  const level = Math.min(1, theta / THETA_MAX);
  if (Math.random() >= PAGE_SHOWER.maxP * level * (demoEnabled ? 2 : 1)) return;
  stage.pageShower({ intensity: level, glyphs: glyphsFromReading() });
}

// ---- 常時演出(地のきらきら) ---------------------------------------------
//
// 読んでいる間だけ、θに比例した密度で小さな星が漂う。ヒント(離散報酬)とは
// 別系統の連続的な演出で、Level 0が最も濃く、θの減少とともに自然に薄まる。
// 「読んでいる状態そのものに薄い報酬が伴う」がこの補助輪の地の部分。

const ambientTimer = AMBIENT.enabled
  ? setInterval(() => {
      // 読んでいる瞬間には動かさない(Play ブックス): 地のきらきらは出さない。予告は余白の静かな印で
      if (margin && READING_FX.still) return;
      if (document.hidden || mode !== 'full' || theta <= 0) return;
      if (!isReading()) return; // 読む手が止まっているときに光らせない
      // 先触れ: 少し先の段落にレア以上が待っているとき、地のきらきらが
      // 金(激レアは虹)に変わる — 「もうすぐ来る」をcueで伝える予期の窓。
      // 外れ予告は存在しないので、この色替わりは必ず本演出で回収される。
      const fw = approachingRare();
      if (fw) {
        if (Math.random() < 0.45) {
          const palette = fw.tier === 'epic' ? 'rainbow' : 'gold';
          if (margin) margin.ambient(palette, 2 + Math.floor(Math.random() * 3));
          else overlay.glint(3 + Math.floor(Math.random() * 5), palette);
        }
        return;
      }
      // 日常: 銀の星。均等に湧かせず、たまに「キラッ」と固まって瞬く(予測不能性)
      const p =
        (theta / THETA_MAX) ** 2 *
        AMBIENT.maxClusterChance *
        (demoEnabled && theta >= 5 ? 2.2 : 1);
      if (Math.random() < Math.min(p, 0.9)) {
        if (margin) margin.ambient('silver', 2 + Math.floor(Math.random() * 3));
        else overlay.glint(3 + Math.floor(Math.random() * 5));
      }
    }, AMBIENT.tickMs)
  : null;

// ---- 常時演出(紙のめくれ) -----------------------------------------------
//
// 読んでいる間だけ、ときどき風で左下の角がペラっとめくれて戻る(本文には重ねない)。
// 頻度と大きさはθに比例する。

const pageCurl = PAGE_CURL.enabled ? createPageCurl(overlay.curlLayer()) : null;
let lastCurlAt = 0;
const curlTimer = pageCurl
  ? setInterval(() => {
      if (document.hidden || mode !== 'full' || theta <= 0) return;
      if (!isReading() || Date.now() - lastCurlAt < PAGE_CURL.minGapMs) return;
      const level = theta / THETA_MAX;
      if (Math.random() >= PAGE_CURL.maxChance * level) return;
      lastCurlAt = Date.now();
      pageCurl.flip(PAGE_CURL.minSize + (PAGE_CURL.maxSize - PAGE_CURL.minSize) * level);
    }, PAGE_CURL.tickMs)
  : null;

// ---- 片付け ---------------------------------------------------------------

function stop({ celebrate = false, readMin = 0 } = {}) {
  if (stopped) return; // 二重に畳まない(拡張の更新で切れた後に rs_stop が届く等)
  stopped = true;
  stage.close();
  clearInterval(dwellTimer);
  if (ambientTimer) clearInterval(ambientTimer);
  if (curlTimer) clearInterval(curlTimer);
  pageCurl?.destroy();
  if (demoQuizTimer) clearInterval(demoQuizTimer);
  observer.disconnect();
  pageWatcher?.disconnect();
  clearTimeout(adoptTimer);
  removeEventListener('resize', updateTextColumn);
  removeEventListener('pagehide', onPageHide);
  for (const [type, fn] of listeners) removeEventListener(type, fn);
  try {
    chrome.runtime.onMessage.removeListener(onMessage);
  } catch {
    /* 拡張のコンテキストが消えている */
  }
  // このモジュールはページのモジュール表に残り続けるので、本文の写しや画像を抱えたままにしない
  // (同じタブで何度も読むと、そのたびに積み上がる)
  paragraphs.length = 0;
  paragraphKeys.clear();
  seenOrder.length = 0;
  seenSet.clear();
  visible.clear();
  visibleCount.clear();
  pendingHintAt.clear();
  pendingTierAt.clear();
  stock.quiz = null;
  stock.trivia = null;
  cancelPaced();
  carry = null;
  shownTrivia.clear();
  window.__readingScaffoldLoaded = false;
  const teardown = () => {
    overlay.destroy();
    margin?.destroy();
    story?.destroy();
    clearSprites();
  };
  if (celebrate) {
    if (margin) margin.hint('rare', theta / THETA_MAX);
    else overlay.celebrate(readMin);
    setTimeout(teardown, demoEnabled && theta >= 5 ? 7_500 : 2_800);
  } else {
    teardown();
  }
}

function onMessage(msg) {
  if (msg?.type === 'rs_stop') {
    stop({ celebrate: msg.celebrate === true, readMin: msg.read_min ?? 0 });
  } else if (msg?.type === 'rs_progress') {
    bookPct = Number.isFinite(msg.pct) ? msg.pct : bookPct;
  } else if (msg?.type === 'rs_page_turn') {
    // Play ブックスのページ送り。送りボタンは最上位のフレームにあり、ここでは操作が見えない
    markInteraction();
    scheduleTextColumn();
    noteFlip('turn');
    if (finalePending) setTimeout(maybeFinaleAtEndScreen, 900);
    pageTurns += 1;
    // 読む速さ: めくった直後はまだ前のページが見えているので、その語数と滞在時間を1標本として送る
    {
      const now = Date.now();
      const words = visibleWords();
      if (!pageInterrupted && words > 0) {
        const ms = now - pageStartedAt;
        const ds = [...visible].map(difficultyOfIdx);
        const d = ds.length ? Math.round((ds.reduce((a, b) => a + b, 0) / ds.length) * 100) / 100 : null;
        report(EventType.PAGE_READ, { words, ms, d });
        // 速さの推定にも同じ標本を(SW と同じ条件で絞る)
        if (ms >= PACE.minPageMs && ms <= PACE.maxPageMs && words >= PACE.minPageWords) {
          paceLocal.push({ words, ms });
          if (paceLocal.length > PACE.maxSamples) paceLocal.shift();
        }
      }
      pageStartedAt = now;
      pageInterrupted = false;
    }
    cancelPaced(); // 前のページの予定は捨てる(作りかけのうんちくは carry に回る)
    stage.dismissCorner(); // さっきのページのうんちくは引っ込める
    maybePageShower();
    maybePageEvent();
    // めくった直後はまだ前のページが「見えている」扱いなので、可視が更新されてから素材を集めて作る
    setTimeout(() => {
      prefetch('trivia');
      prefetch('quiz');
    }, 900);
  } else if (msg?.type === 'rs_book_end') {
    // 最後のページに着いた。フィナーレは次の「読み終えた」画面に進んでから
    finalePending = true;
  } else if (msg?.type === 'rs_book_end_screen') {
    if (finalePending) {
      finalePending = false;
      showBookFinale();
    }
  } else if (msg?.type === 'rs_theta') {
    // θ手動ダイヤル(ダッシュボード)からの即時反映。
    theta = msg.theta ?? 0;
    setDemoTheta(theta);
    planHints();
  }
}
const onPageHide = () => stop();
chrome.runtime.onMessage.addListener(onMessage);
addEventListener('pagehide', onPageHide, { once: true });

// ---- 開始報告 -------------------------------------------------------------

report('content_ready', {
  article_len_words: totalWords,
  paragraph_count: paragraphs.length,
  lang: isCJK ? 'cjk' : 'latin',
  mode,
});

// θはSWが持っているセッションから受け取る。SW側の保存処理と競走になっても
// 取りこぼさないよう、セッションが見えるまで少し待って再試行する。
let sessionInfo = null;
for (let i = 0; i < 6 && !sessionInfo && !stopped; i += 1) {
  try {
    const res = await chrome.runtime.sendMessage({ type: Msg.GET_STATUS });
    sessionInfo = res?.session ?? null;
    if (res?.state?.pace?.wpm > 0) pacePrior = res.state.pace; // 前回までの読む速さ(持ち越し)
  } catch {
    /* SW再起動中など。次の試行に任せる */
  }
  if (!sessionInfo) await new Promise((r) => setTimeout(r, 250));
}
// 読み込みの途中でセッションが終わっていた(rs_stop は受け取る準備ができる前に届いて
// 取りこぼしうる)。監視や演出を始めずに畳む
if (!sessionInfo || sessionInfo.state === SessionState.ENDED) stop();
// デモモード(プロフィールごと・既定OFF)を読み、演出系に反映してから計画する。
if (!stopped) demoEnabled = await readDemoFlag();
// 上の await の間に終了が届いていたら、監視を新しく作らない(作ると二度と外れない)
if (!stopped) {
  setDemoEnabled(demoEnabled);
  theta = sessionInfo?.theta ?? 0;
  if (PLAY_BOOKS && Number.isFinite(sessionInfo?.book_pct)) bookPct = sessionInfo.book_pct;
  setDemoTheta(theta); // デモの増幅率もθ連動(玄人はほぼ通常=静か)
  planHints();
  if (PLAY_BOOKS && mode === 'full') adoptNewParagraphs(); // 重複して残っている要素(見えている方を含む)も監視する
  watchNewPages();

  // 開始の合図。無言だと動いているかどうかが本人に分からない(診断可能性)。
  // Level/θ/バージョンを添えるのはドッグフーディング用: どの設定・どのコードで
  // 動いているかを一目で判別する(θ=0でヒントが出ないのは仕様、が見えるように)。
  if (mode === 'full') {
    // θと版はストア版では出さない(補助の量は本人に見せない — 気づかない速さで減らす設計)
    let dev = '';
    if (!IS_STORE_BUILD) {
      const ver = chrome.runtime.getManifest?.().version ?? '?';
      dev = ` · θ=${Number(theta).toFixed(1)} · v${ver}`;
    }
    // 語数は出さない: Play ブックスではその瞬間に描画されているページ分しか数えられず、毎回ぶれる
    // ページを再読み込みしたあとの入れ直し(#38)は、同じセッションの続き
    const verb = sessionInfo?.resumed_at ? '計測を続けています' : '計測をはじめました';
    overlay.showNotice(`${verb}${dev}`, 4_000);
  } else {
    // 設計どおり: 本文検出に失敗したページは補助なしで計測のみ。
    overlay.showNotice('本文を検出できないため、このページでは計測のみ行います', 4_500);
  }
}
