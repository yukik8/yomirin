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
