import { createTurnFx, MOODS, MOTIFS, mixPalette } from './turnfx.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const scenes = {
  calm: ['森の朝', '木漏れ日の道', '朝の森には、まだ誰の足あともなかった。枝の先にたまったしずくが、風の通るたびにひとつずつ落ちた。|遠くで小鳥が鳴いた。道は木の根をよけながら、小さな川へと続いていた。急いで着かなければならない場所は、今日はどこにもなかった。|川べりの石に腰をおろすと、水の中を流れる葉が見えた。葉はくるりと向きを変え、それからまた、ゆっくり進んでいった。'],
  warm: ['午後のこと', '窓辺の湯気', '窓をあけると、庭から焼きたてのパンのにおいがした。向かいの家のおばあさんが、小さく手を振っている。|机には、ふたつのカップが並んでいた。片方のふちには、昨日直したばかりの小さな欠けがある。お湯を注ぐと、湯気が窓の光にほどけていった。|言いかけていた話の続きを、どちらからともなく思い出した。時計の針がひとつ進んだ。'],
  sad: ['ある夜のこと', '雨の向こう', '雨は夕方から降り続いていた。窓の向こうの街灯が、水の膜を通してぼんやり見えた。机の上には、まだ開いていない手紙が一通あった。|あの人の字だと、封筒を見ただけでわかった。旅先から届く手紙には、いつもその土地の空の色が書かれていた。今度は、どんな空の下にいるのだろう。|屋根を打つ雨の音が、少しだけ静かになった。私はカップを脇に寄せ、封筒の端にそっと指をかけた。'],
  tense: ['街の片隅で', '消えた灯り', '角を曲がったとき、通りの灯りがいっせいに消えた。足音だけが、まだ少し先を進んでいる。私は壁に手を添え、息をひそめた。|さっきまで開いていた扉が、いまは閉じていた。隙間から見えていた細い光もない。向こうで何かが床を滑る音がした。|ポケットの鍵を、手のひらの中で確かめた。足音が止まった。暗がりの奥で、誰かがゆっくりこちらを振り向いた。'],
  eerie: ['夜ふけのこと', '知らない駅', '電車を降りると、ホームには誰もいなかった。駅名を確かめようとしたが、看板には見たことのない文字が並んでいた。|時計は十二時を少し過ぎたところで止まっている。改札の奥に、青い灯りがひとつ揺れた。そこから、遠い海のにおいがした。|振り返ると、さっき降りた電車はもういなかった。線路の先には、濃い霧だけが続いていた。'],
  joyful: ['春の日に', '小さな祝日', '坂の上まで走ると、町の広場が見えた。色とりどりの布が風にふくらみ、その下で誰かが大きく手を振っていた。|待ち合わせの木のそばに、みんなが集まっている。籠からは花があふれ、まだ温かいお菓子が紙に包まれていた。|今日は何の日でもない。それでも、こうしてみんなで集まれたことが、何かの始まりのように思えた。'],
  wonder: ['空の上へ', '雲の図書館', '階段の最後の一段を上がると、足もとに雲が広がっていた。その先に、扉のない図書館が静かに浮かんでいた。|本棚の間を、白い羽根がゆっくり通り過ぎた。本の背には、まだ誰も見たことのない星の名前が記されている。|一冊を手に取ると、ページの中から夜空がひらいた。紙の上を、小さな星が音もなく渡っていった。'],
};
const defaultMotif = { calm: 'forest', warm: 'flower', sad: 'rain', tense: 'city', eerie: 'night', joyful: 'flower', wonder: 'sky' };
for (const [id, mood] of Object.entries(MOODS)) $('mood').append(new Option(mood.label, id));
for (const [id, label] of Object.entries(MOTIFS)) $('motif').append(new Option(label, id));
$('mood').value = Object.hasOwn(MOODS, params.get('mood')) ? params.get('mood') : 'sad';
$('motif').value = Object.hasOwn(MOTIFS, params.get('motif')) ? params.get('motif') : defaultMotif[$('mood').value];
for (const key of ['size', 'timing', 'energy']) if ([...$(key).options].some(o => o.value === params.get(key))) $(key).value = params.get(key);
if (params.has('theta')) $('theta').value = params.get('theta');
if (params.has('at')) { $('freeze').checked = true; $('time').value = params.get('at'); }
$('reduced').checked = params.get('reduced') === '1';
let mode = params.get('mode') === 'full' ? 'full' : 'edge';
let palette = [...MOODS[$('mood').value].colors];
let page = 1;
const fx = createTurnFx($('turn-canvas'), () => $('book').getBoundingClientRect());

function swatches() { $('swatches').replaceChildren(...palette.map(color => { const el = document.createElement('i'); el.style.background = color; return el; })); }
function scene() {
  const [chapter, title, text] = scenes[$('mood').value];
  $('chapter').textContent = chapter; $('title').textContent = title;
  $('prose').replaceChildren(...text.split('|').map(t => { const p = document.createElement('p'); p.textContent = t; return p; }));
}
function options() { return { mood: $('mood').value, motif: $('motif').value, size: $('size').value, energy: +$('energy').value, theta: +$('theta').value, timing: $('timing').value, reduced: $('reduced').checked, mode, colors: palette, seed: 43 }; }
function status() {
  $('theta-out').value = (+$('theta').value).toFixed(1);
  $('time-out').value = $('time').value + ' ms';
  $('freeze-panel').hidden = !$('freeze').checked;
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  $('status').textContent = +$('theta').value === 0 ? 'θ=0：演出は出ません。' : ($('reduced').checked || matchMedia('(prefers-reduced-motion: reduce)').matches) ? '余白に静かな色だけを置きます。' : mode === 'full' ? ($('timing').value === 'late' ? '本文が表示済みなので、余白だけに切り替わります。' : '本文の上は0.36秒まで。粒は0.72秒で消えます。') : '本文のまわりに、大きく広がります。';
}
function update() { status(); if ($('freeze').checked) fx.preview(options(), +$('time').value); else fx.clear(); }
function play() {
  const oldPalette = palette;
  palette = mixPalette(palette, MOODS[$('mood').value].colors);
  let accepted = true;
  if ($('freeze').checked) fx.preview(options(), +$('time').value);
  else { accepted = fx.play(options()); if (!accepted) palette = oldPalette; }
  page += 1; $('page').textContent = String(page).padStart(2, '0');
  // 次のページは同じ場面の文章。順を変え、読み始めと演出の重なりを確かめる。
  const first = $('prose').firstElementChild; $('prose').append(first);
  status(); swatches();
  if (!accepted && +$('theta').value > 0) $('status').textContent = '続けてめくっている間は重ねません。';
}
$('mood').addEventListener('change', () => { $('motif').value = defaultMotif[$('mood').value]; fx.clear(); scene(); update(); });
for (const id of ['motif', 'size', 'energy', 'timing', 'theta', 'reduced', 'freeze', 'time']) $(id).addEventListener('input', update);
for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => { mode = button.dataset.mode; update(); });
$('play').addEventListener('click', play);
$('theme').addEventListener('click', () => { const dark = document.body.classList.toggle('dark'); $('theme').setAttribute('aria-pressed', String(dark)); $('theme').textContent = dark ? '明るい背景' : '暗い背景'; update(); });
if (params.get('theme') === 'dark') $('theme').click();
addEventListener('keydown', e => { if (e.target !== document.body || e.repeat || ![' ', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); play(); });
addEventListener('pagehide', () => fx.destroy(), { once: true });
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', update);
scene(); swatches(); update();
