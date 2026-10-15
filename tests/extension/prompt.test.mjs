// 本を開いたときの「計測しますか?」(#32・background/prompt.js・content/prompt.js)のテスト。
//
// 確かめるのは: たずねるのは Play ブックスのリーダーを読み込み終えたときだけ・印はタブと本ごと・
// 開始を受けるのはリーダーの最上位のフレームの自分の content script だけ・既定はたずねる・
// カードは閉じた Shadow DOM で本人のクリックだけを受け、開始のほかは何も送らない。
//
//   node --test "tests/extension/*.test.mjs"

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fakeChrome, install } from './lib/fake-chrome.mjs';

const READER = 'https://play.google.com/books/reader?id=BOOK_A&pg=GBS.PA12';

// session.js が読み込み時に chrome.storage.local を掴むので、先に置いてから読む
let readerBookId, offeredBook, markAsked, forgetAsked, isPromptSender, readStartPrompt, writeStartPrompt;
before(async () => {
  globalThis.chrome = fakeChrome();
  ({ readerBookId, offeredBook, markAsked, forgetAsked, isPromptSender } = await import(
    '../../extension/src/background/prompt.js'
  ));
  ({ readStartPrompt, writeStartPrompt } = await import('../../extension/src/shared/config.js'));
  delete globalThis.chrome;
});

test('本の id は Play ブックスのリーダーの URL からだけ取る', () => {
  assert.equal(readerBookId(READER), 'BOOK_A');
  assert.equal(readerBookId('https://play.google.com/books/reader?id=BOOK_A'), 'BOOK_A');
  assert.equal(readerBookId('https://play.google.com/books/reader'), null, 'id が無い');
  assert.equal(readerBookId('https://play.google.com/books'), null, '本棚');
  assert.equal(readerBookId('https://play.google.com/store/books/details?id=BOOK_A'), null, 'ストアの本のページ');
  assert.equal(readerBookId('https://example.com/books/reader?id=BOOK_A'), null);
  assert.equal(readerBookId(undefined), null);
});

test('たずねるのは、リーダーを読み込み終えたときと、読み込み済みの文書の中で URL が変わったときだけ', () => {
  const done = { status: 'complete', url: READER };
  // 読み込みの始まり(前の文書がまだ残っている)には入れない
  assert.equal(offeredBook({ status: 'loading', url: READER }, { status: 'loading', url: READER }), null);
  // 読み込み終わり
  assert.equal(offeredBook({ status: 'complete' }, done), 'BOOK_A');
  // 本棚から本を開いた・めくった(文書はそのまま URL だけが変わる)
  assert.equal(offeredBook({ url: READER }, done), 'BOOK_A');
  // 題だけが変わった・リーダーの外
  assert.equal(offeredBook({ title: '書名' }, done), null);
  assert.equal(offeredBook({ url: 'https://play.google.com/books' }, { status: 'complete', url: 'https://play.google.com/books' }), null);
});

test('印はタブと本ごと。リーダーの外の URL では付けない。外すとまたたずねる', async (t) => {
  const chrome = fakeChrome();
  install(t, chrome);
  const asked = () => chrome.sessionData.get('start_prompt_asked');

  await markAsked(5, 'https://play.google.com/books/reader?id=BOOK_A'); // セッションの page_url の形
  await markAsked(9, READER.replace('BOOK_A', 'BOOK_B'));
  assert.deepEqual(asked(), { 5: 'BOOK_A', 9: 'BOOK_B' });

  await markAsked(5, 'https://play.google.com/books');
  assert.deepEqual(asked(), { 5: 'BOOK_A', 9: 'BOOK_B' }, 'リーダーの外では変えない');

  await forgetAsked(5);
  assert.deepEqual(asked(), { 9: 'BOOK_B' });
  await forgetAsked(42); // 印の無いタブ
  assert.deepEqual(asked(), { 9: 'BOOK_B' });
  assert.equal(chrome.data.size, 0, 'storage.local には何も書かない');
});

test('「はい」を受けるのは、リーダーの最上位のフレームの、自分の content script からだけ', () => {
  const ok = { id: 'EXT', frameId: 0, tab: { id: 3 }, url: READER };
  assert.equal(isPromptSender(ok, 'EXT'), true);
  assert.equal(isPromptSender({ ...ok, id: 'OTHER' }, 'EXT'), false, 'ほかの拡張');
  assert.equal(isPromptSender({ ...ok, frameId: 2, url: 'https://books.googleusercontent.com/books/content?id=BOOK_A' }, 'EXT'), false, '本文のフレーム');
  assert.equal(isPromptSender({ ...ok, url: 'chrome-extension://EXT/src/popup/popup.html', tab: undefined }, 'EXT'), false, '拡張のページは START_SESSION を使う');
  assert.equal(isPromptSender({ ...ok, url: 'https://play.google.com/books' }, 'EXT'), false, '本棚');
  assert.equal(isPromptSender({ ...ok, tab: undefined }, 'EXT'), false);
  assert.equal(isPromptSender(undefined, 'EXT'), false);
});

test('既定はたずねる。ダッシュボードで切ると、たずねない', async (t) => {
  const chrome = fakeChrome();
  install(t, chrome);
  assert.equal(await readStartPrompt(), true, 'キーが無い = たずねる');
  await writeStartPrompt(false);
  assert.equal(chrome.data.get('start_prompt'), false);
  assert.equal(await readStartPrompt(), false);
  await writeStartPrompt(true);
  assert.equal(await readStartPrompt(), true);
});

test('カードは閉じた Shadow DOM で、本人のクリックだけを受け、開始のほかは何も送らない・読まない', () => {
  const src = readFileSync(new URL('../../extension/src/content/prompt.js', import.meta.url), 'utf8');
  assert.match(src, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.equal(src.match(/e\.isTrusted/g)?.length, 2, '「はい」と「いいえ」の両方で');
  const sent = [...src.matchAll(/sendMessage\(\{ type: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(sent, ['start_prompted']);
  assert.doesNotMatch(src, /chrome\.storage|\bfetch\s*\(|textContent\s*=\s*document|innerText/, '計測しない・ページの文字を読まない');
});
