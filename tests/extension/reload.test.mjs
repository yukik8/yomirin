// 計測中にページを再読み込みしたとき(#38・background/session.js)のテスト。拡張のコードをそのまま読む。
//
// 確かめるのは: 同じ本の読み込みが始まったら印を付け、読み込み終わりで同じセッションのまま入れ直す・
// 本文のフレームに入るまで少し待っては入れ直す・セッションが変わった/終わったらやめる・
// 計測中のタブ以外・印の無い読み込み終わりでは何もしない・loader の結果がどのフレームに入ったかを返す。
//
//   node --test "tests/extension/*.test.mjs"

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fakeChrome } from './lib/fake-chrome.mjs';

const TAB = 7;
const BOOK = 'https://play.google.com/books/reader?id=BOOK_A';
const TOP = 'play.google.com';
const BODY = 'books.googleusercontent.com';

// session.js は読み込み時に chrome.storage.local を掴むので、このファイルの間は同じ chrome を置いておく
const chrome = fakeChrome();
let frames = []; // executeScript が呼ばれるたびに先頭から1つ使う(入ったフレームの hostname の並び。Error なら投げる)
const injected = [];
chrome.tabs = { get: async (id) => ({ id, url: `${BOOK}&pg=GBS.PA12`, status: 'complete' }) };
chrome.scripting = {
  executeScript: async (opts) => {
    injected.push(opts);
    const hosts = frames.shift() ?? [TOP];
    if (hosts instanceof Error) throw hosts;
    return hosts.map((result, frameId) => ({ frameId, result }));
  },
};

let injectUntilBook, onTabUpdated;
before(async () => {
  globalThis.chrome = chrome;
  ({ injectUntilBook, onTabUpdated } = await import('../../extension/src/background/session.js'));
});
after(() => {
  delete globalThis.chrome;
});

const current = () => chrome.data.get('currentSession');
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  chrome.data.set('currentSession', {
    session_id: 'S',
    tab_id: TAB,
    state: 'active',
    site: 'play_books',
    page_url: BOOK,
    zoom: null,
    last_event_at: 1,
  });
  frames = [];
  injected.length = 0;
});

test('本文のフレームに入るまで、少し待っては全フレームに loader を入れ直す', async () => {
  frames = [[TOP], [TOP, BODY]];
  assert.equal(await injectUntilBook(TAB, 'S', [0, 0, 0]), true);
  assert.equal(injected.length, 2);
  for (const opts of injected) {
    assert.deepEqual(opts, { target: { tabId: TAB, allFrames: true }, files: ['src/content/loader.js'] });
  }
});

test('入らないまま待ちが尽きたら、やめる', async () => {
  assert.equal(await injectUntilBook(TAB, 'S', [0, 0, 0]), false);
  assert.equal(injected.length, 3);
});

test('セッションが変わった・終わった・注入できない(タブが閉じた)なら、やめる', async () => {
  chrome.data.set('currentSession', { ...current(), session_id: 'OTHER' });
  assert.equal(await injectUntilBook(TAB, 'S', [0, 0]), false);
  chrome.data.set('currentSession', { ...current(), session_id: 'S', state: 'ended' });
  assert.equal(await injectUntilBook(TAB, 'S', [0, 0]), false);
  chrome.data.delete('currentSession');
  assert.equal(await injectUntilBook(TAB, 'S', [0, 0]), false);
  assert.equal(injected.length, 0);

  chrome.data.set('currentSession', { session_id: 'S', state: 'active' });
  frames = [new Error('No tab with id: 7')];
  assert.equal(await injectUntilBook(TAB, 'S', [0, 0]), false);
  assert.equal(injected.length, 1);
});

test('同じ本の再読み込み: 読み込みの始まりで印を付け、読み込み終わりで同じセッションのまま入れ直す', async () => {
  await onTabUpdated(TAB, { status: 'loading' });
  assert.equal(current().reloading, true, '終わりにはしない');
  assert.equal(current().session_id, 'S');
  assert.equal(injected.length, 0, '読み込み中の文書には入れない');

  frames = [[TOP, BODY]];
  await onTabUpdated(TAB, { status: 'complete' });
  assert.equal(current().reloading, false);
  assert.ok(current().resumed_at > 1, 'main.js が「続けています」と出す');
  assert.equal(current().last_event_at, current().resumed_at, '読み込み直したのは本人の操作');
  await tick(); // 入れ直しは列の外で
  assert.equal(injected.length, 1);
  assert.equal(current().session_id, 'S');
});

test('印の無い読み込み終わり・計測中のタブ以外・終わったセッションでは何もしない', async () => {
  await onTabUpdated(TAB, { status: 'complete' });
  await onTabUpdated(99, { status: 'loading' });
  await onTabUpdated(99, { status: 'complete' });
  chrome.data.set('currentSession', { ...current(), state: 'ended', reloading: true });
  await onTabUpdated(TAB, { status: 'complete' });
  await tick();
  assert.equal(injected.length, 0);
  assert.equal(current().resumed_at, undefined);
});

test('loader の最後の式は location.hostname(executeScript の結果で、どのフレームに入ったかが分かる)', () => {
  const src = readFileSync(new URL('../../extension/src/content/loader.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//'));
  assert.equal(code.at(-1), 'location.hostname;');
});
