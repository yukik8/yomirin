// 章の絵巻(#51 → #34)。読み進めた話を踏まえて場面を読み取り、余白の絵が話を演じる。
// 場面が移ると絵巻が流れて次の区画へ進み、同じ場面のうちは、物が道に沿って動く・揺れる・現れる・去る・灯る・日が暮れる。
// ページを開いた瞬間に、そのページ(まだ読んでいない)を送って用意させ、答えには封をしておく。
// そのページをめくった瞬間(読み終えた)に封を開け、そのページの出来事を数秒のアニメで演じる。読んでいる間は止まっている。
//
// 端末の側の決まりをここに集める: いつ何を送るか・返ってきたものの検め方・本ごとに残すもの・絵の組み立てと動き。
// サーバの側(Claude への指示)は run.py。試写室(preview.js)・check.mjs・device.mjs(run.py が呼ぶ)で使う。
// 見込みが立てば extension/src/content/ へ移す。
//
// ネタバレの守り(端末の側):
// - 封: まだ読んでいないページから作ったもの(出来事・場面・物・動き)は、そのページをめくるまで、画面にも、ここまでの話にも入れない。
//   記録をたどるとき、回 [a, b] の答えは b をめくった後(turn = b + 1)にだけ当てる(replay・timeline)
// - 本に足すのは、今回送ったページにそのまま有る語句を付けたものだけ(found)。下調べで先を知っている読み取り係が「先」を書いても、ここで止まる
// - 動き(beat)も同じ。読み取りの動きには語句を、描く係の動きには、語句で確かめたこの回の出来事の番号を付けさせる
// - 描く係に渡すのは、ここまでの話と、語句で確かめた場面と物だけ(drawRequest)。書名と下調べは渡さない
// - 描く係が返した形は、頼んだ物の id のものだけを受け取る(applyDrawing)
import { VIEW, checkPath, checkShape, paint, frame, layer, sceneSchema } from '../scene/scene.js';

export const TIMES = { morning: '朝', day: '昼', evening: '夕方', night: '夜', unknown: '分からない' };
export const WEATHERS = { clear: '晴れ', cloudy: '曇り', rain: '雨', snow: '雪', fog: '霧', unknown: '分からない' };
// #42(めくりの演出)と同じ7つ
export const MOODS = { calm: '穏やか', warm: 'あたたかい', sad: 'しんみり', tense: '緊迫', eerie: '不思議・不穏', joyful: 'うれしい', wonder: '発見・驚き', unknown: '分からない' };
// 物の動き。move は区画の「所」(spot)へ動く(道 route があれば道に沿って)。leave は去る(所を書けばそこへ動きながら消える)。
// appear は現れる。light と dark は灯りがともる・消える
export const ACTS = { move: '所へ動く', leave: '去る', appear: '現れる', light: '灯る', dark: '消える' };
// 動きの速さ(演じる長さ ms)と、動きながらの様子
export const SPEEDS = { slow: 2000, mid: 1300, fast: 800 };
export const FX = { none: 'そのまま', bob: '揺れながら(車・乗り物・走る物)', spin: '回りながら(転がる物・回る物)' };
// 演じている間だけの、物の揺らぎ(終わると止まる)
export const LOOPS = { none: '動かない', sway: '揺れる(木・草・花・旗)', bob: '浮き沈みする(水・波・浮かぶ物)', flicker: 'ゆらぐ(灯・火・星)', drift: 'ただよう(煙・雲・湯気)' };
export const CLIP = { panel: 900, change: 700, time: 1200, max: 4500, min: 350 }; // 演じる長さ(ms)。1ページの場面は max まで
export const EMAKI = {
  every: 1, // 読み取りの区切り(字)。1 は、ページを開くたびにそのページを送る(先に送って封をする)
  pageSize: 400, // 試写室の1ページ(字)
  panels: 12, // 1章の区画の上限
  things: 12, // 1区画の物の上限(指示は6つほど。上限を変えると、前の記録をたどったときに id がずれる)
  spots: 8, // 1区画の所の上限
  routes: 8, // 1区画の道の上限
  events: 4, // 1回の読み取りで足す出来事の上限
  scenes: 2, // 1回の読み取りで当てる場面の上限(2ページの間に場面が二つ過ぎることがある)
  beats: 6, // 1回の動きの上限
  recent: 30, // 送る「この章の出来事」の上限(新しい方から)
  event: 60, quote: 40, look: 40, name: 20, seed: 300, summary: 200, // 字数の上限
  shapes: { forms: 16, lines: 24, light: 8 }, // 1つの物の形の上限
  ground: 16,
  depth: 9, // 重なりの奥行きの段(0 がいちばん奥。数の大きい物が前に重なる。決めていない物は真ん中)
  total: 40000, // 1区画の d の長さの合計の上限
};

const flat = (s) => String(s ?? '').replace(/\s+/g, '');
const cut = (s, n) => String(s ?? '').trim().slice(0, n);
const list = (v) => (Array.isArray(v) ? v : []);
const choice = (table, v) => (typeof v === 'string' && Object.hasOwn(table, v) ? v : 'unknown');
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

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
 * 読み取りの区切り: start ページから、本文が every 字たまるか章の終わりで1回。[[最初のページ, 最後のページ], …]。
 * いまの形(every=1)は1ページに1回で、ページを開いた瞬間に送る。答えは、最後のページをめくった瞬間に封を開けて演じる
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

/** 語句が、回のページ [a, b] のどのページに有るか(ページをまたぐ語句は、終わるページ)。見つからなければ a */
export function pageOf(quote, pages, [a, b]) {
  const q = flat(quote);
  const all = flat(textOf(pages, [a, b]));
  const at = q ? all.indexOf(q) : -1;
  if (at < 0) return a;
  let end = 0;
  for (let p = a; p <= b; p += 1) {
    end += flat(pages[p].text).length;
    if (at + q.length <= end) return p;
  }
  return b;
}

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
const sceneOf = (panel) => ({ place: panel.place.name, time: panel.time, weather: panel.weather, mood: panel.mood });

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
    scene: panel && sceneOf(panel),
    spots: panel ? panel.spots.map((s) => s.name) : [],
    things: panel ? panel.things.map((t) => ({ name: t.name, look: t.look, spot: t.pos ?? '', shown: t.shown, lit: t.lit })) : [],
    seed: blank(book) && !!book.brief,
    text,
  };
}

export function readSchema() {
  const quote = str(`<このページ> からそのまま写した語句(${EMAKI.quote}字まで・言い換えない)。写せなければ空`);
  const pick = (table, what) => ({ type: 'string', enum: Object.keys(table), description: `${what}。` + Object.entries(table).map(([k, v]) => `${k}=${v}`).join(' / ') });
  return obj({
    seed: str(`頼まれたときだけ: 本の始まりから <このページ> の直前までのあらすじ(${EMAKI.seed}字まで)。頼まれていない・このページが本の始まりなら空`),
    events: { type: 'array', description: `<このページ> で起きること(順に・${EMAKI.events}つまで)`, items: obj({ text: str(`${EMAKI.event}字まで`), quote }) },
    scenes: {
      type: 'array', description: `このページの中の場面を順に(${EMAKI.scenes}つまで)。ページの最後の場面は必ず入れる`,
      items: obj({
        change: { type: 'string', enum: ['same', 'new'], description: '一つ前の場面(最初は <いまの場面>)の続きなら same。場所が大きく移った・時が大きく飛んだ・夢や回想に入ったら new。<いまの場面> が無ければ new' },
        place: str(`場所(${EMAKI.name}字まで)`), place_quote: quote,
        time: pick(TIMES, '時刻'), time_quote: quote,
        weather: pick(WEATHERS, '天気'), weather_quote: quote,
        mood: pick(MOODS, '雰囲気(いま読んだ所の。この先を先取りしない)'), mood_quote: quote,
        keep: { type: 'array', description: 'new のときだけ: 一つ前の場面の物のうち、この場面にも続けて見える物の名前', items: str('物の名前') },
        things: { type: 'array', description: 'この場面に新しく出てきた、描ける物(人は入れない)', items: obj({ name: str(`${EMAKI.name}字まで`), look: str(`いまどう見えるか(${EMAKI.look}字まで)`), quote, main: { type: 'boolean', description: '場面の主役' } }) },
        changes: { type: 'array', description: 'この場面の物の見た目が変わったとき(積み上がる・壊れる。描き直す)', items: obj({ name: str('物の名前'), look: str(`${EMAKI.look}字まで`), quote }) },
        beats: {
          type: 'array', description: `same のときだけ: <いまの場面の物> が動く・去る・現れる・灯る・消えることを、本文の順に(${EMAKI.beats}つまで)`,
          items: obj({
            name: str('物の名前'), act: pick(ACTS, '動き'),
            to: str('move のとき: <いまの場面の所> の名前。leave で、去りながら動く所があれば、その名前。ほかは空'),
            speed: pick(SPEEDS, '速さ'), fx: pick(FX, '動きながらの様子'), quote,
          }),
        },
      }),
    },
  });
}

/**
 * 読み取りの答えを、今回送ったページ text と照らし合わせてから本に足す(book を書き換える。封を開けたときに呼ぶ)。
 * 返すもの: { dropped: [{ kind, what, quote, why }], draws: [{ panel, mode, ids, tick }](描く順), cues: 演じること }
 * cues は { kind: 'panel' | 'appear' | 'beat' | 'time', panel, id?, act?, to?, from?, speed?, fx?, quote }。演じる順と長さは timeline・clipOf が決める
 * why は quote(語句が段落に無い)・limit(上限)・name(知らない物や所の名前)。
 */
export function applyReading(book, data, text, tick) {
  const dropped = [];
  const drop = (kind, what, quote, why = 'quote') => dropped.push({ kind, what: cut(what, 40), quote: cut(quote, 80), why });
  if (!data || typeof data !== 'object') return { dropped, draws: [], cues: [], error: 'not_object' };
  const ok = (quote) => found(quote, text);
  if (blank(book) && book.brief && typeof data.seed === 'string') book.story.seed = cut(data.seed, EMAKI.seed);
  for (const [i, e] of list(data.events).entries()) {
    if (i >= EMAKI.events) drop('event', e?.text, e?.quote, 'limit');
    else if (typeof e?.text === 'string' && e.text.trim() && ok(e.quote)) book.story.events.push({ text: cut(e.text, EMAKI.event), quote: cut(e.quote, EMAKI.quote), tick });
    else drop('event', e?.text, e?.quote);
  }
  const draws = [], cues = [];
  for (const [i, s] of list(data.scenes).entries()) {
    if (i >= EMAKI.scenes) { drop('scene', s?.place, s?.place_quote, 'limit'); continue; }
    scene(book, s && typeof s === 'object' ? s : {}, { ok, drop, draws, cues, tick });
  }
  return { dropped, draws, cues };
}

// 場面を1つ当てる。時刻・天気・雰囲気・場所・物・動きは、語句が確かめられたものだけ
function scene(book, s, { ok, drop, draws, cues, tick }) {
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
    panel = { id: `p${book.next++}`, tick, place, time, weather, mood, time0: time, ground: [], spots: [], routes: [], things: [] };
    // 前の場面から続けて見える物(語句は前に確かめてある)。形と所は新しい区画で描き直す
    for (const name of list(s.keep)) {
      const t = before?.things.find((x) => x.name === name);
      if (!t) drop('keep', name, '', 'name');
      else if (panel.things.length >= EMAKI.things) drop('keep', name, '', 'limit');
      else panel.things.push(carry(book, t, tick));
    }
  } else {
    // 同じ場面の続き: 分からなかったものは埋め、時刻が移ったら日が暮れる(明ける)のを演じる
    for (const [k, v] of Object.entries({ weather, mood })) if (panel[k] === 'unknown') panel[k] = v;
    if (panel.time === 'unknown') { panel.time = time; panel.time0 = time; }
    else if (time !== 'unknown' && time !== panel.time) { panel.time = time; cues.push({ kind: 'time', panel: panel.id, to: time, quote: s.time_quote }); }
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
    const thing = { id: `t${book.next++}`, name, look: cut(t.look, EMAKI.look), quote: cut(t.quote, EMAKI.quote), main: t.main === true, tick, late: !fresh, ...unplaced() };
    panel.things.push(thing);
    ids.push(thing.id);
    if (!fresh) cues.push({ kind: 'appear', panel: panel.id, id: thing.id, quote: thing.quote });
  }
  if (!fresh) {
    for (const [i, b] of list(s.beats).entries()) {
      if (i >= EMAKI.beats) { drop('beat', b?.name, b?.quote, 'limit'); continue; }
      const thing = panel.things.find((t) => t.name === b?.name);
      if (!thing) { drop('beat', b?.name, b?.quote, 'name'); continue; }
      if (!ok(b.quote)) { drop('beat', `${thing.name} ${b.act}`, b.quote); continue; }
      const cue = act(panel, thing, b.act, b.to, b.quote, b);
      if (cue) cues.push(cue);
      else drop('beat', `${thing.name} ${b.act} ${b.to ?? ''}`, b.quote, 'name');
    }
  }

  if (fresh) {
    if (!panel.things.length && !panel.place.name) return; // 描くものが無い
    book.emaki.panels.push(panel);
    cues.push({ kind: 'panel', panel: panel.id, quote: place.quote || s.time_quote || '' });
    draws.push({ panel: panel.id, mode: 'new', ids: panel.things.map((t) => t.id), tick });
    return;
  }
  if (!ids.length) return;
  // この回に描く区画なら、そこへまとめる
  const same = draws.find((d) => d.panel === panel.id);
  if (same) same.ids.push(...ids.filter((id) => !same.ids.includes(id)));
  else draws.push({ panel: panel.id, mode: 'add', ids: [...new Set(ids)], tick });
}

// まだ描いていない物の、置き場所と灯り(描く係が決める)。pos0・shown0・lit0 は区画が現れたときの様子
const unplaced = () => ({ shapes: null, drawn: null, at: null, depth: null, spot: null, pos0: null, pos: null, shown0: true, shown: true, lit0: true, lit: true, loop: 'none' });
// 前の場面から続けて見える物を、新しい区画へ写す
const carry = (book, t, tick) => ({ ...t, id: `t${book.next++}`, tick, late: false, changed: undefined, ...unplaced() });

// 物を1つ動かす(本を書き換える)。読めない動き・知らない所は null。from は動く前に居た所(道を引くため)
function act(panel, thing, verb, to, quote, { speed, fx } = {}) {
  const from = thing.pos;
  const spot = panel.spots.find((s) => s.name === to)?.name ?? null;
  if (verb === 'move') {
    if (!spot) return null;
    Object.assign(thing, { pos: spot, shown: true });
  } else if (verb === 'leave') Object.assign(thing, { pos: spot ?? thing.pos, shown: false });
  else if (verb === 'appear') thing.shown = true;
  else if (verb === 'light') thing.lit = true;
  else if (verb === 'dark') thing.lit = false;
  else return null;
  return { kind: 'beat', panel: panel.id, id: thing.id, act: verb, to: spot && (verb === 'move' || verb === 'leave') ? spot : '', from, speed: choice(SPEEDS, speed) === 'unknown' ? 'mid' : speed, fx: choice(FX, fx) === 'unknown' ? 'none' : fx, quote: cut(quote, 80) };
}

// ---- 描く(新しい区画か、描き足す物があるときだけ) ----

/**
 * 描く係へ送るもの。書名と下調べは入れない(描く係が知っているのは、ここまでの話と、語句で確かめた場面と物だけ)。
 * new のときは、この回の出来事に番号を付けて渡し、出来事に沿った動き(beats)を返させる
 */
export function drawRequest(book, draw) {
  const panel = book.emaki.panels.find((p) => p.id === draw.panel);
  return {
    mode: draw.mode,
    story: storyOf(book),
    events: draw.mode === 'new' ? book.story.events.filter((e) => e.tick === draw.tick).map((e) => e.text) : [],
    scene: sceneOf(panel),
    things: panel.things.map((t) => ({ id: t.id, name: t.name, look: t.look, main: t.main, draw: draw.ids.includes(t.id), spot: t.pos ?? '' })),
    spots: draw.mode === 'add' ? panel.spots : [],
    routes: draw.mode === 'add' ? panel.routes : [],
    current: draw.mode === 'add' ? { ground: panel.ground, things: panel.things.filter((t) => t.shapes).map((t) => ({ id: t.id, at: t.at, depth: depthOf(t), ...t.shapes })) } : null,
  };
}

export function drawSchema() {
  const { ground, forms, lines, light } = sceneSchema().properties;
  const n = (description) => ({ type: 'number', description });
  return obj({
    ground: { type: 'array', description: `地。空・地面・壁・水面など、奥の大きな面(${EMAKI.ground}まで)。mode が add なら空`, items: ground.items },
    spots: {
      type: 'array', description: `この場面で物が居られる所・動いて行ける所(${EMAKI.spots}まで)。地面や線路の上の点で、画面の外(x が 0 より小さい・320 より大きい)も使える。add のときは、足す所だけ`,
      items: obj({ name: str(`所の名前(${EMAKI.name}字まで。例: 坂の上・茶店の前・画面の外の左)`), x: n('x'), y: n('y。物の足もとが来る高さ'), scale: n('その所での物の大きさ(手前は大きく、奥は小さく。1 が描いた大きさ)') }),
    },
    routes: {
      type: 'array', description: `所から所への道(${EMAKI.routes}まで)。線路や坂のように曲がった道を、物の足もとが通る線(SVG の path の d)で。from の所から始まり to の所で終わる。逆向きにも使う。まっすぐでよければ要らない`,
      items: obj({ from: str('spots の名前'), to: str('spots の名前'), d: str('SVG の path の d(コマンドと数字だけ)') }),
    },
    things: {
      type: 'array', description: '物ごとの形。id は <物> の一覧の id',
      items: obj({
        id: str('<物> の id'),
        at: obj({ x: n('物の足もと(置いてある点)の x'), y: n('物の足もとの y') }),
        depth: { type: 'integer', description: `重なりの奥行き(0〜${EMAKI.depth})。0 がいちばん奥(空・遠い山・海原)で、数の大きい物が前に重なる。動く物は、通る地面・線路・道と、その脇の物より大きく` },
        spot: str('描いた所の名前(spots の名前)。所に居ない物(空・山・建物など動かない物)は空。動く物は、いちばん大きく見える所で描く'),
        start: str('最初に居る所の名前(spots の名前)。描いた所と同じなら空'),
        hidden: { type: 'boolean', description: '最初は見えない(出来事で現れる)なら true' },
        lit: { type: 'boolean', description: '光る物が、最初に灯っているか(灯っていない灯り・まだ昇っていない月は false。光らない物は true)' },
        loop: { type: 'string', enum: Object.keys(LOOPS), description: '演じている間の揺らぎ。' + Object.entries(LOOPS).map(([k, v]) => `${k}=${v}`).join(' / ') },
        forms: { type: 'array', description: `物の面(${EMAKI.shapes.forms}まで)`, items: forms.items },
        lines: { type: 'array', description: `色鉛筆の線。輪郭は必ず描く(${EMAKI.shapes.lines}まで)`, items: lines.items },
        light: { type: 'array', description: `光るものそのものの形(${EMAKI.shapes.light}まで)`, items: light.items },
      }),
    },
    beats: {
      type: 'array', description: `mode が new のときだけ: <この回の出来事> に沿って、物が動く・去る・現れる・灯る・消えることを順に(${EMAKI.beats}つまで)。同じ出来事の動きは一緒に演じる`,
      items: obj({
        event: { type: 'integer', description: '<この回の出来事> の番号' }, id: str('物の id'),
        act: { type: 'string', enum: Object.keys(ACTS), description: Object.entries(ACTS).map(([k, v]) => `${k}=${v}`).join(' / ') },
        to: str('move のとき: spots の名前。leave で、去りながら動く所があれば、その名前。ほかは空'),
        speed: { type: 'string', enum: Object.keys(SPEEDS), description: '速さ(slow・mid・fast)' },
        fx: { type: 'string', enum: Object.keys(FX), description: Object.entries(FX).map(([k, v]) => `${k}=${v}`).join(' / ') },
      }),
    },
  });
}

/**
 * 描く係の答えを区画に当てる(book を書き換える)。頼んだ id のほかの物は捨てる。add のときは地を描き直さない。
 * 返すもの: { dropped: 捨てた形・所・動きの数, strangers: 頼んでいない id, missed: 頼んだのに形が来なかった id, cues: 演じること }
 */
export function applyDrawing(book, data, draw, tick) {
  const panel = book.emaki.panels.find((p) => p.id === draw.panel);
  const result = { dropped: 0, strangers: [], missed: [], cues: [] };
  if (!panel || !data || typeof data !== 'object') return { ...result, missed: draw.ids, error: 'not_object' };
  const redraw = new Set(list(data.things).map((t) => t?.id).filter((id) => draw.ids.includes(id)));
  let total = (draw.mode === 'new' ? 0 : length(panel.ground)) + panel.things.filter((t) => t.shapes && !redraw.has(t.id)).reduce((n, t) => n + length(Object.values(t.shapes).flat()), 0);
  const take = (kind, shapes, max) => {
    const kept = [];
    for (const s of list(shapes)) {
      const shape = checkShape(kind, s);
      if (!shape || kept.length >= max || total + shape.d.length > EMAKI.total) { result.dropped += 1; continue; }
      total += shape.d.length;
      kept.push(shape);
    }
    return kept;
  };
  if (draw.mode === 'new') Object.assign(panel, { ground: take('ground', data.ground, EMAKI.ground), spots: [], routes: [] });
  else result.dropped += list(data.ground).length;
  for (const s of list(data.spots)) {
    const name = typeof s?.name === 'string' ? cut(s.name, EMAKI.name) : '';
    const x = num(s?.x, -320, 640), y = num(s?.y, -240, 480), scale = num(s?.scale, .3, 3);
    if (!name || x == null || y == null || scale == null || panel.spots.length >= EMAKI.spots || panel.spots.some((p) => p.name === name)) { result.dropped += 1; continue; }
    panel.spots.push({ name, x, y, scale });
  }
  for (const r of list(data.routes)) {
    const d = checkPath(r?.d);
    const known = (name) => panel.spots.some((x) => x.name === name);
    if (!d || !known(r.from) || !known(r.to) || r.from === r.to || panel.routes.length >= EMAKI.routes) { result.dropped += 1; continue; }
    panel.routes.push({ from: r.from, to: r.to, d });
  }
  for (const t of list(data.things)) {
    const thing = redraw.has(t?.id) && panel.things.find((x) => x.id === t.id);
    if (!thing) { result.strangers.push(cut(t?.id, 20)); continue; }
    const shapes = { forms: take('forms', t.forms, EMAKI.shapes.forms), lines: take('lines', t.lines, EMAKI.shapes.lines), light: take('light', t.light, EMAKI.shapes.light) };
    if (!shapes.forms.length && !shapes.lines.length && !shapes.light.length) continue;
    const x = num(t.at?.x, -320, 640), y = num(t.at?.y, -240, 480);
    const spot = panel.spots.find((s) => s.name === t.spot)?.name ?? null;
    const start = panel.spots.find((s) => s.name === t.start)?.name ?? spot;
    const shown = t.hidden !== true, lit = t.lit !== false;
    const depth = num(t.depth, 0, EMAKI.depth);
    Object.assign(thing, { shapes, drawn: tick, at: x == null || y == null ? null : { x, y }, depth: depth == null ? null : Math.round(depth), spot, pos0: start, pos: start, shown0: shown, shown, lit0: lit, lit, loop: choice(LOOPS, t.loop) === 'unknown' ? 'none' : t.loop });
  }
  result.missed = draw.ids.filter((id) => panel.things.find((t) => t.id === id)?.drawn !== tick);
  // 重なり: 奥行きの順に並べ直す(数の大きい物が前)。同じ奥行きなら、この答えの物は答えの順に、前からの物の前へ
  const rank = new Map();
  list(data.things).forEach((t, i) => { if (redraw.has(t?.id) && !rank.has(t.id)) rank.set(t.id, i); });
  panel.things.sort((a, b) => depthOf(a) - depthOf(b) || (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
  // 出来事に沿った動き(new のときだけ)。出来事は語句で確かめてあるので、その語句で演じる時刻を決める
  const events = book.story.events.filter((e) => e.tick === draw.tick);
  for (const [i, b] of list(data.beats).entries()) {
    const thing = panel.things.find((t) => t.id === b?.id && t.shapes);
    const event = Number.isInteger(b?.event) ? events[b.event] : null;
    const cue = draw.mode === 'new' && i < EMAKI.beats && thing && event ? act(panel, thing, b.act, b.to, event.quote, b) : null;
    if (cue) result.cues.push(cue);
    else result.dropped += 1;
  }
  return result;
}
const length = (shapes) => shapes.reduce((n, s) => n + s.d.length, 0);
const depthOf = (t) => t.depth ?? Math.ceil(EMAKI.depth / 2);

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
 * run.py の記録を、端末と同じ決まりでたどる。upTo 回目まで当てた本と、回ごとの記録を返す。
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

// ---- 演じる(試写室・本番の余白) ----

/**
 * 回ごとの cues に、演じるめくり(turn・そのページを開いたときのページの番号)と、その中の時刻(start・dur ms)を付ける。
 * 封: 回 [a, b] の答えは、b をめくった瞬間(turn = b + 1)にだけ演じる。それより前のめくりには決して出さない
 */
export function timeline(run, pages, logs) {
  return logs.flatMap((log) => {
    const tick = run.ticks[log.tick];
    const [a, b] = tick.pages;
    const text = flat(textOf(pages, [a, b]));
    const cues = [...log.read.cues, ...log.drawn.flatMap((d) => d?.cues ?? [])].map((cue) => ({ ...cue, tick: log.tick, chapter: tick.chapter, at: Math.max(0, text.indexOf(flat(cue.quote))) }));
    // この回にできた区画の中の動きは、区画より後に回す(区画が現れてから動く)
    for (const panel of cues.filter((c) => c.kind === 'panel')) for (const c of cues) if (c !== panel && c.panel === panel.panel && c.at <= panel.at) c.at = panel.at + .5;
    cues.sort((x, y) => x.at - y.at || order(x) - order(y));
    return clipOf(cues).map((cue) => ({ ...cue, turn: b + 1 }));
  });
}
const order = (cue) => (cue.kind === 'panel' ? 0 : 1);

/**
 * 1ページの場面を、数秒の場面にする。本文で同じ所(同じ語句)の動きは一緒に、ほかは順に演じる。
 * 長さは、区画が流れる 0.9 秒・動きは速さ(SPEEDS)・現れる/去る/灯るは 0.7 秒(slow なら倍)・日が暮れるのは 1.2 秒。合わせて CLIP.max を超えたら縮める
 */
export function clipOf(cues) {
  const groups = [];
  for (const cue of cues) {
    const prev = groups.at(-1);
    if (prev && cue.kind !== 'panel' && prev[0].kind !== 'panel' && flat(prev[0].quote) === flat(cue.quote)) prev.push(cue);
    else groups.push([cue]);
  }
  const moving = (cue) => cue.kind === 'beat' && (cue.act === 'move' || (cue.act === 'leave' && cue.to));
  const length = (cue) => (cue.kind === 'panel' ? CLIP.panel : cue.kind === 'time' ? CLIP.time : moving(cue) ? SPEEDS[cue.speed] ?? SPEEDS.mid : cue.speed === 'slow' ? CLIP.change * 2 : CLIP.change);
  const total = groups.reduce((n, g) => n + Math.max(...g.map(length)), 0);
  const k = total > CLIP.max ? CLIP.max / total : 1;
  let t = 0; // 丸めは出すときだけ(積み重ねると延びる)
  return groups.flatMap((g) => {
    const out = g.map((cue) => ({ ...cue, start: Math.round(t), dur: Math.max(CLIP.min, Math.round(length(cue) * k)) }));
    t += Math.max(CLIP.min, Math.max(...g.map(length)) * k);
    return out;
  });
}

/**
 * ページ turn を開いたとき(そのめくりの場面を演じ終えたところ)の、章の絵巻の様子。book は、そのめくりまでに封を開けた回をたどった本。
 * 返すもの: { panels: [{ id, time, things: { id: { pos, shown, lit } } }], current: いま余白に出す区画の id }
 */
export function stageAt(book, cues, turn, chapter) {
  const panels = [];
  for (const cue of cues) {
    if (cue.turn > turn || cue.chapter !== chapter) continue;
    const panel = book.emaki.panels.find((p) => p.id === cue.panel);
    if (!panel) continue;
    if (cue.kind === 'panel') {
      if (!drawable(panel)) continue;
      const things = {};
      for (const t of panel.things) if (!t.late) things[t.id] = { pos: t.pos0, shown: t.shown0, lit: t.lit0 };
      panels.push({ id: panel.id, time: panel.time0, things });
      continue;
    }
    const shown = panels.find((p) => p.id === cue.panel);
    if (!shown) continue;
    if (cue.kind === 'time') shown.time = cue.to;
    else if (cue.kind === 'appear') { const t = panel.things.find((x) => x.id === cue.id); if (t) shown.things[cue.id] = { pos: t.pos0, shown: true, lit: t.lit0 }; }
    else {
      const state = shown.things[cue.id];
      if (!state) continue;
      if (cue.act === 'move') Object.assign(state, { pos: cue.to, shown: true });
      else if (cue.act === 'leave') Object.assign(state, { pos: cue.to || state.pos, shown: false });
      else if (cue.act === 'appear') state.shown = true;
      else state.lit = cue.act === 'light';
    }
  }
  return { panels, current: panels.at(-1)?.id ?? null };
}

/** 所から所への道(描く係が引いたもの)。逆向きの道は reverse。無ければ null(まっすぐ動く) */
export function routeOf(panel, from, to) {
  const r = panel.routes?.find((x) => (x.from === from && x.to === to) || (x.from === to && x.to === from));
  return r ? { d: r.d, reverse: r.from !== from } : null;
}

/** 物を、いまの所へ置く動かし方。描いた所(spot)から、いまの所(pos)へ。所の大きさの比で大きさも変える */
export function placement(panel, thing, pos) {
  const to = panel.spots.find((s) => s.name === pos);
  if (!to || !thing.at) return { dx: 0, dy: 0, scale: 1 };
  return pointAt(panel, thing, to.x, to.y, to.scale);
}

/** 物の足もとを (x, y) に置き、その所の大きさ scale にする動かし方(道の途中の点にも使う) */
export function pointAt(panel, thing, x, y, scale) {
  const drawn = panel.spots.find((s) => s.name === thing.spot);
  return { dx: +(x - thing.at.x).toFixed(1), dy: +(y - thing.at.y).toFixed(1), scale: +(scale / (drawn?.scale ?? 1)).toFixed(3) };
}

// 時刻が描いた時より進んだぶんだけ、上から色を重ねる(日が暮れる・夜になる)。描いた時刻の色は描く係が付けている
const DUSK = { morning: 0, day: 0, evening: 1, night: 2, unknown: 0 };
export function tint(panel, time) {
  const step = DUSK[time] - DUSK[panel.time0];
  if (step <= 0) return null;
  return time === 'night' ? { color: '#2b3566', opacity: step === 2 ? .5 : .38 } : { color: '#e8935f', opacity: .26 };
}

/** 区画の地(紙と地の面)。物と縁は別の層 */
export function groundSvg(panel, { styled = true } = {}) {
  return frame([paint({ ground: panel.ground }, { styled })], { styled, fade: false });
}

/** 物1つの層(透明)。lit=false の灯りは淡い色を置くだけ */
export function thingSvg(thing, { lit = true, styled = true } = {}) {
  return layer(paint({ forms: thing.shapes.forms, lines: thing.shapes.lines, light: thing.shapes.light }, { light: lit ? 'glow' : 'soft', styled }), { styled });
}

/**
 * 区画を1枚の絵にする(章の終わりの絵巻・一覧)。物は state の所に置き、灯りは state のとおり(glow=true なら全部ともす)。
 * state が無ければ、本に残っているいまの様子
 */
export function panelArt(panel, { state = null, glow = false, styled = true } = {}) {
  const parts = [paint({ ground: panel.ground }, { styled })];
  for (const t of panel.things) {
    if (!t.shapes) continue;
    const s = state ? state.things[t.id] : { pos: t.pos, shown: t.shown, lit: t.lit };
    if (!s || !s.shown) continue;
    const art = paint(t.shapes, { light: glow || s.lit ? 'glow' : 'soft', styled });
    const { dx, dy, scale } = placement(panel, t, s.pos);
    parts.push(dx || dy || scale !== 1 ? `<g transform="translate(${+(t.at.x + dx).toFixed(1)} ${+(t.at.y + dy).toFixed(1)}) scale(${scale}) translate(${-t.at.x} ${-t.at.y})">${art}</g>` : art);
  }
  const shade = tint(panel, state ? state.time : panel.time);
  if (shade) parts.push(`<rect width="${VIEW.width}" height="${VIEW.height}" fill="${shade.color}" opacity="${shade.opacity}" style="mix-blend-mode:multiply"/>`);
  return parts.join('');
}

export const panelSvg = (panel, opts = {}) => frame([panelArt(panel, opts)], opts);
/** 章の絵巻: 区画を順に横へ並べ、灯りをともす */
export const scrollSvg = (panels, opts = {}) => frame(panels.map((p) => panelArt(p, { ...opts, glow: true })), opts);
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
      scene: panel && sceneOf(panel),
      things: panel ? panel.things.map((t) => ({ name: t.name, look: t.look, drawn: !!t.shapes, spot: t.pos ?? '', shown: t.shown, lit: t.lit })) : [],
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
