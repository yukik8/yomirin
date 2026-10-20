# reading-scaffold

Google Play ブックス専用の読書拡張(Chrome MV3・ビルド工程なし)と、うんちくサーバ(FastAPI・Vercel)。

- **いまの仕組みと不変条件:** [docs/design.md](docs/design.md)(唯一の一次資料。これから作るものの設計は issue に書く)
- **見た目と言葉のテイスト:** [docs/style.md](docs/style.md) — 画面・演出・画像・図を作る/直すときは、必ずこれに合わせる
- 公開の手順: [docs/release.md](docs/release.md) / 利用者向けの説明: [PRIVACY.md](PRIVACY.md) / サーバ: [server/README.md](server/README.md)

## 進め方

- **やることは GitHub の issue で管理する。** 作る前に issue を立て(テンプレート: 機能要望 `[feature]` / バグ報告 `[bug]` / 検証・実験 `[experiment]`)、進み具合はプロジェクトボード(Not started → In progress → Testing → Released)で動かす。**PR を merge しても issue は閉じない。** Testing に置き、issue の完了条件を本物で確かめてから手で閉じる(下の「プロジェクトボードを動かす」)
- **設計は issue に書く。** どの issue にも「設計」の欄を埋めてから作る(仕組み・データ・θ と不変条件との関係・やらないこと・決めていないこと・触るファイル)。docs/plans/ のような別の設計文書は作らない。作り終えた PR で、できあがった仕組みを docs/design.md に移す
- **変更は PR で。** `.github/pull_request_template.md` のチェックリスト(三分法・不変条件・文書・動作確認)を埋める。`Refs #N` で issue と結ぶ(merge で閉じないように。確かめるものが無い変更 — 文書だけ・CI だけ — は `Closes #N` でよい)。main へは PR からだけ入る(ルールセット。CI の `extension`・`server`・`version` が緑でないと merge できず、管理者も抜けられない)
- **版とリリース:** `extension/` を変えたら manifest の version を上げ、docs/design.md の版の表に行を足す(CI の `version` が見る)。出すときは版のタグ(`v0.26.1` など)を push すると、zip が GitHub Release の下書きに付く(docs/release.md §2)
- **テスト:** 拡張は `node --test "tests/extension/*.test.mjs"`(依存なし)、サーバは `cd server && ./.venv/bin/python -m pytest`。PR ごとに GitHub Actions(`.github/workflows/ci.yml`)で回る。制御の式や config の値を変えると replay のスナップショットが落ちる。わざとなら `--test-update-snapshots` を付けて書き直し、PR に理由と表の差分を書く
- ラベルは英語、題と本文は日本語

## プロジェクトボードを動かす

ボードは [よみりん](https://github.com/users/yukik8/projects/1)。**issue を閉じても Status は自動では動かない**ので、手で動かす。

| いつ | Status |
|---|---|
| issue を立てた | Not started |
| 作り始めた(ブランチを切った) | In progress |
| PR を merge した(issue は開いたまま。複数の PR にまたがる issue は最後の PR のあと) | **Testing** |
| 完了条件を確かめて、issue を手で閉じた(確かめるものが無い変更は `Closes #N` の merge で閉じた) | **Released** |

- **閉じるとき:** issue の完了条件(試写室 / 本物の Play ブックス / replay / サーバのテスト)を確かめ、何をどこで見たか(本・ページ・版・見たもの)をコメントに残して閉じる: `gh issue close $N --comment "..."`
- 確かめて駄目なら閉じない。直す PR を足し、In progress に戻す
- Testing に溜まっていないか: `gh project item-list 1 --owner yukik8 --format json --limit 200 --jq '.items[] | select(.status=="Testing") | "#\(.content.number) \(.content.title)"'`

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
