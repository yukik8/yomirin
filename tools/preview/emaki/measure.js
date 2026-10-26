// 章の絵巻の試作(#51)の計測。試写室と check.mjs で使う。判定基準は #51 に書いたもので、あとから動かさない。
import { PRICES } from '../scene/measure.js';
import { sceneAt, whereIs } from './emaki.js';

export { PRICES };
export const CRITERIA = {
  spoilers: 0, // 判定役がネタバレと言った回の数(全部の版で)
  grounded: .9, // 読み取りの語句が段落にそのまま有る割合
  scenes: .8, // 場面の変わり目が目印と合う割合
  medianMs: 60000, maxMs: 120000, // 1回(読み取り+描く)の時間
  perThousand: .07, // 1,000字あたりの費用の中央値($)。1日 5,000字で月 $10 ほど
};
export const SAMPLE = 'sample'; // Claude Code が手で書いた見本。計測が無く、判定に入れない

/** 1回の費用($)。キャッシュの書き込みは入力の 1.25 倍、読み出しは 0.1 倍。単価が分からない・usage が無いときは null */
export function cost(record) {
  const price = PRICES[record?.served_model ?? record?.model];
  const u = record?.usage;
  if (!price || !u) return null;
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * .1;
  return (input * price[0] + (u.output_tokens ?? 0) * price[1]) / 1e6;
}

export function median(values) {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = list.length >> 1;
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

const sum = (values) => (values.some((v) => v == null) ? null : values.reduce((n, v) => n + v, 0));
/** 回ごとの呼び出し(読み取り・描く・章のまとめ) */
export const callsOf = (tick) => [tick.reader, ...(tick.drawers ?? []), tick.summary].filter(Boolean);

/**
 * 記録1つの数字。replay の結果(logs)と、本(books.json の1冊)とページから出す。
 * - grounded: 読み取りが付けた語句のうち、段落にそのまま有った割合(上限で落としたものは数えない)
 * - later: 門で止めた語句のうち、まだ読んでいない所にだけ有ったもの(下調べから「先」が漏れかけた)
 * - scenes: 目印で場面が変わった/変わらなかった回のうち、新しい区画を作った/作らなかったが合った割合(章の最初の回と、must でない目印をまたぐ回は数えない)
 */
export function measure(run, logs, book, pages) {
  let tried = 0, missed = 0;
  const later = [];
  for (const log of logs) {
    const data = run.ticks[log.tick].reader?.data;
    if (!data) continue;
    tried += quoted(data);
    const bad = log.read.dropped.filter((d) => d.why === 'quote');
    missed += bad.length;
    for (const d of bad) if (whereIs(d.quote, pages, run.ticks[log.tick].pages[1]) === 'later') later.push({ tick: log.tick, ...d });
  }
  let agree = 0, scored = 0;
  const at = (tick, must) => { const p = pages[tick.pages[1]]; return sceneAt(book, p.chapter, p.paras.at(-1), { must }); };
  for (const log of logs) {
    const tick = run.ticks[log.tick], prev = run.ticks[log.tick - 1];
    if (!prev || prev.chapter !== tick.chapter || !tick.reader?.data) continue;
    const truth = at(tick, true) !== at(prev, true), loose = at(tick, false) !== at(prev, false);
    const made = log.read.draws.some((d) => d.mode === 'new');
    scored += 1;
    if (made === truth || (made && loose)) agree += 1; // must でない目印をまたいで新しい区画にしたのは、合っているとみなす
  }
  const ticks = run.ticks.map((tick) => ({ ms: sum(callsOf(tick).map((c) => c.ms ?? null)), cost: sum(callsOf(tick).map(cost)) }));
  const extra = [run.brief, run.judge].filter(Boolean);
  const chars = run.ticks.reduce((n, t) => n + pages.slice(t.pages[0], t.pages[1] + 1).reduce((m, p) => m + p.to - p.from, 0), 0);
  const total = sum([...ticks.map((t) => t.cost), ...[run.brief].filter(Boolean).map(cost)]);
  const spoilers = (run.judge?.data?.ticks ?? []).filter((t) => t.spoiler);
  return {
    grounded: tried ? (tried - missed) / tried : null, missed, later,
    scenes: scored ? agree / scored : null, scored,
    panels: logs.reduce((n, l) => n + l.read.draws.filter((d) => d.mode === 'new').length, 0),
    adds: logs.reduce((n, l) => n + l.read.draws.filter((d) => d.mode === 'add').length, 0),
    strangers: logs.reduce((n, l) => n + l.drawn.reduce((m, d) => m + (d?.strangers.length ?? 0), 0), 0),
    shapesDropped: logs.reduce((n, l) => n + l.drawn.reduce((m, d) => m + (d?.dropped ?? 0), 0), 0),
    medianMs: median(ticks.map((t) => t.ms)), maxMs: ticks.some((t) => Number.isFinite(t.ms)) ? Math.max(...ticks.map((t) => t.ms).filter(Number.isFinite)) : null,
    chars, cost: total, perThousand: total == null || !chars ? null : (total / chars) * 1000,
    judged: run.judge?.data ? run.judge.data.ticks.length : null, spoilers,
    judgeCost: cost(run.judge), extra: extra.length,
  };
}

// 読み取りの答えのうち、語句を付けたもの(出来事・場所・分かった時刻など・物・変わった物)の数
function quoted(data) {
  const scenes = Array.isArray(data.scenes) ? data.scenes : [];
  return (Array.isArray(data.events) ? data.events.length : 0) + scenes.reduce((n, s) => n
    + (typeof s?.place === 'string' && s.place.trim() ? 1 : 0)
    + ['time', 'weather', 'mood'].filter((k) => s?.[k] && s[k] !== 'unknown').length
    + (Array.isArray(s?.things) ? s.things.length : 0) + (Array.isArray(s?.changes) ? s.changes.length : 0), 0);
}

/** runs/ の1件の表に出す名前 */
export function label(run) {
  if (run.model === SAMPLE) return '見本(Claude Code・計測なし)';
  const short = (m) => m?.replace(/^claude-/, '').replace(/-\d.*$/, '') ?? '—';
  const parts = [run.brief ? '下調べあり' : '下調べなし', `読み取り ${short(run.models.reader)}・描く ${short(run.models.drawer)}`];
  if (run.settings.start) parts.push(`${run.settings.start + 1}ページ目から`);
  if (run.settings.chapters) parts.push(`${run.settings.chapters}章まで`);
  return parts.join('・') + ` · ${run.label.split('.').at(-1)}回目`;
}
