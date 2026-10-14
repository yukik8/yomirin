// テスト用の chrome(storage.local と runtime だけ)と fetch。拡張のコードは呼ぶたびに globalThis の
// chrome・fetch を読むので、テストごとに置き換えられる。

/** storage.local を Map で持つ chrome。data で中身を見られる。 */
export function fakeChrome(initial = {}, manifest = { version: '0.27' }) {
  const data = new Map(Object.entries(structuredClone(initial)));
  const keysOf = (k) => (k == null ? [...data.keys()] : Array.isArray(k) ? k : [k]);
  return {
    data,
    runtime: { getManifest: () => manifest },
    storage: {
      local: {
        get: async (k) => Object.fromEntries(keysOf(k).filter((x) => data.has(x)).map((x) => [x, structuredClone(data.get(x))])),
        set: async (obj) => {
          for (const [k, v] of Object.entries(obj)) data.set(k, structuredClone(v));
        },
        remove: async (k) => {
          for (const x of keysOf(k)) data.delete(x);
        },
        clear: async () => data.clear(),
      },
    },
  };
}

/**
 * 呼ばれた引数を calls に残す fetch。reply(url, init) が返す status で応える(数でなく Error を返すと、届かなかったことにする)。
 */
export function fakeFetch(reply = () => 204) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    const status = await reply(url, init);
    if (status instanceof Error) throw status;
    return { status, ok: status >= 200 && status < 300, json: async () => ({}) };
  };
  return { fetch, calls };
}

/** globalThis の chrome と fetch を置き換え、テストが終わったら戻す。 */
export function install(t, chrome, fetch) {
  const realFetch = globalThis.fetch;
  globalThis.chrome = chrome;
  if (fetch) globalThis.fetch = fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    delete globalThis.chrome;
  });
}
