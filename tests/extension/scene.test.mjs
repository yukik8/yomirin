import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { checkScene, grounded, buildSvg, sceneSchema, COLORS, TONES, WIDTHS, LIMITS, LAST } from '../../tools/preview/scene/scene.js';
import { cost, median, PRICES } from '../../tools/preview/scene/measure.js';

const dir = new URL('../../tools/preview/scene/', import.meta.url);
const base = () => ({
  items: [{ thing: '檸檬', quote: '檸檬を据えつけた' }],
  ground: [{ d: 'M0 0 H320 V240 H0 Z', color: 'sand', tone: 'pale' }],
  forms: [{ d: 'M10 10 h20 v20 h-20 z', color: 'lemon', tone: 'deep' }],
  lines: [{ d: 'M10 10 h20', color: 'umber', width: 'thin' }],
  light: [{ d: 'M15 15 h4 v4 h-4 z', color: 'white' }],
});

test('path の文字以外・知らない色・tone と width の違いは、形ごと落として数える', () => {
  const data = base();
  data.forms.push(
    { d: 'M0 0 L10 10"/><script>alert(1)</script><path d="M0 0', color: 'red', tone: 'mid' },
    { d: 'url(https://example.com/x.svg)', color: 'red', tone: 'mid' },
    { d: 'M0 0 L10 10', color: 'gold', tone: 'mid' },
    { d: 'M0 0 L10 10', color: '__proto__', tone: 'mid' },
    { d: 'M0 0 L10 10', color: 'red', tone: 'loud' },
    { d: 'M0 0 L5000 10', color: 'red', tone: 'mid' },
    { d: 'L0 0 L10 10', color: 'red', tone: 'mid' },
  );
  data.lines.push({ d: 'M0 0 L10 10', color: 'red', width: 'huge' }, { d: 'M0 0 L10 10', color: 'red' });
  const { scene, dropped, error } = checkScene(data);
  assert.equal(error, null);
  assert.equal(dropped, 9);
  assert.equal(scene.forms.length, 1);
  assert.equal(scene.lines.length, 1);
});

test('層が無い・object でない・描くものが無いときは scene を返さない', () => {
  for (const data of [null, 'svg', [], { ...base(), lines: undefined }, { ...base(), light: {} }]) assert.equal(checkScene(data).scene, null);
  assert.equal(checkScene({ ...base(), forms: [], lines: [] }).error, 'empty');
  assert.equal(checkScene({ ...base(), items: undefined }).error, null); // items が無くても絵は出せる(根拠が 0/0 になる)
});

test('層ごとの数・1つの d の長さ・全体の長さの上限を超えた分は落とす', () => {
  const many = { ...base(), forms: Array.from({ length: LIMITS.forms + 5 }, () => ({ d: 'M0 0 h4 v4 z', color: 'red', tone: 'mid' })) };
  assert.equal(checkScene(many).scene.forms.length, LIMITS.forms);
  assert.equal(checkScene(many).dropped, 5);
  const long = { ...base(), lines: [{ d: 'M0 0' + ' l1 1'.repeat(LIMITS.d), color: 'red', width: 'thin' }, ...base().lines] };
  assert.equal(checkScene(long).dropped, 1);
  const d = 'M0 0' + ' l1 1'.repeat(290); // 1454字
  const heavy = { ...base(), lines: Array.from({ length: LIMITS.lines }, () => ({ d, color: 'red', width: 'thin' })) };
  const checked = checkScene(heavy);
  const total = Object.values(checked.scene).flat().reduce((n, s) => n + (s.d?.length ?? 0), 0);
  assert.ok(checked.dropped > 0 && total <= LIMITS.total);
});

test('SVG には決まった要素だけが入り、items の文字列は入らない', () => {
  const data = base();
  data.items = [{ thing: '<script>alert(1)</script>', quote: '" onload="alert(1)' }];
  const { scene } = checkScene(data);
  for (const styled of [true, false]) for (let stage = 0; stage <= LAST; stage += 1) {
    const svg = buildSvg(scene, stage, { styled });
    assert.ok(!svg.includes('script') && !svg.includes('onload') && !svg.includes('href'), `${styled}/${stage}`);
    const tags = new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]));
    for (const tag of tags) assert.match(tag, /^(svg|defs|filter|fe[A-Z][A-Za-z]+|mask|rect|path|g)$/);
  }
});

test('段: 下描きは鉛筆の線だけ、色はだんだん濃くなり、光は仕上がりだけ', () => {
  const { scene } = checkScene(base());
  const washes = (svg) => [...svg.matchAll(/fill="(#[0-9a-f]{6})" fill-opacity="([\d.]+)"/g)].map((m) => +m[2]);
  assert.ok(!buildSvg(scene, 0).includes('<path'));
  const sketch = buildSvg(scene, 1);
  assert.deepEqual(washes(sketch), []);
  assert.ok(sketch.includes('stroke="#7a6b5f"') && !sketch.includes(`stroke="${COLORS.umber[0]}"`));
  assert.ok(Math.max(...washes(buildSvg(scene, 2))) < Math.max(...washes(buildSvg(scene, 3))));
  assert.ok(buildSvg(scene, 3).includes(`stroke="${COLORS.umber[0]}"`));
  assert.ok(!buildSvg(scene, LAST - 1).includes('url(#glow)'));
  assert.ok(buildSvg(scene, LAST).includes('url(#glow)'));
  assert.ok(!buildSvg(scene, LAST, { styled: false }).includes('filter'));
  // multiply は物だけ(地まで multiply にすると、暗い地の上の明るい地が消える)
  assert.equal((buildSvg(scene, LAST).match(/mix-blend-mode:multiply/g) ?? []).length, scene.forms.length);
});

test('根拠の語句は、空白と改行を無視して本文にそのまま有るかを数える', () => {
  const scene = { items: [{ thing: 'a', quote: '城壁の 頂きに' }, { thing: 'b', quote: '本文に無い' }, { thing: 'c', quote: 'x' }] };
  assert.deepEqual(grounded(scene, 'その城壁の\n頂きに恐る恐る'), { total: 3, found: 1, missing: ['b', 'c'] });
});

test('schema の enum は色・濃さ・太さの表と同じで、どの object も additionalProperties: false', () => {
  const schema = sceneSchema();
  const walk = (node) => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(walk);
    }
    if (node.type === 'array') walk(node.items);
  };
  walk(schema);
  assert.deepEqual(schema.properties.forms.items.properties.color.enum, Object.keys(COLORS));
  assert.deepEqual(schema.properties.ground.items.properties.tone.enum, Object.keys(TONES));
  assert.deepEqual(schema.properties.lines.items.properties.width.enum, Object.keys(WIDTHS));
});

test('samples/ は全部 index.json に載っていて、見本は検査を通り、根拠が本文に有る', () => {
  const files = readdirSync(new URL('samples/', dir)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  assert.deepEqual(JSON.parse(readFileSync(new URL('samples/index.json', dir), 'utf8')).files, files);
  const passages = Object.fromEntries(JSON.parse(readFileSync(new URL('passages.json', dir), 'utf8')).passages.map((p) => [p.id, p.text]));
  for (const file of files.filter((f) => f.includes('.sample.'))) {
    const record = JSON.parse(readFileSync(new URL(`samples/${file}`, dir), 'utf8'));
    const { scene, dropped, error } = checkScene(record.data);
    assert.equal(error, null, file);
    assert.equal(dropped, 0, file);
    const g = grounded(scene, passages[record.scene]);
    assert.equal(g.found, g.total, `${file}: ${g.missing}`);
  }
});

test('費用は入力と出力のトークンに単価を掛ける。中央値は数だけで取る', () => {
  assert.equal(cost('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), PRICES['claude-opus-5-5'][0] + PRICES['claude-opus-5-5'][1]);
  assert.equal(cost('unknown', { input_tokens: 1 }), null);
  assert.equal(cost('claude-opus-5-5', null), null);
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});
