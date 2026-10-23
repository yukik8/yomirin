import { checkScene, grounded, buildSvg, svgUrl, STAGES, LAST } from './scene.js';
import { cost, label } from './measure.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const WAIT = LAST - 1; // めくりで進むのはここまで。仕上がりは章の終わり
const [{ passages }, { files }] = await Promise.all(['./passages.json', './samples/index.json'].map((url) => fetch(url, { cache: 'no-store' }).then((r) => r.json())));
const records = await Promise.all(files.map((file) => fetch(`./samples/${file}`, { cache: 'no-store' }).then((r) => r.json()).then((record) => ({ file, record, ...checkScene(record.data) }))));
const byScene = (id) => records.filter((r) => r.record.scene === id);

let stage = Math.max(0, Math.min(LAST, +(params.get('stage') ?? 0) || 0));
let front = $('pic-a');

for (const p of passages) $('scene').append(new Option(`${p.title}(${p.label})`, p.id));
if (passages.some((p) => p.id === params.get('scene'))) $('scene').value = params.get('scene');
$('styled').checked = params.get('styled') !== '0';
if ([...$('size').options].some((o) => o.value === params.get('size'))) $('size').value = params.get('size');
if (params.get('theme') === 'dark') document.body.classList.add('dark');

const passage = () => passages.find((p) => p.id === $('scene').value);
const current = () => records.find((r) => r.file === $('version').value);
const fmt = (n, digits) => (n == null ? '—' : n.toFixed(digits));

function versions() {
  const list = byScene($('scene').value);
  $('version').replaceChildren(...list.map((r) => new Option(label(r.record), r.file)));
  if (list.some((r) => r.file === params.get('v'))) $('version').value = params.get('v');
}

function page() {
  const p = passage();
  $('title').textContent = p.title;
  $('prose').replaceChildren(...p.text.split('\n').map((t) => { const el = document.createElement('p'); el.textContent = t; return el; }));
  $('source').textContent = `${p.author}「${p.title}」(青空文庫)より`;
}

function facts(r, paintMs) {
  const rows = [['版', label(r.record)]];
  if (!r.scene) rows.push(['検査', `× ${r.error ?? r.record.error ?? r.record.stop_reason}`]);
  else {
    const g = grounded(r.scene, passage().text);
    rows.push(['検査', r.dropped ? `× ${r.dropped}個落とした` : '通る'], ['形の数', `地 ${r.scene.ground.length}・物 ${r.scene.forms.length}・線 ${r.scene.lines.length}・光 ${r.scene.light.length}`], ['根拠', `${g.found}/${g.total} が本文にそのまま有る`]);
  }
  const usage = r.record.usage;
  rows.push(['時間', r.record.ms == null ? '—(計測なし)' : `${fmt(r.record.ms / 1000, 1)} 秒`], ['トークン', usage ? `入力 ${usage.input_tokens}・出力 ${usage.output_tokens}` : '—'], ['費用', `$${fmt(cost(r.record.served_model ?? r.record.model, usage), 3)}`]);
  if (paintMs != null) rows.push(['描画', `${paintMs.toFixed(0)} ms(この段)`]);
  $('facts').replaceChildren(...rows.flatMap(([k, v]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; return [dt, dd]; }));
  const flat = (s) => s.replace(/\s+/g, '');
  const body = flat(passage().text);
  $('items').replaceChildren(...(r.scene?.items ?? []).map((item) => {
    const li = document.createElement('li'), ok = flat(item.quote).length >= 2 && body.includes(flat(item.quote));
    li.className = ok ? '' : 'no';
    li.textContent = `${ok ? '○' : '×'} ${item.thing}「${item.quote}」`;
    return li;
  }));
}

// 段を替えるときは、裏の img に描いてから入れ替える(0.9秒でふわっと。#34 の置き方と同じ)
async function show() {
  const r = current();
  $('stage').value = stage;
  $('stage-out').value = STAGES[stage];
  $('turn').textContent = stage >= WAIT ? 'めくる(ここで待つ)' : 'めくる';
  document.documentElement.style.setProperty('--card', `${$('size').value}px`);
  if (!r?.scene || stage === 0) { front.classList.remove('on'); r && facts(r, null); return; }
  const back = front === $('pic-a') ? $('pic-b') : $('pic-a');
  const started = performance.now();
  back.src = svgUrl(buildSvg(r.scene, stage, { styled: $('styled').checked }));
  await back.decode().catch(() => {});
  const paintMs = performance.now() - started;
  back.classList.add('on');
  front.classList.remove('on');
  front = back;
  facts(r, paintMs);
}

function grid() {
  const styled = $('styled').checked;
  $('grid').replaceChildren(...passages.map((p) => {
    const section = document.createElement('section');
    const h = document.createElement('h2'), sub = document.createElement('p');
    h.textContent = `${p.title}(${p.label})`;
    sub.className = 'sub';
    sub.textContent = `${p.author}・${p.text.length}字。段は左から ${STAGES.slice(1).join(' → ')}、いちばん右は画風なしの仕上がり`;
    section.append(h, sub);
    for (const r of byScene(p.id)) {
      const row = document.createElement('div');
      row.className = 'row';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('b');
      name.textContent = label(r.record);
      const g = r.scene ? grounded(r.scene, p.text) : null;
      meta.append(name, r.scene ? `${r.dropped ? `× ${r.dropped}個落とした` : '通る'}・根拠 ${g.found}/${g.total}` : `× ${r.error ?? r.record.error ?? r.record.stop_reason}`);
      if (r.record.ms != null) meta.append(document.createElement('br'), `${fmt(r.record.ms / 1000, 1)}秒・$${fmt(cost(r.record.served_model ?? r.record.model, r.record.usage), 3)}`);
      row.append(meta);
      for (let s = 1; s <= LAST + 1; s += 1) {
        const img = document.createElement('img');
        if (r.scene) img.src = svgUrl(buildSvg(r.scene, Math.min(s, LAST), { styled: s <= LAST && styled }));
        img.alt = '';
        row.append(img);
      }
      section.append(row);
    }
    return section;
  }));
}

function turn() { stage = Math.min(WAIT, stage + 1); show(); }
$('scene').addEventListener('change', () => { versions(); page(); stage = 0; show(); });
$('version').addEventListener('change', () => { stage = 0; show(); });
$('turn').addEventListener('click', turn);
$('finish').addEventListener('click', () => { stage = LAST; show(); });
$('reset').addEventListener('click', () => { stage = 0; show(); });
$('stage').addEventListener('input', () => { stage = +$('stage').value; show(); });
$('styled').addEventListener('change', () => (document.body.classList.contains('grid-view') ? grid() : show()));
$('size').addEventListener('change', show);
$('theme').addEventListener('click', () => { const dark = document.body.classList.toggle('dark'); $('theme').setAttribute('aria-pressed', String(dark)); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('select, input, button') || !(e.key === ' ' || e.key === 'ArrowRight')) return;
  e.preventDefault();
  turn();
});

versions();
page();
if (params.get('view') === 'grid') {
  document.body.classList.add('grid-view');
  $('view-link').textContent = '1枚ずつ見る';
  $('view-link').href = '?';
  grid();
} else show();
