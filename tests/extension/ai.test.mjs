// ai.js の、生成の前後を検める純粋な関数のテスト(サーバは呼ばない)。
// pickTerms はサーバへ送るものを決める所なので、上限と「文にならない」ことを確かめる(§11-7)。
//
//   node --test "tests/extension/*.test.mjs"

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SERVER } from '../../extension/src/shared/config.js';
import { acceptQuiz, acceptTrivia, looksLikeSound, pickTerms, sharesTermWith } from '../../extension/src/background/ai.js';

const terms = JSON.parse(readFileSync(new URL('../fixtures/terms.json', import.meta.url), 'utf8'));

describe('looksLikeSound(サーバの _looks_like_sound と同じ表で確かめる)', () => {
  for (const w of terms.sound) test(`「${w}」は擬音らしい`, () => assert.equal(looksLikeSound(w), true));
  for (const w of terms.word) test(`「${w}」は言葉`, () => assert.equal(looksLikeSound(w), false));
  test('空・null は擬音にしない', () => {
    assert.equal(looksLikeSound(''), false);
    assert.equal(looksLikeSound(null), false);
  });
});

describe('pickTerms: サーバへ送る単語の候補', () => {
  // 候補になる語を上限より多く含む本文(漢字・カタカナ・英語)
  const text =
    '活動写真館の楽長は、第六交響曲の総譜を抱えて金星音楽団の練習へ向かった。蓄音機と手風琴、' +
    '譜面台と指揮棒が並び、ヴァイオリンとセロとトランペットとクラリネットの音が鳴る。' +
    '途中でゴロゴロと雷が鳴り、時間がないと言いながら三百人の聴衆を待たせた。' +
    'The conductor said it was an extraordinary performance, a remarkable rehearsal, and a wonderful evening.';
  const out = pickTerms(text);

  test('数は SERVER.maxTerms まで、1語は SERVER.maxTermChars 字まで', () => {
    assert.ok(out.length > 0 && out.length <= SERVER.maxTerms, `${out.length}語`);
    assert.ok(out.every((w) => w.length <= SERVER.maxTermChars));
  });

  test('本文にそのまま出てくる1語ずつで、文にならない(空白・句読点・記号を含まない)', () => {
    for (const w of out) {
      assert.ok(text.includes(w), w);
      assert.match(w, /^[一-鿿々〆ァ-ヺーa-z'-]+$/);
    }
  });

  test('ありふれた語・数だけの語・擬音・大文字始まりの英単語は選ばない', () => {
    for (const w of ['時間', '途中', '三百', 'ゴロゴロ', 'The']) assert.ok(!out.includes(w), w);
  });

  test('「第六交響曲」は「交響曲」として拾う', () => {
    assert.ok(pickTerms('第六交響曲を聴いた。').includes('交響曲'));
  });

  test('種類ごとの上限(漢字5・カタカナ3・英語3)', () => {
    const kanji = out.filter((w) => /^[一-鿿々〆]+$/.test(w));
    const kana = out.filter((w) => /^[ァ-ヺー]+$/.test(w));
    const latin = out.filter((w) => /^[a-z'-]+$/.test(w));
    assert.ok(kanji.length <= 5 && kana.length <= 3 && latin.length <= 3, out.join(' '));
  });

  test('本文が無ければ何も選ばない', () => {
    assert.deepEqual(pickTerms(''), []);
    assert.deepEqual(pickTerms(null), []);
  });
});

describe('acceptTrivia: うんちくの出力を検める', () => {
  const good = { text: '活動写真館は映画館の古い呼び方なんだって!', term: '活動写真館', sure: true };

  test('言い切れるものだけ通す', () => {
    assert.deepEqual(acceptTrivia(good), { text: good.text, term: good.term });
    assert.equal(acceptTrivia({ ...good, sure: false }), null);
    assert.equal(acceptTrivia({ ...good, sure: 'true' }), null);
  });

  test('空・90字超・擬音らしい語は捨てる', () => {
    assert.equal(acceptTrivia({ ...good, text: '  ' }), null);
    assert.equal(acceptTrivia({ ...good, text: 'あ'.repeat(91) }), null);
    assert.ok(acceptTrivia({ ...good, text: 'あ'.repeat(90) }));
    assert.equal(acceptTrivia({ ...good, term: 'トォテテ テテテイ' }), null);
    assert.equal(acceptTrivia(null), null);
  });
});

describe('acceptQuiz: クイズの形を確かめる', () => {
  const good = { question: ' 楽長が抱えていたのは? ', choices: ['総譜', '指揮棒', '譜面台'], answer_index: 0 };

  test('形が合えば整えて返す', () => {
    assert.deepEqual(acceptQuiz(good), { question: '楽長が抱えていたのは?', choices: ['総譜', '指揮棒', '譜面台'], answer_index: 0 });
  });

  test('選択肢が3つでない・空の選択肢・正解の添字が範囲外なら null', () => {
    assert.equal(acceptQuiz({ ...good, choices: ['総譜', '指揮棒'] }), null);
    assert.equal(acceptQuiz({ ...good, choices: ['総譜', ' ', '譜面台'] }), null);
    for (const answer_index of [-1, 3, 1.5, 'x']) assert.equal(acceptQuiz({ ...good, answer_index }), null, String(answer_index));
    assert.equal(acceptQuiz({ ...good, question: '' }), null);
    assert.equal(acceptQuiz(null), null);
  });

  test('長すぎる問題文・選択肢は切る', () => {
    const q = acceptQuiz({ ...good, question: 'あ'.repeat(400), choices: ['い'.repeat(200), 'う', 'え'] });
    assert.equal(q.question.length, 300);
    assert.equal(q.choices[0].length, 120);
  });
});

describe('sharesTermWith: 本についての問いか(本文と言葉を共有するか)', () => {
  const text = '仲買い人の汽車が着くと、ジョバンニは Serendipity という本を開いた。';

  test('漢字は2字ずつ見る(「仲買人」でも「仲買い人」に当たる)', () => {
    assert.equal(sharesTermWith('仲買人って何?', text), true);
  });

  test('カタカナ語・英単語・「」で括った言葉', () => {
    assert.equal(sharesTermWith('ジョバンニは誰?', text), true);
    assert.equal(sharesTermWith('what does serendipity mean', text), true);
    assert.equal(sharesTermWith('「汽車」の読みは?', text), true);
  });

  test('頼みごとの言葉だけでは本についての問いにしない', () => {
    assert.equal(sharesTermWith('宿題を手伝って', '友だちの仕事を手伝っていた。'), false);
    assert.equal(sharesTermWith('Pythonで累積和を出すコードを書いて', text), false);
  });

  test('本文が無ければ false', () => {
    assert.equal(sharesTermWith('仲買人って何?', ''), false);
  });
});
