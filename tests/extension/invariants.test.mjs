// 不変条件とストアの申告を、コードと manifest から確かめる(docs/design.md §11・docs/release.md §3)。
// 申告と実際の動きが食い違うとストアの違反になるので、権限・外へ出る経路・外のコードを足すと、ここで落ちる。
// 足すなら、先に release.md の申告・PRIVACY.md・同意の文言を直してから、ここを直す。
//
//   node --test "tests/extension/*.test.mjs"

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fakeChrome, fakeFetch, install } from './lib/fake-chrome.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXT = join(ROOT, 'extension');
const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));

const sources = readdirSync(join(EXT, 'src'), { recursive: true })
  .filter((f) => /\.(js|html|css)$/.test(f))
  .map((f) => ({ path: relative(EXT, join(EXT, 'src', f)), text: readFileSync(join(EXT, 'src', f), 'utf8') }));
const ofType = (ext) => sources.filter((s) => s.path.endsWith(ext));

/** 当たった行を「ファイル:行 中身」で返す(落ちたときに場所が分かるように) */
function hits(files, re) {
  const out = [];
  for (const { path, text } of files) {
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) out.push(`${path}:${i + 1} ${line.trim().slice(0, 100)}`);
    });
  }
  return out;
}

describe('manifest: 権限は release.md の申告どおり', () => {
  // release.md「権限の用途」の表の1列目(`scripting` など)を申告の一覧とみなす
  const declared = (() => {
    const md = readFileSync(join(ROOT, 'docs', 'release.md'), 'utf8');
    const section = md.split('#### 権限の用途')[1]?.split(/\n#### |\n```/)[0] ?? '';
    return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]).sort();
  })();

  test('permissions と host_permissions が、申告の表と同じ', () => {
    assert.ok(declared.length > 0, 'release.md に「権限の用途」の表が見つからない');
    const used = [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])].sort();
    assert.deepEqual(used, declared);
  });

  test('後から足せる権限・自動で入る content script・外からの接続を持たない', () => {
    // 計測は「読む」(か、本を開いたときの「計測しますか?」の「はい」)を押した間だけ(§11-2)。
    // 注入は scripting で、Play ブックスのタブにだけ行う(カードも、押したタブへの計測のスクリプトも)
    for (const key of ['optional_permissions', 'optional_host_permissions', 'content_scripts', 'externally_connectable']) {
      assert.equal(manifest[key], undefined, `manifest に ${key} がある`);
    }
  });

  test('update_url が無い(ストアが付ける。repo にあると開発版がストア版として動く)', () => {
    assert.equal(manifest.update_url, undefined);
  });

  test('web_accessible_resources は Play ブックスのページにだけ見せる', () => {
    const allowed = new Set(['https://play.google.com/*', 'https://books.googleusercontent.com/*']);
    for (const entry of manifest.web_accessible_resources ?? []) {
      for (const m of entry.matches) assert.ok(allowed.has(m), `matches に ${m}`);
    }
  });
});

describe('不変条件 §11-1・§11-2: 1ページの長さ(#33)は、ブラウザの倍率で・常設リスナーを足さずに', () => {
  const ZOOM_JS = join('src', 'background', 'zoom.js');

  test('倍率を変えるのは background/zoom.js だけ', () => {
    assert.deepEqual(hits(ofType('.js').filter((s) => s.path !== ZOOM_JS), /\bsetZoom(?:Settings)?\s*\(/), []);
  });

  test('倍率の変化を見張るリスナー(onZoomChange)を持たない。本人が変えたかは終わるときに比べるだけ', () => {
    assert.deepEqual(hits(ofType('.js'), /\.onZoomChange\b/), []);
  });
});

describe('不変条件 §11-7・§11-8: 端末の外へ出る経路は、よみりんのサーバへの1本だけ(うんちく・クイズと問い・使われ方の要約)', () => {
  const NETWORK = /\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b|\bEventSource\b|\bconnectNative\b|\bsendNativeMessage\b/;
  const SERVER_JS = join('src', 'background', 'server.js');

  test('通信の API を使うのは background/server.js だけ', () => {
    assert.deepEqual(hits(ofType('.js').filter((s) => s.path !== SERVER_JS), NETWORK), []);
  });

  test('server.js の fetch は SERVER.base(うんちく・クイズと問い)と SERVER.telemetryBase(使われ方の要約)にだけ向く', () => {
    const text = sources.find((s) => s.path === SERVER_JS).text;
    const targets = [...text.matchAll(/\bfetch\s*\(\s*([^,)]+)/g)].map((m) => m[1].trim());
    assert.ok(targets.length > 0);
    for (const t of targets) {
      assert.ok(t.startsWith('`${SERVER.base}/') || t.startsWith('`${SERVER.telemetryBase}/'), `fetch の行き先: ${t}`);
    }
  });
});

describe('ストアの申告「remote code: No」: 外のコードを読まない・文字列をコードとして動かさない', () => {
  test('JS に eval・new Function・importScripts・文字列のタイマー・外の URL からの import が無い', () => {
    const re =
      /\beval\s*\(|\bnew\s+Function\s*\(|\bimportScripts\s*\(|\bset(?:Timeout|Interval)\s*\(\s*['"`]|\bimport\s*\(\s*['"`](?:https?:)?\/\/|\bfrom\s+['"](?:https?:)?\/\//;
    assert.deepEqual(hits(ofType('.js'), re), []);
  });

  test('HTML・CSS が外のスクリプト・スタイルを読まない', () => {
    assert.deepEqual(hits(ofType('.html'), /<script\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\/|<link\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\//i), []);
    assert.deepEqual(hits(ofType('.css'), /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\//i), []);
  });
});

describe('うんちくのサーバへ送るもの(§11-7)', () => {
  test('ストア版も開発版も本番の https を呼ぶ(§11-10。開発版の要約の行は build=dev)', async (t) => {
    t.after(() => delete globalThis.chrome);
    delete globalThis.chrome;
    const dev = await import('../../extension/src/shared/config.js?dev');
    assert.equal(dev.IS_STORE_BUILD, false);
    assert.equal(dev.SERVER.base, 'https://reading-scaffold.vercel.app', 'うんちく・クイズ・問いは開発版も本番へ(v0.30)');
    assert.equal(dev.SERVER.telemetryBase, 'https://reading-scaffold.vercel.app', '使われ方の要約は開発版も本番へ(build=dev で分かる)');

    // ストアから入れた拡張の manifest には update_url が付く
    globalThis.chrome = { runtime: { getManifest: () => ({ ...manifest, update_url: 'https://clients2.google.com/service/update2/crx' }) } };
    const store = await import('../../extension/src/shared/config.js?store');
    assert.equal(store.IS_STORE_BUILD, true);
    assert.equal(store.SERVER.base, 'https://reading-scaffold.vercel.app');
    assert.equal(store.SERVER.telemetryBase, 'https://reading-scaffold.vercel.app');
  });

  test('送るのは、上限で切った単語の候補とインストール ID だけ', async (t) => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ ok: true, trivia: { text: '話', term: '活動写真館', sure: true } }) };
    };
    t.after(() => {
      globalThis.fetch = realFetch;
      delete globalThis.chrome;
    });
    const { SERVER } = await import('../../extension/src/shared/config.js');
    const { serverTrivia } = await import('../../extension/src/background/server.js');

    const long = 'あ'.repeat(SERVER.maxTermChars + 1);
    const terms = ['活動写真館', long, ...Array.from({ length: 12 }, (_, i) => `語${i}`)];
    assert.deepEqual(await serverTrivia(terms), { text: '話', term: '活動写真館' });

    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, `${SERVER.base}/trivia`);
    assert.equal(init.method, 'POST');
    assert.deepEqual(Object.keys(init.headers).sort(), ['content-type', 'x-rs-install']);
    assert.match(init.headers['x-rs-install'], /^[0-9a-f-]{36}$/);
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body), ['terms'], '単語の候補のほかに何も送らない');
    assert.ok(body.terms.length <= SERVER.maxTerms);
    assert.ok(body.terms.every((w) => w.length <= SERVER.maxTermChars));
    assert.ok(!body.terms.includes(long));
  });

  test('候補が無ければ呼ばない。サーバが候補に無い語を返したら捨てる', async (t) => {
    let called = 0;
    const realFetch = globalThis.fetch;
    globalThis.chrome = { storage: { local: { get: async () => ({ install_id: 'x' }), set: async () => {} } } };
    globalThis.fetch = async () => {
      called += 1;
      return { ok: true, json: async () => ({ ok: true, trivia: { text: '話', term: '候補に無い', sure: true } }) };
    };
    t.after(() => {
      globalThis.fetch = realFetch;
      delete globalThis.chrome;
    });
    const { serverTrivia } = await import('../../extension/src/background/server.js');
    assert.equal(await serverTrivia([]), null);
    assert.equal(called, 0);
    assert.equal(await serverTrivia(['活動写真館']), null);
  });
});

describe('本文をサーバへ送るのは、本人が「本文を AI のサーバに送る」をオンにしたときだけ(§11-7・#13)', () => {
  const STORE_MANIFEST = { version: '0.30', update_url: 'https://clients2.google.com/service/update2/crx' };
  const PARA = 'ゴーシュは町の活動写真館でセロを弾く係りでした。'.repeat(4);
  const ASK = { question: '係りは?', selection: '活動写真館', context: [{ i: 2, text: PARA }], judge: false };

  async function load() {
    const server = await import('../../extension/src/background/server.js');
    const config = await import('../../extension/src/shared/config.js');
    return { ...server, ...config };
  }

  for (const [label, manifest] of [
    ['ストア版', STORE_MANIFEST],
    ['開発版', undefined],
  ]) {
    test(`${label}: まだ選んでいない(前の版から使っている人)・オフなら送らない`, async (t) => {
      const chrome = fakeChrome({}, manifest);
      const { fetch, calls } = fakeFetch(() => 200);
      install(t, chrome, fetch);
      const { serverQuiz, serverAnswer, readTextChoice, writeTextConsent } = await load();
      assert.equal(await readTextChoice(), null);
      assert.equal(await serverQuiz(PARA), null);
      await writeTextConsent(false);
      assert.equal(await readTextChoice(), false);
      assert.equal(await serverAnswer(ASK), null);
      assert.equal(calls.length, 0);
    });
  }

  test('オンなら(ストア版も)、/quiz へは本文と焦点だけ・/ask へは問い・選んだ文字列・段落・judge だけを、上限で切って送る', async (t) => {
    const chrome = fakeChrome({ text_server_consent: true }, STORE_MANIFEST);
    const { fetch, calls } = fakeFetch(() => 200);
    install(t, chrome, fetch);
    const { serverQuiz, serverAnswer, SERVER } = await load();
    await serverQuiz('あ'.repeat(2500), 'い'.repeat(700));
    await serverAnswer({
      question: 'う'.repeat(400),
      selection: 'え'.repeat(600),
      context: Array.from({ length: 10 }, (_, i) => ({ i, text: 'お'.repeat(900), page: 3 })),
      judge: true,
    });
    assert.deepEqual(
      calls.map((c) => c.url),
      [`${SERVER.base}/quiz`, `${SERVER.base}/ask`],
    );
    for (const { init } of calls) {
      assert.equal(init.method, 'POST');
      assert.deepEqual(Object.keys(init.headers).sort(), ['content-type', 'x-rs-install']);
    }
    const [quiz, ask] = calls.map((c) => c.body);
    assert.deepEqual(Object.keys(quiz).sort(), ['focus', 'text']);
    assert.equal(quiz.text.length, 2000);
    assert.equal(quiz.focus.length, 600);
    assert.deepEqual(Object.keys(ask).sort(), ['context', 'judge', 'question', 'selection']);
    assert.equal(ask.question.length, 300);
    assert.equal(ask.selection.length, 500);
    assert.equal(ask.context.length, 8);
    assert.ok(ask.context.every((c) => Object.keys(c).sort().join() === 'i,text' && c.text.length === 800));
    assert.equal(ask.judge, true);
  });
});

describe('使われ方の要約で送るもの(§11-7・§11-8・#28)', () => {
  const fixture = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'telemetry.json'), 'utf8'));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // 記録層(本・本文・問い)と、端末を見分けられるもの。sessions の行やセッションに混ざっていても出ていかないこと
  const RECORD = {
    page_id: 'ab'.repeat(32),
    domain: 'play.google.com',
    url: 'https://play.google.com/books/reader?id=SECRETBOOK',
    page_url: 'https://play.google.com/books/reader?id=SECRETBOOK',
    title: '銀河鉄道の夜',
    question: '「槌」の読み方は?',
    paragraph_excerpt: 'ジョバンニは、口笛を吹いているようなさびしい口付きで',
    user_agent: 'Mozilla/5.0 (Macintosh) Chrome/141.0.0.0',
  };
  const record = {
    ...RECORD,
    session_id: '6f7c1c52-5b1e-4f0e-9a51-1d2f6c0b9e11',
    date: '2026-10-14',
    started_at: new Date(2026, 9, 14, 21, 5).getTime(),
    theta: 5.1123456,
    theta_base: 5.4,
    read_ms: 1_260_000,
    escapes: 1,
    completion_pct: 37,
    success: true,
    stability: 0.8123,
    reason: 'manual',
    away_total_ms: 42_000,
    quick_returns: 1,
    hints_shown: 6,
    effects_shown: 2,
    longest_streak_ms: 840_000,
    pages_read: 14,
    pace_wpm: 512.34,
    pace_cv: 0.31,
    slow_pages: 1,
    fast_pages: 0,
    backs: 2,
  };
  const extra = {
    ...RECORD,
    ext: '0.27',
    theta_after: 4.86,
    controller_reason: 'success',
    quiz_answered: 1,
    quiz_correct: 1,
    questions_asked: 0,
    position_read: true,
    reached_end: false,
  };

  /** 文字列の値は、決まった語・版の番号・UUID・日付だけ(本文や書名が入る形の項目が無い) */
  async function assertNoFreeText(row) {
    const { CONTROLLER_REASONS, END_REASONS } = await import('../../extension/src/background/telemetry.js');
    const { GOALS } = await import('../../extension/src/shared/config.js');
    const allowed = {
      kind: (v) => ['session', 'hello'].includes(v),
      ext: (v) => /^\d{1,4}(\.\d{1,4}){0,3}$/.test(v),
      session_id: (v) => UUID.test(v),
      date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
      controller_reason: (v) => CONTROLLER_REASONS.includes(v),
      end_reason: (v) => END_REASONS.includes(v),
      build: (v) => ['store', 'dev'].includes(v),
      goal: (v) => Object.hasOwn(GOALS, v),
    };
    for (const [k, v] of Object.entries(row)) {
      if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) continue;
      assert.equal(typeof v, 'string', `${k} が数・真偽・文字列のどれでもない`);
      assert.ok(allowed[k]?.(v), `${k} に自由な文字列: ${v}`);
    }
    const text = JSON.stringify(row);
    for (const leak of Object.values(RECORD)) assert.ok(!text.includes(leak), `送る行に ${leak}`);
    assert.ok(!text.includes('SECRETBOOK'));
  }

  test('セッションの行は表(見本)の項目だけで、値は数・真偽・決まった語だけ', async () => {
    const { sessionRow, SESSION_FIELDS } = await import('../../extension/src/background/telemetry.js');
    const row = sessionRow(record, extra);
    assert.deepEqual(Object.keys(row), SESSION_FIELDS);
    assert.deepEqual([...SESSION_FIELDS].sort(), Object.keys(fixture.session).sort(), 'tests/fixtures/telemetry.json(サーバのテストも読む)と同じ項目');
    await assertNoFreeText(row);
    assert.equal(row.hour, 21);
    assert.equal(row.theta, 5.112);
    assert.equal(row.end_reason, 'manual');
  });

  test('環境の行(hello)も表の項目だけ。UA の全文ではなく Chrome のメジャー版だけ', async () => {
    const { helloRow, HELLO_FIELDS } = await import('../../extension/src/background/telemetry.js');
    const row = helloRow({ ...RECORD, ext: '0.27', store: false, userAgent: RECORD.user_agent, theta0: 6, goal: 'level1', trivia: false });
    assert.deepEqual(Object.keys(row), HELLO_FIELDS);
    assert.deepEqual([...HELLO_FIELDS].sort(), Object.keys(fixture.hello).sort());
    await assertNoFreeText(row);
    assert.equal(row.chrome, 141);
  });

  test('決まった語に無いもの・範囲の外の値は、決まった語か範囲の中に丸める', async () => {
    const { sessionRow, helloRow } = await import('../../extension/src/background/telemetry.js');
    const row = sessionRow(
      { ...record, reason: '本文の段落', theta: 99, read_ms: 9e12, completion_pct: -3, stability: 'とても', pace_wpm: NaN },
      { ...extra, controller_reason: '本文の段落', quiz_answered: '3' },
    );
    await assertNoFreeText(row);
    assert.equal(row.end_reason, null);
    assert.equal(row.controller_reason, null);
    assert.equal(row.theta, 8);
    assert.equal(row.read_ms, 86_400_000);
    assert.equal(row.completion_pct, 0);
    assert.equal(row.stability, null);
    assert.equal(row.pace_wpm, null);
    assert.equal(row.quiz_answered, 0, '数でない値は 0');
    const hello = helloRow({ ext: '0.27', goal: '本文の段落', userAgent: 'Firefox/130', theta0: 'x' });
    await assertNoFreeText(hello);
    assert.equal(hello.goal, null);
    assert.equal(hello.chrome, null);
    // 送れる形にならない行は作らない
    assert.equal(sessionRow({ ...record, session_id: 'x' }, extra), null);
    assert.equal(sessionRow(record, { ...extra, ext: '0.27 銀河鉄道' }), null);
    assert.equal(helloRow({ ext: '' }), null);
  });

  test('同意がオフ(まだ選んでいないときも)なら、積まない・送らない', async (t) => {
    const { sessionRow } = await import('../../extension/src/background/telemetry.js');
    const { queueTelemetry, flushTelemetry } = await import('../../extension/src/background/server.js');
    const net = fakeFetch();
    for (const consent of [undefined, false]) {
      const chrome = fakeChrome(consent === undefined ? {} : { telemetry_consent: consent });
      install(t, chrome, net.fetch);
      await queueTelemetry(sessionRow(record, extra));
      await flushTelemetry({ hello: async () => ({ kind: 'hello', ext: '0.27' }) });
      assert.deepEqual([...chrome.data.keys()].filter((k) => k.startsWith('telemetry_') && k !== 'telemetry_consent'), []);
    }
    assert.equal(net.calls.length, 0);
  });

  test('送るのは SERVER.telemetryBase/telemetry への POST だけ。ヘッダは content-type と X-RS-Telemetry(うんちくの ID とは別)・本文は rows だけ', async (t) => {
    const { SERVER } = await import('../../extension/src/shared/config.js');
    const { sessionRow } = await import('../../extension/src/background/telemetry.js');
    const { queueTelemetry, flushTelemetry } = await import('../../extension/src/background/server.js');
    const install_id = '11111111-2222-4333-8444-555555555555';
    const chrome = fakeChrome({ telemetry_consent: true, install_id });
    const net = fakeFetch();
    install(t, chrome, net.fetch);
    const row = sessionRow(record, extra);
    await queueTelemetry(row);
    await flushTelemetry();

    assert.equal(net.calls.length, 1);
    const { url, init, body } = net.calls[0];
    assert.equal(url, `${SERVER.telemetryBase}/telemetry`);
    assert.equal(init.method, 'POST');
    assert.deepEqual(Object.keys(init.headers).sort(), ['content-type', 'x-rs-telemetry']);
    assert.match(init.headers['x-rs-telemetry'], UUID);
    assert.notEqual(init.headers['x-rs-telemetry'], install_id);
    assert.deepEqual(Object.keys(body), ['rows']);
    assert.deepEqual(body.rows, [row]);
  });
});
