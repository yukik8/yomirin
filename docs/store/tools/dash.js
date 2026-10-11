// ダッシュボードを見本データ入りで表示してストア用スクリーンショット(1280×800 を2枚): node dash.js out.png 1280
const puppeteer = require(process.env.S + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');
const EXT = require('path').resolve(__dirname, '../../../extension');
const STUB = `<script>
  window.chrome = {
    runtime: {
      sendMessage: async (m) => ({ ok: true, theta: 3.2, goal: m.goal ?? null }),
      getManifest: () => ({ version: '${require(EXT + '/manifest.json').version}', update_url: 'https://clients2.google.com/service/update2/crx' }),
      getURL: (p) => location.origin + '/' + p,
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { create: () => {} },
  };
</script>`;
const SEED = `<!doctype html><meta charset="utf-8">${STUB}<script type="module">
  import { seedDemoData } from '/src/dashboard/demo-seed.js';
  import { putPage, putReading, addQuiz, addQuizAttempt, addQuestion } from '/src/background/store.js';
  await seedDemoData();
  const now = Date.now(), day = 86400000, min = 60000;
  await putPage({ page_id: 'bk1', url: 'https://play.google.com/books/reader?id=gauche', title: 'セロ弾きのゴーシュ', domain: 'play.google.com', first_read_at: now - 3 * day, last_read_at: now - 2 * 3600e3, read_count: 4, total_read_ms: 42 * min, best_completion_pct: 65, book_position: { page: 11, total: 17 } });
  await putPage({ page_id: 'bk2', url: 'https://play.google.com/books/reader?id=kumo', title: '蜘蛛の糸', domain: 'play.google.com', first_read_at: now - 9 * day, last_read_at: now - 6 * day, read_count: 2, total_read_ms: 18 * min, best_completion_pct: 100, finished_at: now - 6 * day, book_position: { page: 9, total: 9 } });
  const R = [['bk1', 3, 1, 5, 12], ['bk1', 2, 4, 8, 11], ['bk1', 1, 1, 3, 6], ['bk1', 0.2, 8, 11, 13], ['bk2', 9, 1, 5, 9], ['bk2', 6, 5, 9, 9]];
  let i = 0;
  for (const [id, ago, from, to, m] of R) await putReading({ session_id: 'r' + (i++), page_id: id, started_at: now - ago * day, range: { from, to, furthest: to, total: id === 'bk1' ? 17 : 9 }, read_ms: m * min });
  const q1 = await addQuiz({ page_id: 'bk1', book_page: 4, question: 'ゴーシュが午前に枝をきっていたのは何の枝?', choices: ['セロ', 'トマト', '水車'], answer_index: 1, created_at: now - 2 * day });
  await addQuizAttempt({ quiz_id: q1, page_id: 'bk1', answered_at: now - 2 * day, correct: true });
  const q2 = await addQuiz({ page_id: 'bk1', book_page: 9, question: '楽長がゴーシュに言ったことは?', choices: ['もっと速く', 'セロがおくれた', '休もう'], answer_index: 1, created_at: now - day });
  await addQuizAttempt({ quiz_id: q2, page_id: 'bk1', answered_at: now - day, correct: false });
  await addQuizAttempt({ quiz_id: q2, page_id: 'bk1', answered_at: now - day + 5000, correct: true });
  await addQuestion({ page_id: 'bk1', book_page: 2, question: '活動写真館って何?', answer: '昔の映画館のことです。', selection: '活動写真館', created_at: now - 3 * day });
  document.title = 'seeded';
</script>`;
(async () => {
  const [out, width] = [process.argv[2], Number(process.argv[3] || 760)];
  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.setRequestInterception(true);
  p.on('request', (req) => {
    const u = new URL(req.url()); if (u.protocol === 'data:') return req.continue();
    if (u.pathname === '/seed') return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: SEED });
    const file = path.join(EXT, u.pathname);
    if (!fs.existsSync(file)) { console.log('404', u.pathname); } if (!fs.existsSync(file)) return req.respond({ status: 404, body: 'nf' });
    let body = fs.readFileSync(file);
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
    if (file.endsWith('dashboard.html')) body = Buffer.from(body.toString().replace('<head>', '<head>' + STUB));
    return req.respond({ status: 200, contentType: type, body });
  });
  await p.setViewport({ width, height: 800, deviceScaleFactor: 1 });
  await p.goto('https://dash.test/seed');
  await p.waitForFunction(() => document.title === 'seeded', { timeout: 20000 });
  await p.goto('https://dash.test/src/dashboard/dashboard.html');
  await new Promise((r) => setTimeout(r, 1800)); await p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: out, clip: { x: 0, y: 0, width, height: 800 } });
  await p.screenshot({ path: out.replace('.png', '-2.png'), clip: { x: 0, y: 760, width, height: 800 }, captureBeyondViewport: true });
  console.log('エラー:', errors.length ? errors.slice(0, 5) : 'なし');
  await b.close();
})();
