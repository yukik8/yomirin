// オンボーディング: 診断(4問)→ 目標選択 → 完了。
// スコアと初期θは本人に見せない(ラベリングしない — PRD「診断と目標設定」)。
// θの計算と保存、外へ送るかどうかの保存はSW側(COMPLETE_ONBOARDING)。このページはUIだけを持つ。

import { Msg } from '../shared/events.js';
import { GOALS, DIAGNOSIS, readTextChoice, readTelemetryChoice } from '../shared/config.js';
import { getState } from '../background/store.js';
import { showBear } from '../content/bear.js';

const $ = (id) => document.getElementById(id);

// 各問 0(軽い)〜2(重い)。並びは PRD の診断項目(SNS利用時間・読書継続・離脱傾向)
const QUESTIONS = [
  {
    text: 'ショート動画やSNSを見る時間は、1日にどれくらいですか',
    choices: ['1時間未満', '1〜3時間', '3時間以上'],
  },
  {
    text: '最後にまとまった長さの文章(本や長い記事)を読み切ったのは、いつですか',
    choices: ['ここ1ヶ月のうち', 'ここ半年のうち', '思い出せない'],
  },
  {
    text: '一度に集中して読み続けられるのは、どれくらいですか',
    choices: ['30分以上', '10分くらい', '5分もたない'],
  },
  {
    text: '読んでいる途中で、スマホや別のタブに手が伸びますか',
    choices: ['ほとんどない', 'ときどき', 'ほぼ毎回'],
  },
];

// 案内役のくま(docs/style.md §6)。段ごとに絵が替わる: はじめ=正面 / 診断=考えながら読む /
// 目標=なにそれ? / おわり=読む
const STEP_BEAR = { 'step-intro': 'front', 'step-quiz': 'think-read', 'step-goal': 'what', 'step-done': 'read' };

const answers = [];
let currentQ = 0;
let selectedGoal = null;

/** 選択肢をキーボードでも選べるようにする(Tab で移動、Enter / Space で選ぶ)。 */
function pressable(li, onPress) {
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.addEventListener('click', onPress);
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPress();
    }
  });
}

function show(stepId) {
  for (const id of ['step-intro', 'step-quiz', 'step-goal', 'step-done']) {
    $(id).hidden = id !== stepId;
  }
  showBear($('mascot'), STEP_BEAR[stepId]);
  // 一枚ずつ出すので、切り替えのたびに入場の動きをやり直す
  const el = $(stepId);
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  window.scrollTo({ top: 0 });
}

function renderQuestion(i) {
  currentQ = i;
  const q = QUESTIONS[i];
  $('progress').textContent = `${i + 1} / ${QUESTIONS.length}`;
  $('qtext').textContent = q.text;
  $('back').hidden = i === 0;

  const list = $('choices');
  list.textContent = '';
  q.choices.forEach((label, value) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'choice-name';
    name.textContent = label;
    li.append(name);
    if (answers[i] === value) li.classList.add('selected');
    pressable(li, () => {
      answers[i] = value;
      li.classList.add('selected');
      // ひと呼吸おいて次へ(選んだ実感を残す)
      setTimeout(() => {
        if (i + 1 < QUESTIONS.length) renderQuestion(i + 1);
        else renderGoals();
      }, 180);
    });
    list.append(li);
  });
  list.firstElementChild?.focus();
}

function renderGoals() {
  show('step-goal');
  const score = answers.reduce((a, v) => a + v, 0);
  const recommended = DIAGNOSIS.recommendGoal(score);
  if (!selectedGoal) selectedGoal = recommended;

  const list = $('goals');
  list.textContent = '';
  for (const [key, g] of Object.entries(GOALS)) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'choice-name';
    name.textContent = g.name;
    if (key === recommended) {
      const reco = document.createElement('span');
      reco.className = 'reco';
      reco.textContent = 'おすすめ';
      name.append(reco);
    }
    const desc = document.createElement('span');
    desc.className = 'choice-desc';
    desc.textContent = g.desc;
    li.append(name, desc);
    if (key === selectedGoal) li.classList.add('selected');
    pressable(li, () => {
      selectedGoal = key;
      for (const el of list.children) el.classList.remove('selected');
      li.classList.add('selected');
    });
    list.append(li);
  }
}

$('begin').addEventListener('click', () => {
  show('step-quiz');
  renderQuestion(0);
});

$('back').addEventListener('click', () => {
  renderQuestion(Math.max(0, currentQ - 1)); // 答えは選び直しで上書きされる
});

$('finish').addEventListener('click', async () => {
  $('finish').disabled = true;
  $('finish-error').hidden = true;
  let res = null;
  try {
    res = await chrome.runtime.sendMessage({
      type: Msg.COMPLETE_ONBOARDING,
      answers,
      goal: selectedGoal,
      text: $('text').checked,
      telemetry: $('telemetry').checked,
    });
  } catch {
    /* SW不在など。下で案内する */
  }
  if (res?.ok) {
    show('step-done');
  } else {
    // 黙って戻すと「終わった」と誤解して閉じてしまう。失敗は必ず見せる
    $('finish-error').textContent =
      `保存できませんでした(${res?.error ?? 'no-response'})。拡張をリロードして、もう一度お試しください。`;
    $('finish-error').hidden = false;
    $('finish').disabled = false;
  }
});

$('close').addEventListener('click', () => window.close());

// 同意の初期値。本文を AI のサーバに送る・使われ方の要約は、新しく入れた人だけ既定オン。
// 診断のやり直しでは、いま選んでいるものを出す(この版より前から使っていて、まだ選んでいない人はオフ)
(async () => {
  const returning = Boolean((await getState().catch(() => null))?.onboarded_at);
  $('text').checked = (await readTextChoice()) ?? !returning;
  $('telemetry').checked = (await readTelemetryChoice()) ?? !returning;
})();

show('step-intro');
