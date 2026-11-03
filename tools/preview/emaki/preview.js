import { paginate, replay, timeline, stageAt, placement, pointAt, routeOf, tint, groundSvg, thingSvg, panelSvg, scrollSvg, drawable, whereIs, TIMES, WEATHERS, MOODS, ACTS } from './emaki.js';
import { svgUrl, edgeSvg, VIEW } from '../scene/scene.js';
import { cost, callsOf, label, measure } from './measure.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const get = (url) => fetch(url, { cache: 'no-store' }).then((r) => r.json());
const [{ books }, { files }] = await Promise.all([get('./books.json'), get('./runs/index.json')]);
const runs = await Promise.all(files.filter((f) => f !== 'unknown.json').map((file) => get(`./runs/${file}`).then((run) => ({ file, run }))));
const shelf = books.filter((b) => runs.some((r) => r.run.book === b.id));
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let page = 0;
let playing = null; // 演じている途中の場面(めくり直したら止めて、終わりの様子に置く)

for (const b of shelf) $('book').append(new Option(`${b.title}(${b.author})`, b.id));
if (shelf.some((b) => b.id === params.get('book'))) $('book').value = params.get('book');
$('styled').checked = params.get('styled') !== '0';
for (const id of ['size', 'pace']) if ([...$(id).options].some((o) => o.value === params.get(id))) $(id).value = params.get(id);
if (params.get('theme') === 'dark') document.body.classList.add('dark');
$('edge').src = svgUrl(edgeSvg());

const book = () => books.find((b) => b.id === $('book').value);
const current = () => runs.find((r) => r.file === $('run').value)?.run;
const pagesOf = (run) => paginate(books.find((b) => b.id === run.book), run.settings.pageSize);
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
const sceneLine = (p) => `場所: ${p.place.name || '分からない'} / ${TIMES[p.time]} / ${WEATHERS[p.weather]} / ${MOODS[p.mood]}`;

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

// ページ p を開いたときに封を開けた回の数(回の答えは、その回の最後のページをめくった瞬間に開く)
const opened = (run, p) => run.ticks.filter((t) => t.pages[1] < p).length;

function prose(pages, p) {
  const pg = pages[p];
  const b = book();
  const prev = pages[p - 1];
  $('chapter').textContent = b.chapters[pg.chapter].title || b.title;
  $('title').textContent = p === 0 || prev?.chapter !== pg.chapter ? (b.chapters[pg.chapter].title || b.title) : '';
  $('title').hidden = !$('title').textContent;
  const cont = prev && prev.chapter === pg.chapter && prev.paras.at(-1) === pg.paras[0];
  $('prose').replaceChildren(...pg.text.split('\n').map((t, i) => { const el = document.createElement('p'); el.textContent = t; if (i === 0 && cont) el.className = 'cont'; return el; }));
  $('source').textContent = `${b.author}「${b.title}」(青空文庫)より`;
  const [a, z] = range(current());
  $('folio').textContent = `${p + 1}ページ(${p - a + 1} / ${z - a + 1})`;
}

// ---- 余白: 320×240 の舞台を余白の大きさに縮めて置く。区画を横に並べた帯を流し、区画の中は地・物ごとの層・色を重ねる層。いちばん上に縁の紙 ----

let built = { key: '', panels: new Map() };

function panelNode(panel, index) {
  const styled = $('styled').checked;
  const el = Object.assign(document.createElement('div'), { className: 'panel' });
  el.style.left = `${index * VIEW.width}px`;
  el.append(Object.assign(document.createElement('img'), { src: svgUrl(groundSvg(panel, { styled })), alt: '' }));
  const shade = Object.assign(document.createElement('div'), { className: 'tint' });
  el.append(shade);
  const node = { el, things: new Map(), shade, panel };
  addThings(node);
  return node;
}

// 物の層を足す。描き足した物(あとから形が来た物)は色の層の下に足し、描き直した物は画像を替える
function addThings(node) {
  const styled = $('styled').checked;
  for (const t of node.panel.things) {
    if (!t.shapes) continue;
    const had = node.things.get(t.id);
    if (had) had.thing = t;
    if (had?.drawn === t.drawn) continue;
    const img = (lit) => Object.assign(document.createElement('img'), { src: svgUrl(thingSvg(t, { lit, styled })), alt: '' });
    if (had) { had.lit.src = img(true).src; if (had.dark) had.dark.src = img(false).src; had.drawn = t.drawn; continue; }
    // 物は動かす枠(mover)に入れ、揺らぎは中の画像に付ける。灯りのある物は、灯っていない姿と灯った姿を重ねて入れ替える
    const mover = Object.assign(document.createElement('div'), { className: 'mover' });
    if (t.at) mover.style.transformOrigin = `${t.at.x}px ${t.at.y}px`;
    const dark = t.shapes.light.length ? img(false) : null, lit = img(true);
    for (const i of [dark, lit].filter(Boolean)) { if (t.at) i.style.transformOrigin = `${t.at.x}px ${t.at.y}px`; mover.append(i); }
    node.el.insertBefore(mover, node.shade);
    node.things.set(t.id, { mover, lit, dark, thing: t, drawn: t.drawn });
  }
  // 重なりは区画の物の順(描く係が決めた奥行きの順)。描き足した物も、その順の所へ入れる
  for (const t of node.panel.things) { const item = node.things.get(t.id); if (item) node.el.insertBefore(item.mover, node.shade); }
}

// 区画の DOM を用意する(state に出てくる区画すべて)
function ensure(state, bookState) {
  const key = `${$('run').value}|${bookState.emaki.chapter}|${$('styled').checked}`;
  if (built.key !== key) { $('strip').replaceChildren(); built = { key, panels: new Map() }; }
  state.panels.forEach((shown, i) => {
    const panel = bookState.emaki.panels.find((p) => p.id === shown.id);
    const had = built.panels.get(shown.id);
    if (had) { had.panel = panel; addThings(had); return; }
    const node = panelNode(panel, i);
    built.panels.set(shown.id, node);
    $('strip').append(node.el);
  });
  for (const [id, node] of built.panels) if (!state.panels.some((p) => p.id === id)) { node.el.remove(); built.panels.delete(id); }
}

const moveOf = (panel, t, pos) => { const { dx, dy, scale } = placement(panel, t, pos); return `translate(${dx}px, ${dy}px) scale(${scale})`; };
const indexOf = (state, id) => Math.max(0, state.panels.findIndex((p) => p.id === id));

// 区画1つの物と色を、その様子のとおりに置く
function put(node, shown) {
  for (const [id, { mover, lit, dark, thing }] of node.things) {
    const s = shown.things[id];
    mover.style.transform = s ? moveOf(node.panel, thing, s.pos) : '';
    const visible = !!s && s.shown;
    mover.style.opacity = visible ? 1 : 0;
    lit.style.opacity = !dark || s?.lit ? 1 : 0;
    if (dark) dark.style.opacity = s?.lit ? 0 : 1;
  }
  const shade = tint(node.panel, shown.time);
  node.shade.style.backgroundColor = shade?.color ?? 'transparent';
  node.shade.style.opacity = shade?.opacity ?? 0;
}

// 様子を、動かさずにそのまま置く
function place(state) {
  for (const anim of document.getAnimations().filter((a) => a.effect?.target?.closest?.('#card'))) anim.cancel();
  state.panels.forEach((shown) => {
    const node = built.panels.get(shown.id);
    if (node) put(node, shown);
  });
  $('strip').style.transform = `translateX(${-indexOf(state, state.current) * VIEW.width}px)`;
  $('card').style.opacity = state.panels.length ? 1 : 0;
}

// 道に沿った動きのキーフレーム。道が無ければまっすぐ。fx が bob なら揺れながら、spin なら回りながら
function path(panel, t, from, to, fx, dur) {
  const route = routeOf(panel, from, to);
  const a = panel.spots.find((s) => s.name === from), b = panel.spots.find((s) => s.name === to);
  const steps = 16;
  const points = [];
  if (route) {
    const el = $('measure');
    el.setAttribute('d', route.d);
    const length = el.getTotalLength();
    for (let i = 0; i <= steps; i += 1) { const pt = el.getPointAtLength(length * (route.reverse ? 1 - i / steps : i / steps)); points.push([pt.x, pt.y]); }
  } else {
    const [x0, y0] = a ? [a.x, a.y] : [t.at.x, t.at.y], [x1, y1] = [b.x, b.y];
    for (let i = 0; i <= steps; i += 1) points.push([x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]);
  }
  const s0 = a?.scale ?? panel.spots.find((s) => s.name === t.spot)?.scale ?? 1, s1 = b.scale;
  const turns = Math.max(1, Math.round(dur / 700));
  return points.map(([x, y], i) => {
    const k = i / steps;
    const { dx, dy, scale } = pointAt(panel, t, x, y, s0 + (s1 - s0) * k);
    const bob = fx === 'bob' && i % 2 && i < steps ? -1.6 : 0;
    const spin = fx === 'spin' ? ` rotate(${Math.round(360 * turns * k)}deg)` : '';
    return { transform: `translate(${dx}px, ${dy + bob}px) scale(${scale})${spin}`, offset: k };
  });
}

// 演じている間だけの揺らぎ(終わると止まる)
const LOOPS = {
  sway: { period: 1600, frames: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-1.6deg)' }, { transform: 'rotate(1.4deg)' }, { transform: 'rotate(0deg)' }] },
  bob: { period: 1400, frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(-1.8px)' }, { transform: 'translateY(1.2px)' }, { transform: 'translateY(0)' }] },
  flicker: { period: 700, frames: [{ opacity: 1 }, { opacity: .72 }, { opacity: 1 }, { opacity: .86 }, { opacity: 1 }] },
  drift: { period: 2400, frames: [{ transform: 'translate(0, 0)' }, { transform: 'translate(3px, -1.5px)' }, { transform: 'translate(0, 0)' }] },
};

/**
 * めくった瞬間に、いま読み終えたページの場面を演じる。before から始め、cues を時刻どおりに動かし、終わったら after に置く。
 * 返すのは演じる長さ(ms)
 */
function play(bookState, before, after, cues) {
  ensure(after, bookState);
  place(before);
  // この場面で現れる区画は、動き出すまで、現れたときの様子(最初に居る所・見えるか・灯り)で待たせる
  for (const shown of after.panels) {
    if (before.panels.some((p) => p.id === shown.id)) continue;
    const node = built.panels.get(shown.id);
    if (node) put(node, { time: node.panel.time0, things: stageInit(node.panel) });
  }
  if (!cues.length || calm()) { place(after); return 0; }
  const end = Math.max(...cues.map((c) => c.start + c.dur));
  const state = structuredClone(before);
  // 始まる前は before の様子のまま(fill は forwards だけ。同じ物を二度動かすとき、後の動きが前を上書きしないように)
  const anim = (el, frames, c) => el.animate(frames, { delay: c.start, duration: c.dur, easing: 'ease-in-out', fill: 'forwards' });
  for (const c of cues) {
    if (c.kind === 'panel') {
      const fromIndex = indexOf(state, state.current), toIndex = after.panels.findIndex((p) => p.id === c.panel);
      if (!state.panels.length) anim($('card'), [{ opacity: 0 }, { opacity: 1 }], c);
      else anim($('strip'), [{ transform: `translateX(${-fromIndex * VIEW.width}px)` }, { transform: `translateX(${-toIndex * VIEW.width}px)` }], c);
      const panel = bookState.emaki.panels.find((p) => p.id === c.panel);
      state.panels.push({ id: c.panel, time: panel.time0, things: stageInit(panel) });
      state.current = c.panel;
      continue;
    }
    const node = built.panels.get(c.panel);
    const shown = state.panels.find((p) => p.id === c.panel);
    if (!node || !shown) continue;
    if (c.kind === 'time') {
      const from = tint(node.panel, shown.time), to = tint(node.panel, c.to);
      anim(node.shade, [{ backgroundColor: from?.color ?? to?.color ?? 'transparent', opacity: from?.opacity ?? 0 }, { backgroundColor: to?.color ?? 'transparent', opacity: to?.opacity ?? 0 }], c);
      shown.time = c.to;
      continue;
    }
    const item = node.things.get(c.id);
    if (!item) continue;
    const s = shown.things[c.id] ?? (shown.things[c.id] = { pos: item.thing.pos0, shown: false, lit: item.thing.lit0 });
    if (c.kind === 'appear' || c.act === 'appear') {
      anim(item.mover, [{ opacity: 0, transform: `${moveOf(node.panel, item.thing, s.pos)} translateY(6px)` }, { opacity: 1, transform: moveOf(node.panel, item.thing, s.pos) }], c);
      s.shown = true;
    } else if (c.act === 'move' || (c.act === 'leave' && c.to)) {
      const frames = path(node.panel, item.thing, s.pos ?? item.thing.spot, c.to, c.fx, c.dur);
      if (c.act === 'leave') frames.forEach((f) => { f.opacity = f.offset < .6 ? 1 : 1 - (f.offset - .6) / .4; });
      anim(item.mover, frames, c);
      Object.assign(s, { pos: c.to, shown: c.act === 'move' });
    } else if (c.act === 'leave') {
      anim(item.mover, [{ opacity: 1 }, { opacity: 0 }], c);
      s.shown = false;
    } else if (c.act === 'light' || c.act === 'dark') {
      const on = c.act === 'light';
      anim(item.lit, [{ opacity: on ? 0 : 1 }, { opacity: on ? 1 : 0 }], c);
      if (item.dark) anim(item.dark, [{ opacity: on ? 1 : 0 }, { opacity: on ? 0 : 1 }], c);
      s.lit = on;
    }
  }
  // 揺らぎ: 演じている間、見えている区画の物を揺らす
  for (const shown of after.panels) {
    const node = built.panels.get(shown.id);
    for (const [, item] of node?.things ?? []) {
      const loop = LOOPS[item.thing.loop];
      if (!loop) continue;
      for (const img of [item.lit, item.dark].filter(Boolean)) img.animate(loop.frames, { duration: loop.period, iterations: Math.max(1, Math.round(end / loop.period)), easing: 'ease-in-out' });
    }
  }
  playing = setTimeout(() => { playing = null; place(after); }, end + 60);
  return end;
}

// 区画が現れたときの物の様子(区画の cue で使う)
function stageInit(panel) {
  return Object.fromEntries(panel.things.filter((t) => !t.late).map((t) => [t.id, { pos: t.pos0, shown: t.shown0, lit: t.lit0 }]));
}

// ページ p を開いたときの余白。めくってきたなら、いま読み終えたページの場面を演じる。飛んできたら(戻る・ページの指定)動かさずに置く
function margin(run, pages, p, { turned }) {
  if (playing) { clearTimeout(playing); playing = null; }
  $('stage').style.transform = `scale(${+$('size').value / VIEW.width})`;
  document.documentElement.style.setProperty('--card', `${$('size').value}px`);
  const { book: bookState, logs } = replay(run, pages, opened(run, p));
  const cues = timeline(run, pages, logs);
  const chapter = pages[p].chapter;
  const after = stageAt(bookState, cues, p, chapter);
  const now = cues.filter((c) => c.turn === p && c.chapter === chapter);
  if (turned) play(bookState, stageAt(bookState, cues, p - 1, chapter), after, now);
  else { ensure(after, bookState); place(after); }
  return { bookState, logs, cues: now, final: after };
}

function facts(run, pages, p, { bookState, logs, cues, final }) {
  const k = opened(run, p);
  const brief = run.brief?.data;
  const rows = [['版', label(run)], ['下調べ', !run.brief ? 'なし(書名を渡していない)' : brief?.known === 'yes' ? brief.work : '知らない本(読んだ所だけで進める)']];
  const tick = k > 0 && run.ticks[k - 1].pages[1] === p - 1 ? run.ticks[k - 1] : null;
  if (tick) {
    const calls = callsOf(tick).filter((c) => c !== tick.summary);
    const ms = calls.reduce((n, c) => n + (c.ms ?? 0), 0);
    const late = calls.every((c) => c.ms != null) && ms > +$('pace').value;
    rows.push(['封を開けた答え', `${tick.pages[0] + 1}${tick.pages[1] > tick.pages[0] ? `〜${tick.pages[1] + 1}` : ''}ページ・読み取り ${model(tick.reader)} ${sec(tick.reader?.ms)} ${money(cost(tick.reader))}${tick.reader?.data ? '' : ` × ${tick.reader?.error ?? tick.reader?.stop_reason}`}`]);
    logs[k - 1].read.draws.forEach((d, i) => {
      const r = tick.drawers?.[i];
      rows.push(['', `描く(${d.mode === 'new' ? '新しい区画' : '描き足し'}・${d.ids.length}つ)・${model(r)} ${sec(r?.ms)} ${money(cost(r))}${r?.data ? '' : ' × 来ていない'}`]);
    });
    if (tick.summary) rows.push(['', `章のまとめ・${model(tick.summary)} ${sec(tick.summary.ms)} ${money(cost(tick.summary))}`]);
    if (late) rows.push(['', `⚠ 間に合わない(用意に ${sec(ms)}。1ページ ${sec(+$('pace').value)} で読むと、次のめくりまで待つ)`]);
  } else rows.push(['封を開けた答え', '—']);
  const spent = [run.brief, ...run.ticks.slice(0, k).flatMap(callsOf)].filter(Boolean).map(cost);
  rows.push(['ここまで', spent.some((c) => c == null) ? '$—(見本)' : `$${spent.reduce((n, c) => n + c, 0).toFixed(3)}(${k}回)`]);
  rows.push(['この章の区画', String(final.panels.length)]);
  $('facts').replaceChildren(...rows.flatMap(([a, b]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = a; dd.textContent = b; return [dt, dd]; }));

  const story = bookState.story;
  const items = [];
  if (story.seed) items.push(li(`読み始める前(下調べから・語句なし): ${story.seed}`));
  story.chapters.forEach((c, i) => items.push(li(`前の章 ${i + 1}: ${c.summary}`)));
  for (const e of story.events) items.push(li(`○ ${e.text}`, e.tick === k - 1 && tick ? 'new' : '', e.quote));
  $('story').replaceChildren(...(items.length ? items : [li('まだ無い')]));

  const panelOf = (cue) => bookState.emaki.panels.find((x) => x.id === cue.panel);
  const nameOf = (cue) => panelOf(cue)?.things.find((t) => t.id === cue.id)?.name ?? cue.id;
  const said = (cue) => (cue.kind === 'panel' ? `区画が現れる: ${panelOf(cue)?.place.name || '(場所の名前なし)'}`
    : cue.kind === 'appear' ? `${nameOf(cue)}が現れる`
    : cue.kind === 'time' ? `時が移る: ${TIMES[cue.to]}`
    : `${nameOf(cue)}: ${ACTS[cue.act]}${cue.to ? ` → ${cue.to}` : ''}${cue.speed && cue.act !== 'light' && cue.act !== 'dark' ? `(${{ slow: 'ゆっくり', mid: '', fast: '速く' }[cue.speed]}${cue.fx === 'bob' ? '・揺れながら' : cue.fx === 'spin' ? '・回りながら' : ''})`.replace('()', '') : ''}`);
  $('cues').replaceChildren(...(cues.length ? cues.map((c) => li(`${(c.start / 1000).toFixed(1)}秒 ${said(c)}`, '', c.quote)) : [li('無い(止まっている)')]));

  const shown = final.panels.find((x) => x.id === final.current);
  const panel = shown && bookState.emaki.panels.find((x) => x.id === shown.id);
  const things = panel ? [li(sceneLine(panel)), ...panel.things.filter((t) => shown.things[t.id]).map((t) => {
    const s = shown.things[t.id];
    const where = [t.depth != null ? `奥行き ${t.depth}` : '', s.pos ? `所: ${s.pos}` : '', s.shown ? '' : '見えない', t.shapes?.light.length ? (s.lit ? '灯っている' : '灯っていない') : '', t.loop && t.loop !== 'none' ? { sway: '揺れる', bob: '浮き沈み', flicker: 'ゆらぐ', drift: 'ただよう' }[t.loop] : ''].filter(Boolean).join('・');
    return li(`${t.main ? '★' : '・'}${t.name}${where ? `[${where}]` : ''} — ${t.look}`, '', t.quote);
  })] : [li('まだ無い(この章の最初のページを読み終えるのを待っている)')];
  $('things').replaceChildren(...things);

  const dropped = logs.flatMap((log) => log.read.dropped.filter((d) => d.why === 'quote').map((d) => ({ ...d, tick: log.tick, where: whereIs(d.quote, pages, run.ticks[log.tick].pages[1]) }))).reverse();
  const where = { later: '先(それより後のページにだけ有る)', before: '前のページに有る', none: '本文に無い' };
  $('dropped').replaceChildren(...(dropped.length ? dropped.map((d) => li(`${run.ticks[d.tick].pages[1] + 1}ページ ${d.kind} ${d.what}「${d.quote}」→ ${where[d.where]}`, d.where === 'later' ? 'warn' : '')) : [li('無い')]));

  const verdicts = run.judge?.data?.ticks ?? null;
  if (!verdicts) $('judge').replaceChildren(li(run.judge ? `× ${run.judge.error ?? run.judge.stop_reason}` : '判定していない(見本・判定役なし)'));
  else {
    const flagged = verdicts.filter((v) => v.tick < k && v.spoiler);
    $('judge').replaceChildren(...(flagged.length ? flagged.flatMap((v) => v.found.map((f) => li(`⚠ ${v.tick + 1}回目: ${f.what} — ${f.why}`, 'warn'))) : [li(`○ ネタバレの疑いなし(${k}回目まで)`)]));
  }
}

function show({ turned = false } = {}) {
  const run = current();
  if (!run) return;
  const pages = pagesOf(run);
  const [a, z] = range(run);
  page = Math.max(a, Math.min(z, page));
  $('page').min = a; $('page').max = z; $('page').value = page;
  $('page-out').value = String(page + 1);
  $('turn').textContent = pages[page].end ? 'めくる(章の終わり)' : 'めくる';
  prose(pages, page);
  facts(run, pages, page, margin(run, pages, page, { turned }));
}

// 章の終わり: 最後のページの場面を余白で演じてから、その章の区画を順に並べた絵巻を広げ、左から右へゆっくり流す(灯りがともる)
function unroll(run, pages, p) {
  const upTo = run.ticks.filter((t) => t.pages[1] <= p).length;
  const { book: state, logs } = replay(run, pages, upTo);
  const panels = state.emaki.panels.filter(drawable);
  if (!panels.length) return false;
  const cues = timeline(run, pages, logs);
  const chapter = pages[p].chapter;
  const wait = play(state, stageAt(state, cues, p, chapter), stageAt(state, cues, p + 1, chapter), cues.filter((c) => c.turn === p + 1 && c.chapter === chapter));
  setTimeout(() => {
    const img = $('scroll');
    img.style.transition = 'none';
    img.style.transform = 'translateX(0)';
    img.src = svgUrl(scrollSvg(panels, { styled: $('styled').checked }));
    $('unroll-note').textContent = `${book().chapters[chapter].title || book().title} · ${panels.length}区画`;
    $('unroll').classList.add('on');
    img.decode().catch(() => {}).then(() => {
      const travel = img.getBoundingClientRect().width - img.parentElement.getBoundingClientRect().width;
      if (travel <= 0 || calm()) { img.parentElement.style.overflowX = 'auto'; return; }
      requestAnimationFrame(() => { img.style.transition = `transform ${2.2 * panels.length}s linear .6s`; img.style.transform = `translateX(${-travel}px)`; });
    });
    $('close').focus();
  }, wait ? wait + 500 : 0);
  return true;
}

function closeUnroll() {
  $('unroll').classList.remove('on');
  if (page < range(current())[1]) page += 1;
  show(); // 次の章の最初のページ。前の章の最後の場面は、もう演じた
}

function turn() {
  if ($('unroll').classList.contains('on')) { closeUnroll(); return; }
  const run = current();
  const pages = pagesOf(run);
  if (pages[page].end && unroll(run, pages, page)) return;
  if (page >= range(run)[1]) return;
  page += 1;
  show({ turned: true });
}

// 全部を並べる: 版ごとに、章の絵巻と、ページごとの区画・動き・止めたもの
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
    sub.textContent = `区画 ${m.panels}・描き足し ${m.adds}・動き ${m.cues}・語句 ${m.grounded == null ? '—' : Math.round(m.grounded * 100) + '%'}・門で止めた先の語句 ${m.later.length}・場面の変わり目 ${m.scenes == null ? '—' : `${Math.round(m.scenes * 100)}%(${m.scored}回)`}・1回 ${sec(m.medianMs)}(最長 ${sec(m.maxMs)})・費用 ${money(m.cost)}(1,000字あたり ${money(m.perThousand)})・判定役 ${m.judged == null ? '—' : `ネタバレ ${m.spoilers.length}回`}`;
    section.append(h, sub);
    for (const c of [...new Set(run.ticks.map((t) => t.chapter))]) {
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
      const costs = callsOf(tick).map(cost);
      meta.textContent = `${tick.pages[0] + 1}${tick.pages[1] > tick.pages[0] ? `〜${tick.pages[1] + 1}` : ''}ページ ${sec(callsOf(tick).reduce((n, c) => n + (c.ms ?? 0), 0) || null)} ${money(costs.every((c) => c != null) ? costs.reduce((n, c) => n + c, 0) : null)}`;
      const ul = document.createElement('ul');
      for (const e of tick.reader?.data?.events ?? []) ul.append(li(e.text));
      for (const d of log.read.draws) ul.append(li(`${d.mode === 'new' ? '新しい区画' : '描き足し'}: ${d.ids.length}つ`));
      const acted = [...log.read.cues, ...log.drawn.flatMap((d) => d?.cues ?? [])].filter((c) => c.kind !== 'panel').length;
      if (acted) ul.append(li(`動き: ${acted}`));
      for (const d of log.read.dropped.filter((x) => x.why === 'quote')) { const w = whereIs(d.quote, pages, tick.pages[1]); ul.append(li(`止めた: ${d.kind} ${d.what}「${d.quote}」${w === 'later' ? '(先)' : ''}`, w === 'later' ? 'warn' : '')); }
      for (const v of (run.judge?.data?.ticks ?? []).filter((x) => x.tick === log.tick && x.spoiler)) for (const f of v.found) ul.append(li(`⚠ 判定役: ${f.what} — ${f.why}`, 'warn'));
      body.append(ul);
      // このページの区画(演じ終えた様子)
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

$('book').addEventListener('change', () => { versions(); page = current()?.settings.start ?? 0; document.body.classList.contains('all-view') ? all() : show(); });
$('run').addEventListener('change', () => { page = current().settings.start; show(); });
$('turn').addEventListener('click', turn);
$('back').addEventListener('click', () => { page -= 1; show(); });
$('reset').addEventListener('click', () => { page = current().settings.start; show(); });
$('page').addEventListener('input', () => { page = +$('page').value; show(); });
$('styled').addEventListener('change', () => (document.body.classList.contains('all-view') ? all() : show()));
for (const id of ['size', 'pace']) $(id).addEventListener('change', () => show());
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
