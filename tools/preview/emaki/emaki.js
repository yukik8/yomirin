// 章の絵巻(#51 → #34)。読み進めた話を踏まえて場面を読み取り、余白の絵が話とともに育つ。
// 端末の側の決まりをここに集める: いつ何を送るか・返ってきたものの検め方・本ごとに残すもの・絵の組み立て。
// サーバの側(Claude への指示)は run.py。試写室(preview.js)・check.mjs・device.mjs(run.py が呼ぶ)で使う。
// 見込みが立てば extension/src/content/ へ移す。
//
// ネタバレの守り(端末の側):
// - 本に足すのは、今回送った段落にそのまま有る語句を付けたものだけ(found)。下調べで先を知っている読み取り係が「先」を書いても、ここで止まる
// - 描く係に渡すのは、ここまでの話と、語句で確かめた場面と物だけ(drawRequest)。書名と下調べは渡さない
// - 描く係が返した形は、頼んだ物の id のものだけを受け取る(applyDrawing)
import { checkShape, paint, frame, sceneSchema } from '../scene/scene.js';

export const TIMES = { morning: '朝', day: '昼', evening: '夕方', night: '夜', unknown: '分からない' };
export const WEATHERS = { clear: '晴れ', cloudy: '曇り', rain: '雨', snow: '雪', fog: '霧', unknown: '分からない' };
// #42(めくりの演出)と同じ7つ
export const MOODS = { calm: '穏やか', warm: 'あたたかい', sad: 'しんみり', tense: '緊迫', eerie: '不思議・不穏', joyful: 'うれしい', wonder: '発見・驚き', unknown: '分からない' };
export const EMAKI = {
  every: 700, // 読み終えた本文がこれだけたまったら読み取る(字。試写室ではおよそ2ページ)。章の終わりでは足りなくても読み取る
  pageSize: 400, // 試写室の1ページ(字)
  panels: 8, // 1章の区画の上限
  things: 12, // 1区画の物の上限
  events: 4, // 1回の読み取りで足す出来事の上限
  scenes: 2, // 1回の読み取りで当てる場面の上限(2ページの間に場面が二つ過ぎることがある)
  recent: 30, // 送る「この章の出来事」の上限(新しい方から)
  event: 60, quote: 40, look: 40, name: 20, seed: 300, summary: 200, // 字数の上限
  shapes: { forms: 16, lines: 24, light: 8 }, // 1つの物の形の上限
  ground: 16,
  total: 40000, // 1区画の d の長さの合計の上限
};

const flat = (s) => String(s ?? '').replace(/\s+/g, '');
const cut = (s, n) => String(s ?? '').trim().slice(0, n);
const list = (v) => (Array.isArray(v) ? v : []);
const choice = (table, v) => (typeof v === 'string' && Object.hasOwn(table, v) ? v : 'unknown');

/** 語句が本文にそのまま有るか(空白と改行は無視する。2字より短いものは数えない) */
export function found(quote, text) {
  const q = flat(quote);
  return typeof quote === 'string' && q.length >= 2 && flat(text).includes(q);
}

// 文の切れ目(。!? と、続く閉じかっこ)で分ける
const sentences = (p) => p.match(/[^。！？]+(?:[。！？]+[」』）]*|$)|[。！？」』）]+/g) ?? [p];

/**
 * 本を試写室のページに分ける。章の始まりは新しいページ。ページは文の切れ目で size 字までにする(長い段落はページをまたぐ)。
 * from・to は本の始まりからの字数(空白を除く)。end は章の最後のページ。
 */
export function paginate(book, size = EMAKI.pageSize) {
  const pages = [];
  let at = 0;
  book.chapters.forEach((chapter, ci) => {
    let page = null;
    chapter.paras.forEach((para, pi) => {
      for (const s of sentences(para)) {
        if (!page || (page.chars > 0 && page.chars + s.length > size)) {
          page = { index: pages.length, chapter: ci, pieces: [], chars: 0, from: at, to: at, end: false };
          pages.push(page);
        }
        const last = page.pieces.at(-1);
        if (last?.para === pi) last.text += s;
        else page.pieces.push({ para: pi, text: s });
        page.chars += s.length;
        at += flat(s).length;
        page.to = at;
      }
    });
    if (page) page.end = true;
  });
  return pages.map(({ pieces, chars, ...p }) => ({ ...p, paras: pieces.map((x) => x.para), text: pieces.map((x) => x.text).join('\n') }));
}

/**
 * 読み取りの区切り: start ページから読み始め、読み終えた本文が every 字たまるか章の終わりで1回。[[最初のページ, 最後のページ], …]
 * 試写室では、その回の答えは最後のページの次のめくりで見える
 */
export function ticksOf(pages, { start = 0, every = EMAKI.every, chapters = null } = {}) {
  const ticks = [];
  const limit = chapters ?? Infinity; // chapters 章まで(null は最後まで)
  let from = null, chars = 0;
  for (const page of pages.slice(start)) {
    if (page.chapter >= limit) break;
    if (from == null) from = page.index;
    chars += page.to - page.from;
    if (chars >= every || page.end) { ticks.push([from, page.index]); from = null; chars = 0; }
  }
  return ticks;
}

const textOf = (pages, [a, b]) => pages.slice(a, b + 1).map((p) => p.text).join('\n');

// ---- 下調べ(本ごとに一度。書名から。画面に出さず、エクスポートにも入れない) ----

export function briefSchema() {
  return obj({
    known: { type: 'string', enum: ['yes', 'no'], description: 'この本を確かに知っているときだけ yes' },
    work: str('どの本だと思ったか(著者と題)。no なら空'),
    whole: str('始まりから結末までのあらすじ(800字まで)。no なら空'),
    world: str('時代・土地・季節・建物や道具の様子(200字まで)。no なら空'),
  });
}

/** 下調べを検める。知らない本・読めないものは null(読んだ所だけで進める) */
export function checkBrief(data) {
  if (!data || data.known !== 'yes' || typeof data.whole !== 'string' || !data.whole.trim()) return null;
  return { work: cut(data.work, 60), whole: cut(data.whole, 1200), world: cut(data.world, 300) };
}

// ---- 本ごとに端末に残すもの ----

/** story: ここまでの話(seed=途中から読み始めたときの、それより前のあらすじ・chapters=済んだ章のまとめ・events=この章の出来事) */
export function newBook(brief = null) {
  return { brief, story: { seed: '', chapters: [], events: [] }, emaki: { chapter: null, panels: [] }, next: 1 };
}

const storyOf = (book) => ({
  seed: book.story.seed,
  chapters: book.story.chapters.map((c) => c.summary),
  events: book.story.events.slice(-EMAKI.recent).map((e) => e.text),
});
const blank = (book) => !book.story.seed && !book.story.chapters.length && !book.story.events.length;
const current = (book) => book.emaki.panels.at(-1) ?? null;

/** 新しい章に入った。絵巻は新しくする(持ち越さない)。ここまでの話は持ち越す */
export function startChapter(book, chapter) {
  book.emaki = { chapter, panels: [] };
}

// ---- 読み取り(数ページに1回) ----

/** サーバへ送るもの。seed は、ここまでの話が空で下調べがあるときだけ頼む(途中から読み始めた本) */
export function readRequest(book, text) {
  const panel = current(book);
  return {
    brief: book.brief,
    story: storyOf(book),
    scene: panel && { place: panel.place.name, time: panel.time, weather: panel.weather, mood: panel.mood },
    things: panel ? panel.things.map((t) => ({ name: t.name, look: t.look })) : [],
    seed: blank(book) && !!book.brief,
    text,
  };
}

export function readSchema() {
  const quote = str(`<新しく読んだ段落> からそのまま写した語句(${EMAKI.quote}字まで・言い換えない)。写せなければ空`);
  const pick = (table, what) => ({ type: 'string', enum: Object.keys(table), description: `${what}。` + Object.entries(table).map(([k, v]) => `${k}=${v}`).join(' / ') });
  return obj({
    seed: str(`頼まれたときだけ: 本の始まりから <新しく読んだ段落> の直前までのあらすじ(${EMAKI.seed}字まで)。頼まれていない・段落が本の始まりなら空`),
    events: { type: 'array', description: `<新しく読んだ段落> で起きたこと(順に・${EMAKI.events}つまで)`, items: obj({ text: str(`${EMAKI.event}字まで`), quote }) },
    scenes: {
      type: 'array', description: `段落の中の場面を読んだ順に(${EMAKI.scenes}つまで)。段落の最後の場面は必ず入れる`,
      items: obj({
        change: { type: 'string', enum: ['same', 'new'], description: '一つ前の場面(最初は <いまの場面>)の続きなら same。場所が大きく移った・時が大きく飛んだ・夢や回想に入ったら new。<いまの場面> が無ければ new' },
        place: str(`場所(${EMAKI.name}字まで)`), place_quote: quote,
        time: pick(TIMES, '時刻'), time_quote: quote,
        weather: pick(WEATHERS, '天気'), weather_quote: quote,
        mood: pick(MOODS, '雰囲気(いま読んだ所の。この先を先取りしない)'), mood_quote: quote,
        keep: { type: 'array', description: 'new のときだけ: 一つ前の場面の物のうち、この場面にも続けて見える物の名前', items: str('物の名前') },
        things: { type: 'array', description: 'この場面に新しく出てきた、描ける物(人は入れない)', items: obj({ name: str(`${EMAKI.name}字まで`), look: str(`いまどう見えるか(${EMAKI.look}字まで)`), quote, main: { type: 'boolean', description: '場面の主役' } }) },
        changes: { type: 'array', description: 'この場面の物の見た目が変わったとき(灯がともる・積み上がる・壊れる)', items: obj({ name: str('物の名前'), look: str(`${EMAKI.look}字まで`), quote }) },
      }),
    },
  });
}

/**
 * 読み取りの答えを、今回の段落 text と照らし合わせてから本に足す(book を書き換える)。
 * 返すもの: { dropped: [{ kind, what, quote, why }], draws: [{ panel, mode: 'new' | 'add', ids }] }(描く順)
 * why は quote(語句が段落に無い)・limit(上限)・name(知らない物の名前)。
 */
export function applyReading(book, data, text, tick) {
  const dropped = [];
  const drop = (kind, what, quote, why = 'quote') => dropped.push({ kind, what: cut(what, 40), quote: cut(quote, 80), why });
  if (!data || typeof data !== 'object') return { dropped, draws: [], error: 'not_object' };
  const ok = (quote) => found(quote, text);
  if (blank(book) && book.brief && typeof data.seed === 'string') book.story.seed = cut(data.seed, EMAKI.seed);
  for (const [i, e] of list(data.events).entries()) {
    if (i >= EMAKI.events) drop('event', e?.text, e?.quote, 'limit');
    else if (typeof e?.text === 'string' && e.text.trim() && ok(e.quote)) book.story.events.push({ text: cut(e.text, EMAKI.event), quote: cut(e.quote, EMAKI.quote), tick });
    else drop('event', e?.text, e?.quote);
  }
  const draws = [];
  for (const [i, s] of list(data.scenes).entries()) {
    if (i >= EMAKI.scenes) { drop('scene', s?.place, s?.place_quote, 'limit'); continue; }
    scene(book, s && typeof s === 'object' ? s : {}, { ok, drop, draws, tick });
  }
  return { dropped, draws };
}

// 場面を1つ当てる。時刻・天気・雰囲気・場所・物は、語句が確かめられたものだけ
function scene(book, s, { ok, drop, draws, tick }) {
  const attr = (table, key) => {
    const v = choice(table, s[key]);
    if (v === 'unknown' || ok(s[`${key}_quote`])) return v;
    drop(key, v, s[`${key}_quote`]);
    return 'unknown';
  };
  const time = attr(TIMES, 'time'), weather = attr(WEATHERS, 'weather'), mood = attr(MOODS, 'mood');
  const named = typeof s.place === 'string' && s.place.trim();
  const place = named && ok(s.place_quote) ? { name: cut(s.place, EMAKI.name), quote: cut(s.place_quote, EMAKI.quote) } : { name: '', quote: '' };
  if (named && !place.name) drop('place', s.place, s.place_quote);

  const before = current(book);
  const fresh = !before || (s.change === 'new' && (place.name || time !== 'unknown') && book.emaki.panels.length < EMAKI.panels);
  let panel = before;
  if (fresh) {
    panel = { id: `p${book.next++}`, tick, place, time, weather, mood, ground: [], things: [] };
    // 前の場面から続けて見える物(語句は前に確かめてある)
    for (const name of list(s.keep)) {
      const t = before?.things.find((x) => x.name === name);
      if (!t) drop('keep', name, '', 'name');
      else if (panel.things.length >= EMAKI.things) drop('keep', name, '', 'limit');
      else panel.things.push({ ...t, id: `t${book.next++}`, tick, shapes: null, drawn: null });
    }
  } else {
    // 同じ場面の続き: 分からなかったものだけ埋める
    for (const [k, v] of Object.entries({ time, weather, mood })) if (panel[k] === 'unknown') panel[k] = v;
    if (!panel.place.name) panel.place = place;
  }

  const ids = [];
  for (const c of list(s.changes)) {
    const target = panel.things.find((t) => t.name === c?.name);
    if (!target) drop('change', c?.name, c?.quote, 'name');
    else if (!ok(c.quote)) drop('change', target.name, c.quote);
    else { target.look = cut(c.look, EMAKI.look); target.changed = tick; ids.push(target.id); }
  }
  for (const t of list(s.things)) {
    const name = typeof t?.name === 'string' ? cut(t.name, EMAKI.name) : '';
    if (!name || !ok(t.quote)) { drop('thing', t?.name, t?.quote); continue; }
    if (panel.things.some((x) => x.name === name)) continue; // もう有る
    if (panel.things.length >= EMAKI.things) { drop('thing', name, t.quote, 'limit'); continue; }
    const thing = { id: `t${book.next++}`, name, look: cut(t.look, EMAKI.look), quote: cut(t.quote, EMAKI.quote), main: t.main === true, tick, shapes: null, drawn: null };
    panel.things.push(thing);
    ids.push(thing.id);
  }

  if (fresh) {
    if (!panel.things.length && !panel.place.name) return; // 描くものが無い
    book.emaki.panels.push(panel);
    draws.push({ panel: panel.id, mode: 'new', ids: panel.things.map((t) => t.id) });
    return;
  }
  if (!ids.length) return;
  // この回に描く区画なら、そこへまとめる
  const same = draws.find((d) => d.panel === panel.id);
  if (same) same.ids.push(...ids.filter((id) => !same.ids.includes(id)));
  else draws.push({ panel: panel.id, mode: 'add', ids: [...new Set(ids)] });
}

// ---- 描く(新しい場面か、描き足す物があるときだけ) ----

/** 描く係へ送るもの。書名と下調べは入れない(描く係が知っているのは、ここまでの話と、語句で確かめた場面と物だけ) */
export function drawRequest(book, draw) {
  const panel = book.emaki.panels.find((p) => p.id === draw.panel);
  return {
    mode: draw.mode,
    story: storyOf(book),
    scene: { place: panel.place.name, time: panel.time, weather: panel.weather, mood: panel.mood },
    things: panel.things.map((t) => ({ id: t.id, name: t.name, look: t.look, main: t.main, draw: draw.ids.includes(t.id) })),
    current: draw.mode === 'add' ? { ground: panel.ground, things: panel.things.filter((t) => t.shapes).map((t) => ({ id: t.id, ...t.shapes })) } : null,
  };
}

export function drawSchema() {
  const { ground, forms, lines, light } = sceneSchema().properties;
  return obj({
    ground: { type: 'array', description: `地。空・地面・壁・水面など、奥の大きな面(${EMAKI.ground}まで)。mode が add なら空`, items: ground.items },
    things: {
      type: 'array', description: '物ごとの形。id は <物> の一覧の id',
      items: obj({
        id: str('<物> の id'),
        forms: { type: 'array', description: `物の面(${EMAKI.shapes.forms}まで)`, items: forms.items },
        lines: { type: 'array', description: `色鉛筆の線。輪郭は必ず描く(${EMAKI.shapes.lines}まで)`, items: lines.items },
        light: { type: 'array', description: `光るものそのものの形。章の終わりに灯る(${EMAKI.shapes.light}まで)`, items: light.items },
      }),
    },
  });
}

/**
 * 描く係の答えを区画に当てる(book を書き換える)。頼んだ id のほかの物は捨てる。add のときは地を描き直さない。
 * 返すもの: { dropped: 捨てた形の数, strangers: 頼んでいない id, missed: 頼んだのに形が来なかった id }
 */
export function applyDrawing(book, data, draw, tick) {
  const panel = book.emaki.panels.find((p) => p.id === draw.panel);
  const result = { dropped: 0, strangers: [], missed: [] };
  if (!panel || !data || typeof data !== 'object') return { ...result, missed: draw.ids, error: 'not_object' };
  const redraw = new Set(list(data.things).map((t) => t?.id).filter((id) => draw.ids.includes(id)));
  let total = (draw.mode === 'new' ? 0 : length(panel.ground)) + panel.things.filter((t) => t.shapes && !redraw.has(t.id)).reduce((n, t) => n + length(Object.values(t.shapes).flat()), 0);
  const take = (layer, shapes, max) => {
    const kept = [];
    for (const s of list(shapes)) {
      const shape = checkShape(layer, s);
      if (!shape || kept.length >= max || total + shape.d.length > EMAKI.total) { result.dropped += 1; continue; }
      total += shape.d.length;
      kept.push(shape);
    }
    return kept;
  };
  if (draw.mode === 'new') panel.ground = take('ground', data.ground, EMAKI.ground);
  else result.dropped += list(data.ground).length;
  for (const t of list(data.things)) {
    const thing = redraw.has(t?.id) && panel.things.find((x) => x.id === t.id);
    if (!thing) { result.strangers.push(cut(t?.id, 20)); continue; }
    const shapes = { forms: take('forms', t.forms, EMAKI.shapes.forms), lines: take('lines', t.lines, EMAKI.shapes.lines), light: take('light', t.light, EMAKI.shapes.light) };
    if (!shapes.forms.length && !shapes.lines.length && !shapes.light.length) continue;
    thing.shapes = shapes;
    thing.drawn = tick;
  }
  result.missed = draw.ids.filter((id) => panel.things.find((t) => t.id === id)?.drawn !== tick);
  return result;
}
const length = (shapes) => shapes.reduce((n, s) => n + s.d.length, 0);

// ---- 章のまとめ(章の終わりに一度。下調べは渡さない) ----

export function summaryRequest(book) {
  return { events: book.story.events.map((e) => e.text) };
}

export function summarySchema() {
  return obj({ summary: str(`章のまとめ(${EMAKI.summary}字まで)。渡した出来事に無いことは書かない`) });
}

/** 章のまとめを残し、この章の出来事を空にする。まとめが来なければ出来事をつないで代わりにする */
export function applySummary(book, data) {
  const summary = typeof data?.summary === 'string' && data.summary.trim() ? cut(data.summary, EMAKI.summary) : cut(book.story.events.map((e) => e.text).join('。'), EMAKI.summary);
  if (summary) book.story.chapters.push({ summary });
  book.story.events = [];
}

// ---- 記録をたどる(試写室・check.mjs・device.mjs) ----

/**
 * run.py の記録を、端末と同じ決まりでたどる。upTo 回目まで当てた本と、回ごとの記録(落としたもの・描いたか)を返す。
 * 回の中身: { pages: [a, b], chapter, reader: { data }, drawers: [{ data }](描く順), summary: { data } | null }
 */
export function replay(run, pages, upTo = run.ticks.length) {
  const book = newBook(checkBrief(run.brief?.data));
  const logs = [];
  for (const [i, tick] of run.ticks.slice(0, upTo).entries()) {
    const read = enter(book, tick, pages, i);
    const drawn = read.draws.map((draw, k) => (tick.drawers?.[k] ? applyDrawing(book, tick.drawers[k].data ?? null, draw, i) : null));
    if (tick.summary) applySummary(book, tick.summary.data);
    logs.push({ tick: i, read, drawn });
  }
  return { book, logs };
}

// 回の始まり: 章が替わったら絵巻を新しくし、読み取りの答えを当てる
function enter(book, tick, pages, i) {
  if (book.emaki.chapter !== tick.chapter) startChapter(book, tick.chapter);
  return applyReading(book, tick.reader?.data ?? null, textOf(pages, tick.pages), i);
}

/**
 * run.py に、次にすることを返す。{ op: 'read', tick, request } / { op: 'draw', draw, request } / { op: 'summary', request } / { op: 'done' }
 * 区切り・送るもの・描くかどうかは、ここ(端末)が決める。run.py は Claude を呼んで答えを記録に書くだけ
 */
export function next(run, pages) {
  const plan = ticksOf(pages, run.settings);
  const done = run.ticks.length;
  const last = run.ticks.at(-1);
  if (last) {
    const { book } = replay(run, pages, done - 1);
    const { draws } = enter(book, last, pages, done - 1);
    const drawers = list(last.drawers);
    for (const [k, draw] of draws.entries()) {
      if (!drawers[k]) return { op: 'draw', draw, request: drawRequest(book, draw) };
      applyDrawing(book, drawers[k].data ?? null, draw, done - 1);
    }
    if (pages[last.pages[1]].end && !last.summary) return { op: 'summary', request: summaryRequest(book) };
  }
  if (done >= plan.length) return { op: 'done' };
  const { book } = replay(run, pages);
  const [a, b] = plan[done];
  if (book.emaki.chapter !== pages[a].chapter) startChapter(book, pages[a].chapter);
  return { op: 'read', tick: { pages: [a, b], chapter: pages[a].chapter }, request: readRequest(book, textOf(pages, [a, b])) };
}

// ---- 絵 ----

/**
 * 区画の絵の断片。sketch の物は線だけを鉛筆の色で描く(描き足した直後)。sketchAll は区画ごと下描き(新しい場面の直後・地も描かない)。
 * light: 'soft'(読んでいる間)・'glow'(章の終わり)
 */
export function panelArt(panel, { sketch = new Set(), sketchAll = false, light = 'soft', styled = true } = {}) {
  const drawn = panel.things.filter((t) => t.shapes);
  const rough = (t) => sketchAll || sketch.has(t.id);
  const colored = drawn.filter((t) => !rough(t));
  return paint({
    ground: sketchAll ? [] : panel.ground,
    forms: colored.flatMap((t) => t.shapes.forms),
    lines: drawn.flatMap((t) => (rough(t) ? t.shapes.lines.map((s) => ({ ...s, sketch: true })) : t.shapes.lines)),
    light: colored.flatMap((t) => t.shapes.light),
  }, { light, styled });
}

export const panelSvg = (panel, opts = {}) => frame([panelArt(panel, opts)], opts);
/** 章の絵巻: 区画を順に横へ並べ、灯りをともす */
export const scrollSvg = (panels, opts = {}) => frame(panels.map((p) => panelArt(p, { ...opts, light: 'glow' })), opts);
export const drawable = (panel) => !!panel && (panel.ground.length > 0 || panel.things.some((t) => t.shapes));

// ---- 判定役(試写室での検査だけ。本番には無い) ----

/** 回ごとに、端末に残っていたもの(描く係に渡るもの)と描いた物。判定役(run.py --judge)に渡す */
export function judgeRequest(run, pages) {
  const ticks = run.ticks.map((tick, i) => {
    const { book } = replay(run, pages, i + 1);
    const panel = current(book);
    return {
      tick: i,
      read_to_page: tick.pages[1] + 1,
      story: storyOf(book),
      scene: panel && { place: panel.place.name, time: panel.time, weather: panel.weather, mood: panel.mood },
      things: panel ? panel.things.map((t) => ({ name: t.name, look: t.look, drawn: !!t.shapes })) : [],
    };
  });
  return { text: pages.map((p) => `〔${p.index + 1}ページ〕\n${p.text}`).join('\n'), ticks };
}

export function judgeSchema() {
  return obj({
    ticks: {
      type: 'array', description: '回ごとの判定(渡した回をすべて)',
      items: obj({ tick: { type: 'integer' }, spoiler: { type: 'boolean', description: '読んだ所より後で初めて分かることが入っていれば true' }, found: { type: 'array', items: obj({ what: str('入っていたもの'), why: str('何ページで初めて分かることか') }) } }),
    },
  });
}

/** 落とした語句が、本のどこに有るか: later(まだ読んでいない所だけに有る=門で止めた先の語句)・before(前に読んだ所)・none(どこにも無い) */
export function whereIs(quote, pages, page) {
  const q = flat(quote);
  if (q.length < 2) return 'none';
  const read = flat(pages.slice(0, page + 1).map((p) => p.text).join(''));
  if (read.includes(q)) return 'before';
  return flat(pages.slice(page + 1).map((p) => p.text).join('')).includes(q) ? 'later' : 'none';
}

/** 場面の目印(books.json の scenes)で、その位置が何番目の場面か。must でない目印は数えない */
export function sceneAt(book, chapter, para, { must = true } = {}) {
  let at = -1;
  book.scenes.forEach((s, i) => { if ((!must || s.must) && (s.chapter < chapter || (s.chapter === chapter && s.para <= para))) at = i; });
  return at;
}

function obj(properties) {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}
function str(description) {
  return { type: 'string', description };
}
