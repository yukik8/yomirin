// 使われ方の要約(#28)の送り待ちと送信・消去(background/server.js)のテスト。拡張のコードをそのまま読む。
//
// 確かめるのは: 届かなければ残して送り直す・形を断られたら捨てる・上限で古い順に捨てる・同じ回は1行・
// hello は版ごとに1回・「送ったものを消す」と全消去でサーバの行を消し ID を作り直す・消せなければ持ち続ける。
//
//   node --test "tests/extension/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome, fakeFetch, install } from './lib/fake-chrome.mjs';
import { TELEMETRY } from '../../extension/src/shared/config.js';
import { sessionCounts } from '../../extension/src/background/telemetry.js';
import { EventType } from '../../extension/src/shared/events.js';
import {
  queueTelemetry,
  flushTelemetry,
  forgetTelemetry,
  dropTelemetryOutbox,
  resetTelemetryHello,
} from '../../extension/src/background/server.js';

const row = (n) => ({ kind: 'session', v: 1, session_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` });
const hello = (ext = '0.27') => async () => ({ kind: 'hello', v: 1, ext });
const outbox = (chrome) => chrome.data.get('telemetry_outbox') ?? [];
const ids = (rows) => rows.map((r) => r.session_id ?? r.kind);
const posts = (net) => net.calls.filter((c) => c.init.method === 'POST');
const deletes = (net) => net.calls.filter((c) => c.init.method === 'DELETE');

function setup(t, status = () => 204, initial = {}) {
  const chrome = fakeChrome({ telemetry_consent: true, ...initial });
  const net = fakeFetch(status);
  install(t, chrome, net.fetch);
  return { chrome, net };
}

test('届けば送り待ちから外す。届かない・429・5xx なら残して、次に送り直す', async (t) => {
  let status = new Error('offline');
  const { chrome, net } = setup(t, () => status);
  await queueTelemetry(row(1));
  await flushTelemetry();
  assert.deepEqual(ids(outbox(chrome)), [row(1).session_id]);
  for (const s of [429, 503]) {
    status = s;
    await flushTelemetry();
    assert.equal(outbox(chrome).length, 1, `${s} では残す`);
  }
  status = 204;
  await queueTelemetry(row(2));
  await flushTelemetry();
  assert.deepEqual(outbox(chrome), []);
  assert.deepEqual(ids(posts(net).at(-1).body.rows), [row(1).session_id, row(2).session_id]);
  const id = chrome.data.get('telemetry_id');
  assert.ok(posts(net).every((c) => c.init.headers['x-rs-telemetry'] === id), '送り直しても同じ ID');
});

test('形を断られた(422 など 4xx)行は、送り直しても通らないので捨てる', async (t) => {
  const { chrome } = setup(t, () => 422);
  await queueTelemetry(row(1));
  await flushTelemetry();
  assert.deepEqual(outbox(chrome), []);
});

test('送り待ちは上限まで。超えたら古い順に捨てる。同じ回は1行', async (t) => {
  const { chrome, net } = setup(t, () => new Error('offline'));
  for (let i = 0; i < TELEMETRY.maxOutbox + 5; i += 1) await queueTelemetry(row(i));
  await queueTelemetry({ ...row(TELEMETRY.maxOutbox + 4), read_ms: 1 });
  const kept = outbox(chrome);
  assert.equal(kept.length, TELEMETRY.maxOutbox);
  assert.equal(kept[0].session_id, row(5).session_id);
  assert.equal(kept.at(-1).read_ms, 1);
  await flushTelemetry();
  assert.ok(posts(net)[0].body.rows.length <= TELEMETRY.maxOutbox);
});

test('送っている間に積んだ行は、取りこぼさずに次へ残る', async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { chrome } = setup(t, () => gate.then(() => 204));
  await queueTelemetry(row(1));
  const sending = flushTelemetry();
  await new Promise((r) => setTimeout(r, 0));
  await queueTelemetry(row(2)); // 送っている最中に、次のセッションが閉じた
  release();
  await sending;
  assert.deepEqual(ids(outbox(chrome)), [row(2).session_id]);
});

test('hello は、いまの ID でこの版をまだ積んでいなければ積む(版が変わったとき・オンボーディングをやり直したとき)', async (t) => {
  const { net } = setup(t);
  await flushTelemetry({ hello: hello('0.27') });
  await flushTelemetry({ hello: hello('0.27') });
  assert.deepEqual(posts(net).map((c) => ids(c.body.rows)), [['hello']]);
  await flushTelemetry({ hello: hello('0.28') });
  await resetTelemetryHello();
  await flushTelemetry({ hello: hello('0.28') });
  assert.equal(posts(net).length, 3);
});

test('同意をオフにすると、積んでいたものも送らない', async (t) => {
  const { chrome, net } = setup(t);
  await queueTelemetry(row(1));
  chrome.data.set('telemetry_consent', false); // SET_TELEMETRY {on: false}
  await dropTelemetryOutbox();
  await flushTelemetry();
  assert.deepEqual(outbox(chrome), []);
  assert.equal(posts(net).length, 0);
  chrome.data.set('telemetry_consent', true); // オンに戻しても、オフの間のものは出ていかない
  await flushTelemetry();
  assert.equal(posts(net).length, 0);
});

test('送ったものを消す: いまの ID で DELETE し、ID・送り待ち・hello の印を捨てる。次は新しい ID で送る', async (t) => {
  const { chrome, net } = setup(t);
  await flushTelemetry({ hello: hello() });
  const before = chrome.data.get('telemetry_id');
  await queueTelemetry(row(1));
  assert.equal(await forgetTelemetry(), true);
  assert.equal(deletes(net).length, 1);
  assert.equal(deletes(net)[0].init.headers['x-rs-telemetry'], before);
  assert.equal(deletes(net)[0].body, undefined);
  for (const key of ['telemetry_id', 'telemetry_outbox', 'telemetry_hello', 'telemetry_forget']) {
    assert.equal(chrome.data.has(key), false, key);
  }
  assert.equal(chrome.data.get('telemetry_consent'), true, '送るかどうかは本人の選択のまま');
  await flushTelemetry({ hello: hello() });
  const after = posts(net).at(-1).init.headers['x-rs-telemetry'];
  assert.notEqual(after, before);
});

test('消せなかった ID は持ち続け、同意をオフにしていても、次の機会に消しにいく', async (t) => {
  let status = new Error('offline');
  const { chrome, net } = setup(t, () => status);
  await queueTelemetry(row(1));
  const id = chrome.data.get('telemetry_id');
  assert.equal(await forgetTelemetry(), false);
  assert.deepEqual(chrome.data.get('telemetry_forget'), [id]);
  chrome.data.set('telemetry_consent', false);
  status = 204;
  await flushTelemetry();
  assert.equal(chrome.data.has('telemetry_forget'), false);
  assert.equal(deletes(net).at(-1).init.headers['x-rs-telemetry'], id);
  assert.equal(posts(net).length, 0);
});

test('全消去: storage が空になっても、消してほしい ID は残してサーバへ送る。消している間は送らない', async (t) => {
  const { chrome, net } = setup(t);
  await queueTelemetry(row(1));
  const id = chrome.data.get('telemetry_id');
  await forgetTelemetry(async () => {
    await queueTelemetry(row(2)); // 全消去の前に閉じたセッション
    await flushTelemetry(); // 閉じたあとの送信(消している間は送らない)
    chrome.data.clear(); // wipeAll
  });
  assert.equal(posts(net).length, 0);
  assert.deepEqual(deletes(net).map((c) => c.init.headers['x-rs-telemetry']), [id]);
  assert.deepEqual([...chrome.data.keys()], []);
});

test('クイズと問いは数だけ数える(中身は見ない)', () => {
  const ev = (type, payload = {}) => ({ type, payload });
  assert.deepEqual(
    sessionCounts([
      ev(EventType.QUIZ_ANSWERED, { correct: true }),
      ev(EventType.QUIZ_ANSWERED, { correct: false }),
      ev(EventType.QUESTION_ASKED, { chars: 12 }),
      ev(EventType.DWELL_TICK),
    ]),
    { quiz_answered: 2, quiz_correct: 1, questions_asked: 1 },
  );
});
