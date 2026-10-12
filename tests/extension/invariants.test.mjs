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
    // 計測は「読む」を押した間だけ(§11-2)。注入は scripting で、押したタブにだけ行う
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

describe('不変条件 §11-7・§11-8: 端末の外へ出る経路は、うんちくのサーバへの1本だけ', () => {
  const NETWORK = /\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b|\bEventSource\b|\bconnectNative\b|\bsendNativeMessage\b/;
  const SERVER_JS = join('src', 'background', 'server.js');

  test('通信の API を使うのは background/server.js だけ', () => {
    assert.deepEqual(hits(ofType('.js').filter((s) => s.path !== SERVER_JS), NETWORK), []);
  });

  test('server.js の fetch は SERVER.base にだけ向く', () => {
    const text = sources.find((s) => s.path === SERVER_JS).text;
    const targets = [...text.matchAll(/\bfetch\s*\(\s*([^,)]+)/g)].map((m) => m[1].trim());
    assert.ok(targets.length > 0);
    for (const t of targets) assert.ok(t.startsWith('`${SERVER.base}/'), `fetch の行き先: ${t}`);
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
  test('ストア版は本番の https、開発版は手元のサーバを呼ぶ(§11-10)', async (t) => {
    t.after(() => delete globalThis.chrome);
    delete globalThis.chrome;
    const dev = await import('../../extension/src/shared/config.js?dev');
    assert.equal(dev.IS_STORE_BUILD, false);
    assert.equal(dev.SERVER.base, 'http://127.0.0.1:8787');

    // ストアから入れた拡張の manifest には update_url が付く
    globalThis.chrome = { runtime: { getManifest: () => ({ ...manifest, update_url: 'https://clients2.google.com/service/update2/crx' }) } };
    const store = await import('../../extension/src/shared/config.js?store');
    assert.equal(store.IS_STORE_BUILD, true);
    assert.equal(store.SERVER.base, 'https://reading-scaffold.vercel.app');
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
