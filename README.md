# よみりん

Google Play ブックス(ウェブ版)で本を読む時間を支える Chrome 拡張。製品名は「よみりん」。

読む力を意志力ではなく環境で支えて、その支え(ヒント・くまの演出・突然クイズ)を本人が気づかない速度で減らしていく。
効果は **「週次目標の達成率 × θ(補助量)の推移」** の対で測る — 達成を保ったまま補助が
減り続けなければ機構の失敗と判定する(KPIの経緯と根拠: [docs/research/benchmark.md](docs/research/benchmark.md) §5)。

- 設計(唯一の一次資料): [docs/design.md](docs/design.md) — θ・三分法(演出/記録/道具)・制御器・演出・データ・不変条件
- 公開の手順(ストア申請・Vercel・zip): [docs/release.md](docs/release.md)
- 見た目と言葉のテイスト(画面・演出・図を作るとき): [docs/style.md](docs/style.md)
- プライバシーポリシー(公開用): [PRIVACY.md](PRIVACY.md)
- サーバ(うんちく・使われ方の要約)の運用: [server/README.md](server/README.md)
- 文献の調査: [docs/research/](docs/research/)。古い設計書は [docs/archive/](docs/archive/)
- ステータス: v0.21.1 / Play ブックス専用。Chrome ウェブストア公開の準備中

## 原則(コードで守るもの・抜粋)

全10条は [docs/design.md §11](docs/design.md#11-不変条件コードで守るもの)。

1. **ページを改変しない。** 追加するのは Shadow DOM の中の層だけ。演出は本文の外(余白)に描き、文字の上に重ねない。
2. **計測はセッション中のみ。** 「読む」(か、本を開いたときの「計測しますか?」の「はい」)を押してから終えるまで。タブ観測の全ハンドラは最初にセッションの存在を確認し、無ければ何も読まず何も書かずに戻る(例外は、本を開いたタブに「計測しますか?」を出すことだけ)。
3. **θの目標値は常に0。** エンゲージメント指標を制御器の入力にしない(スロットマシン化の構造的禁止)。演出の量と派手さはθに比例し、θ=0では何も出さない。
4. **本の本文を端末の外へ出すのは、本人が「本文を AI のサーバに送る」をオンにしたときだけ。** クイズと問いへの答えは、読み終えたページの本文の一部と問いからサーバで作る(サーバには残さない)。うんちくのサーバへ送るのは、端末で選んだ単語の候補だけ。使われ方の要約(オフにしていなければ)は数・真偽・決まった語だけで、本文は入らない。
5. **記録層(本・本文・読書メモリ)はローカルのみ。** IndexedDB に留め、サーバへは出さない。計測と θ は、オフにしていなければ、閉じたセッションの要約だけを送る(design.md §9)。

## 構成

```
extension/            Chrome 拡張(MV3・ビルド不要の ES モジュール)
  manifest.json       権限は scripting / storage / alarms と Play ブックスの2ホストだけ
  src/background/     Service Worker: セッション状態機械・制御器・IndexedDB・生成の検め(ai.js)・サーバとの通信(server.js・telemetry.js)
  src/content/        セッション中だけ注入される content script(計測・余白の演出・くま・突然クイズ・読了フィナーレ)
  src/popup/          「読む」ボタンと今週の様子
  src/onboarding/     初回の診断・目標・外へ送るかどうかの同意
  src/dashboard/      本棚・帯・推移・データ管理
  src/shared/         設定(config.js)とイベント型
server/               よみりんのサーバ(FastAPI・Vercel)。うんちくの単語の候補・クイズと問いの本文(本人がオンのときだけ)・使われ方の要約(Postgres)を受ける
docs/                 設計ドキュメント(古い版は docs/archive/)
```

## 動かす

ビルド工程は意図的に置いていない。`chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」で `extension/` を選べばそのまま動く。

- 開発中の拡張も、本番のサーバを呼ぶ(うんちく・クイズ・問い・使われ方の要約。要約の行は `build = 'dev'` で分かる)。手元のサーバで試すときは `extension/src/shared/config.js` の `SERVER.base` を `http://127.0.0.1:8787` にする(起動は [server/README.md](server/README.md))。
- ストア版(manifest に `update_url` が付く)は本番のサーバを呼び、開発用の機能(θの手動上書き・デモ・デモデータ投入・開始通知のθ表示)を出さない。切り替えは `extension/src/shared/config.js` の `IS_STORE_BUILD`。
- クイズと問いは、「本文を AI のサーバに送る」がオンのときに出る(最初の設定・ダッシュボードの「データ」)。v0.30 で端末内の Gemini Nano はやめた(空きディスク 22GB 以上などが要り、使える人と使えない人に分かれた)。

## ストアに出す

zip の作り方・出す前の確認・申請の書き方は [docs/release.md](docs/release.md)。
