// 日付と週の境(shared/time.js)。すべてローカル時刻で切るので、日付は new Date(年, 月, 日) で作る。
// CI は TZ=Asia/Tokyo で回す(.github/workflows/ci.yml)。
//
//   node --test "tests/extension/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dateKey, weekStart, weekKey, weekLabel, recentWeeks } from '../../extension/src/shared/time.js';

const at = (y, m, d, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms).getTime();

test('dateKey はローカルの日付を YYYY-MM-DD で', () => {
  assert.equal(dateKey(at(2026, 1, 5, 23, 59)), '2026-01-05');
  assert.equal(dateKey(at(2026, 10, 12)), '2026-10-12');
});

test('週は月曜0時から。日曜の終わりまでは前の週', () => {
  assert.equal(weekStart(at(2026, 10, 12, 15)), at(2026, 10, 12)); // 月曜
  assert.equal(weekStart(at(2026, 10, 18, 23, 59, 59, 999)), at(2026, 10, 12)); // 日曜の終わり
  assert.equal(weekStart(at(2026, 10, 19)), at(2026, 10, 19)); // 次の月曜0時
  assert.equal(weekKey(at(2026, 10, 15)), '2026-10-12');
  assert.equal(weekLabel(at(2026, 10, 15)), '10/12');
});

test('月と年をまたぐ週', () => {
  assert.equal(weekKey(at(2026, 11, 1)), '2026-10-26'); // 日曜
  assert.equal(weekKey(at(2027, 1, 1)), '2026-12-28'); // 金曜
});

test('recentWeeks は古い順に、続いた月曜を n 週ぶん。最後が今週', () => {
  const weeks = recentWeeks(6, at(2027, 1, 6));
  assert.deepEqual(
    weeks.map((w) => w.key),
    ['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04'],
  );
  assert.equal(weeks.at(-1).start, weekStart(at(2027, 1, 6)));
});

// 夏時間のある地域。夏時間の始まった週は 167 時間しかないので、7×24 時間ずつ戻ると前の日曜に落ちて1週飛ぶ
// (v0.26 まで。ダッシュボードの週ごとの集計から、その週が抜けていた)
const ZONES = ['Asia/Tokyo', 'America/New_York', 'Europe/Berlin', 'Australia/Sydney'];

function inZone(tz, fn) {
  const before = process.env.TZ;
  process.env.TZ = tz; // Node は TZ を書き換えると、その場で時刻の解釈を切り替える
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

test('夏時間の始まり・終わりをまたいでも、recentWeeks は1週も飛ばさない', () => {
  inZone('America/New_York', () => {
    // 2027-03-14(日)に始まり、2026-11-01(日)に終わる
    assert.deepEqual(recentWeeks(4, at(2027, 3, 17)).map((w) => w.key), ['2027-02-22', '2027-03-01', '2027-03-08', '2027-03-15']);
    assert.deepEqual(recentWeeks(4, at(2026, 11, 4)).map((w) => w.key), ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
  });
  inZone('Europe/Berlin', () => {
    assert.deepEqual(recentWeeks(4, at(2027, 3, 31)).map((w) => w.key), ['2027-03-08', '2027-03-15', '2027-03-22', '2027-03-29']);
  });
});

test(`どの地域・どの日でも、recentWeeks は7日おきの月曜0時(${ZONES.join('・')}・2年ぶん)`, () => {
  const keyDay = (key) => Date.UTC(...key.split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0))) / 86_400_000;
  for (const tz of ZONES) {
    inZone(tz, () => {
      for (let d = 0; d < 730; d += 1) {
        const weeks = recentWeeks(8, at(2026, 1, 1 + d, 12));
        for (let i = 0; i < weeks.length; i += 1) {
          const start = new Date(weeks[i].start);
          assert.equal(start.getDay(), 1, `${tz} ${weeks[i].key} が月曜でない`);
          if (i > 0) assert.equal(keyDay(weeks[i].key) - keyDay(weeks[i - 1].key), 7, `${tz} ${weeks[i - 1].key} → ${weeks[i].key}`);
        }
      }
    });
  }
});
