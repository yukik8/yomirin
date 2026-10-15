# 透過素材の制作・書き出し

`extension/assets/` の136枚(くまと小物48枚・ストーリー18話88コマ)の制作元は `docs/style/sprites/`。
`master.png` が顔・毛色・線・体型の基準。既存のキャラクターを参照し、画像生成で透過背景の絵を描き起こした(#40)。
`prompts.json` に制作指示を残す。画像生成は同じ指示でも同じ画素を返すとは限らないため、確認済みの PNG 自体を保存する。

## 素材を作る

- `docs/style.md` の色鉛筆と水彩のテイストに合わせ、基準のくまを参照する。新しいキャラクターを作らない。
- ストーリーは1話ずつ、4コマは2列×2行、5〜6コマは3列×2行に配置する。5コマなら右下は空。ポーズは6枚ずつ3列×2行。
- **最初からアルファ付きの透過画像を作る。** 体・口元・本・紙・雲・雪は不透明。水彩の質感をアルファで表さない。文字・見出し・矢印・パネルの地・落ち影・白い縁取りを入れない。
- 全セルの間に透明な隙間を十分残し、物・風船の糸・飛び散る本を隣のセルに重ねない。同じ話ではくまの頭の大きさと色をそろえる。
- 元の背景付きシートは話とポーズの参考として残すが、新しい素材をそこから再切り抜きしない。`tools/{bear,story}-sprites/cut.py` は旧素材の再現用。

## 書き出す

Python 3 と Pillow・numpy・scipy を使う(`pip install -r tools/asset-sprites/requirements.txt`)。

```sh
python tools/asset-sprites/export.py
python tools/asset-sprites/export.py --check
python tools/asset-sprites/review.py --out work/assets-review.html
```

1話だけなら `export.py --only books`。`--check` は元の PNG からの書き出しと、保存済み WebP の全 RGBA 画素を比較する。

`manifest.json` が制作元・セル配置・出力名・出力寸法の対応表。セルの境界は指定の格子の近くの**既存アルファが透明な隙間**だけを使う。
背景色の推定・AI の背景除去・RGB の逆算は行わない。生成画像の微小なアルファノイズだけを丸める(0〜8 → 0、245〜255 → 255)。
輪郭の中間アルファは残す。絵は縦横比を保って元の寸法の中に収め、中央・下4pxに配置する。出力時の追加縮小は manifest の `scale` で指定できる。
WebP は `lossless=True, exact=True` で保存し、透明な縁の色も非可逆圧縮で変えない。

## 確認する

`assets-review.html` は画像を内包した単独の HTML。サーバなしで開き、明るい背景・暗い背景・市松の背景を切り替えられる。
各話のスライダーでコマを切り替える。すべて同じ表示倍率(既定0.45)なので、頭の大きさ・足元・物の増え方を比較できる。
自動検証では全136枚の対応、RGBA、元の寸法、周囲の透明な余白、画像内側の不透明率(98%以上)を確かめ、横に JSON を出す。

拡張での大きさと動きはリポジトリの一番上で `python -m http.server 8000` → `http://localhost:8000/tools/preview/`。
18話の最後の手前から章の終わりまで、顔だけの瞬き、左右からのぞくポーズ、読了フィナーレ、動きを減らす設定を見る。
本物の Play ブックスでの配置は別途確認する。

2026-10-15 の確認: 全136枚の寸法・アルファ・全画素再現が通過。拡張の既存テスト137件が通過。
Chromium の試写室で18話×明暗2背景の最終コマと本文の外の配置、読了フィナーレの通常/動きを減らす設定、
確認ページの3背景と18個のコマ切り替えを確認し、JavaScript エラーは0件。
比較画像は `docs/style/sprites/before-after.png`、試写室の例は `preview-dark.png` と `finale.png`。
`verification.json` は全136枚の不透明率と寸法の検証結果。

`extension/assets/` を変更したら、manifest の版と `docs/design.md` の版の表も更新する。
