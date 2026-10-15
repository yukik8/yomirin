// 1ページの長さ(#33・background/zoom.js)のテスト。拡張のコードをそのまま読む。
//
// 確かめるのは: 倍率の式(θ 配下・θ=0 と小さい θ では掛けない)・本人が自分で大きくしていたら掛けない・
// このタブだけに掛ける(per-tab にできなければ掛けない — Play ブックスの倍率として残さない)・
// 終わったら元に戻す・本人が途中で変えていたら戻さない・Chrome が戻していたら触らない・タブが無くても落ちない・
// θ のダイヤルで掛け直す・お祝いのあとに戻すのを待っている間に次が始まったら先に戻す。
//
//   node --test "tests/extension/*.test.mjs"

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome, fakeTabs, install } from './lib/fake-chrome.mjs';
import { PAGE_ZOOM, THETA_MAX } from '../../extension/src/shared/config.js';
import {
  zoomFor,
  zoomTarget,
  applyZoom,
  retuneZoom,
  restoreZoom,
  restoreZoomLater,
  flushZoomRestore,
} from '../../extension/src/background/zoom.js';

const TAB = 7;

function setup(t, tabs = { [TAB]: { zoom: 1 } }, opts) {
  const chrome = fakeChrome();
  chrome.tabs = fakeTabs(tabs, opts);
  install(t, chrome);
  return chrome.tabs;
}
const sets = (tabs) => tabs.calls.filter(([name]) => name.startsWith('set'));

describe('倍率の式', () => {
  test('θ=8 で PAGE_ZOOM.max、θ が下がると 1 へ戻り、θ=0 では掛けない', () => {
    assert.equal(zoomFor(THETA_MAX), PAGE_ZOOM.max);
    assert.equal(zoomFor(THETA_MAX / 2), Math.round((1 + (PAGE_ZOOM.max - 1) / 2) * 100) / 100);
    assert.equal(zoomFor(0), 1);
    assert.equal(zoomFor(20), PAGE_ZOOM.max, 'θ の上限を超えても max まで');
    assert.equal(zoomFor(-1), 1);
    assert.equal(zoomFor(undefined), 1);
  });

  test('θ が下がるほど小さく(単調)、minFactor 未満は掛けない', () => {
    let prev = Infinity;
    for (let th = THETA_MAX; th >= 0; th -= 0.1) {
      const f = zoomFor(th);
      assert.ok(f <= prev, `θ=${th.toFixed(1)} で ${f} > ${prev}`);
      assert.ok(f === 1 || f >= PAGE_ZOOM.minFactor);
      prev = f;
    }
    assert.equal(zoomFor(0.5), 1, 'θ=0.5 では差が小さいので掛けない');
    assert.ok(zoomFor(1) > 1);
  });

  test('成功1回(θ×0.9)あたりの倍率の変化は小さい', () => {
    const drop = zoomFor(THETA_MAX) - zoomFor(THETA_MAX * 0.9);
    assert.ok(drop > 0 && drop / zoomFor(THETA_MAX) < 0.05, `${drop}`);
  });

  test('いまの倍率がそれ以上なら掛けない(本人が自分で大きくしている)', () => {
    assert.equal(zoomTarget(THETA_MAX, 1), PAGE_ZOOM.max);
    assert.equal(zoomTarget(THETA_MAX, 1.25), PAGE_ZOOM.max);
    assert.equal(zoomTarget(THETA_MAX, PAGE_ZOOM.max), null);
    assert.equal(zoomTarget(THETA_MAX, 2), null);
    assert.equal(zoomTarget(0, 0.8), null, 'θ=0 なら、小さくしている人にも掛けない');
  });
});

describe('掛ける・戻す', () => {
  test('このタブを per-tab にしてから掛ける。Play ブックスの倍率(origin)は変えない', async (t) => {
    const tabs = setup(t);
    const zoom = await applyZoom(TAB, THETA_MAX);
    assert.deepEqual(zoom, { before: 1, mode: 'automatic', scope: 'per-origin', applied: PAGE_ZOOM.max });
    assert.deepEqual(sets(tabs), [
      ['setZoomSettings', TAB, { mode: 'automatic', scope: 'per-tab' }],
      ['setZoom', TAB, PAGE_ZOOM.max],
    ]);
    assert.equal(tabs.tabs[TAB].zoom, PAGE_ZOOM.max);
    assert.equal(tabs.origin.zoom, 1);
  });

  test('θ=0・小さい θ・本人が大きくしているときは、何も変えない', async (t) => {
    const tabs = setup(t, { [TAB]: { zoom: 1 }, 8: { zoom: 1.75 } });
    assert.equal(await applyZoom(TAB, 0), null);
    assert.equal(await applyZoom(TAB, 0.4), null);
    assert.equal(await applyZoom(8, THETA_MAX), null);
    assert.deepEqual(sets(tabs), []);
  });

  test('per-tab にできなければ掛けない(per-origin のまま掛けると Play ブックスの倍率として残る)', async (t) => {
    const tabs = setup(t, undefined, { fail: ['setZoomSettings'] });
    assert.equal(await applyZoom(TAB, THETA_MAX), null);
    assert.equal(tabs.calls.filter(([name]) => name === 'setZoom').length, 0);
    assert.equal(tabs.tabs[TAB].zoom, 1);
    assert.equal(tabs.origin.zoom, 1);
  });

  test('倍率を変えられなければ、設定も元に戻して掛けない', async (t) => {
    const tabs = setup(t, undefined, { fail: ['setZoom'] });
    assert.equal(await applyZoom(TAB, THETA_MAX), null);
    assert.equal(tabs.tabs[TAB].scope, 'per-origin');
  });

  test('タブが無ければ null(落ちない)', async (t) => {
    setup(t, {});
    assert.equal(await applyZoom(TAB, THETA_MAX), null);
    assert.equal(await restoreZoom(TAB, { before: 1, mode: 'automatic', scope: 'per-origin', applied: 1.6 }), false);
  });

  test('終わったら元の倍率と設定に戻す', async (t) => {
    const tabs = setup(t, { [TAB]: { zoom: 1.1 } }, { originZoom: 1.1 });
    const zoom = await applyZoom(TAB, THETA_MAX);
    assert.equal(await restoreZoom(TAB, zoom), true);
    assert.equal(tabs.tabs[TAB].zoom, 1.1);
    assert.equal(tabs.tabs[TAB].scope, 'per-origin');
    assert.equal(tabs.origin.zoom, 1.1);
    // 倍率を戻してから設定を戻す(先に per-origin に戻すと、掛けた倍率が origin に残りうる)
    assert.deepEqual(sets(tabs).slice(-2), [
      ['setZoom', TAB, 1.1],
      ['setZoomSettings', TAB, { mode: 'automatic', scope: 'per-origin' }],
    ]);
  });

  test('getZoom が少しずれて返っても、掛けたままとみなして戻す', async (t) => {
    const tabs = setup(t);
    const zoom = await applyZoom(TAB, THETA_MAX);
    tabs.tabs[TAB].zoom = zoom.applied * 1.0001;
    assert.equal(await restoreZoom(TAB, zoom), true);
    assert.equal(tabs.tabs[TAB].zoom, 1);
  });

  test('本人が途中で ⌘+/⌘− していたら戻さない', async (t) => {
    const tabs = setup(t);
    const zoom = await applyZoom(TAB, THETA_MAX);
    await chrome.tabs.setZoom(TAB, 1.25); // 本人の ⌘−
    const before = sets(tabs).length;
    assert.equal(await restoreZoom(TAB, zoom), false);
    assert.equal(tabs.tabs[TAB].zoom, 1.25);
    assert.equal(sets(tabs).length, before);
  });

  test('Chrome が戻していたら(別の文書へ移った・起動し直してタブの番号が使い回された)触らない', async (t) => {
    const tabs = setup(t);
    const zoom = await applyZoom(TAB, THETA_MAX);
    // 別の文書へ移ると、per-tab の倍率は Chrome が origin の倍率に戻す
    Object.assign(tabs.tabs[TAB], { zoom: 1, scope: 'per-origin' });
    const before = sets(tabs).length;
    assert.equal(await restoreZoom(TAB, zoom), false);
    // 使い回された番号のタブが、たまたま同じ倍率でも per-tab でなければ触らない
    tabs.tabs[TAB].zoom = zoom.applied;
    assert.equal(await restoreZoom(TAB, zoom), false);
    assert.equal(sets(tabs).length, before);
  });

  test('掛けていなければ何もしない', async (t) => {
    const tabs = setup(t);
    assert.equal(await restoreZoom(TAB, null), false);
    await restoreZoomLater(TAB, null, 0);
    assert.deepEqual(tabs.calls, []);
  });
});

describe('θ のダイヤル(開発版)で掛け直す', () => {
  test('掛けたままなら新しい θ の倍率に。θ を下げきれば元の倍率', async (t) => {
    const tabs = setup(t);
    let zoom = await applyZoom(TAB, THETA_MAX);
    zoom = await retuneZoom(TAB, zoom, THETA_MAX / 2);
    assert.equal(tabs.tabs[TAB].zoom, zoomFor(THETA_MAX / 2));
    assert.equal(zoom.applied, zoomFor(THETA_MAX / 2));
    zoom = await retuneZoom(TAB, zoom, 0);
    assert.equal(tabs.tabs[TAB].zoom, 1);
    zoom = await retuneZoom(TAB, zoom, THETA_MAX);
    assert.equal(tabs.tabs[TAB].zoom, PAGE_ZOOM.max);
    assert.equal(await restoreZoom(TAB, zoom), true);
    assert.equal(tabs.tabs[TAB].zoom, 1);
    assert.equal(tabs.tabs[TAB].scope, 'per-origin');
  });

  test('まだ掛けていなければ新しい θ で掛ける。本人が変えていたら触らない', async (t) => {
    const tabs = setup(t);
    let zoom = await retuneZoom(TAB, null, 0);
    assert.equal(zoom, null);
    zoom = await retuneZoom(TAB, null, THETA_MAX);
    assert.equal(zoom.applied, PAGE_ZOOM.max);
    await chrome.tabs.setZoom(TAB, 1.2); // 本人
    assert.deepEqual(await retuneZoom(TAB, zoom, THETA_MAX / 2), zoom);
    assert.equal(tabs.tabs[TAB].zoom, 1.2);
  });
});

describe('お祝いを出し終えてから戻す', () => {
  test('待っている間は戻さず、時間が来たら戻す', async (t) => {
    const tabs = setup(t);
    const zoom = await applyZoom(TAB, THETA_MAX);
    await restoreZoomLater(TAB, zoom, 20);
    assert.equal(tabs.tabs[TAB].zoom, PAGE_ZOOM.max);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(tabs.tabs[TAB].zoom, 1);
    await flushZoomRestore(); // もう待っていない
    assert.equal(tabs.calls.filter(([name]) => name === 'setZoom').length, 2);
  });

  test('待っている間に次が始まったら、先に戻す(1回だけ)', async (t) => {
    const tabs = setup(t);
    const zoom = await applyZoom(TAB, THETA_MAX);
    await restoreZoomLater(TAB, zoom, 10_000);
    await flushZoomRestore();
    assert.equal(tabs.tabs[TAB].zoom, 1);
    const next = await applyZoom(TAB, THETA_MAX / 2);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(tabs.tabs[TAB].zoom, next.applied, '前の回の戻しが、次の回の倍率を消さない');
  });

  test('0 ならすぐ戻す', async (t) => {
    const tabs = setup(t);
    const zoom = await applyZoom(TAB, THETA_MAX);
    await restoreZoomLater(TAB, zoom, 0);
    assert.equal(tabs.tabs[TAB].zoom, 1);
  });
});
