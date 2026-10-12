# replay — 記録を別の制御器に通して比べる

拡張の `controller.js` をそのまま読み(写しは作らない)、制御器の違いで θ がどう動くかを比べる。
依存なし。Node 24 で動く。

```
node tools/replay/replay.mjs --simulate                   # 模擬の読者 4 種 × 制御器
node tools/replay/replay.mjs --simulate --preset heavy --readers 500 --seed 3
node tools/replay/replay.mjs --export reading-scaffold-20261008.json   # 自分の記録
```

## 2つのモード

| | `--simulate` | `--export` |
|---|---|---|
| 成否 | 読者モデルが θ に応じて決める | 記録どおり(記録された θ のもとで起きたもの) |
| 分かること | 制御器どうしの差(読者モデルの仮定の範囲で) | θ の軌跡の違い。`fixed` が記録を再現するか(ハーネスの検算) |
| 分からないこと | 本物の人がこのモデルで動くか | 「別の θ ならどう読んだか」(因果) |

`--export` で `fixed` の列が記録の θ_base と食い違ったら、ハーネスか拡張のどちらかが変わっている。
手動の上書き・ホメオスタットの再展開・終了時刻のずれ(日付の境)は不一致に数えるので、備考を見る。

## 読者モデル(lib/reader.mjs)

「θ がこれだけあれば読める」閾値 ν を隠れて持ち、成功のたびに少し下がる(習慣)。

```
P(成功 | θ) = γ + (1 − γ − λ) · σ((log θ − ν) / w)
```

- `typical` 最初は θ≈2 を切ると読めない
- `light` 素の力が高い(γ=0.6)
- `heavy` 閾値が高く(θ≈4)、習慣がつくのも遅い
- `flat` θ と無関係に 9 割成功する — **今の成功基準(5分・離脱1回以下)の緩さで実際に起きていること**

## 列の意味

- **卒業率@12w** 合格ライン(`PASS.graduateWithinWeeks`)までに θ=0 に着いた割合
- **成功率(漸減中)** θ>0 の間の成功セッションの割合
- **P(成功)後半** タペリングの後半で、制御器が読者を置いた θ での成功確率。低いほど「読めない θ まで追い込んでいる」
- **上げた回数** θ を戻した回数

## スナップショット(tests/extension/replay.test.mjs)

`--simulate --seed 1` の表を、テストのスナップショットに残している。制御器の式や config の値を変えると CI で落ちる。
わざと変えたときは書き直し、PR に理由と表の差分を書く:

```
node --test --test-update-snapshots "tests/extension/*.test.mjs"
```

表の見た目(列・桁)を直したときも落ちるので、同じように書き直す。

## 制御器を足す

`lib/controllers.mjs` の `CONTROLLERS` に `{ init, step, theta }` を足す。拡張側の実装を import して包む。
