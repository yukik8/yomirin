import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  EMAKI, paginate, ticksOf, pageOf, newBook, startChapter, readRequest, applyReading, drawRequest, applyDrawing, applySummary,
  replay, next, timeline, clipOf, stageAt, placement, pointAt, routeOf, tint, groundSvg, thingSvg, panelSvg, scrollSvg, whereIs, checkBrief, CLIP, SPEEDS,
  briefSchema, readSchema, drawSchema, summarySchema, judgeSchema, judgeRequest,
} from '../../tools/preview/emaki/emaki.js';
import { edgeSvg } from '../../tools/preview/scene/scene.js';
import { cost, measure } from '../../tools/preview/emaki/measure.js';

const dir = new URL('../../tools/preview/emaki/', import.meta.url);
const { books } = JSON.parse(readFileSync(new URL('books.json', dir), 'utf8'));
const flat = (s) => s.replace(/\s+/g, '');
const TEXT = '或夕方、トロッコは泥だらけになったまま、薄明るい中に並んでいる。三人の子供は恐る恐る、一番端にあるトロッコを押した。';
const BRIEF = { work: '芥川龍之介「トロッコ」', whole: '…結末まで…', world: '大正の村' };
const scene = (extra = {}) => ({ change: 'new', place: '村外れ', place_quote: '一番端にあるトロッコ', time: 'evening', time_quote: '或夕方', weather: 'unknown', weather_quote: '', mood: 'tense', mood_quote: '恐る恐る', keep: [], things: [], changes: [], beats: [], ...extra });
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
  assert.deepEqual(draws, [{ panel: panel.id, mode: 'new', ids: [panel.things[0].id], tick: 0 }]);
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
  assert.deepEqual(draws, [{ panel: panel.id, mode: 'add', ids: [panel.things[0].id, panel.things[1].id], tick: 1 }]);
  assert.equal(panel.things[0].look, '押されて動く');

  const moved = applyReading(book, { seed: '', events: [], scenes: [scene({ place: '線路の先', place_quote: '薄明るい中に', keep: ['トロッコ'], things: [thing('線路', '一番端にある')] })] }, TEXT, 2);
  const second = book.emaki.panels[1];
  assert.deepEqual(second.things.map((t) => t.name), ['トロッコ', '線路']);
  assert.notEqual(second.things[0].id, panel.things[0].id);
  assert.equal(second.things[0].shapes, null);
  assert.deepEqual(moved.draws, [{ panel: second.id, mode: 'new', ids: second.things.map((t) => t.id), tick: 2 }]);
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
  assert.deepEqual(Object.keys(req).sort(), ['current', 'events', 'mode', 'routes', 'scene', 'spots', 'story', 'things']);
  assert.deepEqual(req.events, []);
  assert.equal(req.current, null);
  assert.ok(JSON.stringify(readRequest(book, TEXT)).includes(BRIEF.whole), '読み取りには渡す');
});

test('描く: 頼んだ id の形だけを受け取る。add では地を描き直さず、読めない形と頼んでいない id を数える', () => {
  const book = fresh();
  const first = applyReading(book, { seed: '', events: [], scenes: [scene({ things: [thing('トロッコ', '泥だらけ', true), thing('線路', '一番端')] })] }, TEXT, 0).draws[0];
  const [a, b] = first.ids;
  const r1 = applyDrawing(book, { ground: [{ d: 'M0 0 H320 V240 H0 Z', color: 'sky', tone: 'pale' }], things: [{ id: a, ...shape() }, { id: 'p99', ...shape() }, { id: b, forms: [{ d: 'url(x)', color: 'red', tone: 'mid' }], lines: [], light: [] }] }, first, 0);
  assert.deepEqual(r1, { dropped: 1, strangers: ['p99'], missed: [b], cues: [] });
  const panel = book.emaki.panels[0];
  assert.equal(panel.ground.length, 1);
  assert.equal(panel.things[0].drawn, 0);
  const add = applyReading(book, { seed: '', events: [], scenes: [scene({ change: 'same', things: [thing('子供', '三人の子供')] })] }, TEXT, 1).draws[0];
  assert.equal(add.mode, 'add');
  assert.ok(drawRequest(book, add).current.things.some((t) => t.id === a));
  const r2 = applyDrawing(book, { ground: [{ d: 'M0 0 h1', color: 'sky', tone: 'pale' }], things: [{ id: add.ids[0], ...shape() }, { id: a, ...shape() }] }, add, 1);
  assert.deepEqual(r2, { dropped: 1, strangers: [a], missed: [], cues: [] });
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

// 区画を1つ作り、所と物を描いた本(トロッコは線路の下に居て、灯りは消えている)
function staged() {
  const book = fresh();
  const { draws } = applyReading(book, { seed: '', events: [{ text: '押した', quote: '一番端にあるトロッコを押した' }], scenes: [scene({ things: [thing('トロッコ', '泥だらけ', true), thing('灯', '薄明るい中に')] })] }, TEXT, 0);
  const [cart, lamp] = draws[0].ids;
  const result = applyDrawing(book, {
    ground: [{ d: 'M0 0 H320 V240 H0 Z', color: 'sky', tone: 'pale' }],
    spots: [{ name: '線路の下', x: 80, y: 200, scale: 1 }, { name: '坂の上', x: 220, y: 140, scale: .5 }, { name: '線路の下', x: 1, y: 1, scale: 1 }, { name: '空', x: 'x', y: 0, scale: 1 }],
    routes: [{ from: '線路の下', to: '坂の上', d: 'M80 200 C120 190 180 160 220 140' }, { from: '線路の下', to: '海', d: 'M0 0 L1 1' }, { from: '線路の下', to: '坂の上', d: 'url(x)' }],
    things: [{ id: cart, at: { x: 80, y: 200 }, spot: '線路の下', start: '', hidden: false, lit: true, loop: 'none', ...shape() }, { id: lamp, at: { x: 10, y: 10 }, spot: '', start: '', hidden: true, lit: false, loop: 'flicker', forms: [], lines: [], light: [{ d: 'M5 5 h4 v4 h-4 z', color: 'orange' }] }],
    beats: [{ event: 0, id: cart, act: 'move', to: '坂の上', speed: 'fast', fx: 'bob' }, { event: 5, id: cart, act: 'move', to: '線路の下' }, { event: 0, id: cart, act: 'move', to: '知らない所' }],
  }, draws[0], 0);
  return { book, draws, result, cart, lamp, panel: book.emaki.panels[0] };
}

test('描く: 所は名前が重ならず座標の読めるものだけ。道は知っている所どうしの読める d だけ。物は足もと・最初の様子・灯り・揺らぎを持ち、出来事の番号の付いた動きだけを演じる', () => {
  const { result, panel, cart, lamp } = staged();
  assert.deepEqual(panel.spots.map((x) => x.name), ['線路の下', '坂の上']);
  assert.deepEqual(panel.routes, [{ from: '線路の下', to: '坂の上', d: 'M80 200 C120 190 180 160 220 140' }]);
  const t = panel.things.find((x) => x.id === cart);
  assert.deepEqual([t.at, t.spot, t.pos0, t.pos], [{ x: 80, y: 200 }, '線路の下', '線路の下', '坂の上']);
  const l = panel.things.find((x) => x.id === lamp);
  assert.deepEqual([l.lit0, l.shown0, l.loop], [false, false, 'flicker']);
  assert.equal(result.dropped, 2 + 2 + 2); // 所 2(名前が重なる・座標が読めない)+ 道 2(知らない所・読めない d)+ 動き 2(出来事の番号が無い・知らない所)
  assert.deepEqual(result.cues, [{ kind: 'beat', panel: panel.id, id: cart, act: 'move', to: '坂の上', from: '線路の下', speed: 'fast', fx: 'bob', quote: '一番端にあるトロッコを押した' }]);
  assert.deepEqual(routeOf(panel, '線路の下', '坂の上'), { d: panel.routes[0].d, reverse: false });
  assert.deepEqual(routeOf(panel, '坂の上', '線路の下'), { d: panel.routes[0].d, reverse: true });
  assert.equal(routeOf(panel, '坂の上', '海'), null);
});

test('読み取りの動き: 同じ場面のときだけ。語句が段落に無い・知らない物や所の動きは捨て、時刻が移れば日が暮れるのを演じる', () => {
  const { book, panel, cart, lamp } = staged();
  const req = readRequest(book, TEXT);
  assert.deepEqual(req.spots, ['線路の下', '坂の上']);
  assert.deepEqual(req.things.find((x) => x.name === 'トロッコ'), { name: 'トロッコ', look: 'トロッコの見た目', spot: '坂の上', shown: true, lit: true });
  const { dropped, cues } = applyReading(book, { seed: '', events: [], scenes: [scene({ change: 'same', time: 'night', time_quote: '薄明るい中に',
    things: [thing('車輪', '車輪をまわした'), thing('音', '書いていない語句')],
    beats: [
      { name: 'トロッコ', act: 'move', to: '線路の下', quote: 'トロッコを押した' },
      { name: '灯', act: 'light', to: '', quote: '薄明るい' },
      { name: 'トロッコ', act: 'move', to: '海', quote: 'トロッコを押した' },
      { name: '無い物', act: 'leave', to: '', quote: 'トロッコを押した' },
      { name: 'トロッコ', act: 'leave', to: '', quote: '書いていない' },
    ] })] }, TEXT + '突然ごろりと車輪をまわした。', 1);
  assert.deepEqual(dropped.map((d) => [d.kind, d.why]), [['thing', 'quote'], ['beat', 'name'], ['beat', 'name'], ['beat', 'quote']]);
  assert.deepEqual(cues.map((c) => [c.kind, c.id ?? '', c.act ?? '', c.to ?? '']), [['time', '', '', 'night'], ['appear', panel.things.at(-1).id, '', ''], ['beat', cart, 'move', '線路の下'], ['beat', lamp, 'light', '']]);
  assert.deepEqual([panel.time, panel.time0], ['night', 'evening']);
  assert.equal(panel.things.find((x) => x.id === lamp).lit, true);
  // new の場面の動きは描く係が決める(読み取りの beats は使わない)
  const other = applyReading(book, { seed: '', events: [], scenes: [scene({ place: '線路の先', place_quote: '線路を登って', beats: [{ name: 'トロッコ', act: 'leave', to: '', quote: 'トロッコを押した' }] })] }, TEXT + 'そろそろ線路を登って行った。', 2);
  assert.deepEqual(other.cues.map((c) => c.kind), ['panel']);
});

test('封: ページの答えは、そのページをめくった瞬間(turn = 最後のページ + 1)にだけ演じる。それより前のめくりの様子には入らない', () => {
  const pages = paginate(books.find((b) => b.id === 'torokko'));
  const run = JSON.parse(readFileSync(new URL('runs/torokko.sample.json', dir), 'utf8'));
  assert.deepEqual(ticksOf(pages, run.settings), pages.map((p) => [p.index, p.index]), '1ページに1回');
  for (let k = 1; k <= run.ticks.length; k += 1) {
    const { book, logs } = replay(run, pages, k);
    const cues = timeline(run, pages, logs);
    const page = run.ticks[k - 1].pages[1];
    for (const c of cues.filter((x) => x.tick === k - 1)) assert.equal(c.turn, page + 1);
    // そのページを開いている間(turn = page)の様子に、そのページの答えは無い
    const before = stageAt(book, cues, page, run.ticks[k - 1].chapter);
    const earlier = stageAt(book, cues.filter((c) => c.tick < k - 1), page, run.ticks[k - 1].chapter);
    assert.deepEqual(before, earlier, `${page + 1}ページを読んでいる間`);
  }
});

test('1ページの場面: 同じ語句の動きは一緒に、ほかは順に。区画が先に流れ、長すぎれば縮める', () => {
  const a = { kind: 'panel', panel: 'p1', quote: '一' };
  const b = { kind: 'beat', panel: 'p1', id: 't1', act: 'move', to: 'x', speed: 'fast', fx: 'bob', quote: '二' };
  const c = { kind: 'beat', panel: 'p1', id: 't2', act: 'appear', speed: 'slow', quote: '二' };
  const d = { kind: 'time', panel: 'p1', to: 'night', quote: '三' };
  assert.deepEqual(clipOf([a, b, c, d]).map((x) => [x.start, x.dur]), [[0, CLIP.panel], [CLIP.panel, SPEEDS.fast], [CLIP.panel, CLIP.change * 2], [CLIP.panel + CLIP.change * 2, CLIP.time]]);
  const many = Array.from({ length: 8 }, (_, i) => ({ ...b, quote: `語${i}`, speed: 'slow' }));
  const clip = clipOf(many);
  const end = Math.max(...clip.map((x) => x.start + x.dur));
  assert.ok(end <= CLIP.max + 2 && clip.every((x) => x.dur >= CLIP.min), `${end}`);
});

test('めくりごとの様子(見本): 区画は現れたときの様子から始まり、動き・灯り・時刻を順に当てる。あとから出た物は現れるまで出さない', () => {
  const pages = paginate(books.find((b) => b.id === 'torokko'));
  const run = JSON.parse(readFileSync(new URL('runs/torokko.sample.json', dir), 'utf8'));
  const { book, logs } = replay(run, pages);
  const cues = timeline(run, pages, logs);
  const at = (turn, name) => { const panel = book.emaki.panels.find((p) => p.place.name === name); return [panel, stageAt(book, cues, turn, 0).panels.find((p) => p.id === panel.id)]; };
  assert.equal(stageAt(book, cues, 0, 0).panels.length, 0, '1ページ目を読んでいる間は何も無い');
  const [yard, y1] = at(1, '村外れの工事場');
  const cart = yard.things.find((t) => t.name === 'トロッコ');
  assert.equal(cart.pos0, '山の上', '山の上から下りて来る');
  assert.deepEqual([y1.things[cart.id].pos, y1.things[yard.things.find((t) => t.name === '土の山').id].shown], ['山の上', true], '下りて土をぶちまけ、また山へ');
  const [evening] = at(2, '夕方の村外れ');
  const mud = evening.things.find((t) => t.name === '泥だらけのトロッコ');
  assert.deepEqual([at(2, '夕方の村外れ')[1].things[mud.id].pos, at(3, '夕方の村外れ')[1].things[mud.id].pos], ['坂の途中', '線路の下']);
  const [village, v10] = at(10, '村の家並み');
  assert.equal(v10.things[village.things.find((t) => t.name === '電燈').id].lit, true, '村に入ると電燈がともる');
  assert.ok(!v10.things[village.things.find((t) => t.name === '門口').id], '門口はまだ現れていない');
  assert.ok(at(11, '村の家並み')[1].things[village.things.find((t) => t.name === '門口').id].shown);
  const [road, r10] = at(10, '夕暮れの線路');
  assert.deepEqual([road.time0, r10.time], ['evening', 'night'], '帰り道で日が暮れる');
  assert.equal(stageAt(book, cues, 12, 1).panels.length, 0, '次の章では前の章の区画を出さない');
});

test('置き方と色: 所へ動かすぶんと大きさの比。時刻が描いた時より進んだぶんだけ色を重ねる', () => {
  const { panel, cart } = staged();
  const t = panel.things.find((x) => x.id === cart);
  assert.deepEqual(placement(panel, t, '坂の上'), { dx: 140, dy: -60, scale: .5 });
  assert.deepEqual(placement(panel, t, '線路の下'), { dx: 0, dy: 0, scale: 1 });
  assert.deepEqual(placement(panel, t, null), { dx: 0, dy: 0, scale: 1 });
  assert.deepEqual(pointAt(panel, t, 150, 170, .75), { dx: 70, dy: -30, scale: .75 });
  assert.equal(tint({ time0: 'evening' }, 'evening'), null);
  assert.equal(tint({ time0: 'day' }, 'morning'), null);
  assert.ok(tint({ time0: 'day' }, 'evening').opacity < tint({ time0: 'day' }, 'night').opacity);
});

test('絵: 地・物・縁の紙の層に分け、物の層は透明。一枚の絵では、物を居る所へ置き、章の終わりは灯りを全部ともす', () => {
  const { panel, cart, lamp } = staged();
  const ground = groundSvg(panel);
  assert.ok(ground.includes('fill="#9cc8e8"') && !ground.includes('mask="url(#fade)"'));
  const lit = thingSvg(panel.things.find((x) => x.id === lamp), { lit: true }), dark = thingSvg(panel.things.find((x) => x.id === lamp), { lit: false });
  assert.ok(lit.includes('url(#glow)') && !dark.includes('url(#glow)') && !lit.includes('#fdfaf3"/>'));
  const edge = edgeSvg();
  assert.ok(edge.includes('mask="url(#rim)"'));
  panel.things.find((x) => x.id === lamp).shown = true; // 灯りは見えているが、まだ消えている
  const art = panelSvg(panel);
  assert.ok(art.includes('translate(220 140) scale(0.5) translate(-80 -200)'), 'トロッコは坂の上に居る');
  assert.ok(!art.includes('url(#glow)'), '消えている灯り');
  const scroll = scrollSvg([panel, panel]);
  assert.ok(scroll.includes('url(#glow)') && scroll.includes('viewBox="0 0 640 240"'));
  for (const svg of [ground, lit, dark, edge, art, scroll]) {
    assert.ok(!svg.includes('script') && !svg.includes('泥だらけ') && !svg.includes('トロッコ'));
    for (const tag of new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]))) assert.match(tag, /^(svg|defs|filter|fe[A-Z][A-Za-z]+|mask|rect|path|g)$/);
  }
  void cart;
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
