import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTurn, frameAt, mixPalette, MOODS, MOTIFS, BODY_MS, PARTICLE_MS, END_MS } from '../../tools/preview/turn/turnfx.js';

test('どの雰囲気・粒でも本文上は360ms未満、粒は720ms未満、1800msで何も残らない', () => {
  for (const mood of Object.keys(MOODS)) for (const motif of Object.keys(MOTIFS)) {
    const plan = planTurn({ mode: 'full', mood, motif });
    assert.equal(frameAt(plan, BODY_MS - 1).body, true);
    for (const time of [BODY_MS, 500, 799, 800, 1200]) {
      assert.equal(frameAt(plan, time).body, false, `${mood}/${motif}/${time}`);
      assert.equal(frameAt(plan, time).bodyAlpha, 0);
    }
    assert.equal(frameAt(plan, PARTICLE_MS - 1).particles, true);
    assert.equal(frameAt(plan, PARTICLE_MS).particles, false);
    assert.equal(frameAt(plan, END_MS).active, false);
  }
});

test('表示後の検知とreduced-motionでは、全画面を指定しても本文には描かない', () => {
  for (const options of [{ timing: 'late' }, { reduced: true }, { mode: 'edge' }]) {
    const plan = planTurn({ mode: 'full', ...options });
    assert.equal(plan.mode, 'edge');
    for (let ms = 0; ms < END_MS; ms += 10) assert.equal(frameAt(plan, ms).body, false);
    if (options.reduced) assert.deepEqual(plan.particles, []);
  }
});

test('θ=0は残光も粒もなし。低いθでは粒も小さく少なくなる', () => {
  const off = planTurn({ theta: 0, mode: 'full' });
  assert.equal(off.particles.length, 0);
  assert.equal(frameAt(off, 100).active, false);
  const low = planTurn({ theta: 2 });
  const high = planTurn({ theta: 8 });
  assert.ok(low.particles.length < high.particles.length);
  assert.ok(low.particles[0].size < high.particles[0].size);
  assert.ok(Math.abs(low.particles[0].dx) < Math.abs(high.particles[0].dx));
});

test('同じ条件の比較は同じ配置。未知の語は静かな基本形に戻す', () => {
  assert.deepEqual(planTurn({ seed: 42 }), planTurn({ seed: 42 }));
  assert.deepEqual(planTurn({ mode: 'full' }).particles, planTurn({ mode: 'edge' }).particles);
  const plan = planTurn({ mood: 'unknown', motif: 'unknown', size: 'unknown' });
  assert.equal(plan.mood, 'calm'); assert.equal(plan.motif, 'none'); assert.equal(plan.size, 'large');
  assert.ok(Number.isFinite(plan.particles[0].size));
});

test('色は新しい場面に徐々に近づき、2回一致を待たずに反映する', () => {
  const a = MOODS.calm.colors, b = MOODS.tense.colors;
  const first = mixPalette(a, b);
  assert.notDeepEqual(first, a); assert.notDeepEqual(first, b);
  let result = first;
  for (let i = 0; i < 12; i += 1) result = mixPalette(result, b);
  for (let i = 0; i < b.length; i += 1) for (const start of [1, 3, 5]) {
    assert.ok(Math.abs(parseInt(result[i].slice(start, start + 2), 16) - parseInt(b[i].slice(start, start + 2), 16)) <= 1);
  }
});
