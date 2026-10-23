// 場面の絵の試作(#50)の検査と集計。samples/ の全部を checkScene で検め、モデルごとに判定基準と比べた表を出す。
//
//   node tools/preview/scene/check.mjs            # 表(Markdown。#50 の「結果」に貼る)
//   node tools/preview/scene/check.mjs --schema   # generate.py が Claude に渡す JSON Schema
//   node tools/preview/scene/check.mjs --index    # samples/index.json を書き直す(試写室が読む一覧)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkScene, grounded, sceneSchema } from './scene.js';
import { CRITERIA, SAMPLE, cost, label, median } from './measure.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'samples');
const arg = process.argv[2];

if (arg === '--schema') {
  process.stdout.write(JSON.stringify(sceneSchema()));
  process.exit(0);
}
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
if (arg === '--index') {
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ files }, null, 2) + '\n');
  console.log(`samples/index.json: ${files.length}件`);
  process.exit(0);
}

const passages = Object.fromEntries(JSON.parse(readFileSync(join(here, 'passages.json'), 'utf8')).passages.map((p) => [p.id, p]));
const rows = files.map((file) => {
  const record = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const { scene, dropped, error } = checkScene(record.data);
  const ground = scene ? grounded(scene, passages[record.scene].text) : { total: 0, found: 0, missing: [] };
  const shapes = scene ? scene.ground.length + scene.forms.length + scene.lines.length + scene.light.length : 0;
  const model = record.served_model ?? record.model;
  return { file, record, pass: !error && dropped === 0, error: error ?? (record.data ? null : record.stop_reason), dropped, ground, shapes, ms: record.ms ?? null, usage: record.usage ?? null, cost: cost(model, record.usage) };
});

const fmt = (n, digits = 0) => (n == null ? '—' : n.toFixed(digits));
console.log('| 場面 | 版 | 検査 | 根拠 | 形の数 | 秒 | 入力 | 出力 | 費用 $ |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const check = r.pass ? '通る' : r.error ? `× ${r.error}` : `× ${r.dropped}個落とした`;
  console.log(`| ${r.record.scene} | ${label(r.record)} | ${check} | ${r.ground.found}/${r.ground.total} | ${r.shapes} | ${fmt(r.ms && r.ms / 1000, 1)} | ${r.usage?.input_tokens ?? '—'} | ${r.usage?.output_tokens ?? '—'} | ${fmt(r.cost, 3)} |`);
}

const models = [...new Set(rows.map((r) => r.record.model).filter((m) => m !== SAMPLE))];
if (models.length) {
  const mark = (ok) => (ok == null ? '' : ok ? ' ✓' : ' ✗');
  console.log('\n| モデル | 枚数 | 形が通る(8/9 以上) | 本文に根拠(90% 以上) | 秒の中央値(60 以内) | 最長(120 以内) | 費用の中央値($0.07 以下) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const model of models) {
    const list = rows.filter((r) => r.record.model === model);
    const passed = list.filter((r) => r.pass).length;
    const found = list.reduce((n, r) => n + r.ground.found, 0), total = list.reduce((n, r) => n + r.ground.total, 0);
    const ms = list.map((r) => r.ms), midMs = median(ms), maxMs = Math.max(...ms.filter(Number.isFinite));
    const midCost = median(list.map((r) => r.cost));
    console.log(`| ${model} | ${list.length} | ${passed}/${list.length}${mark(passed / list.length >= CRITERIA.pass)} | ${total ? Math.round((found / total) * 100) : '—'}%${mark(total ? found / total >= CRITERIA.grounded : null)} | ${fmt(midMs && midMs / 1000, 1)}${mark(midMs == null ? null : midMs <= CRITERIA.medianMs)} | ${Number.isFinite(maxMs) ? (maxMs / 1000).toFixed(1) : '—'}${mark(Number.isFinite(maxMs) ? maxMs <= CRITERIA.maxMs : null)} | ${fmt(midCost, 3)}${mark(midCost == null ? null : midCost <= CRITERIA.medianCost)} |`);
  }
  console.log('\n人物を描かない・画風がそろう・場面が分かる・段階は、試写室の一覧(?view=grid)を見て本人が決める。');
}
const missing = rows.filter((r) => r.ground.missing.length);
if (missing.length) {
  console.log('\n本文にそのまま無かった根拠:');
  for (const r of missing) console.log(`- ${r.file}: ${r.ground.missing.join('、')}`);
}
