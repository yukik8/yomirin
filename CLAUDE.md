# reading-scaffold

Google Play ブックス専用の読書拡張(Chrome MV3・ビルド工程なし)と、うんちくサーバ(FastAPI・Vercel)。

- **いまの仕組みと不変条件:** [docs/design.md](docs/design.md)(唯一の一次資料。これから作るものの設計は issue に書く)
- **見た目と言葉のテイスト:** [docs/style.md](docs/style.md) — 画面・演出・画像・図を作る/直すときは、必ずこれに合わせる
- 公開の手順: [docs/release.md](docs/release.md) / 利用者向けの説明: [PRIVACY.md](PRIVACY.md) / サーバ: [server/README.md](server/README.md)

## 進め方

- **やることは GitHub の issue で管理する。** 作る前に issue を立て(テンプレート: 機能要望 `[feature]` / バグ報告 `[bug]` / 検証・実験 `[experiment]`)、進み具合はプロジェクトボード(Not started → In progress → Testing → Released)で動かす
- **設計は issue に書く。** どの issue にも「設計」の欄を埋めてから作る(仕組み・データ・θ と不変条件との関係・やらないこと・決めていないこと・触るファイル)。docs/plans/ のような別の設計文書は作らない。作り終えた PR で、できあがった仕組みを docs/design.md に移す
- **変更は PR で。** `.github/pull_request_template.md` のチェックリスト(三分法・不変条件・文書・動作確認)を埋める。`Closes #N` で issue と結ぶ
- **テスト:** 拡張は `node --test "tests/extension/*.test.mjs"`(依存なし)、サーバは `cd server && ./.venv/bin/python -m pytest`。PR ごとに GitHub Actions(`.github/workflows/ci.yml`)で回る。制御の式や config の値を変えると replay のスナップショットが落ちる。わざとなら `--test-update-snapshots` を付けて書き直し、PR に理由と表の差分を書く
- ラベルは英語、題と本文は日本語
