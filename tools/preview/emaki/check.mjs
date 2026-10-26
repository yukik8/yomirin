// 章の絵巻の試作(#51)の集計。runs/ の記録を端末の決まり(emaki.js の replay)でたどり、判定基準と比べた表を出す。
//
//   node tools/preview/emaki/check.mjs           # 表(Markdown。#51 の「結果」に貼る)
//   node tools/preview/emaki/check.mjs --index   # runs/index.json を書き直す(試写室が読む一覧)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paginate, replay } from './emaki.js';
import { CRITERIA, SAMPLE, label, measure, median } from './measure.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'runs');
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
if (process.argv[2] === '--index') {
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ files }, null, 2) + '\n');
  console.log(`runs/index.json: ${files.length}件`);
  process.exit(0);
}

const { books } = JSON.parse(readFileSync(join(here, 'books.json'), 'utf8'));
const fmt = (n, digits = 0) => (n == null ? '—' : n.toFixed(digits));
const pct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`);
const mark = (ok) => (ok == null ? '' : ok ? ' ✓' : ' ✗');

const rows = files.filter((f) => f !== 'unknown.json').map((file) => {
  const run = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const book = books.find((b) => b.id === run.book);
  const pages = paginate(book, run.settings.pageSize);
  const { logs } = replay(run, pages);
  return { file, run, book, m: measure(run, logs, book, pages) };
});

console.log('| 本 | 版 | 回 | 区画 | 描き足し | 語句 | 門で止めた先の語句 | 場面の変わり目 | 1回の秒(中央値・最長) | 費用 $ | 1,000字あたり $ | 判定役のネタバレ |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const { run, book, m } of rows) {
  const spoil = m.judged == null ? '—' : `${m.spoilers.length}/${m.judged}`;
  console.log(`| ${book.title} | ${label(run)} | ${run.ticks.length} | ${m.panels} | ${m.adds} | ${pct(m.grounded)} | ${m.later.length} | ${pct(m.scenes)} | ${fmt(m.medianMs && m.medianMs / 1000, 1)}・${fmt(m.maxMs && m.maxMs / 1000, 1)} | ${fmt(m.cost, 3)} | ${fmt(m.perThousand, 3)} | ${spoil} |`);
}

// 組み合わせ(下調べの有無 × 読み取り・描くモデル)ごとに、判定基準と比べる
const measured = rows.filter((r) => r.run.model !== SAMPLE);
const groups = Map.groupBy(measured, (r) => `${r.run.brief ? '下調べあり' : '下調べなし'}・読み取り ${r.run.models.reader}・描く ${r.run.models.drawer}`);
if (groups.size) {
  console.log(`\n| 組み合わせ | 版の数 | ネタバレ(${CRITERIA.spoilers}回) | 語句(${pct(CRITERIA.grounded)} 以上) | 場面の変わり目(${pct(CRITERIA.scenes)} 以上) | 1回の秒(中央値 ${CRITERIA.medianMs / 1000}・最長 ${CRITERIA.maxMs / 1000} 以内) | 1,000字あたり(中央値 $${CRITERIA.perThousand} 以下) |`);
  console.log('|---|---|---|---|---|---|---|');
  for (const [name, list] of groups) {
    const spoilers = list.reduce((n, r) => n + r.m.spoilers.length, 0), judged = list.every((r) => r.m.judged != null);
    const g = median(list.map((r) => r.m.grounded)), s = median(list.map((r) => r.m.scenes));
    const ms = median(list.map((r) => r.m.medianMs)), max = Math.max(...list.map((r) => r.m.maxMs ?? NaN).filter(Number.isFinite));
    const per = median(list.map((r) => r.m.perThousand));
    console.log(`| ${name} | ${list.length} | ${judged ? spoilers : '—'}${mark(judged ? spoilers <= CRITERIA.spoilers : null)} | ${pct(g)}${mark(g == null ? null : g >= CRITERIA.grounded)} | ${pct(s)}${mark(s == null ? null : s >= CRITERIA.scenes)} | ${fmt(ms && ms / 1000, 1)}・${Number.isFinite(max) ? (max / 1000).toFixed(1) : '—'}${mark(ms == null ? null : ms <= CRITERIA.medianMs && max <= CRITERIA.maxMs)} | ${fmt(per, 3)}${mark(per == null ? null : per <= CRITERIA.perThousand)} |`);
  }
  console.log('\n話に沿う・育つ・絵巻・下調べの有無・人物を描かないは、試写室(1ページずつ・?view=all)を見て本人が決める。');
}

const later = rows.flatMap((r) => r.m.later.map((d) => `- ${r.file} ${d.tick + 1}回目: ${d.kind} ${d.what}「${d.quote}」`));
if (later.length) console.log('\n門で止めた先の語句(まだ読んでいない所にだけ有る):\n' + later.join('\n'));
const spoilers = rows.flatMap((r) => r.m.spoilers.flatMap((t) => t.found.map((f) => `- ${r.file} ${t.tick + 1}回目: ${f.what} — ${f.why}`)));
if (spoilers.length) console.log('\n判定役がネタバレと言ったもの:\n' + spoilers.join('\n'));

if (files.includes('unknown.json')) {
  const { unknown } = JSON.parse(readFileSync(join(dir, 'unknown.json'), 'utf8'));
  console.log('\n| 知らない本(題・著者) | known | 判定 |\n|---|---|---|');
  for (const u of unknown) {
    const known = u.record.data?.known ?? `× ${u.record.error ?? u.record.stop_reason}`;
    console.log(`| ${u.title}・${u.author} | ${known} |${mark(known === 'no')} |`);
  }
}
