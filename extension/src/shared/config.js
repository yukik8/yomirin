// タペリング制御器とセッションの設定。ドッグフーディング中は手で触る前提で1ファイルに集める。

// θ = ヒント・演出の頻度(本文1,000語あたりの表示回数)。[0, THETA_MAX]の連続値。
// 2026-08-16改訂: Level 5段階は廃止。段差は本人が気づく。
// Weber-Fechnerの法則(気づける最小変化=現在量の約10〜20%)に基づき、
// JND未満の乗算的漸減にする。目標値は常に0で、これは変えない。
export const THETA_MAX = 8;

export const CONTROLLER = {
  // W3で有効化(2026-08-16)。セッション終了ごとに基準θが自動で動く。
  enabled: true,
  // 'fixed'(v0.21 の固定則)| 'staircase'(閾値推定・staircase.js)。tools/replay で比べてから切り替える
  policy: 'fixed',

  // 成功セッションごとに θ ← θ×(1−alpha)。10%はJND未満(本人に通知しない)
  alpha: 0.1,
  // 失敗がこれだけ続いたら θ ← θ×(1+beta)。戻すときは大きめ(ヒステリシス)
  failStreakToRaise: 2,
  beta: 0.3,
  // 不変条件: 1日の総変化は±この率まで(急激な変化の禁止)
  maxDailyChangeRatio: 0.15,
  // 乗算は0に到達しないため、これ未満で0へスナップ(卒業)
  graduateBelow: 0.3,
  // ホメオスタットモード: 卒業後、補助なし読書時間の4週移動平均が
  // 卒業時ベースラインのdropRatioを切ったら一時的にθを再展開し、
  // recoverRatioまで戻るか、通常の漸減で0に着いたら再び卒業する(再展開中も目標は0)。
  // 卒業(再卒業)から窓の4週間は見守るだけで再展開しない — 4週平均が卒業後の読書を映すまで待つ。
  homeostatDropRatio: 0.5,
  homeostatRecoverRatio: 0.8,
  homeostatRedeployTheta: 1.5,
  homeostatWindowWeeks: 4,
  // ごく短く、離れてもいないセッション(誤って開始・本の切り替え)は成否に数えない
  neutralBelowMs: 60_000,
};

// 閾値推定の制御器(staircase.js・v0.22)。CONTROLLER.policy で切り替える。
// その人の「読める最低の θ」をセッションの成否から推定し、成功確率が target を保てる
// 最も低い θ に向けて動かす。θ の量を AI や学習に任せるのではなく、2〜3個の
// パラメータを持つ曲線をその人のデータで当てはめる(n=1・数十回で収束する)。
export const STAIRCASE = {
  target: 0.75, // この成功確率になる点(閾値の少し上)を目指す。λ と合わせて余白 ≈ 閾値×2 になる
  gamma: 0.15, // 補助がなくても読める確率(事前の見込み。実際に高い人は閾値が下に推定される)
  lambda: 0.1, // 生活のノイズ: θ がいくら高くても失敗する確率
  w: 0.5, // 閾値の鈍さ(log θ の尺度。0.5 ≈ θ の ±65% で成功率が大きく変わる)
  gridMin: 0.05, // 閾値グリッドの下端(θ)
  gridAboveMax: 1.5, // 上端は log(THETA_MAX) + これ(「最大量でも足りない」閾値を表せるように)
  gridN: 64,
  driftSd: 0.12, // 閾値が1セッションに動きうる幅(log θ)= 忘却の速さ。習慣で閾値が下がるのを追う
  raiseHysteresis: 1.05, // 目標点がいまの θ の 5% 以内なら上げない(揺れで上げない)
  knownSd: 0.5, // 事後分布の幅(log θ)がこれ以下なら「閾値が分かった」とみなし、余白の中では下げない
  // 探索の保留(micro-randomization): 下げる場面でもこの確率で据え置き、「下げたせいで
  // 読めなくなったか」を後から比べられるようにする。卒業が遅れるので既定は 0(使わない)
  exploreHoldP: 0,
};

// セッションごとの実効θ = θ × (1±この幅の乱数)。
// 日々±10%揺れる中を成功あたり10%下るので、下降トレンドがノイズに埋もれる(迷彩)。
export const THETA_NOISE = 0.1;

// デモモード: 演出だけを全体的に派手にする。計測・制御・記録には一切影響しない。
// ON/OFFはコード直書きをやめ、chrome.storage.local(プロフィールごとに独立)に置く。
// これで「本番プロフィール=常時OFFでクリーンな計測」と「デモプロフィール=ONで派手」を
// 同じコードのまま両立できる(フラグ書き換えの戻し忘れ事故が消える)。既定はOFF。
// ONの間: 読了お祝いは成功条件を待たず必ず出る / クイズは最初のヒント枠で必ず出て
// 正解は常に大当たり / レア演出の確率も大幅増。
export const DEMO = {
  boost: 3, // 星の数の倍率(サイズも1.25倍)。これは静的な調整値
};

const DEMO_KEY = 'demo_enabled';

// ストア版(Chrome Web Store から入れたもの)の manifest には update_url が付き、
// 開発中(パッケージ化されていない拡張)には付かない。ビルドなしで本番と開発を切り替える目印。
// 開発用の機能(θの手動上書き・デモ・デモデータ投入・開始通知のθ表示)はストア版では出さない。
export const IS_STORE_BUILD = (() => {
  try {
    return 'update_url' in chrome.runtime.getManifest();
  } catch {
    return false;
  }
})();

// よみりんのサーバ。うんちくで受け取るのは端末で選んだ「単語の候補」だけ。本の本文を受け取るのは
// クイズと問いへの答え(/quiz・/ask)だけで、本人が「本文を AI のサーバに送る」をオンにしたときに限る(下の readTextConsent)。
// 本番は Vercel。開発版も本番を呼ぶ(2026-10-15・v0.30。手元でサーバと鍵を用意しなくても、クイズ・問い・うんちくを試せる)。
// 手元の uvicorn(server/README.md)で試すときは、base を 'http://127.0.0.1:8787' にする。
// 拡張にこのオリジンの host 権限は付けない — サーバ側が chrome-extension:// に CORS を返す。
const PRODUCTION_BASE = 'https://reading-scaffold.vercel.app';
export const SERVER = {
  base: PRODUCTION_BASE,
  // 使われ方の要約(#28)は、開発版も本番に送る(2026-10-15。開発中の自分の記録も同じ表に貯める)。
  // 開発版の行は hello の build が 'dev' なので分けられる。送り先を手元に戻す前に「送ったものを消す」を押す
  // (消すのも、いまの送り先にだけ届く)。手元のサーバで試すときは、ここを 'http://127.0.0.1:8787' にする
  telemetryBase: PRODUCTION_BASE,
  timeoutMs: 15_000,
  maxTerms: 8, // 1回に送る単語の候補の上限
  maxTermChars: 16, // 1語の長さの上限
};

// うんちくのために単語をサーバへ送ってよいか(本人の同意)。既定は送らない。
// オンボーディングとダッシュボードで本人が選ぶ。同意が無ければ、うんちくは出ない。
const CONSENT_KEY = 'trivia_server_consent';

export async function readServerConsent() {
  try {
    const r = await chrome.storage.local.get(CONSENT_KEY);
    return r[CONSENT_KEY] === true;
  } catch {
    return false;
  }
}

export async function writeServerConsent(value) {
  try {
    await chrome.storage.local.set({ [CONSENT_KEY]: value === true });
  } catch {
    /* 失敗は無視(次回の読みで「送らない」扱い) */
  }
}

// 本文を AI のサーバに送ってよいか(本人の同意・#13・docs/design.md §9・PRIVACY.md §2-2)。オンにすると、
// 突然クイズと問いへの答えを、読み終えた本文からサーバ(→ Anthropic)で作る。くまのうんちくも出る(送るのは
// 本文から選んだ単語の候補で、本文より少ない)。新しく入れた人には、最初の設定でチェックを入れた状態で見せる
// (既定オン・送る前に必ず一度見せる)。この版より前から使っている人は、選ぶまでオフ(キーが無い=まだ選んでいない
// =送らない。PRIVACY.md §6「送るものを増やすときは、あらためて同意をいただく」)。ダッシュボードの「データ」で切り替える。
const TEXT_CONSENT_KEY = 'text_server_consent';

/** 本文を送るかの選択。true / false、まだ選んでいなければ null。 */
export async function readTextChoice() {
  try {
    const r = await chrome.storage.local.get(TEXT_CONSENT_KEY);
    return typeof r[TEXT_CONSENT_KEY] === 'boolean' ? r[TEXT_CONSENT_KEY] : null;
  } catch {
    return null;
  }
}

export async function readTextConsent() {
  return (await readTextChoice()) === true;
}

export async function writeTextConsent(value) {
  try {
    await chrome.storage.local.set({ [TEXT_CONSENT_KEY]: value === true });
  } catch {
    /* 失敗は無視(次回の読みで「送らない」扱い) */
  }
}

// 使われ方の要約(#28・docs/design.md §9)。セッションを閉じたあと、その要約(読書時間・離脱・θ・成否など。
// 値は数・真偽・決まった語だけ)を同じサーバの /telemetry に送る。本・本文・問い(記録層)は送らない。
// 新しく入れた人には、最初の設定でチェックを入れた状態で見せる(既定オン)。この版より前から使っている人は、
// 選ぶまでオフ(キーが無い=送らない。ダッシュボードで一度だけ知らせる)。
export const TELEMETRY = {
  v: 1, // 送る行の形の版(サーバの TmSession / TmHello と揃える)
  maxOutbox: 50, // 送り待ちに置く行の上限(古い順に捨てる)。1回の POST もこの行数まで
  timeoutMs: 10_000,
};

const TELEMETRY_CONSENT_KEY = 'telemetry_consent';

/** 使われ方の要約を送ってよいか。true / false(本人が選んだ)/ null(まだ選んでいない=送らない)。 */
export async function readTelemetryChoice() {
  try {
    const r = await chrome.storage.local.get(TELEMETRY_CONSENT_KEY);
    return typeof r[TELEMETRY_CONSENT_KEY] === 'boolean' ? r[TELEMETRY_CONSENT_KEY] : null;
  } catch {
    return null;
  }
}

export async function readTelemetryConsent() {
  return (await readTelemetryChoice()) === true;
}

export async function writeTelemetryConsent(value) {
  try {
    await chrome.storage.local.set({ [TELEMETRY_CONSENT_KEY]: value === true });
  } catch {
    /* 失敗は無視(次回の読みで「送らない」扱い) */
  }
}

// 本を開いたら「計測しますか?」とたずねるか(#32・docs/design.md §3)。ダッシュボードで切り替える。
// キーが無い=たずねる(押し忘れ対策なので既定オン。外へ送るものではないので同意は要らない)
const START_PROMPT_KEY = 'start_prompt';

export async function readStartPrompt() {
  try {
    const r = await chrome.storage.local.get(START_PROMPT_KEY);
    return r[START_PROMPT_KEY] !== false;
  } catch {
    return false;
  }
}

export async function writeStartPrompt(value) {
  try {
    await chrome.storage.local.set({ [START_PROMPT_KEY]: value === true });
  } catch {
    /* 失敗は無視(次回の読みで今の値のまま) */
  }
}

/** デモモードの現在値(プロフィールごと)。既定OFF。読めなければOFF扱い。 */
export async function readDemoFlag() {
  try {
    const r = await chrome.storage.local.get(DEMO_KEY);
    return r[DEMO_KEY] === true;
  } catch {
    return false;
  }
}

export async function writeDemoFlag(value) {
  try {
    await chrome.storage.local.set({ [DEMO_KEY]: value === true });
  } catch {
    /* 失敗は無視(次回の読みでOFF扱い) */
  }
}

export const SESSION = {
  // 読書時間の操作的定義: 本文段落が可視、かつ直近このミリ秒以内に
  // スクロールまたは操作がある時間。
  activityWindowMs: 30_000,
  // ページ送りの本(Play ブックス)では、1ページを読む間(縦書き文庫で約60秒)は操作が無い。
  // 30秒だと1ページの後半が数えられないので、ページ送りを操作とみなしたうえで窓を広げる。
  pagedActivityWindowMs: 90_000,

  // dwellの積算粒度。設計ドキュメントは30秒だが20秒に落としている。
  // MV3のService Workerはメッセージが30秒途切れると停止しうるため、
  // 30秒ちょうどの間隔だと停止と再起動の境界に当たる。20秒なら鼓動が絶えない。
  dwellTickMs: 20_000,

  // 無操作・未復帰でセッションを自動終了するまでの時間。
  idleTimeoutMs: 3 * 60_000,

  // 本文のフレーム(books.googleusercontent.com)に loader が入らなかったとき、入れ直すまでの待ち(#38)。
  // ページの読み込み終わり(再読み込み・読み込み直後の「計測しますか?」)には、本文のフレームがまだ無いことがある
  injectRetryMs: [1_000, 2_000, 4_000, 8_000],

  // 本文検出の合格ライン。これを下回るページは「計測のみ」モードにする。
  minParagraphs: 3,
  minWords: 200,
};

// 常時演出(ambient): 読んでいる間、θに比例した密度で小さな星を漂わせる。
// ヒント(離散的な報酬)と別系統の「地」の演出。θに比例するので、
// Level 0で最も濃く、Levelが上がると自然に薄まり、Level 5(θ=0)で消える。
export const AMBIENT = {
  enabled: true,
  tickMs: 1_500,
  // 1 tickあたりの「キラッ」発生確率 = (θ/θmax)² × maxClusterChance。
  // 均等に湧かせず、余白の一点に星が固まって瞬く(1回3〜7粒)。
  // 2乗カーブ: Level 0で約4.3秒に1回、中間は稀に、卒業間際はほぼ無音。
  maxClusterChance: 0.35,
};

// 紙のめくれ(ambient): 読んでいる間、ときどき風で左下の角がペラっとめくれて戻る。本文には重ねない。
// 頻度と大きさはθに比例し、θ=0で出ない。
// 2026-10-07: 読書中に邪魔だったので止めた(普段の演出は余白だけに描く margin.js に寄せた)
export const PAGE_CURL = {
  enabled: false,
  tickMs: 1_500,
  maxChance: 0.06, // θ=THETA_MAX のとき、1 tick あたりにめくれる確率(平均して約25秒に1回)
  minGapMs: 8_000, // 前のめくれからの最小間隔
  minSize: 36, // めくれの大きさ(角からの px)。θに比例して min〜max
  maxSize: 90,
};

// 先触れ(予期の設計・v0.11.0): レア以上はヒント計画時に事前ロールし、発火が近づくと
// 地のきらきらが金(激レアは虹)に変わる。ドーパミンは報酬でなくcueと予測誤差で出る
// (Schultz 1997)ため、予期の窓を作る。予告は必ず当たる(ニアミス禁止)。
// 段落の難しさ(content/difficulty.js)で、ヒント枠の配分と突然クイズの素材を決める。
// 枠の重み = (0.1 + 難しさ)^k、k = focusMax × (1 − θ/THETA_MAX)。
// θ が最大のとき k=0(一様 = 今までどおり)、θ が下がるほど難しい段落に寄る — 易しい所から先に消える。
// 頻度は θ が決めたまま(枠の数は変えない)。どこに出るかは乱数のままで、予測できなさは残る。
export const DIFFICULTY = {
  enabled: true,
  focusMax: 3,
};

export const FORESHADOW = {
  // 何段落先までを「近い」とみなして先触れを始めるか
  aheadParagraphs: 4,
  // 先触れ開始後、この回数のdwell tickまでに段落が来なければ発火を保証する
  // (予告を裏切らない: 約60秒で必ず本演出)
  guaranteeTicks: 3,
};

// 天井(下限保証・v0.11.0): θ>0なのに演出ゼロの実読書が続いたら、次の区切りで
// normal一回を確定させる。ハマリの演出化(残り時間の表示・示唆)は移植しない。
// 天井分数 = perThetaMinutes/θ を[min,max]に丸める(θが低いほど天井は遠い)。
export const CEILING = {
  enabled: true,
  perThetaMinutes: 12,
  minMinutes: 3,
  maxMinutes: 15,
};

// 演出のレア度。ヒント発火時にロールする(=頻度はθ配下のまま、大きさだけ可変)。
// ドーパミンは報酬の予測誤差で出るので、頻度の乱数に加えて大きさも予測不能にする。
// ルール: 予告(foreshadow)はレア以上が確定したときだけ出す。
// ニアミス(予告→ハズレ)は悔しさ駆動の技法なので構造的に作らない。
export const EFFECT_TIERS = {
  epic: { p: 0.025 }, // 激レア: 金の雨(濃)+縁光。約1/40
  rare: { p: 0.12 }, // レア: 金の雨。約1/8
};

// クイズ(理解連動Micro Content)。サーバが読み終えた本文から出題する(本人が本文を送るのをオンにしたときだけ)。
// ヒント枠の一部がクイズに化ける形なので頻度はθ配下のまま。1セッション1問まで。
// 作れなければ静かに何も出さない(読書を壊さない)。
export const QUIZ = {
  enabled: true,
  // ヒント枠がクイズに化ける確率
  p: 0.3,
  // 読了済み段落がこれ未満なら出さない(素材不足)
  minParagraphsRead: 3,
  // 正解時の演出の強さはθに連動(低Levelほど盛大に、卒業に向けて漸減):
  //   θ >= jackpotMinTheta → 大当たり(予告→縁光→特濃の雨+三波)
  //   θ >= rainMinTheta   → 金の雨
  //   それ未満            → 星の二波のみ
  jackpotMinTheta: 5, // Level 0-1
  rainMinTheta: 3, // Level 2
};

// めくった直後の「突然の出来事」(Play ブックス)。出たり出なかったりする(可変報酬)。
// 突然クイズと、くま(うんちく/顔を出すだけ)は別々に抽選する(同じ枠で取り合うとクイズがほぼ出なくなる)。
// 同じめくりで両方当たればクイズを優先。うんちくとクイズは生成に数秒かかるので、読み終えたページから
// 先に1つずつ作ってストックしておく。頻度も派手さもθに比例し、θ=0では何も起きない。
// Play ブックスでは通常のヒント→クイズ化は止め、クイズはこちらに一本化する。
export const PAGE_EVENTS = {
  enabled: true,
  minTurns: 2, // セッション開始後、この回数のページ送りまでは何も起きない
  delayMs: 600, // めくってから出すまでの間(突然感)
  // 突然クイズ: θ=THETA_MAX のとき1回のページ送りで出る確率と、クイズどうしの最小間隔
  quiz: { maxP: 0.25, minGapMs: 120_000 },
  // くま: 同上。weights はうんちく(作れていれば)と、顔を出すだけ の割合
  bear: { maxP: 0.35, minGapMs: 45_000, weights: { trivia: 0.65, peek: 0.35 } },
  afterQuizMs: 20_000, // クイズの直後はくまを出さない
  minTextChars: 120, // 出題・うんちくに使う読了済み本文の最低文字数
  maxTextChars: 1_500, // 生成の素材にする本文の上限(サーバへ送るのは、本人が本文を送るのをオンにしたときだけ)
  // 素材が作れなかった(本文を送らない設定・サーバに届かない・話せることが無い)あと、次に作りに行くまで空けるページ送りの回数
  retryAfterTurns: 3,
  // 正解・読了で「大当たり!!」「読了!!」の言葉を出す。言葉の原則(言葉で褒めない)を
  // この瞬間に限って緩める設定。false にすると光と動きだけになる。
  words: true,
  // 読む速さに合わせた出し方(v0.24)。本人の速さ(語/分)が分かっていれば、めくった直後ではなく
  // 「いま見えているページの、うんちくの語を確実に読み過ぎた頃」に出す。素材はいま見えている
  // ページ(そこから端末で単語の候補を選び、サーバへはその候補だけを送る)。速さが分からない最初の数ページ
  // (持ち越しも無い)は従来どおり、めくった直後に前のページの話をする。
  paced: {
    enabled: true,
    minSamples: 3, // このページ数の標本(持ち越し含む)が無ければ使わない
    slowFactor: 0.8, // 本人の速さのこの倍で読んでいると仮定する(少し遅いくらいのペース)
    cvMargin: 1.0, // ばらつき(cv)× この係数 だけ、さらに遅らせる
    minMs: 4_000, // めくってから最低これだけは待つ(めくった直後に出さない)
    endGuardMs: 8_000, // ページの終わりの推定よりこれ以上手前でなければ出さない(めくりとぶつけない)
    maxMs: 150_000, // これより先の予定は立てない(置いていったページで出さない)
    peekAt: 0.45, // 顔を出すだけ のときは、ページのこの割合を読み過ぎた頃(遅らせ込みでページの終わりに掛からない所)
    carryTurns: 1, // 間に合わなかったうんちくを「さっきのページの」として出せるめくり回数
    priorWeight: 6, // 持ち越した速さを、何ページ分の標本として扱うか
  },
};

// めくった瞬間の花びら(Play ブックス): ページを送るたびに、クイズ正解と同じ花びら・ことば吹雪・
// 星を上から数秒降らせる。読んでいる行に重ねないよう、視線が次のページへ移る切れ目に限る。
// 確率 = maxP × (θ/θmax)、量も Paint が θ で絞る — 最初の頃はほぼ毎回たっぷり、θ=0で出ない。
// 2026-10-07: 本文の上に毎回降って邪魔だったので止めた(大きく出すのはクイズ・読了だけ)
export const PAGE_SHOWER = {
  enabled: false,
  maxP: 1, // θ=THETA_MAX のとき、1回のページ送りで降る確率
};

// 読書中の派手さ(v0.25・2026-10-09・docs/style.md §7)。原則:
//   - 派手さは「動きの速さ」ではなく「色・量・広さ」で出す
//   - 動かすのは「目が文章から離れる瞬間」(めくり・章の終わり)だけ。読んでいる瞬間には動かさない
//   - 読んでいる時間の報酬は「世界が育っていること」で表す。手が止まっても何も減らさない
//     (考えて止まる時間も読書。ページを速く進める人ではなく、本に注意を留められる人を育てる)
// 3つの階層: Micro(めくり中)/ Meso(読書中・静止)/ Macro(章・読了)。どれも本文の外にだけ描き、
// θ に比例して静かになり、θ=0 では出ない。はじめは全部盛りで、あとから取捨選択する(enabled: false で止める)。
export const READING_FX = {
  // 読んでいる瞬間には動かさない: 余白のヒント・予告を静止した飾りにし、めくった瞬間に置く。
  // 地のきらきら(読書中に拍ごとに瞬く星)も出さない。false で前の版(舞う花びら・瞬く星)に戻る
  still: true,
  // Meso・縁の光: 余白を水彩の色で染める。章の区切りから fullPages 回めくると最も濃い(めくるたびに少しずつ。見開きは2ページで1回)
  glow: { enabled: true, fullPages: 12, maxAlpha: 0.6 },
  // Meso・余白の飾り: ちゃんと読んだページ(minPageMs 以上)をめくるたびに一つ〜三つ(芽・葉・花・銀の星。θ が高いほど多い)。
  // bearAt ページ目に、余白で一緒に読むくまが一度だけ座る。章の終わりで吸い込まれて空になる(集めて残さない)。
  // 2026-10-10: 散らばる飾りは「溜まった感」が出ないので、よみりんの話(story)と比べるために止めてある(enabled)。
  // minPages・fallbackPages・minPageMs は話と章の区切りでも使う
  garden: { enabled: false, minPages: 3, fallbackPages: 12, maxItems: 36, minPageMs: 6_000, bearAt: 5 },
  // Meso・よみりんの小さなストーリー(stories.js・story.js): 画面の右下の角で、無言のくまが一つのものを作り進める。
  // 1コマ目は最初のめくりで必ず出て、そのあとは、ちゃんと読んだページをめくるたびに、確率 (minP + (maxP − minP) × θ/8) × 話の進みやすさ で1コマ進む
  // (skipP × θ/8 で2コマ)。最後から2つ目のコマで止まって待ち、章の終わりにオチる。章のフィーバーの大きさは溜まった分で決まる
  // (限界まで来ていれば θ/8 のまま、何も溜まっていなければ その minRelease 倍)。見出しの無い本は、待ち始めてから ripePages(乱数の範囲)めくりで自分でオチる
  story: { enabled: true, minP: 0.12, maxP: 0.45, skipP: 0.15, ripePages: [2, 4], minRelease: 0.55 },
  // Meso・予告: レア以上が aheadPages ページほど先に待つと、めくるたびに静かな印が増える
  // (レア: 金の星 → 金の星 / 激レア: 金の星 → 金の星 → くまの耳 → 虹のかけら)。残りのページ数は示さない
  premonition: { enabled: true, aheadPages: 3 },
  // 激レアの当たり: くまが画面を斜めに駆け抜ける(めくった瞬間・幕なし)
  flyby: { enabled: true },
  // Macro・章の終わり: めくった先が章の始まり(見出しが見つからない本は fallbackPages ページごと)で、
  // 余白が吸い込まれてフィーバー「章 読了!!」。数秒で本に戻る
  chapter: { enabled: true },
  // Micro・めくりの光: めくっている間に画面の上下の縁を光が走る。θ=THETA_MAX で maxP の確率、minGapMs 以上空ける
  turnFlash: { enabled: true, maxP: 0.2, minGapMs: 20_000 },
};

// 1ページの長さ(#33・background/zoom.js): 補助の多いうちは、読書中のタブを大きく映して1ページに入る字数を減らす。
// ⌘+ と同じブラウザの倍率を、セッションの開始で実効θから決めてこのタブだけに掛け、終わったら元に戻す。
// 倍率 = 1 + (max − 1) × θ/8。minFactor 未満なら掛けない(θ が約0.7未満・θ=0)。いまの倍率がそれ以上でも
// 掛けない(本人が自分で大きくしている)。掛けた回は effect_shown 'page_zoom' を1回数える(補助なしに数えない)
export const PAGE_ZOOM = {
  enabled: true,
  max: 1.6, // θ=8 での倍率(仮。手で ⌘+ を押して読めた倍率に合わせる)
  minFactor: 1.05, // これより小さい倍率は掛けない
  settleMs: 800, // 掛けてから注入するまで待つ(Play ブックスがページを組み直す間)
  afterCelebrateMs: 3_000, // お祝い(余白の金の花)を出した回は、出し終えてから戻す(組み直しで花が本文にかからないように)
};

// 端末内の記録の保持。細かい計測(20秒ごとの鼓動・スクロール)だけを期間で消す。
// セッションの集計・本・読んだ区間・クイズ・問いは本人が消すまで残す(本人の資産)。
export const RETENTION = {
  detailEventsDays: 180,
  detailEventTypes: ['dwell_tick', 'scroll', 'page_read'],
};

// success := read_ms >= 5分 かつ escapes <= 1
export const SUCCESS = {
  minReadMs: 5 * 60_000,
  maxEscapes: 1,
  // 制御器が読む成否の決め方。'binary' は上の2条件、'stability' は読書安定度 S を
  // STABILITY.successAt / failAt で3値(成功・失敗・据え置き)に切る。
  // binary は緩く(5分読めばほぼ成功)、θ と無関係に成功が並ぶ = 制御器に情報が届かない。
  // tools/replay で並走データの一致率を見てから 'stability' に切り替える
  judge: 'binary',
};

// 読む速さ(ページごとの 語数 ÷ 滞在時間)。離脱・5分より早く・細かく「詰まった/流した」が見える。
// その人の速さの分布は sessions の pace_wpm から取る(端末内)。
export const PACE = {
  minPageMs: 3_000, // これより短い滞在は「めくり飛ばし」(読んでいない)。速さの標本に入れない
  maxPageMs: 10 * 60_000, // これより長い滞在は放置。標本に入れない
  minPageWords: 20, // 挿絵・章題だけのページは標本に入れない
  maxSamples: 400, // 1セッションに持つ標本の上限
  slowRatio: 2, // 中央値のこの倍より遅いページ = 詰まった
  fastRatio: 0.4, // 中央値のこの倍より速いページ = 流した
};

// 読書安定度 S ∈ [0,1](docs/design.md §4)。二値successの粗さ(20分読んで1回逸れた人と
// 5分ぎりぎりの人が同じ「成功」)を連続値に格上げする。
// v0.14: 並走計測のみ。sessions.stability に保存して二値と一致率を見る。制御には繋がない。
// 不変条件: 入力は行動シグナルだけ。ヒント数・演出数・クイズ正誤・問いの数・目標達成・
// 連続日数などエンゲージメント/理解の指標は入れない(自己目的化回路を作らない)。
// v0.22: completion(本の中の位置 — その回の読み方と無関係に後半ほど高くなる)を
// steady(ページの速さのばらつきの小ささ)に置き換え、ending の重みを下げた(終了ボタンを
// 押したかどうかで成否が割れないように)。
export const STABILITY = {
  weights: { dur: 0.45, escape: 0.25, return: 0.15, steady: 0.1, ending: 0.05 },
  durFullMin: 20, // この分数で読書時間の項が満点
  escapeFullCount: 3, // この回数の離脱で離脱項が0
  awayFullMs: 3 * 60_000, // 累計でこれだけ離れていたら離脱項が0
  quickReturnMs: 60_000, // これ以内の復帰を「すぐ戻った」と数える
  ending: { manual: 1, close: 0.8, idle: 0.6 },
  steadyCvFull: 1.0, // 速さの変動係数(標準偏差/平均)がこれで steady 項が 0。標本が無ければ 0.5
  // 制御接続時の閾値(並走中は未使用): S≥successAtで成功、S≤failAtで失敗、間は据え置き
  successAt: 0.7,
  failAt: 0.3,
};

// 記憶の層(docs/design.md §8・background/memory.js)。読んだものが自分の知識として残る、の実体。
// 原則: 自分で思い出す(retrieval practice)> 要約。本人が残した主張・問うたこと・答えたクイズを、
// FSRS-5(shared/fsrs.js)の間隔で思い出す。演出なし・褒めない・催促しない(記録カテゴリ)。
export const MEMORY = {
  desiredRetention: 0.9, // 思い出せる確率がここまで落ちた日に出す(FSRS の目標保持率)
  maxDuePerVisit: 5, // ダッシュボードを開いたとき出す上限(残りは次回)
  claimMaxChars: 120, // 主張は一文(読んだ直後に、本人の言葉で)
  retentionDays: [7, 30], // 「時間がたっても残っていること」の節目
};

// 週次目標(評価レイヤーのKPI)。ユーザーが自分で選ぶ。段階が上がると評価だけが厳しくなる。
// 制御器はこれを一切読まない(目標を制御に入れない — 不変条件)。SUCCESSの定義も動かさない。
// 達成率はダッシュボードにのみ事実として表示する(popupのMirrorには出さない — 責めない原則)。
// 閾値の根拠: docs/research/benchmark.md §3・§5(レベル2の10分はGloria Markの
// 「中断までのプロジェクト集中≈10.5分」、レベル3の週60分はATUSのintensive reader相当)。
export const GOALS = {
  level1: { name: 'まず読める', desc: '成功セッション 週3回', sessions: 3 },
  level2: { name: '続けて読める', desc: '成功セッション 週5回・10分続けて', sessions: 5, streakMin: 10 },
  level3: { name: '自分の力で読める', desc: '補助なしで 週60分', unassistedMin: 60 },
};
export const DEFAULT_GOAL = 'level1';

// 合格ライン(2026-09-14確定・docs/design.md §10)。「達成率を保ったままθが下がる」の
// 「保つ」を数値化したもの。評価レイヤー専用 — 制御器は読まない。
export const PASS = {
  achievementFloor: 0.8, // 週次達成率がこれ以上を「保った」と数える
  weeksRequired: 3, // 直近weeksWindow週のうちこれだけ保てば維持
  weeksWindow: 4,
  graduateWithinWeeks: 12, // 開始からこの週数以内に θ=0
  quizDropMaxPt: 10, // クイズ正答率が全期間平均よりこれ以上落ちたら理解の劣化
  // 卒業後の維持(50%割れで再展開)は CONTROLLER.homeostatDropRatio が担う
};

// 初回診断(オンボーディング)。4問×0〜2点の合計(0=軽い〜8=重い)を初期θに写す。
// スコア・θを本人に見せない(「中毒度」のラベリングをしない — PRD「診断と目標設定」)。
// 診断は内部でθの初期値としてだけ働き、以後のθは制御器だけが動かす。
export const DIAGNOSIS = {
  thetaByScore: [2, 3, 4, 5, 5.5, 6, 7, 7.5, 8],
  /** 目標のおすすめ。重いほど控えめな段階から(自己設定なので最終決定は本人)。 */
  recommendGoal(score) {
    if (score >= 5) return 'level1';
    if (score >= 2) return 'level2';
    return 'level3';
  },
};

export const MIRROR = {
  // 週次グラフに出す週数。
  weeks: 8,
  // 補助なし読書時間の定義: ヒントも演出も1回も出さなかったセッションのread_msの合計。
  // 設計ドキュメントは「Level 4以上のセッション」としているが、これは代理指標で、
  // Level 4(θ=0.5)でもヒントは出る。実際の表示回数で数えるほうが定義として正確で、
  // ヒントが未実装のW1でも意味のある数字になる。
  unassistedRequiresZeroHints: true,
};
