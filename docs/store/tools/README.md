# ストア用の素材を作る道具

できあがりは `docs/store/` に置く(掲載欄のどこに何を入れるかは [../../release.md](../../release.md) §3)。

| ファイル | 掲載欄 | 作り方 |
|---|---|---|
| `icon-128.png` | Store icon(128×128。96px のタイルの周り 16px は透明) | `icons.py --store` |
| `screenshot-1-reading-1280x800.png` | Screenshots 1: 読書中(右下のよみりんの話・隅から顔を出すくま) | 試写室を `shoot.mjs` |
| `screenshot-2-chapter-1280x800.png` | Screenshots 2: 章の終わりのフィーバー | 試写室を `shoot.mjs` |
| `screenshot-3-quiz-1280x800.png` | Screenshots 3: 突然クイズ | 試写室を `shoot.mjs` |
| `screenshot-4-dashboard-1280x800.png` | Screenshots 4: ダッシュボード(本棚・読んだ日) | `dash.js` |
| `screenshot-5-dashboard-1280x800.png` | Screenshots 5: ダッシュボード(思い出す・帯) | `dash.js` |
| `promo-440x280.png` | Small promo tile | `promo.html?size=small` を `shoot.mjs` |
| `marquee-1400x560.png` | Marquee promo tile | `promo.html?size=marquee` を `shoot.mjs` |

スクリーンショットとタイルは 24-bit の PNG(透明なし)。見えない Chrome で撮ると、そのままこの形になる。

## 撮り方

リポジトリの一番上で `python3 -m http.server 8931 --bind 127.0.0.1` を立てておき、このフォルダ(`docs/store/tools`)で:

```bash
P=http://127.0.0.1:8931
H="document.querySelector('.panel').hidden = true"   # 試写室の操作パネルを隠す

# アイコン(リポジトリの一番上で。拡張のアイコン icon-{16,32,48,128}.png も同じ絵から作り直す)
python3 -I tools/bear-sprites/icons.py docs/style/ref/icon-sheet.png --store docs/store/icon-128.png

# 読書中・章の終わり・突然クイズ(試写室。本文はパブリックドメインの「セロ弾きのゴーシュ」)
node shoot.mjs ../screenshot-1-reading-1280x800.png 1280x800 "$P/tools/preview/?theta=8&story=pancakes&step=4" 1100 "$H; document.getElementById('peek').click()"
node shoot.mjs ../screenshot-2-chapter-1280x800.png 1280x800 "$P/tools/preview/?theta=8&story=pancakes&step=4&freeze=3200&auto=chapter" 4200 "$H"
node shoot.mjs ../screenshot-3-quiz-1280x800.png 1280x800 "$P/tools/preview/?theta=8&story=books&step=3&auto=quiz" 1800 "$H"

# ダッシュボード 2 枚(見本データ入り。Puppeteer の入った作業用フォルダを S で渡す)
S=/path/to/dir-with-node_modules node dash.js ../screenshot-4-dashboard-1280x800.png 1280
mv ../screenshot-4-dashboard-1280x800-2.png ../screenshot-5-dashboard-1280x800.png

# タイル
node shoot.mjs ../promo-440x280.png 440x280 "$P/docs/store/tools/promo.html?size=small" 800
node shoot.mjs ../marquee-1400x560.png 1400x560 "$P/docs/store/tools/promo.html?size=marquee" 800
```

- `shoot.mjs` はページを見えない Chrome で開き、決めた大きさで撮る(DevTools のプロトコル。依存なし・Node 22 以上)
- `dash.js` は拡張の実物のダッシュボードを、見本データを入れて撮る(Puppeteer。リポジトリには依存を置かないので、`PUPPETEER_SKIP_DOWNLOAD=1 npm i puppeteer` した作業用フォルダを `S` で渡す。Chrome は入っているものを使う)
- `promo.html` はタイルの絵。くまと話のコマは拡張の中の絵を、どれも同じ倍率で置く(大きく伸ばすとぼやける)。色と字は docs/style.md
- 読書中の3枚は試写室(本物の Play ブックスを模したページで、演出は拡張と同じコード)。本物の Play ブックスで撮るなら、本文が写るのでパブリックドメインの本で
