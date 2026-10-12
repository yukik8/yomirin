# 公開の手順(Chrome ウェブストア・Vercel)

- **Status:** ストア公開の準備中(未申請)
- **関連:** 設計は [design.md](design.md)、利用者向けの説明は [../PRIVACY.md](../PRIVACY.md)、サーバの運用は [../server/README.md](../server/README.md)

---

## 0. 公開の前に決めること・用意するもの

| 項目 | 決めたこと | 残り |
|---|---|---|
| 製品名 | **よみりん**(manifest・PRIVACY.md・各画面の見出し) | — |
| アイコン | `extension/icons/` に 16/32/48/128px(manifest の `icons` と `action.default_icon`)。128px はストアの登録にも使う | — |
| ストアの画像 | `docs/store/` にそろえた: アイコン・スクリーンショット5枚・小さいプロモーション タイル・マーキー(作り方は [store/tools/README.md](store/tools/README.md))。読書中の3枚は試写室で撮ったもの | 本物の Play ブックスで撮った読書中の画面に差し替えてもよい(本文が写るのでパブリックドメインの本で) |
| プライバシーポリシー | PRIVACY.md。連絡先は GitHub Issues とストアの連絡先(メールを載せるなら足す) | 申請フォームに `https://github.com/yukik8/yomirin/blob/main/PRIVACY.md` を入れる |
| 規約 | 方式B(本文を端末の外に出さない) | 法的な判断ではないので、専門家の確認を勧める(design.md §9) |
| EU の公開者の区分 | **non-trader**(無料・個人・非商用) | 有料にする・事業として出すなら trader に変える(名前・住所・電話・メールがストアに公開される) |
| Vercel のプラン | Hobby | Hobby は個人・非商用向け。有料化・商用にするなら Pro を検討 |

## 1. うんちくサーバ(Vercel)

済:

- プロジェクト `reading-scaffold`(yukik8s-projects)。本番は `https://reading-scaffold.vercel.app`。拡張の `SERVER.base` と同じ
- `ANTHROPIC_API_KEY`(Production)を登録してある。本番でうんちくが返り、ログに単語が残らない
- GitHub の `yukik8/yomirin` と繋いである。**main に push すると本番に出る**(Root Directory は `server`、`server/` が変わっていない push は飛ばす)。手で出すときはリポジトリの一番上で `vercel deploy --prod`(詳しくは [../server/README.md](../server/README.md))

残り:

1. **Anthropic Console の利用額の上限**(このサーバ専用のキー・workspace に月の上限)。悪用への最後の砦
2. **Upstash Redis**(Vercel の Storage から繋ぐ)。無いと1日の回数制限はインスタンスのメモリで数えるので目安にしかならない
3. ストアに出して拡張の ID が決まったら、`RS_ALLOWED_ORIGINS=chrome-extension://<ID>` を入れて出し直す(他のオリジンからの呼び出しを断る。偽装はできるので補助)

環境変数の一覧と悪用への備えは [../server/README.md](../server/README.md)。

## 2. 拡張を用意する

### ストア版の振る舞い

ストアから入れた拡張の manifest には `update_url` が付く。コードはそれで本番と開発を見分ける(`IS_STORE_BUILD`・ビルド工程なし)。

| | 開発版(パッケージ化されていない) | ストア版 |
|---|---|---|
| うんちくサーバ | `http://127.0.0.1:8787` | `https://reading-scaffold.vercel.app` |
| ダッシュボードの「開発用」(θ の上書き・デモ・デモデータ投入・S の並走) | 出る | 出ない |
| θ の手動上書き(SET_THETA) | 受ける | 断る |
| 開始の通知の θ と版 | 出る | 出ない |
| コンソールの演出の記録(`[よみりん演出]`) | 出る | 出ない |

### 版を上げる

- `extension/manifest.json` の `version` を上げる。ローダーは版が変わると開いたままのタブにも入れ直す
- 動きが変わるなら 0.x を、修正だけなら 0.x.y を上げる
- 版を上げたら design.md の版の表に1行足す
- 拡張を更新すると、進行中のセッションは最後の記録の時点で閉じられる(design.md §3)

### zip を作る

リポジトリの一番上で:

```bash
cd extension && zip -r ../yomirin-$(node -p "require('./manifest.json').version").zip manifest.json icons assets src -x '*.DS_Store'
```

docs・server・.git は入れない(`*.zip` は .gitignore 済み)。

### 出す前に確かめる

zip を展開して「パッケージ化されていない拡張機能を読み込む」で入れる。そのままだと開発版として動くので、**ストア版の動きを見るときは展開したコピーの manifest に `"update_url": "https://clients2.google.com/service/update2/crx"` を一時的に足す**(本物の zip には入れない)。

1. 新しいプロフィールで入れると、オンボーディングが開く。診断 → 目標 → うんちくの同意(既定オフ)まで進める
2. Play ブックスで本を開き、「読む」を押す。Play ブックス以外のタブでは開始しない
3. 1ページめくると、画面の右下の角によみりんの話が出る(余白が狭いと出ない)。めくっても点滅しない。θ が高ければ、くま・突然クイズも出る(出るかどうかは抽選)
4. 章の始まりまでめくると、話がオチてフィーバーになる
5. 「終える」で閉じ、ダッシュボードの本棚に読んだ区間が出る
6. ダッシュボードの「データ」: エクスポート・同意の切り替え・内蔵AIの確認。ストア版で「開発用」が出ないこと
7. 同意をオンにしてうんちくが出たら、Vercel のログに単語が残っていないこと(`vercel logs --environment production --since 15m --no-branch`)
8. 全消去で、本棚とインストール ID が消える

自動テストは `tests/extension/`(依存なし。`node --test "tests/extension/*.test.mjs"`)。PR ごとに GitHub Actions(`.github/workflows/ci.yml`)で回る。上の手順の代わりにはならない: テストが見るのは制御器・権限・外へ送るものだけで、画面と Play ブックスとの繋がりは見ない。manifest の権限は §3「権限の用途」の表と同じでないと落ちる(権限を足すなら、表・PRIVACY.md・申告を先に直す)。

模擬の Play ブックスでの E2E は置いていない(#18 の「やらないこと」)。作るなら、Chrome は起動時の `--load-extension` を受け付けないので、DevTools のパイプ(`--remote-debugging-pipe --enable-unsafe-extension-debugging`)から `Extensions.loadUnpacked` を呼ぶ。

## 3. ストアに申請する

開発者ダッシュボード(https://chrome.google.com/webstore/devconsole)で新しいアイテムを作り、zip をアップロードして、下の内容を入れる。公開範囲(公開・限定公開)を選んで審査に出す。

### プライバシー(Privacy の欄)

フォームの文は英語で入れる(審査の担当に渡る。公開されるのは Data usage のチェックだけ)。

| 欄 | 入れるもの |
|---|---|
| Single purpose description | 下の「単一目的」 |
| scripting / storage / alarms / Host permission justification | 下の「権限の用途」 |
| Are you using remote code? | **No**(すべて拡張の中のファイル。eval・外部スクリプトなし) |
| Data usage(集めるもの) | 下の「データの扱い」の4つにチェック |
| 3つの宣誓 | すべてチェック(販売しない・目的外に使わない・信用評価に使わない) |
| Privacy policy URL | `https://github.com/yukik8/yomirin/blob/main/PRIVACY.md` |

#### 単一目的

Google Play ブックス(ウェブ版)で本を読む時間を支える。読んでいる間だけ補助の演出を出し、その量を本人が気づかない速さで自動的に減らしていく。

```text
Supports reading in the Google Play Books web reader. Only while the user is reading a book they started with the extension's "Read" button, it shows small reading-related effects (a bear character in a corner of the screen, short quizzes about the page just read, a celebration when a chapter ends) and automatically reduces the amount of this support over time, so the user can eventually read without it. It works only on Google Play Books.
```

#### 権限の用途

| 権限 | 用途 |
|---|---|
| `scripting` | 「読む」を押したとき、開いている Play ブックスのタブに、計測と演出のスクリプトを入れる |
| `storage` | 進行中のセッション・設定(診断の答え・目標・うんちくのサーバの同意)・インストール ID を端末に保存する |
| `alarms` | 30秒ごとに見回り、無操作や戻らないまま3分たったセッションを閉じる |
| `https://play.google.com/books/*` | Play ブックスのリーダーのタブであることを確かめ、本の ID と書名を読む |
| `https://books.googleusercontent.com/books/*` | 本文とページ表示はこのドメインのフレームの中にある。そこで読書時間を測り、演出を描く |

`tabs`・`activeTab`・全サイトへの権限は持たない。Play ブックス以外のページの URL も内容も読めない。

```text
scripting:
When the user presses "Read" in the extension popup on an open Google Play Books reader tab, the extension injects its scripts into that tab (including the frame that shows the book) to measure reading time and draw the reading effects. Scripts are injected only after this user action and only into Google Play Books pages.

storage:
Saves the in-progress reading session (so it survives service worker restarts), the user's settings (onboarding answers, weekly goal, whether the optional word-lookup server is enabled) and a random installation ID on the device. Reading records are stored on the device (IndexedDB) and are not sent to the developer.

alarms:
While a reading session is active, a check runs every 30 seconds to close sessions that have been idle, or that the user has not returned to for 3 minutes, so reading time is not over-counted. Alarms are used only for this session housekeeping.

Host permission:
https://play.google.com/books/* is used to confirm that the tab is the Google Play Books reader and to read the book ID and title, so reading records are kept per book.
https://books.googleusercontent.com/books/* is where the Google Play Books reader renders the book text and the page indicator (inside a frame). The extension's script runs in that frame to measure reading time, detect page turns and chapter starts, and draw the effects outside the text. The extension has no access to any other site.
```

#### データの扱い(Data usage)

端末の中だけで扱うデータも申告の対象(Chrome ウェブストアの User Data FAQ)。

| 区分 | チェック | 中身 |
|---|---|---|
| Location | ✓ | IP アドレス。うんちくのサーバをオンにしたときだけ、1日の回数制限のために数える(約25時間で消える) |
| Web history | ✓ | Play ブックスの本の URL(本の ID まで)・書名・読んだ時刻。端末の中にだけ保存 |
| User activity | ✓ | 読書時間・めくり・スクロール・離れた回数。端末の中にだけ保存 |
| Website content | ✓ | 本文は端末の中で読み取る(クイズ・問い。抜粋は80字まで保存)。うんちくのサーバをオンにしたときだけ、単語を最大8語送る |
| Personally identifiable information | — | 名前・メールなどは扱わない。インストール ID はランダムで、人やアカウントと結びつかない |
| Health / Financial / Authentication / Personal communications | — | 扱わない |

- 集めたデータは読書を支える目的にだけ使う(Limited Use・PRIVACY.md §5)。うんちくの単語を Anthropic に渡すのは、この機能のため
- 申告・PRIVACY.md・実際の動きが食い違うと違反になる。送るものを変えたら、3つともそろえる

### 掲載情報(Store listing)

| 欄 | 入れるもの |
|---|---|
| Summary from package | zip の manifest の `description` がそのまま出る: 「Google Play ブックスの読書に、だんだん外れていく補助輪。」 |
| Description | 下の「説明」 |
| Category | Education(教育) |
| Language | 日本語 |
| Store icon | `docs/store/icon-128.png` |
| Global promo video | なし |
| Screenshots | `docs/store/screenshot-1〜5-*-1280x800.png` を番号の順に(読書中・章の終わり・突然クイズ・ダッシュボード2枚) |
| Small promo tile | `docs/store/promo-440x280.png` |
| Marquee promo tile | `docs/store/marquee-1400x560.png` |
| Official URL | なし(Search Console で持ち主を確かめたサイトが無い) |
| Homepage URL | `https://github.com/yukik8/yomirin` |
| Support URL | `https://github.com/yukik8/yomirin/issues` |
| Mature content | なし |
| Item support | オン(GitHub を使わない人も、ストアから問い合わせられる) |

説明:

```text
本を開いても、気づくと別のタブを見ている。そんなときのための読書の補助輪です。

Google Play ブックス(ウェブ版)で「読む」を押すと、読んでいる間だけ、小さな演出が読書を支えます。
・画面の隅で、くまが何かを少しずつ作り進めます。めくるたびに少しずつ変わり、章を読み終えると、作っていたものが弾けたり崩れたりして、フィーバーになります
・ときどき、くまが画面の端から顔を出します
・さっき読んだページから、突然クイズが出ます

補助の量は、読めた回数に合わせて、気づかない速さで少しずつ減っていきます。最後は補助なしで読めるようになるのが目標です。

・本の本文は端末の外へ送りません。クイズと、読書中の問いへの答えは、Chrome に組み込まれた端末内の AI(Gemini Nano)が作ります
・読書の記録はすべてこの端末の中に保存します。ダッシュボードで、本ごとに読んだ区間・残り時間・自分の問いを見られます
・くまのうんちくだけは、オンにしたときに限り、単語を数語だけ送って言葉を調べます(既定はオフ)
・計測と演出は「読む」を押した間だけです。Play ブックス以外のページは読みません

必要なもの: Chrome 138 以降(内蔵 AI を使う場合)。Google Play ブックスのウェブ版で使います。
```

### 審査で聞かれそうなこと

- **Play ブックスの本の扱い:** 本文は端末の中で読み取るだけ。保存するのは、出題に使った箇所の80字までの抜粋、クイズの問題と選択肢、本人が書いた問いと選んだ文字列、内蔵AIの答えだけで、どれも端末の外へは出さない
- **ページを書き換えるか:** 書き換えない。演出は Shadow DOM の中の層に描き、ページの要素には属性も付けない

## 4. 公開した後

1. ストアの拡張 ID で `RS_ALLOWED_ORIGINS` を入れ、出し直す(リポジトリの一番上で `vercel deploy --prod`)
2. Vercel のログと Anthropic の利用額を、最初の数週はときどき見る
3. 直すときは版を上げて zip を作り直し、ストアにアップロードする(審査がある)
