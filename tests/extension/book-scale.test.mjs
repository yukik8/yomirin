// 本の中の位置の尺度(#33・background/book-scale.js)のテスト。倍率や窓の大きさで総ページ数が変わっても、
// セッションの中の位置と本棚の帯・印・残り時間が崩れないこと。
//
//   node --test "tests/extension/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scalePage, scaleRange, markTotal, remainingMinutes } from '../../extension/src/background/book-scale.js';

test('同じ総ページ数・ページが無いときは、そのまま', () => {
  assert.equal(scalePage(50, 300, 300, 'end'), 50);
  assert.equal(scalePage(0, 300, 900, 'start'), 0);
  assert.equal(scalePage(null, 300, 900), null);
  assert.equal(scalePage(5, 0, 900), 5);
  const range = { from: 1, to: 5, furthest: 5, total: 300 };
  assert.equal(scaleRange(range, 300), range);
});

test('大きくした(300 → 900): 1ページが3ページに。区間の頭は頭、終わりは終わり、印は真ん中', () => {
  assert.equal(scalePage(50, 300, 900, 'start'), 148);
  assert.equal(scalePage(50, 300, 900, 'end'), 150);
  assert.equal(scalePage(50, 300, 900, 'mid'), 149);
  assert.equal(scalePage(1, 300, 900, 'start'), 1);
  assert.equal(scalePage(300, 300, 900, 'end'), 900);
});

test('戻した(900 → 300): 3ページが1ページに', () => {
  for (const p of [148, 149, 150]) {
    for (const edge of ['start', 'mid', 'end']) assert.equal(scalePage(p, 900, 300, edge), 50, `${p} ${edge}`);
  }
  assert.equal(scalePage(147, 900, 300, 'end'), 49);
  assert.equal(scalePage(151, 900, 300, 'start'), 51);
  assert.equal(scalePage(900, 900, 300, 'end'), 300);
});

test('端数のある比でも、範囲の中に収まり、往復しても大きくずれない', () => {
  for (const [a, b] of [
    [317, 512],
    [512, 317],
    [17, 40],
    [40, 17],
  ]) {
    for (let p = 1; p <= a; p += 1) {
      for (const edge of ['start', 'mid', 'end']) {
        const q = scalePage(p, a, b, edge);
        assert.ok(q >= 1 && q <= b, `${p}/${a} → ${q}/${b}`);
        assert.ok(Math.abs(scalePage(q, b, a, edge) - p) <= Math.ceil(a / b), `${p}/${a} 往復`);
      }
    }
  }
});

test('読んだ区間を換算しても、始まり ≤ 終わり のまま', () => {
  for (const total of [10, 33, 300, 901]) {
    const r = scaleRange({ from: 12, to: 20, furthest: 25, total: 100 }, total);
    assert.equal(r.total, total);
    assert.ok(r.from <= r.to && r.to <= r.furthest && r.furthest <= total, JSON.stringify(r));
  }
});

test('残り時間: 総ページ数が同じなら、前と同じ(残りページ × ページあたりの時間)', () => {
  const rs = [
    { range: { from: 1, furthest: 11, total: 200 }, read_ms: 10 * 60_000 },
    { range: { from: 11, furthest: 21, total: 200 }, read_ms: 20 * 60_000 },
    { range: { from: 21, furthest: 20, total: 200 }, read_ms: 5 * 60_000 }, // 戻っただけの回は入れない
  ];
  // 20ページで30分 → 1ページ1.5分。残り 180ページ → 270分
  assert.equal(remainingMinutes(rs, 20, 200, 3), 270);
});

test('残り時間: 総ページ数の違う回が混ざっても、進んだ割合あたりの時間で出す', () => {
  const rs = [
    { range: { from: 1, furthest: 11, total: 200 }, read_ms: 15 * 60_000 }, // 5% を15分
    { range: { from: 31, furthest: 61, total: 600 }, read_ms: 15 * 60_000 }, // 大きく映した回: 5% を15分
  ];
  // 10% で30分 → 本全体で300分。今の尺度(600ページ)の 60ページ目 = 10% 読んだ → 残り 270分
  assert.equal(remainingMinutes(rs, 60, 600, 3), 270);
  assert.equal(remainingMinutes(rs, 20, 200, 3), 270);
});

test('残り時間: 進んだ分が今の尺度で少なすぎる・位置が無いなら出さない', () => {
  const rs = [{ range: { from: 1, furthest: 2, total: 200 }, read_ms: 60_000 }];
  assert.equal(remainingMinutes(rs, 2, 200, 3), null);
  assert.equal(remainingMinutes(rs, null, 200, 3), null);
  assert.equal(remainingMinutes(rs, 2, null, 3), null);
  assert.equal(remainingMinutes([], 2, 200, 3), null);
});

test('印の総ページ数: book_total → 同じセッションの区間 → 付けた時刻を含む区間 → 分からない', () => {
  const rs = [
    { session_id: 'a', started_at: 100, ended_at: 200, range: { total: 300 } },
    { session_id: 'b', started_at: 300, ended_at: 400, range: { total: 900 } },
  ];
  assert.equal(markTotal({ book_total: 450, session_id: 'a', created_at: 150 }, rs), 450);
  assert.equal(markTotal({ session_id: 'b', created_at: 150 }, rs), 900);
  assert.equal(markTotal({ created_at: 150 }, rs), 300, '古いクイズはセッションを持たないので時刻で');
  assert.equal(markTotal({ created_at: 350 }, rs), 900);
  assert.equal(markTotal({ created_at: 250 }, rs), null);
  assert.equal(markTotal({ session_id: 'zzz', created_at: 999 }, rs), null);
});
