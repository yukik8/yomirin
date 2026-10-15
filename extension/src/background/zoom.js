// 1ページの長さ(#33・docs/design.md §6「1ページの長さ」)。補助の多いうちは、読書中のタブを大きく映して
// 1ページに入る字数を減らす。⌘+ と同じブラウザの倍率(chrome.tabs.setZoom)なので、ページの DOM には触らず、
// Play ブックスが自分でページを組み直す(不変条件1)。演出なので θ 配下: θ が下がると 1 へ戻り、θ=0 では掛けない。
//
// 掛けるのはこのタブだけ(scope: 'per-tab')。Play ブックスの他のタブや次に開いたときに残さない。per-tab の
// 倍率はタブが別の文書へ移ると Chrome が戻す(再読み込み・ブラウザの再起動でも残らない)。
// 終わるときは、いまの倍率が掛けたままのときだけ戻す。本人が途中で ⌘+/⌘− していたら触らない。
// 本人が変えたかどうかは終わるときに比べるだけ(onZoomChange のような常設リスナーは足さない・不変条件2)。

import { PAGE_ZOOM, THETA_MAX } from '../shared/config.js';

// getZoom は倍率を対数の段に直して持つので、掛けた値と少しずれて返る
const SAME = 0.01;

/** 実効θ に対する倍率(純関数)。掛けないなら 1。 */
export function zoomFor(theta) {
  const k = Math.min(1, Math.max(0, Number(theta) || 0) / THETA_MAX);
  const factor = Math.round((1 + (PAGE_ZOOM.max - 1) * k) * 100) / 100;
  return PAGE_ZOOM.enabled && factor >= PAGE_ZOOM.minFactor ? factor : 1;
}

/** いまの倍率が current のとき、θ で掛ける倍率(純関数)。掛けないなら null。 */
export function zoomTarget(theta, current) {
  const target = zoomFor(theta);
  if (target === 1 || current >= target - SAME) return null;
  return target;
}

const same = (a, b) => Math.abs(a - b) < SAME;

/**
 * セッションの開始で、θ から倍率を決めてこのタブに掛ける。
 * @returns {Promise<{ before: number, scope: string, mode: string, applied: number } | null>}
 *   掛けたら、戻すための元の倍率・設定と、掛けた倍率。掛けなかった・掛けられなかったら null
 */
export async function applyZoom(tabId, theta) {
  try {
    const before = await chrome.tabs.getZoom(tabId);
    const target = zoomTarget(theta, before);
    if (target === null) return null;
    const { mode, scope } = await chrome.tabs.getZoomSettings(tabId);
    // per-tab にできなければ掛けない(per-origin のまま掛けると、Play ブックスの倍率として保存されて残る)
    await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' });
    try {
      await chrome.tabs.setZoom(tabId, target);
    } catch {
      await chrome.tabs.setZoomSettings(tabId, { mode, scope }).catch(() => {}); // 倍率は変わっていない。設定だけ戻す
      return null;
    }
    return { before, mode, scope, applied: target };
  } catch {
    return null; // タブが無い・倍率を変えられないページ。掛けずに読む
  }
}

/**
 * セッションの途中で θ が変わった(開発版の θ のダイヤル)。掛けたままなら新しい θ の倍率に掛け直す。
 * まだ掛けていなければ、新しい θ で掛ける。本人が途中で倍率を変えていたら触らない。
 * @returns {Promise<object | null>} 新しい zoom(applyZoom と同じ形)。掛けていなければ null
 */
export async function retuneZoom(tabId, zoom, theta) {
  if (!zoom) return applyZoom(tabId, theta);
  try {
    if (!(await stillApplied(tabId, zoom))) return zoom;
    const target = zoomTarget(theta, zoom.before) ?? zoom.before;
    if (!same(target, zoom.applied)) await chrome.tabs.setZoom(tabId, target);
    return { ...zoom, applied: target };
  } catch {
    return zoom;
  }
}

/**
 * 計測中にページを再読み込みした(#38)。per-tab の倍率は別の文書へ移ると Chrome が戻すので、開始のときに
 * 掛けた倍率を掛け直す。戻すための記録(元の倍率・設定)は開始のときのものをそのまま使う。掛けたままなら触らない。
 * 再読み込みの前に本人が倍率を変えていたかは分からない(Chrome が戻している)ので、掛け直す。
 * @returns {Promise<boolean>} 掛け直したら true
 */
export async function reapplyZoom(tabId, zoom) {
  if (!zoom) return false;
  try {
    if (await stillApplied(tabId, zoom)) return false;
    await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' });
    try {
      await chrome.tabs.setZoom(tabId, zoom.applied);
    } catch {
      await chrome.tabs.setZoomSettings(tabId, { mode: zoom.mode, scope: zoom.scope }).catch(() => {});
      return false;
    }
    return true;
  } catch {
    return false; // タブが無い・倍率を変えられない。掛けずに読む
  }
}

/**
 * セッションの終わり(どの終わり方でも)に元の倍率へ戻す。戻したら true。
 * 戻すのは、このタブが今も per-tab で、倍率が掛けたままのときだけ: 本人が途中で変えていた・
 * タブが別の文書へ移って Chrome が戻した・タブが無い、なら触らない。ブラウザを起動し直したあとは
 * タブの番号が別のタブに使い回されうるが、そのタブは per-tab でも掛けた倍率でもないので触らない。
 */
export async function restoreZoom(tabId, zoom) {
  if (!zoom) return false;
  try {
    if (!(await stillApplied(tabId, zoom))) return false;
    await putBack(tabId, zoom);
    return true;
  } catch {
    return false;
  }
}

async function stillApplied(tabId, zoom) {
  const { scope } = await chrome.tabs.getZoomSettings(tabId);
  return scope === 'per-tab' && same(await chrome.tabs.getZoom(tabId), zoom.applied);
}

/** 倍率を戻してから設定を戻す(先に設定を per-origin に戻すと、掛けた倍率が Play ブックスの倍率として残りうる)。 */
async function putBack(tabId, zoom) {
  await chrome.tabs.setZoom(tabId, zoom.before);
  if (zoom.scope !== 'per-tab' || zoom.mode !== 'automatic') {
    await chrome.tabs.setZoomSettings(tabId, { mode: zoom.mode, scope: zoom.scope });
  }
}

// ---- 戻すのを少し遅らせる -----------------------------------------------------
// お祝いを出した回は、出し終えてから戻す。その間に次のセッションが始まったら、先に戻してから始める。
let pending = null; // { timer, run }

/** delayMs 後に restoreZoom する(待たずに返る)。0 ならすぐ戻し、戻し終えるまで待つ。 */
export async function restoreZoomLater(tabId, zoom, delayMs) {
  if (!zoom) return;
  await flushZoomRestore();
  if (!(delayMs > 0)) {
    await restoreZoom(tabId, zoom);
    return;
  }
  let done = null;
  const entry = {
    run: () => (done ??= restoreZoom(tabId, zoom)),
    timer: setTimeout(() => {
      if (pending === entry) pending = null;
      entry.run();
    }, delayMs),
  };
  pending = entry;
}

/** 遅らせている戻しがあれば、いま戻す(次のセッションの開始の前に)。 */
export async function flushZoomRestore() {
  const entry = pending;
  if (!entry) return;
  pending = null;
  clearTimeout(entry.timer);
  await entry.run();
}
