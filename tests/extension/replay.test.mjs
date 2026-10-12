// 制御の力学を黙って変えない(§11-9)。seed を固定した replay の表をスナップショットに残し、
// 制御器の式や config の値を変えたら、ここで差分が出るようにする。
//
// わざと変えたときは、スナップショットを書き直して、PR に理由と表の差分を書く:
//   node --test --test-update-snapshots "tests/extension/*.test.mjs"

import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const replay = fileURLToPath(new URL('../../tools/replay/replay.mjs', import.meta.url));

test('replay --simulate --seed 1(模擬の読者4種 × 制御器2つ)', (t) => {
  const table = execFileSync(process.execPath, [replay, '--simulate', '--seed', '1'], { encoding: 'utf8' });
  // 文字のまま残す(差分を表のまま読めるように)
  t.assert.snapshot(table, { serializers: [(v) => v] });
});
