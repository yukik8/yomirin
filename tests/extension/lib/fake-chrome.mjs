// テスト用の chrome(storage.local・storage.session と runtime、タブの倍率)と fetch。拡張のコードは呼ぶたびに globalThis の
// chrome・fetch を読むので、テストごとに置き換えられる。

/** Map で持つ storage の1つの場所(local・session)。 */
function fakeArea(data) {
  const keysOf = (k) => (k == null ? [...data.keys()] : Array.isArray(k) ? k : [k]);
  return {
    get: async (k) => Object.fromEntries(keysOf(k).filter((x) => data.has(x)).map((x) => [x, structuredClone(data.get(x))])),
    set: async (obj) => {
      for (const [k, v] of Object.entries(obj)) data.set(k, structuredClone(v));
    },
    remove: async (k) => {
      for (const x of keysOf(k)) data.delete(x);
    },
    clear: async () => data.clear(),
  };
}

/** storage.local と storage.session を Map で持つ chrome。data(local)・sessionData で中身を見られる。 */
export function fakeChrome(initial = {}, manifest = { version: '0.27' }) {
  const data = new Map(Object.entries(structuredClone(initial)));
  const sessionData = new Map();
  return {
    data,
    sessionData,
    runtime: { getManifest: () => manifest },
    storage: { local: fakeArea(data), session: fakeArea(sessionData) },
  };
}

/**
 * タブの倍率だけを持つ chrome.tabs(#33・background/zoom.js)。tabs は { [tabId]: { zoom, mode?, scope? } }。
 * Chrome と同じく、per-origin のまま setZoom すると origin の倍率(origin.zoom)として残り、per-tab から per-origin に
 * 戻すとタブは origin の倍率になる。無いタブは Error。calls に呼ばれた順に残す。fail にメソッド名を入れると、それが落ちる。
 */
export function fakeTabs(tabs = {}, { originZoom = 1, fail = [] } = {}) {
  const origin = { zoom: originZoom };
  const calls = [];
  const tabOf = (id) => {
    const tab = tabs[id];
    if (!tab) throw new Error(`No tab with id: ${id}`);
    tab.mode ??= 'automatic';
    tab.scope ??= 'per-origin';
    return tab;
  };
  const method = (name, fn) => async (...args) => {
    calls.push([name, ...args]);
    if (fail.includes(name)) throw new Error(`${name} failed`);
    return fn(...args);
  };
  return {
    tabs,
    origin,
    calls,
    getZoom: method('getZoom', (id) => tabOf(id).zoom),
    getZoomSettings: method('getZoomSettings', (id) => {
      const { mode, scope } = tabOf(id);
      return { mode, scope, defaultZoomFactor: 1 };
    }),
    setZoomSettings: method('setZoomSettings', (id, { mode, scope }) => {
      const tab = tabOf(id);
      if (tab.scope === 'per-tab' && scope === 'per-origin') tab.zoom = origin.zoom;
      Object.assign(tab, { mode, scope });
    }),
    setZoom: method('setZoom', (id, factor) => {
      const tab = tabOf(id);
      tab.zoom = factor;
      if (tab.scope === 'per-origin') origin.zoom = factor;
    }),
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
