# server — くまのうんちくサーバ

FastAPI。役目は1つ: 拡張が端末で選んだ**単語の候補**(最大8語)から、くまのうんちくを1つ返す。

- **本の本文・書名・URL は受け取らない。** Google Play の規約で購入した本の送信・再配布は禁止のため、
  本文を扱うクイズと問いは端末内の Gemini Nano だけで作る(このサーバには `/quiz`・`/ask` は無い)。
- 拡張がこのサーバを呼ぶのは、本人がオンボーディングかダッシュボードで「言葉を調べるサーバを使う」を
  オンにしたときだけ(既定オフ)。
- 受け取った単語も生成結果も保存しない。ログは1行 JSON で、状態・所要時間・トークン数だけ(単語は出さない)。
- API キーはサーバだけが持ち、拡張には渡さない。

## エンドポイント

| | 入力 | 出力 |
|---|---|---|
| `GET /healthz` | — | `{"ok": true}` |
| `POST /trivia` | ヘッダ `X-RS-Install: <UUID>`(拡張がインストールごとに作るランダムな ID)、本文 `{"terms": ["活動写真館", ...]}`(1〜8語・各16字まで) | `{"ok": true, "trivia": {"text", "term"}}`。話せることが無ければ `{"ok": false, "error": ...}` |

`term` は必ず候補の中の1語。言い切れない(`sure: false`)・擬音らしい・90字超・URL 入りは返さない。
ID が無いと 401、1日の上限を超えると 429。

## 悪用と料金への備え

公開サーバなので、誰でも叩ける前提で守っている。

1. **1日の回数制限**(UTC の日付で区切る): インストールごと `RS_LIMIT_PER_INSTALL`(既定150)、
   IP ごと `RS_LIMIT_PER_IP`(既定400)、全体 `RS_LIMIT_GLOBAL`(既定20000)。
   Upstash Redis の環境変数があればそこで数え、無ければインスタンスのメモリで数える(目安にしかならない)。
2. **入力の上限**: 8語・各16字まで。空白・記号・URL を含む語は捨てる。本文は受け付けない。
3. **タイムアウト**: Anthropic 呼び出しは12秒・再試行1回(拡張は15秒で諦める)。関数の上限は Vercel の既定のまま。
4. **最後の砦: Anthropic Console の利用額の上限。** このサーバ専用の workspace と API キーを作り、
   月の上限額を設定しておく。
5. ストア公開後、拡張の ID が決まったら `RS_ALLOWED_ORIGINS=chrome-extension://<id>` を入れると、
   他のオリジンからの呼び出しを断る(偽装できるので補助)。

## ローカルで起動

```bash
cd server
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt   # 初回のみ
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env                             # 鍵はここに(初回のみ・コミットされない)
./.venv/bin/python -m uvicorn main:app --port 8787   # フォルダを移しても動く書き方(.venv/bin/uvicorn は作った場所の絶対パスを覚えている)
```

開発中の拡張(パッケージ化されていないもの)は `http://127.0.0.1:8787` を呼ぶ。
ストア版(manifest に `update_url` が付く)は本番の URL を呼ぶ(`extension/src/shared/config.js` の `SERVER`)。

## テスト

```bash
cd server
./.venv/bin/python -m pip install -r requirements-dev.txt   # 初回のみ(pytest)
./.venv/bin/python -m pytest
```

- 本物の Anthropic と Upstash は使わない(`tests/conftest.py` で偽物に差し替える)。鍵は要らない
- 確かめること: 単語の候補のほか(本文・書名など)は 422・Anthropic へ渡すのは候補の並びだけ・回数制限・生成の検め・**ログに単語も生成文も出ない**
- 擬音らしい語の表(`../tests/fixtures/terms.json`)は、拡張のテスト(`ai.js` の `looksLikeSound`)と同じものを通す。片方の式を変えたら、もう片方も
- PR ごとに GitHub Actions(`.github/workflows/ci.yml` の `server`)で回る。テストは `.vercelignore` で Vercel に上げない

## Vercel にデプロイ

Vercel のプロジェクト `reading-scaffold`(yukik8s-projects)は、GitHub の `yukik8/yomirin` と繋がっている(2026-10-09〜)。

- **main に push すると本番に出る。** ほかのブランチの push は確認用の Preview になる(保護つき。`vercel curl /healthz --deployment <URL>` で叩ける)
- プロジェクトの Root Directory は `server`。`server/` の中が**前回デプロイしたときから**変わっていない push は、ビルドせずに飛ばす。拡張だけの変更ではデプロイされない
  - 判定は `vercel.json` の `ignoreCommand`(画面の Ignored Build Step より優先される): `git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- .`。前回デプロイしたコミットは Vercel が `VERCEL_GIT_PREVIOUS_SHA` で渡す(ブランチの最初のデプロイでは空なので、1つ前のコミットと比べる)
  - 前は1つ前のコミットとだけ比べていたので、何コミットかまとめて main に入れると、途中のコミットの `server/` の変更を見落として本番に出なかった
  - Vercel は直近10コミットしか取ってこない。前回のデプロイがそれより古いと比べられないので、`server/` が変わっていなくても1回ビルドする(同じものが出るだけ)
- 手で出すときは、**リポジトリの一番上で** CLI を使う(Root Directory が `server` なので、`server/` の中で出すと `server/server` を探して失敗する)。一番上でまだ `vercel link` していなければ、先に一度だけ

```bash
vercel link --project reading-scaffold   # 初回のみ(リポジトリの一番上で。.vercel/ はコミットされない)
vercel deploy --prod                      # 本番(https://reading-scaffold.vercel.app)
vercel deploy                             # 確認用の Preview
```

- `vercel.json` の `"framework": "fastapi"` で、`main.py` の `app` が入口になる。
- 環境変数(Production)。変えたら出し直す(push するか `vercel deploy --prod`)まで反映されない:
  - `ANTHROPIC_API_KEY`(必須。上の専用キー)
  - `RS_MODEL`(任意。既定 `claude-opus-5`)
  - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`(任意・推奨。Marketplace の Upstash を繋ぐと入る)
  - `RS_LIMIT_PER_INSTALL` / `RS_LIMIT_PER_IP` / `RS_LIMIT_GLOBAL`(任意)
  - `RS_ALLOWED_ORIGINS`(ストア公開後)
- 出したら `https://reading-scaffold.vercel.app/healthz` が `{"ok": true}` を返すことを確かめる。
  拡張は Preview の URL ではなく、この本番ドメインを呼ぶ(`extension/src/shared/config.js` の `SERVER.base`)。

`.env`・`.venv` は `.vercelignore` でアップロードしない。Python は 3.12(`.python-version`)。
