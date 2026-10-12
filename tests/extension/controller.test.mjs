// 制御器(controller.js・staircase.js)のテスト。拡張のコードをそのまま読む(写しを作らない)。
//
// 確かめるのは式の形(成功で下がる・2連続の失敗で戻す・1日の上限・卒業・見守り)。期待値は config の
// 定数から作るので、値を調整しても落ちない。値が変わったことは replay のスナップショットで捕まえる。
//
//   node --test "tests/extension/*.test.mjs"

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CONTROLLER, SUCCESS, THETA_MAX } from '../../extension/src/shared/config.js';
import {
  isSuccess,
  isNeutral,
  outcomeOf,
  nextState,
  applyHomeostat,
  stabilityScore,
} from '../../extension/src/background/controller.js';
import { nextStateStaircase } from '../../extension/src/background/staircase.js';
import { makeRng } from '../../tools/replay/lib/rng.mjs';

const MIN = 60_000;
const WEEK = 7 * 86_400_000;
const { alpha, beta, maxDailyChangeRatio: daily, graduateBelow } = CONTROLLER;

const ok = (o = {}) => ({ read_ms: 10 * MIN, escapes: 0, ...o }); // 成功
const ng = (o = {}) => ({ read_ms: 10 * MIN, escapes: SUCCESS.maxEscapes + 1, ...o }); // 失敗
const blank = (o = {}) => ({ read_ms: CONTROLLER.neutralBelowMs - 1, escapes: 0, ...o }); // 中立
const start = (theta) => ({ theta, success_streak: 0, fail_streak: 0, day: null, day_start_theta: null });
const day = (n) => `2026-10-${String(n).padStart(2, '0')}`;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);

describe('成否の判定', () => {
  test('成功は「読んだ時間が足りて、離脱が上限以下」', () => {
    assert.equal(isSuccess({ read_ms: SUCCESS.minReadMs, escapes: SUCCESS.maxEscapes }), true);
    assert.equal(isSuccess({ read_ms: SUCCESS.minReadMs - 1, escapes: 0 }), false);
    assert.equal(isSuccess({ read_ms: SUCCESS.minReadMs, escapes: SUCCESS.maxEscapes + 1 }), false);
  });

  test('ほとんど読まず離れてもいないものは数えない。読み始めてすぐ離れたものは失敗', () => {
    assert.equal(isNeutral(blank()), true);
    assert.equal(outcomeOf(blank()), 'neutral');
    assert.equal(isNeutral(blank({ escapes: 1 })), false);
    assert.equal(outcomeOf(blank({ escapes: 1 })), 'fail');
  });
});

describe('タペリング(nextState)', () => {
  test('成功すると ×(1−alpha)', () => {
    const s = nextState(start(8), ok(), day(1));
    near(s.theta, Math.max(8 * (1 - alpha), 8 * (1 - daily)));
    assert.equal(s.success_streak, 1);
  });

  test('失敗1回では動かず、2回続くと戻す(1日の上限の中で)', () => {
    let s = nextState(start(4), ng(), day(1));
    assert.equal(s.theta, 4);
    assert.equal(s.fail_streak, 1);
    s = nextState(s, ng(), day(2));
    near(s.theta, Math.min(4 * (1 + beta), 4 * (1 + daily), THETA_MAX));
    assert.equal(s.fail_streak, 0, '戻したら数え直す');
  });

  test('1日の変化は、その日の始めの θ の ±maxDailyChangeRatio まで', () => {
    let s = start(8);
    for (let i = 0; i < 10; i += 1) s = nextState(s, ok(), day(1));
    near(s.theta, 8 * (1 - daily));
    // 日が変われば、その日の始めの θ から測り直す
    s = nextState(s, ok(), day(2));
    near(s.day_start_theta, 8 * (1 - daily));
    assert.ok(s.theta < 8 * (1 - daily));
  });

  test('graduateBelow を切ったら 0(卒業)。卒業のあとは nextState では動かない', () => {
    let s = nextState(start(graduateBelow * 1.01), ok(), day(1));
    assert.equal(s.theta, 0);
    s = nextState(s, ng(), day(2));
    s = nextState(s, ng(), day(3));
    assert.equal(s.theta, 0, '戻すのはホメオスタットだけ');
  });

  test('THETA_MAX を超えない', () => {
    let s = nextState(start(THETA_MAX), ng(), day(1));
    s = nextState(s, ng(), day(2));
    assert.ok(s.theta <= THETA_MAX);
  });

  test('中立のセッションは θ も連続の数も変えない', () => {
    const before = { ...start(5), success_streak: 2, day: day(1), day_start_theta: 5 };
    const s = nextState(before, blank(), day(1));
    assert.equal(s.theta, 5);
    assert.equal(s.success_streak, 2);
  });

  test('どんな並びでも、θ は 0〜THETA_MAX・1日の変化は上限の中(乱数の並び 2000 回)', () => {
    const rng = makeRng(7);
    let s = start(8);
    let today = 1;
    for (let i = 0; i < 2000; i += 1) {
      if (rng.bernoulli(0.4)) today += 1;
      const pick = rng.next();
      const session = pick < 0.5 ? ok() : pick < 0.9 ? ng() : blank();
      s = nextState(s, session, `d${today}`);
      assert.ok(s.theta >= 0 && s.theta <= THETA_MAX, `θ=${s.theta}`);
      if (s.theta > 0) {
        assert.ok(s.theta >= s.day_start_theta * (1 - daily) - 1e-9, `下げすぎ: ${s.theta} / ${s.day_start_theta}`);
        assert.ok(s.theta <= s.day_start_theta * (1 + daily) + 1e-9, `上げすぎ: ${s.theta} / ${s.day_start_theta}`);
        assert.ok(s.theta >= graduateBelow, '0.3 未満なら 0 になっているはず');
      }
    }
  });
});

describe('ホメオスタット(applyHomeostat)', () => {
  const now = Date.UTC(2026, 9, 11);
  const window = CONTROLLER.homeostatWindowWeeks * WEEK;
  const graduated = (o = {}) => ({
    ...start(0),
    homeostat: { baseline: 60, active: false, graduated_at: now - window - 1, ...o },
  });
  const drop = 60 * CONTROLLER.homeostatDropRatio;
  const recover = 60 * CONTROLLER.homeostatRecoverRatio;

  test('卒業前(homeostat が無い)は何もしない', () => {
    const s = start(3);
    assert.equal(applyHomeostat(s, 0, now), s);
  });

  test('卒業から窓の週数のあいだは、読む時間が落ちても見守るだけ', () => {
    const s = graduated({ graduated_at: now - window + 1 });
    assert.equal(applyHomeostat(s, 0, now).theta, 0);
  });

  test('窓が明けて基準の dropRatio を割ったら、θ を再展開する(1日の基準も同じ θ に)', () => {
    const s = applyHomeostat(graduated(), drop - 1, now);
    assert.equal(s.theta, CONTROLLER.homeostatRedeployTheta);
    assert.equal(s.day_start_theta, CONTROLLER.homeostatRedeployTheta);
    assert.equal(s.homeostat.active, true);
    assert.equal(applyHomeostat(graduated(), drop, now).theta, 0, '割っていなければ動かない');
  });

  test('再展開中に基準の recoverRatio まで戻ったら、また卒業', () => {
    const active = { ...graduated({ active: true }), theta: 1.2 };
    assert.equal(applyHomeostat(active, recover - 1, now).theta, 1.2);
    const s = applyHomeostat(active, recover, now);
    assert.equal(s.theta, 0);
    assert.equal(s.homeostat.active, false);
    assert.equal(s.homeostat.graduated_at, now);
  });

  test('基準が 0 のときは、窓が明けた時点の週平均を基準にする', () => {
    const zero = graduated({ baseline: 0 });
    assert.equal(applyHomeostat(zero, 40, now).homeostat.baseline, 40);
    const early = graduated({ baseline: 0, graduated_at: now });
    assert.equal(applyHomeostat(early, 40, now).homeostat.baseline, 0);
  });
});

describe('不変条件 §11-3: 制御器の入力は行動シグナルだけ', () => {
  // design.md §11-3 の「行動シグナル」(read_ms・escapes・away・return・読む速さ・終了理由)と、
  // それだけから作る S(stability)、そのセッションの実効 θ(制御器自身が出したもの)
  const ALLOWED = new Set(['read_ms', 'escapes', 'away_total_ms', 'quick_returns', 'pace_cv', 'stability', 'theta']);

  // 実際のセッションにある項目を全部並べる(session.js)。演出の数・本の進み・ページ数なども入っている
  const full = () => ({
    session_id: 's1',
    page_id: 'p1',
    page_url: 'https://play.google.com/books/reader?id=x',
    started_at: 0,
    ended_at: 20 * MIN,
    read_ms: 12 * MIN,
    escapes: 1,
    away_total_ms: 30_000,
    quick_returns: 1,
    longest_streak_ms: 8 * MIN,
    cur_streak_ms: 0,
    hints_shown: 6,
    effects_shown: 9,
    completion_pct: 40,
    page_turns: 30,
    pages_read: 28,
    pace_wpm: 400,
    pace_cv: 0.3,
    slow_pages: 2,
    fast_pages: 1,
    stability: 0.8,
    theta: 4.2,
    theta_base: 4,
    // セッションに無いものも、足されたら読まれないことを確かめる
    quiz_correct: 3,
    questions: 2,
    goal_met: true,
    streak_days: 12,
  });

  const watched = () => {
    const seen = new Set();
    const proxy = new Proxy(full(), {
      get(target, key, receiver) {
        if (typeof key === 'string') seen.add(key);
        return Reflect.get(target, key, receiver);
      },
    });
    return { proxy, seen };
  };
  const forbidden = (seen) => [...seen].filter((k) => !ALLOWED.has(k));

  for (const judge of ['binary', 'stability']) {
    test(`SUCCESS.judge = '${judge}' でも、ほかの項目を読まない`, (t) => {
      const before = SUCCESS.judge;
      SUCCESS.judge = judge;
      t.after(() => {
        SUCCESS.judge = before;
      });
      for (const [name, step] of [
        ['nextState', (s) => nextState(start(4), s, day(1))],
        ['nextStateStaircase', (s) => nextStateStaircase(start(4), s, day(1), () => 1)],
      ]) {
        const { proxy, seen } = watched();
        step(proxy);
        assert.deepEqual(forbidden(seen), [], `${name} が読んだ`);
      }
    });
  }

  test('S(stabilityScore)も行動シグナルだけから作る', () => {
    const { proxy, seen } = watched();
    stabilityScore(proxy, 'manual');
    assert.deepEqual(forbidden(seen), []);
  });
});
