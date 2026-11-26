// 本文を行とページに割る。全角の字は幅がそろうので、字の数で行を切れば、1行が1つの要素になる
// (なぞる位置と、推定の帯を行に置ける)。章はページの頭から始める。

// 行の頭に来てはいけない字は、前の行にぶら下げる(2字まで)
const HANG = /[、。，．」』）〕】〉》！？]/;
const OPEN = /^[「『（〔【〈《―…]/;

export function linesOf(paras, perLine, { indent = true } = {}) {
  const out = [];
  paras.forEach((raw, para) => {
    const text = indent && raw && !OPEN.test(raw) ? `　${raw}` : raw;
    const shift = text.length - raw.length;
    if (!text) {
      out.push({ text: '', para, at: 0 });
      return;
    }
    let i = 0;
    while (i < text.length) {
      let j = Math.min(text.length, i + perLine);
      for (let k = 0; k < 2 && j < text.length && HANG.test(text[j]); k += 1) j += 1;
      out.push({ text: text.slice(i, j), para, at: Math.max(0, i - shift) });
      i = j;
    }
  });
  return out;
}

// book = { chapters: [{ title, paras }] } → ページ(行の並び)。各行に章・段落・段落の中の位置を持たせる
export function paginate(book, perLine, perPage) {
  const pages = [];
  book.chapters.forEach((ch, chapter) => {
    const lines = [];
    if (ch.title) lines.push({ text: ch.title, title: true, para: -1, at: 0 }, { text: '', para: -1, at: 0 });
    lines.push(...linesOf(ch.paras, perLine));
    for (let i = 0; i < lines.length; i += perPage) {
      pages.push(lines.slice(i, i + perPage).map((l) => ({ ...l, chapter })));
    }
  });
  return pages;
}

// 組み直したあと、同じ所(章・段落・位置)を含むページを探す
export function pageOfPlace(pages, place) {
  if (!place) return 0;
  const key = (l) => [l.chapter, l.para, l.at];
  const before = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  let found = 0;
  pages.forEach((p, i) => {
    const first = p.find((l) => l.para >= 0) ?? p[0];
    if (first && before(key(first), [place.chapter, place.para, place.at]) <= 0) found = i;
  });
  return found;
}
