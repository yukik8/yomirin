// 場面の絵の試作(#50)の計測。試写室と check.mjs で使う。判定基準は #50 に書いたもので、あとから動かさない。
// 単価は $/100万トークン(入力・出力。2026-10 時点)。thinking の分も出力に数えられる
export const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [.1, .5] };
export const CRITERIA = { pass: 8 / 9, grounded: .9, medianMs: 60000, maxMs: 120000, medianCost: .07 };
export const SAMPLE = 'sample'; // Claude Code が手で書いた見本。計測が無く、判定に入れない

/** 1枚の費用($)。単価が分からないモデル・usage が無いときは null */
export function cost(model, usage) {
  const price = PRICES[model];
  if (!price || !usage) return null;
  return ((usage.input_tokens ?? 0) * price[0] + (usage.output_tokens ?? 0) * price[1]) / 1e6;
}

export function median(values) {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = list.length >> 1;
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/** samples/ の1件(generate.py の書き出し)の、表に出す名前。served_model はフォールバックで替わったとき */
export function label(record) {
  if (record.model === SAMPLE) return '見本(Claude Code・計測なし)';
  const served = record.served_model && record.served_model !== record.model ? ` → ${record.served_model}` : '';
  return `${record.model}${served} · ${record.run}回目`;
}
