# server — よみりんのサーバ(うんちく・使われ方の要約)

FastAPI。役目は2つ:

1. `/trivia`: 拡張が端末で選んだ**単語の候補**(最大8語)から、くまのうんちくを1つ返す
2. `/telemetry`: 使われ方の要約(閉じたセッションの読書時間・θ など。#28・docs/design.md §9)を Postgres(Neon)に貯める

うんちく:

- **本の本文・書名・URL は受け取らない。** Google Play の規約で購入した本の送信・再配布は禁止のため、
  本文を扱うクイズと問いは端末内の Gemini Nano だけで作る(このサーバには `/quiz`・`/ask` は無い)。
- 拡張がこのサーバを呼ぶのは、本人がオンボーディングかダッシュボードで「言葉を調べるサーバを使う」を
  オンにしたときだけ(既定オフ)。
- 受け取った単語も生成結果も保存しない。ログは1行 JSON で、状態・所要時間・トークン数だけ(単語は出さない)。
- API キーはサーバだけが持ち、拡張には渡さない。

使われ方の要約:

- 項目は `main.py` の `TmSession` / `TmHello` だけ(拡張の `background/telemetry.js`・`sql/`・`../tests/fixtures/telemetry.json` と同じ)。
  値は数・真偽・決まった語・版の番号・UUID・日付だけで、自由な文字列の項目は無い。ほかの項目が付いてきたら 422。
- 本・本文・問いは受け取らない。IP は保存しない。ログは1行 JSON で、状態・行の数・所要時間だけ(値も ID も出さない)。
- 拡張が送るのは、本人がオフにしていなければ(新しく入れた人は既定オン)。返すのは 204 だけ(一方通行)。
- `DATABASE_URL` が無ければ受け取って捨てる(ローカルでも拡張を止めない)。行は本人が消すまで残す(保存期間は決めていない)。

## エンドポイント

| | 入力 | 出力 |
|---|---|---|
| `GET /healthz` | — | `{"ok": true}` |
| `POST /trivia` | ヘッダ `X-RS-Install: <UUID>`(拡張がインストールごとに作るランダムな ID)、本文 `{"terms": ["活動写真館", ...]}`(1〜8語・各16字まで) | `{"ok": true, "trivia": {"text", "term"}}`。話せることが無ければ `{"ok": false, "error": ...}` |
| `POST /telemetry` | ヘッダ `X-RS-Telemetry: <UUID>`(要約用のランダムな ID。うんちくの ID とは別)、本文 `{"rows": [...]}`(1〜50行。`kind` が `session` か `hello`) | 204(本文なし)。DB に届かなければ 503(拡張は送り待ちに残して送り直す) |
| `DELETE /telemetry` | ヘッダ `X-RS-Telemetry: <UUID>` | 204。その ID の行を `tm_sessions`・`tm_installs` から全部消す |

`term` は必ず候補の中の1語。言い切れない(`sure: false`)・擬音らしい・90字超・URL 入りは返さない。
ID が無いと 401、1日の上限を超えると 429。

### 使われ方の要約の表(`sql/`)

| 表 | 1行 | 中身 |
|---|---|---|
| `tm_installs` | 要約用の ID ごと | 初めて/最後に見た時刻・最後に届いた hello(版・store/dev・Chrome のメジャー版・θ の初期値・目標・うんちくの同意) |
| `tm_sessions` | `(telemetry_id, session_id)` ごと | セッションの要約(docs/design.md §9 の表)+受け取った時刻。送り直されても1行のまま |

SQL は `sql/*.sql` を名前の順に、インスタンスが最初に DB を使うときに流す(どれも `IF NOT EXISTS` で、何度流しても同じ)。
列を足すときは、新しいファイル(`002_...sql`)に `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` を書く。

見るのは、まず Neon の SQL Editor で(分析は `build = 'store'` に絞る。誰でも POST できるので、開発版や偽の行が混ざる):

```sql
select i.build, s.ext, count(*), avg(s.read_ms) / 60000 as read_min, avg(s.theta_base) as theta
from tm_sessions s join tm_installs i on i.id = s.telemetry_id
group by 1, 2 order by 2 desc;
```

## 悪用と料金への備え

公開サーバなので、誰でも叩ける前提で守っている。

1. **1日の回数制限**(UTC の日付で区切る): インストールごと `RS_LIMIT_PER_INSTALL`(既定150)、
   IP ごと `RS_LIMIT_PER_IP`(既定400)、全体 `RS_LIMIT_GLOBAL`(既定20000)。
   使われ方の要約は別に数える: 要約用の ID ごと `RS_TM_LIMIT_PER_ID`(既定100。POST と DELETE の合計)、全体 `RS_TM_LIMIT_GLOBAL`(既定50000)。
   Upstash Redis の環境変数があればそこで数え、無ければインスタンスのメモリで数える(目安にしかならない)。
2. **入力の上限**: 8語・各16字まで。空白・記号・URL を含む語は捨てる。本文は受け付けない。
   使われ方の要約は1回50行まで・項目ごとの範囲(read_ms は24時間まで、θ は 0〜8、など)。偽の行は抑えきれないので、分析は `build = 'store'` に絞る。
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

使われ方の要約を手元で貯めて見るときは、捨ててよい Postgres を立てて `DATABASE_URL` を渡す(無ければ受け取って捨てる):

```bash
docker run -d --rm --name yomirin-tm-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=tm -p 127.0.0.1:54329:5432 postgres:17-alpine
DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/tm ./.venv/bin/python -m uvicorn main:app --port 8787
docker exec yomirin-tm-pg psql -U postgres -d tm -c 'select * from tm_sessions order by received_at desc limit 5'
```

## テスト

```bash
cd server
./.venv/bin/python -m pip install -r requirements-dev.txt   # 初回のみ(pytest)
./.venv/bin/python -m pytest
```

- 本物の Anthropic・Upstash・Neon は使わない(`tests/conftest.py` で偽物に差し替える)。鍵は要らない
- 確かめること: 単語の候補のほか(本文・書名など)は 422・Anthropic へ渡すのは候補の並びだけ・回数制限・生成の検め・**ログに単語も生成文も出ない**
- 使われ方の要約(`tests/test_telemetry.py`): 表の項目と範囲のほかは 422・**自由な文字列の項目が無い**(JSON Schema で見る)・項目が見本(`../tests/fixtures/telemetry.json`)と同じ・**ログに値も ID も出ない**・DB に届かなければ 503
- 表まで確かめるテスト(送り直しても重ならない・hello の上書き・消せる・列が見本と同じ)は、`RS_TEST_DATABASE_URL` に捨ててよい Postgres があるときだけ回る(無ければ飛ばす。上の Docker のもので `RS_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/tm`)。**テストは表を消して作り直すので、Neon の URL は渡さない**。CI は service の Postgres で回す
- 擬音らしい語の表(`../tests/fixtures/terms.json`)は、拡張のテスト(`ai.js` の `looksLikeSound`)と同じものを通す。片方の式を変えたら、もう片方も
- PR ごとに GitHub Actions(`.github/workflows/ci.yml` の `server`)で回る。テストは `.vercelignore` で Vercel に上げない

## Vercel にデプロイ

Vercel のプロジェクト `reading-scaffold`(yukik8s-projects)は、GitHub の `yukik8/yomirin` と繋がっている(2026-10-09〜)。

- **main に merge すると本番に出る**(main へは PR からだけ入り、CI が緑でないと merge できない)。 ほかのブランチの push は確認用の Preview になる(保護つき。`vercel curl /healthz --deployment <URL>` で叩ける)
- プロジェクトの Root Directory は `server`。`server/` の中が**前回デプロイしたときから**変わっていない push は、ビルドせずに飛ばす。拡張だけの変更ではデプロイされない
  - 判定は `vercel.json` の `ignoreCommand`(画面の Ignored Build Step より優先される)。`git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- .` が 0(変わっていない)なら飛ばし、それ以外は 1 にしてビルドする。前回デプロイしたコミットは Vercel が `VERCEL_GIT_PREVIOUS_SHA` で渡す(ブランチの最初のデプロイでは空なので、1つ前のコミットと比べる)
  - 終了コードは 0 か 1 にそろえる。Vercel は 0 と 1 以外(比べるコミットが無いときの 128 など)をデプロイの失敗にする(2026-10-12、これで本番のデプロイが1回失敗した)
  - 前は1つ前のコミットとだけ比べていたので、何コミットかまとめて main に入れると、途中のコミットの `server/` の変更を見落として本番に出なかった
  - Vercel は直近10コミットしか取ってこない。前回のデプロイがそれより古いと比べられないので、`server/` が変わっていなくても1回ビルドする(同じものが出るだけ)。手元で確かめるときは `git clone --depth=10` した所で
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
  - `DATABASE_URL`(使われ方の要約を貯める Postgres。Marketplace の Neon を繋ぐと入る。pooled の URL。無ければ受け取って捨てる)
  - `RS_TM_LIMIT_PER_ID` / `RS_TM_LIMIT_GLOBAL`(任意)
  - `RS_ALLOWED_ORIGINS`(ストア公開後)
- 出したら `https://reading-scaffold.vercel.app/healthz` が `{"ok": true}` を返すことを確かめる。
  拡張は Preview の URL ではなく、この本番ドメインを呼ぶ(`extension/src/shared/config.js` の `SERVER.base`)。

`.env`・`.venv` は `.vercelignore` でアップロードしない。Python は 3.12(`.python-version`)。
