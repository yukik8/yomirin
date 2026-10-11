// ページを見えない Chrome で開き、決めた大きさで撮る(ストアのスクリーンショット・タイル用。DevTools のプロトコル)。
// 書き出す PNG は 24-bit(透明なし)で、ストアの決まりに合う。
//
//   python3 -m http.server 8931 --bind 127.0.0.1                       # リポジトリの一番上で、別に立てておく
//   node shoot.mjs out.png 1280x800 "http://127.0.0.1:8931/tools/preview/?theta=8" 2000 "<流す JS>"
//
//   引数: 書き出す PNG・大きさ・URL・JS を流してから撮るまでのミリ秒・流す JS(省略可)。Node 22 以上(組み込みの WebSocket)。
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [out, size = '1280x800', url, wait = '1000', js = ''] = process.argv.slice(2);
if (!out || !url) {
  console.error('usage: node shoot.mjs out.png 1280x800 "<url>" 2000 "<js>"');
  process.exit(1);
}
const [width, height] = size.split('x').map(Number);
const port = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), 'yomirin-shoot-'));
const chrome = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--hide-scrollbars', '--no-first-run', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i += 1) {
    await sleep(200);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
    } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let seq = 0;
  const waiting = new Map();
  const events = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)(m);
      waiting.delete(m.id);
    } else if (m.method) events.push(m);
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const id = ++seq;
      waiting.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  for (let i = 0; i < 50 && !events.some((e) => e.method === 'Page.loadEventFired'); i += 1) await sleep(100);
  await sleep(500);
  if (js) {
    const r = await send('Runtime.evaluate', { expression: js });
    if (r.result?.exceptionDetails) console.log('JS のエラー:', JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  }
  await sleep(Number(wait));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  for (const e of events) {
    if (e.method === 'Runtime.exceptionThrown') console.log('ページのエラー:', JSON.stringify(e.params).slice(0, 300));
  }
  console.log(out);
  ws.close();
} finally {
  chrome.kill();
}
