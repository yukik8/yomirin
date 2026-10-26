import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  EMAKI, paginate, ticksOf, newBook, startChapter, readRequest, applyReading, drawRequest, applyDrawing, applySummary,
  replay, next, panelSvg, scrollSvg, whereIs, checkBrief, briefSchema, readSchema, drawSchema, summarySchema, judgeSchema, judgeRequest,
} from '../../tools/preview/emaki/emaki.js';
import { cost, measure } from '../../tools/preview/emaki/measure.js';

const dir = new URL('../../tools/preview/emaki/', import.meta.url);
const { books } = JSON.parse(readFileSync(new URL('books.json', dir), 'utf8'));
const flat = (s) => s.replace(/\s+/g, '');
const TEXT = '或夕方、トロッコは泥だらけになったまま、薄明るい中に並んでいる。三人の子供は恐る恐る、一番端にあるトロッコを押した。';
const BRIEF = { work: '芥川龍之介「トロッコ」', whole: '…結末まで…', world: '大正の村' };
const scene = (extra = {}) => ({ change: 'new', place: '村外れ', place_quote: '一番端にあるトロッコ', time: 'evening', time_quote: '或夕方', weather: 'unknown', weather_quote: '', mood: 'tense', mood_quote: '恐る恐る', keep: [], things: [], changes: [], ...extra });
const thing = (name, quote, main = false) => ({ name, look: `${name}の見た目`, quote, main });
const fresh = () => { const book = newBook(BRIEF); startChapter(book, 0); return book; };
const shape = (d = 'M0 0 h10 v10 h-10 z') => ({ forms: [{ d, color: 'brown', tone: 'mid' }], lines: [{ d, color: 'umber', width: 'thin' }], light: [] });

test('ページ: 章の始まりは新しいページで、文の切れ目で size 字までにし、本文を一字も落とさない', () => {
  for (const book of books) {
    const pages = paginate(book, 400);
    assert.equal(flat(pages.map((p) => p.text).join('')), flat(book.chapters.flatMap((c) => c.paras).join('')), book.id);
    for (const [i, p] of pages.entries()) {
      if (i > 0 && pages[i - 1].chapter !== p.chapter) assert.ok(pages[i - 1].end, `${book.id} ${i}`);
      assert.ok(p.text.replace(/\n/g, '').length <= 400 || !/[。！？]./.test(p.text.slice(0, -1)), `${book.id} ${i}: ${p.text.length}字`);
    }
    assert.equal(pages.filter((p) => p.end).length, book.chapters.length);
  }
});

test('読み取りの区切り: every 字たまるか章の終わりで1回。start から読み始め、chapters 章で止める(null は最後まで)', () => {
  const ginga = paginate(books.find((b) => b.id === 'ginga'));
  const ticks = ticksOf(ginga, { chapters: null });
  assert.equal(ticks.at(-1)[1], ginga.length - 1);
  for (const [a, b] of ticks) {
    const chars = ginga.slice(a, b + 1).reduce((n, p) => n + p.to - p.from, 0);
    assert.ok(chars >= EMAKI.every || ginga[b].end, `${a}-${b}`);
    assert.ok(ginga.slice(a, b).every((p) => !p.end), '章をまたがない');
  }
  const six = ticksOf(ginga, { chapters: 6 });
  assert.ok(six.every(([, b]) => ginga[b].chapter < 6) && ginga[six.at(-1)[1]].end);
  assert.equal(ticksOf(ginga, { start: 5 })[0][0], 5);
});

test('門: 段落にそのまま無い語句を付けた出来事・場所・時刻・物は捨て、分からないものは unknown にする', () => {
  const book = fresh();
  const { dropped, draws } = applyReading(book, {
    seed: '', events: [{ text: '押した', quote: '一番端にあるトロッコを押した' }, { text: '先の出来事', quote: 'われはもう帰んな' }],
    scenes: [scene({ weather: 'rain', weather_quote: '雨が降る', mood: 'sad', mood_quote: '泣き出した', things: [thing('トロッコ', '泥だらけになったまま', true), thing('海', '薄ら寒い海が開けた'), thing('一字', '或')] })],
  }, TEXT, 0);
  assert.deepEqual(book.story.events.map((e) => e.text), ['押した']);
  const panel = book.emaki.panels[0];
  assert.deepEqual([panel.time, panel.weather, panel.mood], ['evening', 'unknown', 'unknown']);
  assert.deepEqual(panel.things.map((t) => t.name), ['トロッコ']);
  assert.deepEqual(dropped.map((d) => d.kind).sort(), ['event', 'mood', 'thing', 'thing', 'weather']);
  assert.ok(dropped.every((d) => d.why === 'quote'));
  assert.deepEqual(draws, [{ panel: panel.id, mode: 'new', ids: [panel.things[0].id] }]);
});

test('落とした語句がどこに有るか: まだ読んでいない所だけ(先)・前に読んだ所・どこにも無い', () => {
  const pages = paginate(books.find((b) => b.id === 'torokko'));
  assert.equal(whereIs('われはもう帰んな', pages, 1), 'later');
  assert.equal(whereIs('小田原熱海間', pages, 3), 'before');
  assert.equal(whereIs('爆弾', pages, 3), 'none');
});

test('ここまでの話: seed は、話が空で下調べがあるときだけ残す', () => {
  const data = { seed: '始まりのあらすじ', events: [], scenes: [] };
  const withBrief = fresh();
  applyReading(withBrief, data, TEXT, 0);
  assert.equal(withBrief.story.seed, '始まりのあらすじ');
  const noBrief = newBook(null);
  startChapter(noBrief, 0);
  applyReading(noBrief, data, TEXT, 0);
  assert.equal(noBrief.story.seed, '');
  const later = fresh();
  later.story.events.push({ text: '前の出来事', quote: 'x', tick: 0 });
  applyReading(later, data, TEXT, 1);
  assert.equal(later.story.seed, '');
  assert.equal(readRequest(later, TEXT).seed, false);
  assert.equal(readRequest(fresh(), TEXT).seed, true);
});

test('場面: 1回に2つまで。new は場所か時刻が確かめられたときだけ。keep と changes は名前で、同じ回の区画へまとめる', () => {
  const book = fresh();
  applyReading(book, { seed: '', events: [], scenes: [scene({ things: [thing('トロッコ', '泥だらけになったまま', true)] })] }, TEXT, 0);
  const { dropped, draws } = applyReading(book, {
    seed: '', events: [],
    scenes: [
      scene({ change: 'same', things: [thing('子供の押す音', '恐る恐る')], changes: [{ name: 'トロッコ', look: '押されて動く', quote: 'トロッコを押した' }, { name: '無い物', look: '', quote: '或夕方' }] }),
      scene({ place: '別の所', place_quote: '書いていない', time: 'unknown', time_quote: '' }), // 場所も時刻も確かめられない → 続き
      scene({ place: '線路の先', place_quote: '薄明るい中に', keep: ['トロッコ', '知らない物'] }),
    ],
  }, TEXT, 1);
  assert.deepEqual(dropped.map((d) => [d.kind, d.why]), [['change', 'name'], ['place', 'quote'], ['scene', 'limit']]);
  assert.equal(book.emaki.panels.length, 1);
  const [panel] = book.emaki.panels;
  assert.deepEqual(draws, [{ panel: panel.id, mode: 'add', ids: [panel.things[0].id, panel.things[1].id] }]);
  assert.equal(panel.things[0].look, '押されて動く');

  const moved = applyReading(book, { seed: '', events: [], scenes: [scene({ place: '線路の先', place_quote: '薄明るい中に', keep: ['トロッコ'], things: [thing('線路', '一番端にある')] })] }, TEXT, 2);
  const second = book.emaki.panels[1];
  assert.deepEqual(second.things.map((t) => t.name), ['トロッコ', '線路']);
  assert.notEqual(second.things[0].id, panel.things[0].id);
  assert.equal(second.things[0].shapes, null);
  assert.deepEqual(moved.draws, [{ panel: second.id, mode: 'new', ids: second.things.map((t) => t.id) }]);
});

test('区画と物の数には上限がある。上限を超えた new は、いまの区画の続きにする', () => {
  const book = fresh();
  for (let i = 0; i < EMAKI.panels + 2; i += 1) applyReading(book, { seed: '', events: [], scenes: [scene({ things: [thing(`物${i}`, '或夕方')] })] }, TEXT, i);
  assert.equal(book.emaki.panels.length, EMAKI.panels);
  assert.equal(book.emaki.panels.at(-1).things.length, 3);
  const many = fresh();
  const { dropped } = applyReading(many, { seed: '', events: [], scenes: [scene({ things: Array.from({ length: EMAKI.things + 2 }, (_, i) => thing(`物${i}`, '或夕方')) })] }, TEXT, 0);
  assert.equal(many.emaki.panels[0].things.length, EMAKI.things);
  assert.deepEqual(dropped.map((d) => d.why), ['limit', 'limit']);
});

test('描く係に渡すものに、書名と下調べは入らない', () => {
  const book = fresh();
  const { draws } = applyReading(book, { seed: 'あらすじ', events: [], scenes: [scene({ things: [thing('トロッコ', '泥だらけ', true)] })] }, TEXT, 0);
  const req = drawRequest(book, draws[0]);
  const text = JSON.stringify(req);
  assert.ok(!text.includes(BRIEF.work) && !text.includes(BRIEF.whole) && !text.includes(BRIEF.world));
  assert.deepEqual(Object.keys(req).sort(), ['current', 'mode', 'scene', 'story', 'things']);
  assert.equal(req.current, null);
  assert.ok(JSON.stringify(readRequest(book, TEXT)).includes(BRIEF.whole), '読み取りには渡す');
});

test('描く: 頼んだ id の形だけを受け取る。add では地を描き直さず、読めない形と頼んでいない id を数える', () => {
  const book = fresh();
  const first = applyReading(book, { seed: '', events: [], scenes: [scene({ things: [thing('トロッコ', '泥だらけ', true), thing('線路', '一番端')] })] }, TEXT, 0).draws[0];
  const [a, b] = first.ids;
  const r1 = applyDrawing(book, { ground: [{ d: 'M0 0 H320 V240 H0 Z', color: 'sky', tone: 'pale' }], things: [{ id: a, ...shape() }, { id: 'p99', ...shape() }, { id: b, forms: [{ d: 'url(x)', color: 'red', tone: 'mid' }], lines: [], light: [] }] }, first, 0);
  assert.deepEqual(r1, { dropped: 1, strangers: ['p99'], missed: [b] });
  const panel = book.emaki.panels[0];
  assert.equal(panel.ground.length, 1);
  assert.equal(panel.things[0].drawn, 0);
  const add = applyReading(book, { seed: '', events: [], scenes: [scene({ change: 'same', things: [thing('子供', '三人の子供')] })] }, TEXT, 1).draws[0];
  assert.equal(add.mode, 'add');
  assert.ok(drawRequest(book, add).current.things.some((t) => t.id === a));
  const r2 = applyDrawing(book, { ground: [{ d: 'M0 0 h1', color: 'sky', tone: 'pale' }], things: [{ id: add.ids[0], ...shape() }, { id: a, ...shape() }] }, add, 1);
  assert.deepEqual(r2, { dropped: 1, strangers: [a], missed: [] });
  assert.equal(panel.ground.length, 1);
});

test('章のまとめ: 出来事を空にしてまとめを残す。来なければ出来事をつなぐ', () => {
  const book = fresh();
  book.story.events.push({ text: '押した', quote: 'x', tick: 0 }, { text: '乗った', quote: 'y', tick: 0 });
  applySummary(book, null);
  assert.deepEqual(book.story, { seed: '', chapters: [{ summary: '押した。乗った' }], events: [] });
  book.story.events.push({ text: '走った', quote: 'z', tick: 1 });
  applySummary(book, { summary: '走って帰った' });
  assert.equal(book.story.chapters[1].summary, '走って帰った');
});

test('next: 端末が区切り・読み取り・描く・章のまとめの順を決め、最後は done になる(章をまたいで絵巻を新しくする)', () => {
  const ginga = books.find((b) => b.id === 'ginga');
  const pages = paginate(ginga);
  const run = { book: 'ginga', settings: { start: 0, pageSize: EMAKI.pageSize, every: EMAKI.every, chapters: 2 }, brief: null, ticks: [] };
  const ops = [];
  for (let i = 0; i < 200; i += 1) {
    const step = next(run, pages);
    ops.push(step.op);
    if (step.op === 'done') break;
    if (step.op === 'read') {
      const quote = step.request.text.replace(/\s+/g, '').slice(0, 12);
      run.ticks.push({ ...step.tick, reader: { data: { seed: '', events: [{ text: '何か', quote }], scenes: [scene({ place: '場', place_quote: quote, things: [thing(`物${run.ticks.length}`, quote)] })] } }, drawers: [], summary: null });
    } else if (step.op === 'draw') {
      assert.ok(!JSON.stringify(step.request).includes('銀河鉄道の夜'));
      run.ticks.at(-1).drawers.push({ data: { ground: [], things: step.draw.ids.map((id) => ({ id, ...shape() })) } });
    } else run.ticks.at(-1).summary = { data: { summary: `まとめ${run.ticks.length}` } };
  }
  assert.equal(ops.at(-1), 'done');
  assert.equal(ops.filter((o) => o === 'summary').length, 2);
  assert.equal(ops.filter((o) => o === 'read').length, ticksOf(pages, run.settings).length);
  const { book } = replay(run, pages);
  assert.equal(book.emaki.chapter, 1);
  assert.equal(book.story.chapters.length, 2);
  assert.ok(book.emaki.panels.every((p) => p.things.every((t) => t.shapes)));
  const judge = judgeRequest(run, pages);
  assert.equal(judge.ticks.length, run.ticks.length);
  assert.ok(judge.text.startsWith('〔1ページ〕'));
});

test('絵: 下描きの物は線だけを鉛筆の色で、区画ごとの下描きは地も描かない。灯りは章の終わりにだけ輪を付ける', () => {
  const book = fresh();
  const draw = applyReading(book, { seed: '', events: [], scenes: [scene({ things: [thing('<script>', '泥だらけ'), thing('灯', '一番端')] })] }, TEXT, 0).draws[0];
  applyDrawing(book, { ground: [{ d: 'M0 0 H320 V240 H0 Z', color: 'sky', tone: 'pale' }], things: [{ id: draw.ids[0], ...shape() }, { id: draw.ids[1], forms: [], lines: [], light: [{ d: 'M5 5 h4 v4 h-4 z', color: 'orange' }] }] }, draw, 0);
  const panel = book.emaki.panels[0];
  const colored = panelSvg(panel);
  assert.ok(colored.includes('fill="#9cc8e8"') && colored.includes('stroke="#5c4636"') && !colored.includes('url(#glow)'));
  const sketch = panelSvg(panel, { sketch: new Set([draw.ids[0]]) });
  assert.ok(sketch.includes('stroke="#7a6b5f"') && !sketch.includes('fill="#a8764f"'));
  const all = panelSvg(panel, { sketchAll: true });
  assert.ok(!all.includes('#9cc8e8') && !all.includes('#f0a24e'));
  const scroll = scrollSvg([panel, panel]);
  assert.ok(scroll.includes('url(#glow)') && scroll.includes('viewBox="0 0 640 240"'));
  for (const svg of [colored, sketch, all, scroll]) {
    assert.ok(!svg.includes('script') && !svg.includes('泥だらけ'));
    for (const tag of new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]))) assert.match(tag, /^(svg|defs|filter|fe[A-Z][A-Za-z]+|mask|rect|path|g)$/);
  }
});

test('下調べ: known が yes で全体があるときだけ使う', () => {
  assert.equal(checkBrief({ known: 'no', work: '', whole: '', world: '' }), null);
  assert.equal(checkBrief({ known: 'yes', work: 'x', whole: ' ', world: '' }), null);
  assert.equal(checkBrief(null), null);
  assert.deepEqual(checkBrief({ known: 'yes', work: 'w', whole: 'あらすじ', world: '世界' }), { work: 'w', whole: 'あらすじ', world: '世界' });
});

test('schema: どの object も additionalProperties: false で、全部の項目が required', () => {
  const walk = (node, where) => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, where);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), where);
      for (const [k, v] of Object.entries(node.properties)) walk(v, `${where}.${k}`);
    }
    if (node.type === 'array') walk(node.items, `${where}[]`);
  };
  for (const [name, schema] of Object.entries({ briefSchema, readSchema, drawSchema, summarySchema, judgeSchema })) walk(schema(), name);
});

test('費用: キャッシュの書き込みは 1.25 倍、読み出しは 0.1 倍。フォールバックで替わったら替わったモデルの単価', () => {
  const usage = { input_tokens: 1e6, output_tokens: 0, cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6 };
  assert.equal(cost({ model: 'claude-sonnet-5-5', usage }), 2 * (1 + 1.25 + .1));
  assert.equal(cost({ model: 'claude-opus-5-5', served_model: 'claude-sonnet-5-5', usage: { input_tokens: 0, output_tokens: 1e6 } }), 10);
  assert.equal(cost({ model: 'sample' }), null);
});

test('runs/ は全部 index.json に載っていて、見本は端末の決まりで何も落ちずにたどれる', () => {
  const files = readdirSync(new URL('runs/', dir)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  assert.deepEqual(JSON.parse(readFileSync(new URL('runs/index.json', dir), 'utf8')).files, files);
  for (const file of files.filter((f) => f.includes('.sample'))) {
    const run = JSON.parse(readFileSync(new URL(`runs/${file}`, dir), 'utf8'));
    const book = books.find((b) => b.id === run.book);
    const pages = paginate(book, run.settings.pageSize);
    const { logs } = replay(run, pages);
    const m = measure(run, logs, book, pages);
    assert.equal(m.grounded, 1, file);
    assert.equal(m.strangers + m.shapesDropped, 0, file);
    assert.ok(logs.every((l) => l.drawn.every((d) => d && !d.missed.length)), file);
    assert.equal(next(run, pages).op, 'done', file);
  }
});
