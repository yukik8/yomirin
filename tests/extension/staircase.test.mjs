// 閾値推定の制御器(staircase.js)のテスト。事後分布の扱いと、下げる・据え置く・戻すの場面を確かめる。
// 入力が行動シグナルだけであることは controller.test.mjs(§11-3)で見ている。
//
//   node --test "tests/extension/*.test.mjs"

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CONTROLLER, STAIRCASE, SUCCESS, THETA_MAX } from '../../extension/src/shared/config.js';
import {
  thetaGrid,
  initStaircase,
  marginAboveThreshold,
  thresholdEstimate,
  targetTheta,
  nextStateStaircase,
} from '../../extension/src/background/staircase.js';
import { makeRng } from '../../tools/replay/lib/rng.mjs';

const MIN = 60_000;
const daily = CONTROLLER.maxDailyChangeRatio;
const ok = { read_ms: 10 * MIN, escapes: 0 };
const ng = { read_ms: 10 * MIN, escapes: SUCCESS.maxEscapes + 1 };
const blank = { read_ms: CONTROLLER.neutralBelowMs - 1, escapes: 0 };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const step = (state, session, today = '2026-10-12') => nextStateStaircase(state, session, today, () => 1);

/** 閾値が θ=tau のあたりだと分かっている事後分布(log θ で幅 sd の山) */
function knownAt(tau, sd = 0.1) {
  const post = thetaGrid().map((g) => Math.exp(-((g - Math.log(tau)) ** 2) / (2 * sd * sd)));
  const z = sum(post);
  return { post: post.map((w) => w / z) };
}
const state = (theta, stair) => ({ theta, success_streak: 0, fail_streak: 0, day: null, day_start_theta: null, stair });

describe('事後分布', () => {
  test('グリッドは log θ の等間隔で、THETA_MAX より上まで伸びる', () => {
    const g = thetaGrid();
    assert.equal(g.length, STAIRCASE.gridN);
    assert.ok(Math.abs(g[0] - Math.log(STAIRCASE.gridMin)) < 1e-12);
    assert.ok(g.at(-1) > Math.log(THETA_MAX));
    assert.ok(g.every((v, i) => i === 0 || v > g[i - 1]));
  });

  test('初めは一様。目標点は閾値の余白ぶん上', () => {
    const { post } = initStaircase();
    assert.ok(Math.abs(sum(post) - 1) < 1e-12);
    assert.ok(post.every((w) => Math.abs(w - post[0]) < 1e-15));
    assert.ok(marginAboveThreshold() > 0);
    const stair = knownAt(2);
    assert.ok(Math.abs(targetTheta(stair) - 2 * Math.exp(marginAboveThreshold())) < 0.05);
  });

  test('どんな並びのあとも、重みは 0 以上で和が 1・θ は範囲の中・1日の変化は上限の中', () => {
    const rng = makeRng(11);
    let s = state(8);
    let day = 1;
    for (let i = 0; i < 400; i += 1) {
      if (rng.bernoulli(0.5)) day += 1;
      const pick = rng.next();
      s = step(s, pick < 0.5 ? ok : pick < 0.9 ? ng : blank, `d${day}`);
      assert.ok(Math.abs(sum(s.stair.post) - 1) < 1e-9);
      assert.ok(s.stair.post.every((w) => w >= 0));
      assert.ok(s.theta >= 0 && s.theta <= THETA_MAX);
      if (s.theta > 0) {
        assert.ok(s.theta >= s.day_start_theta * (1 - daily) - 1e-9);
        assert.ok(s.theta <= s.day_start_theta * (1 + daily) + 1e-9);
      }
    }
  });
});

describe('下げる・据え置く・戻す', () => {
  test('閾値が分からないうちは、成功で ×(1−alpha)(固定則と同じ)', () => {
    const s = step(state(8), ok);
    assert.equal(s.last_decision, 'down');
    assert.ok(Math.abs(s.theta - 8 * (1 - CONTROLLER.alpha)) < 1e-9);
  });

  test('閾値が分かっていて、下げると余白を割るなら据え置く', () => {
    const stair = knownAt(2);
    assert.ok(thresholdEstimate(stair).sd <= STAIRCASE.knownSd);
    const theta = targetTheta(stair) * 1.02; // ×0.9 すると目標点を下回る
    const s = step(state(theta, stair), ok);
    assert.equal(s.last_decision, 'hold');
    assert.equal(s.theta, theta);
  });

  test('閾値が分かっていても、余白より十分上なら下げる', () => {
    const stair = knownAt(1);
    const theta = targetTheta(stair) * 2;
    assert.equal(step(state(theta, stair), ok).last_decision, 'down');
  });

  test('目標点より下で失敗したら、目標点へ戻す(1日の上限の中で)', () => {
    const stair = knownAt(2);
    const theta = targetTheta(stair) / 2;
    const s = step(state(theta, stair), ng);
    assert.equal(s.last_decision, 'up');
    assert.ok(Math.abs(s.theta - Math.min(targetTheta(s.stair), theta * (1 + daily))) < 1e-9);
  });

  test('閾値から遠い(目標点より十分上での)失敗は、生活のノイズとして動かない', () => {
    const stair = knownAt(0.5);
    const theta = targetTheta(stair) * 3;
    const s = step(state(theta, stair), ng);
    assert.equal(s.last_decision, 'hold');
    assert.equal(s.theta, theta);
  });

  test('中立のセッションでは学ばない', () => {
    const stair = knownAt(2);
    const s = step(state(3, stair), blank);
    assert.equal(s.theta, 3);
    assert.deepEqual(s.stair, stair);
  });

  test('graduateBelow を切ったら 0(卒業)', () => {
    const s = step(state(CONTROLLER.graduateBelow * 1.01), ok);
    assert.equal(s.theta, 0);
    assert.equal(s.last_decision, 'graduate');
  });
});
