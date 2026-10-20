// 演出の試写室: 拡張の stage.js をそのまま読み、θ を変えながら呼ぶ。
import { createStage, tierOf } from '../../extension/src/content/stage.js';
import { Paint, staticSprite } from '../../extension/src/content/paint.js';
import { READING_FX } from '../../extension/src/shared/config.js';
import { bearImg, bearURL } from '../../extension/src/content/bear.js';
import { createMargin } from '../../extension/src/content/margin.js';
import { createTurnFx } from '../../extension/src/content/turnfx.js';
import { createStory } from '../../extension/src/content/story.js';
import { STORIES } from '../../extension/src/content/stories.js';

const $ = (id) => document.getElementById(id);
const stage = createStage({ Paint, bearImg });
const THETA_MAX = 8;
const TIERS = { 4: '打ち上げ / つむじ風', 3: '大ジャンプ', 2: 'ぴょんぴょん', 1: '寝そべって読む' };

const theta = () => Number($('theta').value);
const intensity = () => theta() / THETA_MAX;
// ことば吹雪: 読んでいる本の字(main.js の glyphsFromReading の代わり)
const glyphs = [...new Set($('book').textContent.replace(/[\s、。「」]/g, ''))].slice(0, 60);

function showTheta() {
  $('theta-out').textContent = theta().toFixed(1);
  const a = Math.min(1, Math.max(0.15, intensity()));
  $('tier').textContent = theta() <= 0 ? '何も出ない' : `段${tierOf(a)}: ${TIERS[tierOf(a)]}`;
}
$('theta').addEventListener('input', showTheta);
showTheta();

// コマ止め: 押してから指定のミリ秒で、Shadow DOM の中の動き・予定されていた切り替え・粒の描画を全部止める。
// 解除はページを読み直す(θ とコマ止めの値は URL に残す)
const realSetTimeout = window.setTimeout.bind(window);
const realClearTimeout = window.clearTimeout.bind(window);
const realRaf = window.requestAnimationFrame.bind(window);
const pending = new Set();
let frozen = false;
window.setTimeout = (fn, ms = 0, ...args) => {
  const id = realSetTimeout(() => {
    pending.delete(id);
    if (!frozen) fn(...args);
  }, ms);
  pending.add(id);
  return id;
};
window.clearTimeout = (id) => {
  pending.delete(id);
  realClearTimeout(id);
};
window.requestAnimationFrame = (fn) => realRaf((t) => !frozen && fn(t));
function freeze() {
  frozen = true;
  for (const id of pending) realClearTimeout(id);
  pending.clear();
  for (const el of document.documentElement.children) {
    for (const a of el.shadowRoot?.getAnimations() ?? []) {
      a.pause();
      a.currentTime = a.currentTime; // 合成側で先に進んでいた分を、止めた時刻に戻す
    }
  }
  realRaf(() => document.body.offsetWidth);
  // 止まった画面のどこかを押したら解除(演出の層が画面を覆っていて、パネルを押せないことがある)
  realSetTimeout(() => addEventListener('click', thaw, { capture: true, once: true }), 0);
}
function thaw() {
  const q = new URLSearchParams({ theta: $('theta').value });
  if ($('freeze').value) q.set('freeze', $('freeze').value);
  if ($('story').value) q.set('story', $('story').value);
  location.search = q.toString();
}
const params = new URLSearchParams(location.search);
if (params.has('theta')) $('theta').value = params.get('theta');
if (params.has('freeze')) $('freeze').value = params.get('freeze');
showTheta();
$('thaw').addEventListener('click', thaw);

function armFreeze() {
  const ms = Number($('freeze').value);
  if ($('freeze').value !== '' && ms >= 0) realSetTimeout(freeze, ms);
}

// θ=0 では何も出さない(main.js と同じ)
const when = (fn) => () => {
  if (theta() <= 0 || frozen) return;
  fn();
  armFreeze();
};

for (const [id, rarity] of [['peek', 'normal'], ['peek-rare', 'rare'], ['peek-epic', 'epic']]) {
  $(id).addEventListener('click', when(() => stage.peek({ intensity: intensity(), rarity })));
}
// ---- 余白(本文の枠の外)と、読書中の派手さ ----------------------------------
// main.js の onAdvance(めくって進んだ瞬間)を、ボタンで1回ずつ起こす
const margin = createMargin(Paint, { bearURL, staticSprite, fx: READING_FX, createTurnFx });
// よみりんの話(右下の角)。?story=<id>&step=<コマ> で、決めた話の決めたコマから始める(撮影用)
const story = createStory(Paint, { fx: READING_FX.story });
for (const s of STORIES) $('story').append(new Option(`${s.name}(${s.frames}コマ・${s.ending})`, s.id));
if (params.has('story')) $('story').value = params.get('story');
function showStory() {
  const s = story.state;
  if (!s) return;
  const at = s.ended ? 'オチた(次のめくりで次の話)' : s.step < 0 ? 'まだ何も無い' : `${s.step + 1}/${s.frames}コマ`;
  const waiting = !s.ended && s.step >= s.frames - 2 ? `・待っている(${s.waited}めくり)` : '';
  $('story-state').textContent = `${s.name}: ${at}${waiting}${s.shown ? '' : '・置き場所が無い'}`;
}
function beginStory() {
  story.begin($('story').value || undefined, intensity());
  if (params.has('step')) story.jump(Number(params.get('step')));
  showStory();
}
$('story').addEventListener('change', () => {
  story.begin($('story').value || undefined, intensity());
  showStory();
});
// 本文の枠 = 本の段落が並んでいる所(見えている範囲)
function syncText() {
  const r = $('book').getBoundingClientRect();
  const rect = { left: r.left + 40, right: r.right - 40, top: Math.max(0, r.top) + 60, bottom: Math.min(innerHeight, r.bottom) - 20 };
  margin.setText(rect);
  story.setText(rect);
}
syncText();
beginStory();
// h キーで操作パネルを隠す(パネルが左の余白に重なって、飾りが見えにくいので)
addEventListener('keydown', (e) => {
  if (e.key === 'h' && e.target === document.body) document.querySelector('.panel').hidden = !document.querySelector('.panel').hidden;
});
addEventListener('resize', syncText);
addEventListener('scroll', syncText, { passive: true });

const sim = { cyclePages: 0, bearPlaced: false, premonition: null };
function advance() {
  const level = intensity();
  const fx = READING_FX;
  // Micro: めくりの演出(ふだんの型・置き場所は余白)
  if ($('flash-always').checked || Math.random() < fx.turnFx.maxP * level) margin.turn({ theta: level * 8, size: 'medium' });
  // Meso: 世界が少し育つ。話が確率で1コマ進む(前の話がオチたあとなら、次の話が始まる)
  sim.cyclePages += 1;
  if (fx.glow.enabled) margin.world(sim.cyclePages / fx.glow.fullPages, level);
  if (fx.story.enabled) {
    if (story.state?.ended && $('story').value) story.begin($('story').value, level); // 話を選んでいるときは、同じ話をもう一度
    else story.advance(level);
    showStory();
  }
  if (fx.garden.enabled) {
    if (!sim.bearPlaced && sim.cyclePages >= fx.garden.bearAt) sim.bearPlaced = margin.add('bear', level);
    else if (Math.random() < 0.35 + 0.65 * level) margin.grow(level);
  }
  // 予告: めくるたびに印が一つ(話の近くに)。決めためくりで当たり(激レアはくまが駆け抜ける)
  const pm = sim.premonition;
  const near = story.rect;
  if (pm) {
    const seq = pm.tier === 'epic' ? ['gold-star', 'gold-star', 'ears', 'rainbow'] : ['gold-star', 'gold-star'];
    if (pm.step + 1 >= pm.payoffAt) {
      margin.hint(pm.tier, level, { still: true, near });
      if (pm.tier === 'epic') stage.flyby({ intensity: level });
      sim.premonition = null;
    } else {
      if (seq[pm.step]) margin.add(seq[pm.step], level, { near });
      pm.step += 1;
    }
  }
}
$('advance').addEventListener('click', when(advance));
$('advance5').addEventListener(
  'click',
  when(() => {
    for (let i = 0; i < 5; i += 1) setTimeout(advance, i * 450);
  }),
);
$('premo-rare').addEventListener('click', when(() => (sim.premonition = { tier: 'rare', step: 0, payoffAt: 3 })));
$('premo-epic').addEventListener('click', when(() => (sim.premonition = { tier: 'epic', step: 0, payoffAt: 5 })));
$('story-limit').addEventListener('click', () => {
  const s = story.state;
  if (s && !s.ended) story.jump(s.frames - 2);
  showStory();
});
// Macro: 話がオチて、余白が吸い込まれてから、フィーバー「〇〇 読了!!」。大きさは話に溜まった分で決まる(main.js の chapterMacro)
async function macro(chapter) {
  const [{ progress, aside }] = await Promise.all([story.ending(), margin.collapse()]);
  showStory();
  sim.cyclePages = 0;
  sim.bearPlaced = false;
  const min = READING_FX.story.minRelease;
  stage.finale({ intensity: intensity() * (min + (1 - min) * progress), glyphs, chapter, bear: !aside, aside });
}
$('chapter').addEventListener('click', when(() => macro({ label: '第一章' })));
$('trivia').addEventListener(
  'click',
  when(() =>
    stage.trivia(
      { text: '「甘藍(かんらん)」はキャベツのことなんだって!', term: '甘藍' },
      { intensity: intensity(), side: Math.random() < 0.5 ? 'left' : 'right' },
    ),
  ),
);
const QUIZ = { question: 'ゴーシュが町の活動写真館で弾いていた楽器は?', choices: ['セロ', 'トランペット', 'クラリネット'], answer_index: 0 };
// クイズはコマ止めを答えた瞬間から数える
$('quiz').addEventListener('click', () => {
  if (theta() <= 0 || frozen) return;
  const variant = params.get('variant') ?? ($('variant').value || undefined);
  stage.quiz(QUIZ, { intensity: intensity(), glyphs, variant, onFirstAnswer: armFreeze });
});
for (const [id, variant] of [['finale', 'launch'], ['tornado', 'tornado']]) {
  $(id).addEventListener(
    'click',
    when(async () => {
      // 本の読了: 話もオチる(寝床は寝たまま)。大きさは溜まった分に関係なく θ のまま
      const [{ aside }] = await Promise.all([story.ending(), margin.collapse()]);
      showStory();
      sim.cyclePages = 0;
      sim.bearPlaced = false;
      stage.finale({ intensity: intensity(), glyphs, variant, bear: !aside, aside });
    }),
  );
}
$('shower').addEventListener('click', when(() => stage.pageShower({ intensity: intensity(), glyphs })));

// ?auto=finale のように渡すと、読み込んだらすぐその演出を出す(コマ止めと合わせて、決まった瞬間を見る)
// ?auto=quiz-win はクイズを出して、0.5秒後に正解を押す
if (params.get('auto') === 'quiz-win') {
  realSetTimeout(() => {
    $('quiz').click();
    realSetTimeout(() => {
      const root = [...document.documentElement.children].map((e) => e.shadowRoot).find((r) => r?.querySelector('.choice'));
      root?.querySelector('.choice').click();
    }, 500);
  }, 300);
} else if (params.has('auto')) {
  realSetTimeout(() => $(params.get('auto'))?.click(), 300);
}
