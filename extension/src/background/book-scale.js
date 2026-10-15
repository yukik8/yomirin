// 本の中の位置の尺度(#33・docs/design.md §8)。リフローする本は、ブラウザの倍率(zoom.js)や窓の大きさで
// 総ページ数が変わる。違う総ページ数で測ったページを、比で今の総ページ数に換算する。純関数。
// 記録の形(readings.range・印の book_page)は変えない。換算するのは、セッションの中の位置(session.js の
// bookPosition)と、本棚を描くとき(library.js)だけ。比の換算は近似(章の切れ目などで本当のページとは少しずれる)。

const EPS = 1e-9;

/**
 * fromTotal ページで測った p ページ目を、toTotal ページの尺度に換算する。
 * edge: 'start' 区間の始まり(そのページの頭)/ 'end' 区間の終わり(そのページの終わり)/ 'mid' 1点(問い・クイズの印)
 */
export function scalePage(p, fromTotal, toTotal, edge = 'mid') {
  if (!(p > 0) || !(fromTotal > 0) || !(toTotal > 0) || fromTotal === toTotal) return p;
  const k = toTotal / fromTotal;
  const at = edge === 'start' ? (p - 1) * k + EPS : edge === 'end' ? p * k - EPS : (p - 0.5) * k;
  return Math.min(toTotal, Math.max(1, Math.floor(at) + 1));
}

/** 読んだ区間 { from, to, furthest, total } を total ページの尺度に。 */
export function scaleRange(range, total) {
  if (!(range.total > 0) || !(total > 0) || range.total === total) return range;
  return {
    from: scalePage(range.from, range.total, total, 'start'),
    to: scalePage(range.to, range.total, total, 'end'),
    furthest: scalePage(range.furthest, range.total, total, 'end'),
    total,
  };
}

/**
 * 印(問い・クイズ・主張)を付けたときの総ページ数。新しい印は book_total を持つ。持たない古い印は、
 * 同じセッションの読んだ区間か、付けた時刻を含む区間の total を使う。分からなければ null(換算しない)。
 */
export function markTotal(mark, readings) {
  if (mark.book_total > 0) return mark.book_total;
  const r =
    (mark.session_id && readings.find((x) => x.session_id === mark.session_id)) ||
    readings.find((x) => x.started_at <= mark.created_at && mark.created_at <= (x.ended_at ?? x.started_at));
  return r?.range?.total > 0 ? r.range.total : null;
}

/**
 * 読み終えるまでの残り時間(分)。読んだ区間ごとの「進んだ割合あたりの読書時間」から出すので、
 * 総ページ数の違う回が混ざってもよい。進んだ分が今の尺度で minPages ページに満たなければ null。
 */
export function remainingMinutes(readings, position, total, minPages) {
  let frac = 0;
  let ms = 0;
  for (const r of readings) {
    const advanced = (r.range.furthest - r.range.from) / r.range.total;
    if (advanced > 0) {
      frac += advanced;
      ms += r.read_ms ?? 0;
    }
  }
  if (!(total > 0) || position === null || frac * total < minPages) return null;
  return Math.ceil((((total - position) / total) * (ms / frac)) / 60_000);
}
