// 生成(クイズ・問いへの答え・くまのうんちく)の前後を検める関数。生成そのものはサーバ(background/server.js)。
//
// 2026-10-15: 端末内の Gemini Nano をやめた。Chrome が空きディスク 22GB 以上・GPU などを求め、使える人と
// 使えない人に分かれたため。本文を扱うクイズと問いは、本人が「本文を AI のサーバに送る」をオンにした
// ときだけサーバで作る(#13)。うんちくは、どちらかの同意があれば pickTerms で選んだ単語の候補だけをサーバへ送る。

/** クイズの形を確かめて整える(問題文・選択肢3つ・正解の添字 0〜2)。合わなければ null。 */
export function acceptQuiz(out) {
  if (!out || typeof out.question !== 'string' || !out.question.trim()) return null;
  if (!Array.isArray(out.choices) || out.choices.length !== 3) return null;
  const choices = out.choices.map((c) => String(c ?? '').trim());
  if (choices.some((c) => !c)) return null;
  const idx = Number(out.answer_index);
  if (!Number.isInteger(idx) || idx < 0 || idx > 2) return null;
  return {
    question: out.question.trim().slice(0, 300),
    choices: choices.map((c) => c.slice(0, 120)),
    answer_index: idx,
  };
}

// 問いや頼みごとによく出るが、本との関わりの手がかりにならない漢字の言葉
// (「宿題を手伝って」が本文の「手伝っていた」に当たらないように、頼む言葉も入れる)
const QUESTION_WORDS = new Set(
  (
    '意味 理由 作者 筆者 著者 本文 内容 説明 場面 気持 文章 言葉 仕組 関係 本当 最後 結末 何歳 何時 何故 一体 今日 明日 昨日 ' +
    '手伝 作成 翻訳 計算 相談 紹介 解説 要約 添削 確認 方法 簡単 具体 詳細 例文'
  ).split(' '),
);

/**
 * 問いが本文と言葉を共有するか(すれば本についての問いとみなし、関係の判定に回さない)。
 * 手がかり: 「」で括った言葉・漢字の2字の並び・2字以上のカタカナ語・3字以上の英単語。
 * 漢字は2字ずつ見る(「仲買人」でも「仲買い人」に当たり、「汽車旅」でも「汽車」に当たる)。
 */
export function sharesTermWith(question, text) {
  const q = String(question ?? '');
  const src = String(text ?? '');
  if (!src) return false;
  const terms = [...q.matchAll(/「([^」]{1,20})」/g)].map((m) => m[1]);
  for (const run of q.match(/[\u4e00-\u9fff々〆]{2,}/g) ?? []) {
    if (QUESTION_WORDS.has(run)) continue;
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const pair = run.slice(i, i + 2);
      if (!QUESTION_WORDS.has(pair)) terms.push(pair);
    }
  }
  terms.push(...(q.match(/[\u30a1-\u30faー]{2,}/g) ?? []));
  const lower = src.toLowerCase();
  if ((q.match(/[A-Za-z]{3,}/g) ?? []).some((w) => lower.includes(w.toLowerCase()))) return true;
  return terms.some((t) => src.includes(t));
}

/**
 * 擬音や口ずさみらしい言葉(カタカナ/ひらがなだけで、同じ音や2音の繰り返し・空白を含むか、「っ」で終わる)。
 * 「トォテテ テテテイ」「ボーボー」「がぶがぶ」「ぱたっ」ははじき、「セロ」「ヴァイオリン」「キャベツ」は通す。
 */
export function looksLikeSound(term) {
  const t = String(term ?? '').trim();
  if (!t || !/^[\u3040-\u30ff\u30fc\s\u3000・]+$/.test(t)) return false;
  return /(.)\1/.test(t) || /(..)\1/.test(t) || /\s/.test(t) || /[っッ]$/.test(t);
}

/** うんちくの出力を検める。言い切れないもの・擬音らしいもの・長すぎるものは捨てる(null)。 */
export function acceptTrivia(out) {
  const text = typeof out?.text === 'string' ? out.text.trim() : '';
  const term = typeof out?.term === 'string' ? out.term.trim() : '';
  if (!text || text.length > 90 || out?.sure !== true) return null;
  if (looksLikeSound(term)) return null;
  return { text, term: term.slice(0, 20) };
}

// ---- うんちくの単語の候補(うんちくでサーバへ送るのはこれだけ) -------------------------

// ありふれていて、うんちくにならない熟語(候補から外す)
const COMMON = new Set(
  (
    '自分 今日 明日 昨日 時間 一人 二人 本当 先生 気持 一緒 仕事 人間 世界 言葉 何度 毎日 今度 大丈夫 ' +
    '女性 男性 子供 部屋 場所 最後 最初 結局 少年 少女 自然 必要 問題 大事 一番 一度 全部 以上 以外 ' +
    '無理 意味 存在 状態 理由 様子 相手 会社 学校 電話 家族 友達 両親 母親 父親 今夜 今朝 午前 午後 ' +
    '一日 毎晩 何事 何人 一方 他人 手紙 時代 生活 自身 感情 気分 気配 表情 返事 途中 前後 左右 上下 ' +
    '大人 東京 日本 外国 世間 自宅 本人 誰か 一体 全然 実際 普通 他人事 心配 安心 失礼 用事 準備'
  ).split(' '),
);
const NUMERAL_ONLY = /^[一二三四五六七八九十百千万億兆〇零半数]+$/;

/**
 * 読み終えたページの本文から、うんちくの種になりそうな単語を数語だけ選ぶ(端末内で完結)。
 * うんちくでサーバへ送るのはこの単語の並びだけ — 文として読めず、本の中身の写しにならない量に留める。
 * 候補: 漢字の熟語(2〜6字)・カタカナ語(3字以上。擬音らしいものは除く)・長めの英単語(小文字始まり)。
 * 見慣れなさそうなもの(字数が多い・この範囲に1回だけ出る)を優先する。名前かどうかは
 * 端末では分からないので、サーバ側の指示で避ける。
 */
export function pickTerms(text, { max = 8, maxChars = 16 } = {}) {
  const src = String(text ?? '');
  const count = new Map();
  const add = (w, kind) => {
    if (!w || w.length > maxChars) return;
    const c = count.get(w);
    if (c) c.n += 1;
    else count.set(w, { w, kind, n: 1 });
  };
  for (const m of src.matchAll(/[\u4e00-\u9fff々〆]+/g)) {
    const w = m[0].replace(/^第[一二三四五六七八九十百千]+/, ''); // 「第六交響曲」→「交響曲」
    if (w.length >= 2 && w.length <= 6 && !COMMON.has(w) && !NUMERAL_ONLY.test(w)) add(w, 'kanji');
  }
  for (const m of src.matchAll(/[\u30a1-\u30faー]+/g)) {
    const w = m[0];
    if (w.length >= 3 && !looksLikeSound(w)) add(w, 'kana');
  }
  for (const m of src.matchAll(/(?<![A-Za-z])[a-z][a-z'-]{7,}(?![A-Za-z])/g)) add(m[0], 'latin');

  const score = (c) => c.w.length * 2 + (c.n === 1 ? 2 : 0) - (c.n > 3 ? 3 : 0);
  const ranked = [...count.values()].sort((a, b) => score(b) - score(a));
  // 漢字・カタカナ・英語が偏らないように、種類ごとの上限をかけて取る
  const cap = { kanji: 5, kana: 3, latin: 3 };
  const out = [];
  for (const c of ranked) {
    if (out.length >= max) break;
    if (cap[c.kind] <= 0) continue;
    cap[c.kind] -= 1;
    out.push(c.w);
  }
  return out;
}
