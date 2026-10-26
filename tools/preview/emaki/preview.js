import { paginate, replay, panelSvg, scrollSvg, drawable, whereIs, TIMES, WEATHERS, MOODS } from './emaki.js';
import { svgUrl } from '../scene/scene.js';
import { cost, callsOf, label, measure } from './measure.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const get = (url) => fetch(url, { cache: 'no-store' }).then((r) => r.json());
const [{ books }, { files }] = await Promise.all([get('./books.json'), get('./runs/index.json')]);
const runs = await Promise.all(files.filter((f) => f !== 'unknown.json').map((file) => get(`./runs/${file}`).then((run) => ({ file, run }))));
const shelf = books.filter((b) => runs.some((r) => r.run.book === b.id));

let page = 0;
let front = $('pic-a');
let shown = '';

for (const b of shelf) $('book').append(new Option(`${b.title}(${b.author})`, b.id));
if (shelf.some((b) => b.id === params.get('book'))) $('book').value = params.get('book');
$('sketch').checked = params.get('sketch') !== '0';
$('styled').checked = params.get('styled') !== '0';
if ([...$('size').options].some((o) => o.value === params.get('size'))) $('size').value = params.get('size');
if (params.get('theme') === 'dark') document.body.classList.add('dark');

const book = () => books.find((b) => b.id === $('book').value);
const current = () => runs.find((r) => r.file === $('run').value)?.run;
const pagesOf = (run) => paginate(books.find((b) => b.id === run.book), run.settings.pageSize);
const fmt = (n, digits) => (n == null ? '—' : n.toFixed(digits));
const sec = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}秒`);
const money = (n) => (n == null ? '$—' : `$${n.toFixed(3)}`);
const model = (r) => (r?.served_model ?? r?.model ?? '').replace(/^claude-/, '').replace(/-\d.*$/, '');
// 語句(quote)を渡すと、本文の語句を薄く添える
const li = (text, cls = '', quote = '') => {
  const el = document.createElement('li');
  el.textContent = text;
  if (quote) { const q = document.createElement('span'); q.className = 'quote'; q.textContent = `「${quote}」`; el.append(q); }
  if (cls) el.className = cls;
  return el;
};
const sceneLine = (p) => `場所: ${p.place.name || '分からない'}${p.place.quote ? `「${p.place.quote}」` : ''} / ${TIMES[p.time]} / ${WEATHERS[p.weather]} / ${MOODS[p.mood]}`;

function versions() {
  const list = runs.filter((r) => r.run.book === $('book').value);
  $('run').replaceChildren(...list.map((r) => new Option(label(r.run), r.file)));
  if (list.some((r) => r.file === params.get('v'))) $('run').value = params.get('v');
}

// 試写室で見られるページの範囲: 読み始めたページから、記録の最後の回の最後のページまで
function range(run) {
  const last = run.ticks.at(-1);
  return [run.settings.start, last ? last.pages[1] : run.settings.start];
}

// ページ p を開いたときに見えている回の数(答えは、その回の最後のページの次のめくりで見える)
const visible = (run, p) => run.ticks.filter((t) => t.pages[1] < p).length;

function prose(pages, p) {
  const pg = pages[p];
  const b = book();
  const prev = pages[p - 1];
  $('chapter').textContent = b.chapters[pg.chapter].title || `${b.title}`;
  $('title').textContent = p === 0 || prev?.chapter !== pg.chapter ? (b.chapters[pg.chapter].title || b.title) : '';
  $('title').hidden = !$('title').textContent;
  const cont = prev && prev.chapter === pg.chapter && prev.paras.at(-1) === pg.paras[0];
  $('prose').replaceChildren(...pg.text.split('\n').map((t, i) => { const el = document.createElement('p'); el.textContent = t; if (i === 0 && cont) el.className = 'cont'; return el; }));
  $('source').textContent = `${b.author}「${b.title}」(青空文庫)より`;
  const [a, z] = range(current());
  $('folio').textContent = `${p + 1}ページ(${p - a + 1} / ${z - a + 1})`;
}

// 余白の絵: いまの章の、描けた最後の区画。答えが来た直後のめくりでは、描き足した物を下描きで見せる
function margin(run, pages, p, state) {
  const chapter = pages[p].chapter;
  const panel = state.book.emaki.chapter === chapter ? state.book.emaki.panels.filter(drawable).at(-1) : null;
  const k = visible(run, p);
  const fresh = k > 0 && run.ticks[k - 1].pages[1] === p - 1 && $('sketch').checked ? k - 1 : null;
  let svg = '';
  if (panel) {
    const sketchAll = fresh != null && panel.tick === fresh && state.logs[fresh]?.read.draws.some((d) => d.panel === panel.id && d.mode === 'new');
    const sketch = new Set(fresh == null ? [] : panel.things.filter((t) => t.drawn === fresh).map((t) => t.id));
    svg = panelSvg(panel, { sketch, sketchAll, styled: $('styled').checked });
  }
  document.documentElement.style.setProperty('--card', `${$('size').value}px`);
  if (svg === shown) return panel;
  shown = svg;
  if (!svg) { front.classList.remove('on'); return panel; }
  const back = front === $('pic-a') ? $('pic-b') : $('pic-a');
  back.src = svgUrl(svg);
  back.decode().catch(() => {}).then(() => { back.classList.add('on'); front.classList.remove('on'); front = back; });
  return panel;
}

function facts(run, pages, p, state, panel) {
  const k = visible(run, p);
  const brief = run.brief?.data;
  const rows = [['版', label(run)], ['下調べ', !run.brief ? 'なし(書名を渡していない)' : brief?.known === 'yes' ? brief.work : '知らない本(読んだ所だけで進める)']];
  const tick = k > 0 && run.ticks[k - 1].pages[1] === p - 1 ? run.ticks[k - 1] : null;
  if (tick) {
    rows.push(['この回', `読み取り ${tick.pages[0] + 1}〜${tick.pages[1] + 1}ページ・${model(tick.reader)} ${sec(tick.reader?.ms)} ${money(cost(tick.reader))}${tick.reader?.data ? '' : ` × ${tick.reader?.error ?? tick.reader?.stop_reason}`}`]);
    state.logs[k - 1].read.draws.forEach((d, i) => {
      const r = tick.drawers?.[i];
      rows.push(['', `描く(${d.mode === 'new' ? '新しい区画' : '描き足し'}・${d.ids.length}つ)・${model(r)} ${sec(r?.ms)} ${money(cost(r))}${r?.data ? '' : ' × 来ていない'}`]);
    });
    if (tick.summary) rows.push(['', `章のまとめ・${model(tick.summary)} ${sec(tick.summary.ms)} ${money(cost(tick.summary))}`]);
  } else rows.push(['この回', '—(読み取りの答えは来ていない)']);
  const spent = [run.brief, ...run.ticks.slice(0, k).flatMap(callsOf)].filter(Boolean).map(cost);
  rows.push(['ここまで', spent.some((c) => c == null) ? '$—(見本)' : `$${spent.reduce((n, c) => n + c, 0).toFixed(3)}(${k}回)`]);
  rows.push(['この章の区画', `${state.book.emaki.chapter === pages[p].chapter ? state.book.emaki.panels.length : 0}`]);
  $('facts').replaceChildren(...rows.flatMap(([a, b]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = a; dd.textContent = b; return [dt, dd]; }));

  const story = state.book.story;
  const items = [];
  if (story.seed) items.push(li(`読み始める前(下調べから・語句なし): ${story.seed}`));
  story.chapters.forEach((c, i) => items.push(li(`前の章 ${i + 1}: ${c.summary}`)));
  for (const e of story.events) items.push(li(`○ ${e.text}`, e.tick === k - 1 && tick ? 'new' : '', e.quote));
  $('story').replaceChildren(...(items.length ? items : [li('まだ無い')]));

  const things = panel ? [li(sceneLine(panel)), ...panel.things.map((t) => {
    const drawnAs = !t.shapes ? 'まだ描いていない' : t.drawn === k - 1 && tick && $('sketch').checked ? '下描き' : '色';
    return li(`${t.main ? '★' : '・'}${t.name}[${drawnAs}] — ${t.look}`, t.tick === k - 1 && tick ? 'new' : '', t.quote);
  })] : [li('まだ無い(この章の最初の答えを待っている)')];
  $('things').replaceChildren(...things);

  const dropped = state.logs.flatMap((log) => log.read.dropped.filter((d) => d.why === 'quote').map((d) => ({ ...d, tick: log.tick, where: whereIs(d.quote, pages, run.ticks[log.tick].pages[1]) }))).reverse();
  const where = { later: '先(まだ読んでいない所にだけ有る)', before: '前に読んだ所に有る', none: '本文に無い' };
  $('dropped').replaceChildren(...(dropped.length ? dropped.map((d) => li(`${d.tick + 1}回目 ${d.kind} ${d.what}「${d.quote}」→ ${where[d.where]}`, d.where === 'later' ? 'warn' : '')) : [li('無い')]));

  const verdicts = run.judge?.data?.ticks ?? null;
  if (!verdicts) $('judge').replaceChildren(li(run.judge ? `× ${run.judge.error ?? run.judge.stop_reason}` : '判定していない(見本・判定役なし)'));
  else {
    const flagged = verdicts.filter((v) => v.tick < k && v.spoiler);
    $('judge').replaceChildren(...(flagged.length ? flagged.flatMap((v) => v.found.map((f) => li(`⚠ ${v.tick + 1}回目: ${f.what} — ${f.why}`, 'warn'))) : [li(`○ ネタバレの疑いなし(${k}回目まで)`)]));
  }
}

function show() {
  const run = current();
  if (!run) return;
  const pages = pagesOf(run);
  const [a, z] = range(run);
  page = Math.max(a, Math.min(z, page));
  $('page').min = a; $('page').max = z; $('page').value = page;
  $('page-out').value = String(page + 1);
  $('turn').textContent = pages[page].end ? 'めくる(章の終わり)' : 'めくる';
  const state = replay(run, pages, visible(run, page));
  prose(pages, page);
  const panel = margin(run, pages, page, state);
  facts(run, pages, page, state, panel);
}

// 章の終わり: その章の区画を順に並べた絵巻を広げ、左から右へゆっくり流す(灯りがともる)
function unroll(run, pages, p) {
  const upTo = run.ticks.filter((t) => t.pages[1] <= p).length;
  const { book: state } = replay(run, pages, upTo);
  const panels = state.emaki.panels.filter(drawable);
  if (!panels.length) return false;
  const img = $('scroll');
  img.style.transition = 'none';
  img.style.transform = 'translateX(0)';
  img.src = svgUrl(scrollSvg(panels, { styled: $('styled').checked }));
  $('unroll-note').textContent = `${book().chapters[pages[p].chapter].title || book().title} · ${panels.length}区画`;
  $('unroll').classList.add('on');
  img.decode().catch(() => {}).then(() => {
    const travel = img.getBoundingClientRect().width - img.parentElement.getBoundingClientRect().width;
    if (travel <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) { img.parentElement.style.overflowX = 'auto'; return; }
    requestAnimationFrame(() => { img.style.transition = `transform ${2.2 * panels.length}s linear .6s`; img.style.transform = `translateX(${-travel}px)`; });
  });
  $('close').focus();
  return true;
}

function closeUnroll() {
  $('unroll').classList.remove('on');
  const run = current();
  const [, z] = range(run);
  if (page < z) page += 1;
  show();
}

function turn() {
  if ($('unroll').classList.contains('on')) { closeUnroll(); return; }
  const run = current();
  const pages = pagesOf(run);
  if (pages[page].end && unroll(run, pages, page)) return;
  page += 1;
  show();
}

// 全部を並べる: 版ごとに、章の絵巻と、回ごとの区画・読み取り・止めたもの
function all() {
  const b = book();
  const sections = runs.filter((r) => r.run.book === b.id).map(({ run }) => {
    const pages = pagesOf(run);
    const { logs } = replay(run, pages);
    const m = measure(run, logs, b, pages);
    const section = document.createElement('section');
    const h = document.createElement('h2'), sub = document.createElement('p');
    h.textContent = label(run);
    sub.className = 'sub';
    sub.textContent = `区画 ${m.panels}・描き足し ${m.adds}・語句 ${m.grounded == null ? '—' : Math.round(m.grounded * 100) + '%'}・門で止めた先の語句 ${m.later.length}・場面の変わり目 ${m.scenes == null ? '—' : `${Math.round(m.scenes * 100)}%(${m.scored}回)`}・1回 ${sec(m.medianMs)}(最長 ${sec(m.maxMs)})・費用 ${money(m.cost)}(1,000字あたり ${money(m.perThousand)})・判定役 ${m.judged == null ? '—' : `ネタバレ ${m.spoilers.length}回`}`;
    section.append(h, sub);
    const chapters = [...new Set(run.ticks.map((t) => t.chapter))];
    for (const c of chapters) {
      const upTo = run.ticks.findLastIndex((t) => t.chapter === c) + 1;
      const panels = replay(run, pages, upTo).book.emaki.panels.filter(drawable);
      if (!panels.length) continue;
      const wrap = document.createElement('div'), img = document.createElement('img');
      wrap.className = 'scroll';
      img.src = svgUrl(scrollSvg(panels, { styled: $('styled').checked }));
      img.alt = '';
      wrap.append(img);
      section.append(wrap);
    }
    const table = document.createElement('table');
    for (const log of logs) {
      const tick = run.ticks[log.tick];
      const tr = document.createElement('tr');
      const meta = document.createElement('td'), body = document.createElement('td'), pic = document.createElement('td');
      meta.className = 'meta';
      meta.textContent = `${log.tick + 1}回目 ${tick.pages[0] + 1}〜${tick.pages[1] + 1}ページ ${sec(callsOf(tick).reduce((n, c) => n + (c.ms ?? 0), 0) || null)} ${money(callsOf(tick).map(cost).every((c) => c != null) ? callsOf(tick).map(cost).reduce((n, c) => n + c, 0) : null)}`;
      const ul = document.createElement('ul');
      for (const e of tick.reader?.data?.events ?? []) ul.append(li(e.text));
      for (const d of log.read.draws) ul.append(li(`${d.mode === 'new' ? '新しい区画' : '描き足し'}: ${d.ids.length}つ`));
      for (const d of log.read.dropped.filter((x) => x.why === 'quote')) { const w = whereIs(d.quote, pages, tick.pages[1]); ul.append(li(`止めた: ${d.kind} ${d.what}「${d.quote}」${w === 'later' ? '(先)' : ''}`, w === 'later' ? 'warn' : '')); }
      for (const v of (run.judge?.data?.ticks ?? []).filter((x) => x.tick === log.tick && x.spoiler)) for (const f of v.found) ul.append(li(`⚠ 判定役: ${f.what} — ${f.why}`, 'warn'));
      body.append(ul);
      // この回に描いた区画(新しい区画も、描き足した区画も)
      const state = replay(run, pages, log.tick + 1).book;
      pic.className = 'pics';
      for (const d of log.read.draws) {
        const panel = state.emaki.panels.find((x) => x.id === d.panel);
        if (!drawable(panel)) continue;
        const img = document.createElement('img');
        img.src = svgUrl(panelSvg(panel, { styled: $('styled').checked }));
        img.alt = '';
        pic.append(img);
      }
      tr.append(meta, body, pic);
      table.append(tr);
    }
    section.append(table);
    return section;
  });
  $('all').replaceChildren(...sections);
}

$('book').addEventListener('change', () => { versions(); page = current()?.settings.start ?? 0; shown = ''; document.body.classList.contains('all-view') ? all() : show(); });
$('run').addEventListener('change', () => { page = current().settings.start; shown = ''; show(); });
$('turn').addEventListener('click', turn);
$('back').addEventListener('click', () => { page -= 1; show(); });
$('reset').addEventListener('click', () => { page = current().settings.start; show(); });
$('page').addEventListener('input', () => { page = +$('page').value; show(); });
for (const id of ['sketch', 'styled']) $(id).addEventListener('change', () => { shown = ''; document.body.classList.contains('all-view') ? all() : show(); });
$('size').addEventListener('change', show);
$('close').addEventListener('click', closeUnroll);
$('theme').addEventListener('click', () => { const dark = document.body.classList.toggle('dark'); $('theme').setAttribute('aria-pressed', String(dark)); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('select, input, button') || document.body.classList.contains('all-view')) return;
  if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); turn(); }
  else if (e.key === 'ArrowLeft' && !$('unroll').classList.contains('on')) { e.preventDefault(); page -= 1; show(); }
  else if (e.key === 'Escape' && $('unroll').classList.contains('on')) closeUnroll();
});

versions();
page = +(params.get('page') ?? 0) - 1;
if (!(page >= 0)) page = current()?.settings.start ?? 0;
if (params.get('view') === 'all') {
  document.body.classList.add('all-view');
  $('view-link').textContent = '1ページずつ見る';
  $('view-link').href = `?book=${$('book').value}`;
  all();
} else show();
