# reading-scaffold

Google Play ブックス専用の読書拡張(Chrome MV3・ビルド工程なし)と、うんちくサーバ(FastAPI・Vercel)。

- **いまの仕組みと不変条件:** [docs/design.md](docs/design.md)(唯一の一次資料。これから作るものの設計は issue に書く)
- **見た目と言葉のテイスト:** [docs/style.md](docs/style.md) — 画面・演出・画像・図を作る/直すときは、必ずこれに合わせる
- 公開の手順: [docs/release.md](docs/release.md) / 利用者向けの説明: [PRIVACY.md](PRIVACY.md) / サーバ: [server/README.md](server/README.md)

## 進め方

- **やることは GitHub の issue で管理する。** 作る前に issue を立て(テンプレート: 機能要望 `[feature]` / バグ報告 `[bug]` / 検証・実験 `[experiment]`)、進み具合はプロジェクトボード(Not started → In progress → Testing → Released)で動かす。issue を閉じても自動では動かないので、閉じたら Released に動かす(下の「プロジェクトボードを動かす」)
- **設計は issue に書く。** どの issue にも「設計」の欄を埋めてから作る(仕組み・データ・θ と不変条件との関係・やらないこと・決めていないこと・触るファイル)。docs/plans/ のような別の設計文書は作らない。作り終えた PR で、できあがった仕組みを docs/design.md に移す
- **変更は PR で。** `.github/pull_request_template.md` のチェックリスト(三分法・不変条件・文書・動作確認)を埋める。`Closes #N` で issue と結ぶ。main へは PR からだけ入る(ルールセット。CI の `extension`・`server`・`version` が緑でないと merge できず、管理者も抜けられない)
- **版とリリース:** `extension/` を変えたら manifest の version を上げ、docs/design.md の版の表に行を足す(CI の `version` が見る)。出すときは版のタグ(`v0.26.1` など)を push すると、zip が GitHub Release の下書きに付く(docs/release.md §2)
- **テスト:** 拡張は `node --test "tests/extension/*.test.mjs"`(依存なし)、サーバは `cd server && ./.venv/bin/python -m pytest`。PR ごとに GitHub Actions(`.github/workflows/ci.yml`)で回る。制御の式や config の値を変えると replay のスナップショットが落ちる。わざとなら `--test-update-snapshots` を付けて書き直し、PR に理由と表の差分を書く
- ラベルは英語、題と本文は日本語

## プロジェクトボードを動かす

ボードは [よみりん](https://github.com/users/yukik8/projects/1)。**issue を閉じても Status は自動では動かない**ので、手で動かす。

| いつ | Status |
|---|---|
| issue を立てた | Not started |
| 作り始めた(ブランチを切った) | In progress |
| issue を閉じた(`Closes #N` の PR を merge した・手で閉じた) | **Released** |

```bash
N=18   # issue の番号
ID=$(gh project item-list 1 --owner yukik8 --format json --limit 200 --jq ".items[] | select(.content.number==$N) | .id")
gh project item-edit --id "$ID" --project-id PVT_kwHOBp5Mw84BmcEp \
  --field-id PVTSSF_lAHOBp5Mw84BmcEpzhlFIiE --single-select-option-id d605d439   # Released
```

| Status | option の ID |
|---|---|
| Not started | `256c938a` |
| In progress | `d69d0e8c` |
| Testing | `a0b07176` |
| Released | `d605d439` |

- 立てた issue をボードに入れるのは `gh project item-add 1 --owner yukik8 --url <issue の URL>`(返る ID で上と同じく Status を置く)
- 動かしたら `gh project item-list 1 --owner yukik8 --format json --limit 200 --jq ".items[] | select(.content.number==$N) | .status"` で確かめる
- `gh` のトークンに `project` の権限が要る(`gh auth status` の Token scopes)
