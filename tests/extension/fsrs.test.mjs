// 記憶の層の間隔(shared/fsrs.js・FSRS-5)のテスト。式の性質と範囲を確かめる。
//
//   node --test "tests/extension/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FSRS_W, Grade, retrievability, intervalDays, initCard, reviewCard } from '../../extension/src/shared/fsrs.js';
import { makeRng } from '../../tools/replay/lib/rng.mjs';

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 12);

test('S は「90% 残る日数」: R(0) = 1、R(S) = 0.9、経つほど下がる', () => {
  assert.equal(retrievability(0, 10), 1);
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-12);
  assert.ok(retrievability(20, 10) < retrievability(10, 10));
  assert.equal(retrievability(5, 0), 0);
});

test('保持率 0.9 なら間隔は S 日(1日以上・上限まで)', () => {
  assert.equal(intervalDays(10), 10);
  assert.equal(intervalDays(0.2), 1);
  assert.equal(intervalDays(10_000), 365);
  assert.ok(intervalDays(10, 0.8) > intervalDays(10, 0.9), '保持率を下げると間隔は伸びる');
});

test('新しいカード: 最初の評価から S・D を置き、S 日後に出す', () => {
  const card = initCard(Grade.GOOD, now);
  assert.equal(card.S, FSRS_W[2]);
  assert.ok(card.D >= 1 && card.D <= 10);
  assert.equal(card.reps, 1);
  assert.equal(card.lapses, 0);
  assert.equal(card.due, now + intervalDays(card.S) * DAY);
  assert.equal(initCard(Grade.AGAIN, now).lapses, 1);
  assert.ok(initCard(Grade.AGAIN, now).D > card.D, '思い出せなかったものは難しい');
});

test('期日に思い出せたら S は伸び、思い出せなかったら縮む', () => {
  const card = initCard(Grade.GOOD, now);
  const later = card.due;
  const good = reviewCard(card, Grade.GOOD, later);
  const again = reviewCard(card, Grade.AGAIN, later);
  assert.ok(good.card.S > card.S);
  assert.ok(again.card.S <= card.S);
  assert.equal(again.card.lapses, 1);
  assert.equal(good.card.reps, 2);
  assert.ok(Math.abs(good.R - retrievability(intervalDays(card.S), card.S)) < 1e-3);
});

test('どんな並びでも D は 1〜10・S は 0.1 以上・次の期日は先(乱数の並び 500 回)', () => {
  const rng = makeRng(3);
  let card = initCard(Grade.GOOD, now);
  let t = now;
  for (let i = 0; i < 500; i += 1) {
    t += Math.floor(rng.uniform(0, 30) * DAY);
    const G = [Grade.AGAIN, Grade.HARD, Grade.GOOD][Math.floor(rng.next() * 3)];
    ({ card } = reviewCard(card, G, t));
    assert.ok(card.D >= 1 && card.D <= 10, `D=${card.D}`);
    assert.ok(card.S >= 0.1 && Number.isFinite(card.S), `S=${card.S}`);
    assert.ok(card.due > t);
  }
});

test('EASY を続けても D は 1 を下回らない(この製品は EASY を使わないが、式の範囲として)', () => {
  let card = initCard(Grade.GOOD, now);
  for (let i = 1; i <= 20; i += 1) ({ card } = reviewCard(card, Grade.EASY, card.due));
  assert.ok(card.D >= 1, `D=${card.D}`);
});
