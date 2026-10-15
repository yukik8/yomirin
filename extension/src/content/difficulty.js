// 段落の難しさ(0〜1)。本文から端末内で計算する軽い目安 — AI は使わない。
//
// 使いどころ(docs/design.md §6):
//   - ヒント枠の配分: θ が下がるほど、難しい段落に枠を寄せる(易しい所から先に消える)
//   - 突然クイズの素材: 読み終えたページで最も難しい段落を中心に出す(読む→光 から わかる→光 へ)
//   - 読む速さの素材(page_read の d): 「難しくて遅い」と「飽きて止まった」を後で区別する
//
// 目安の中身: 文の長さ・漢字の割合・長い漢字の連なり(専門語らしさ)。英語は文の長さと長い語の割合。
// LLM で「概念の密度」を採点させる案は、この目安が弱いと分かってからにする(毎ページ
// 生成を走らせるコストに見合うかを先に確かめる)。

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

export function difficultyOf(text) {
  const t = String(text ?? '').trim();
  if (t.length < 10) return 0.5;
  const cjk = (t.match(/[぀-ヿ一-鿿々〆]/g) ?? []).length;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  return cjk >= latin ? japanese(t) : english(t);
}

function japanese(t) {
  const sentences = t.split(/[。！？!?]+/).filter((s) => s.trim().length > 0);
  const meanLen = t.length / Math.max(1, sentences.length);
  const kanji = (t.match(/[一-鿿々〆]/g) ?? []).length;
  const kanjiRatio = kanji / t.length;
  const compounds = (t.match(/[一-鿿々〆]{3,}/g) ?? []).length;
  const compoundDensity = compounds / (t.length / 100);
  // 典型(児童書〜一般書)を 0.5 に置く: 文40字・漢字3割・3字以上の漢字語 1個/100字
  const z = (meanLen - 40) / 25 + (kanjiRatio - 0.3) / 0.12 + (compoundDensity - 1) / 1.2;
  return round(sigmoid(z / 2));
}

function english(t) {
  const words = t.split(/\s+/).filter(Boolean);
  const sentences = t.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const meanLen = words.length / Math.max(1, sentences.length);
  const longRatio = words.filter((w) => w.replace(/[^A-Za-z]/g, '').length >= 8).length / Math.max(1, words.length);
  // 典型を 0.5 に置く: 1文18語・長い語 12%
  const z = (meanLen - 18) / 8 + (longRatio - 0.12) / 0.07;
  return round(sigmoid(z / 1.4));
}

const round = (v) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;

/**
 * 重み付きで k 個を選ぶ(復元なし)。weights が全部同じなら単なるシャッフルと同じ。
 * @param {number[]} idxs 候補
 * @param {(idx: number) => number} weightOf 重み(0 以上)
 */
export function weightedSample(idxs, weightOf, k, rand = Math.random) {
  const pool = idxs.map((idx) => ({ idx, w: Math.max(0, weightOf(idx)) }));
  const out = [];
  while (out.length < k && pool.length > 0) {
    const total = pool.reduce((a, p) => a + p.w, 0);
    let r = rand() * total;
    let pick = pool.length - 1;
    if (total > 0) {
      for (let i = 0; i < pool.length; i += 1) {
        r -= pool[i].w;
        if (r <= 0) {
          pick = i;
          break;
        }
      }
    } else {
      pick = Math.floor(rand() * pool.length);
    }
    out.push(pool[pick].idx);
    pool.splice(pick, 1);
  }
  return out;
}
