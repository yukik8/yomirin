import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTurn, particleAt, frameAt, mixPalette, MOODS, MOTIFS, BODY_MS, PARTICLE_MS, END_MS } from '../../tools/preview/turn/turnfx.js';

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
  const distance = (plan) => {
    const p = plan.particles[0], a = particleAt(plan, p, p.delay), b = particleAt(plan, p, 350);
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  assert.ok(distance(low) < distance(high));
});

test('色と粒を同じにしても7場面の出発点・軌道は異なる。雨は下へ、発見は上へ進む', () => {
  const signatures = new Set();
  for (const mood of Object.keys(MOODS)) {
    const plan = planTurn({ mood, motif: 'none', colors: MOODS.calm.colors });
    const p = plan.particles[10];
    const a = particleAt(plan, p, 150), b = particleAt(plan, p, 480);
    signatures.add([a.x, a.y, b.x, b.y].map(n => Math.round(n)).join(','));
    assert.ok([a.x, a.y, b.x, b.y].every(Number.isFinite));
    if (mood === 'sad') assert.ok(b.y > a.y);
    if (mood === 'wonder') assert.ok(b.y < a.y);
    assert.equal(particleAt(plan, p, PARTICLE_MS).active, false);
  }
  assert.equal(signatures.size, 7);
});

test('全画面案は紙面の中から始まる構図、余白案は周囲から始まる構図', () => {
  const edge = planTurn({ mood: 'warm', mode: 'edge' });
  const full = planTurn({ mood: 'warm', mode: 'full' });
  assert.notEqual(particleAt(edge, edge.particles[0], 180).x, particleAt(full, full.particles[0], 180).x);
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
