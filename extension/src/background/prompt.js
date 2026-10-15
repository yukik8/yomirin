// 本を開いたら「計測しますか?」とたずねる(#32・docs/design.md §3)。「読む」の押し忘れ対策。
// 始めるのは今までどおり本人の操作(カードの「はい」か popup の「読む」)で、ここは何も計測しない。
//
// セッションが無いときに tabs のハンドラがしてよいのは、これだけ(不変条件 §11-2):
// Play ブックスのリーダーを開いたタブ(host 権限は Play ブックスにしか無いので、URL が読めるのは
// Play ブックスのタブだけ)の最上位のフレームに、カード(content/prompt.js)を入れる。
// 書くのは「このタブでこの本をたずねた」の印(storage.session)だけ。events にも IndexedDB にも書かない。

import { readStartPrompt } from '../shared/config.js';
import { getState } from './store.js';
import { getCurrent } from './session.js';

// { [タブの ID]: 本の id }。たずねた・始めた印。めくるたびに URL(pg=)が変わっても出し直さないため。
// SW は止まるのでメモリには置かない。storage.session はブラウザを閉じると消え、content script からは読めない
const ASKED_KEY = 'start_prompt_asked';

/** Play ブックスのリーダーの URL なら本の id(URL の id=)、それ以外は null。 */
export function readerBookId(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'play.google.com' || !u.pathname.startsWith('/books/reader')) return null;
    return u.searchParams.get('id') || null;
  } catch {
    return null;
  }
}

/**
 * tabs.onUpdated のこの知らせで、たずねる候補になる本の id。無ければ null。
 * 読み込み中のタブには入れない(前の文書に入って消える)。読み込み終わり(status=complete)か、
 * 読み込み済みの文書の中で URL が変わった(Play ブックスの中の移動)ときだけ。
 */
export function offeredBook(changeInfo, tab) {
  if (tab?.status !== 'complete') return null;
  const url = changeInfo.url ?? (changeInfo.status === 'complete' ? tab.url : null);
  return url ? readerBookId(url) : null;
}

// 印を読んで書き戻す処理(たずねる・始めた・閉じた)は、同時に走ると古い写しで上書きし合うので、
// SW の中で1本の列に並べる。読み込み終わりと URL の変化がほぼ同時に届いても、二度入れない
let queue = Promise.resolve();
function serial(fn) {
  return (...args) => {
    const run = queue.then(() => fn(...args));
    queue = run.catch(() => {});
    return run;
  };
}

async function readAsked() {
  const got = await chrome.storage.session.get(ASKED_KEY);
  return got[ASKED_KEY] ?? {};
}

async function setAsked(tabId, book) {
  const asked = await readAsked();
  asked[tabId] = book;
  await chrome.storage.session.set({ [ASKED_KEY]: asked });
}

async function markAskedImpl(tabId, url) {
  const book = readerBookId(url);
  if (book) await setAsked(tabId, book);
}

async function forgetAskedImpl(tabId) {
  const asked = await readAsked();
  if (!(tabId in asked)) return;
  delete asked[tabId];
  await chrome.storage.session.set({ [ASKED_KEY]: asked });
}

/**
 * カードの「はい」(START_PROMPTED)を受けてよい送り元か。拡張のページ以外から開始を受けるのは、ここだけ:
 * 自分の content script で、最上位のフレームが Play ブックスのリーダーのもの。ページのスクリプトは
 * chrome.runtime に話せない(externally_connectable なし)。
 */
export function isPromptSender(sender, extensionId) {
  return (
    sender?.id === extensionId &&
    sender.frameId === 0 &&
    typeof sender.tab?.id === 'number' &&
    readerBookId(sender.url ?? '') !== null
  );
}

async function offerStartImpl(tabId, changeInfo, tab) {
  const book = offeredBook(changeInfo, tab);
  if (!book) return;
  if (await getCurrent()) return; // 計測中(どのタブでも)はたずねない。セッションのハンドラの仕事
  if ((await readAsked())[tabId] === book) return; // めくっただけ・もうたずねた
  if (!(await readStartPrompt())) return;
  if (!(await getState()).onboarded_at) return; // 最初の設定の前は、popup が設定へ案内する
  await setAsked(tabId, book);
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['src/content/prompt.js'],
    });
  } catch {
    await forgetAskedImpl(tabId); // 入れられなかった(タブが閉じた・移った)。次の機会にたずねる
  }
}

/** tabs.onUpdated ごとに(session.js の onTabUpdated のあとで)呼ぶ。必要ならカードを入れる。 */
export const offerStart = serial(offerStartImpl);
/** このタブでこの本をたずねた・始めた印を付ける。url は本の URL(セッションの page_url など)。 */
export const markAsked = serial(markAskedImpl);
/** 印を外す(無操作で閉じた・タブを閉じた)。次にめくったときに、またたずねる。 */
export const forgetAsked = serial(forgetAskedImpl);
