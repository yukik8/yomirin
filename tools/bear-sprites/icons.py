#!/usr/bin/env python3
"""アイコンの1枚絵(サイズ別の絵が並んだもの)から、拡張のアイコン extension/icons/icon-{16,32,48,128}.png を作る。

    python3 -I tools/bear-sprites/icons.py docs/style/ref/icon-sheet.png [--sheet out.png] [--store docs/store/icon-128.png]

- 小さいサイズほど絵を単純にしてある(顔が大きく、線が太い)ので、サイズごとにその大きさ用の絵を使う
- 箱(TILES)は 1536×1024 の絵で、タイル(生成りの角丸)を含む広めの範囲。中でタイルの外形を探して切り抜く
- タイルの外(角の外側)は透明にする。角丸は絵の柔らかい縁ではなく、ここで描き直した滑らかな形
- 128px はストアの勧めに合わせて周りに少し余白を取る(タイルを 112px にして真ん中に置く)
- --store はストアの掲載用のアイコン(128px の中に 96px のタイル・周り 16px は透明。ストアの画像の決まり)
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'extension' / 'icons'
REF = (1536, 1024)

# 出す大きさ: (探す範囲, タイルの一辺)
TILES = {
    128: ((408, 88, 606, 288), 112),  # 「128px」の絵
    48: ((734, 164, 840, 270), 48),  # 「48px」
    32: ((843, 186, 925, 268), 32),  # 「32px」
    16: ((1013, 211, 1070, 268), 16),  # 「16px」
}
RADIUS = 0.22  # 角丸の半径(タイルの一辺に対する割合)
SS = 8  # 角丸をなめらかにするための描き込み倍率


def tile_box(rgb: np.ndarray):
    """範囲の中で、地(紙)と違う色の一番大きい塊の外接矩形 = タイル。"""
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    mask = np.sqrt(((rgb - bg) ** 2).sum(axis=2)) > 9
    mask = ndimage.binary_opening(mask, iterations=1)
    lab, n = ndimage.label(mask)
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    ys, xs = np.nonzero(lab == int(np.argmax(sizes)) + 1)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def make(sheet: Image.Image, box, tile: int, canvas: int):
    sx, sy = sheet.width / REF[0], sheet.height / REF[1]
    x0, y0, x1, y1 = round(box[0] * sx), round(box[1] * sy), round(box[2] * sx), round(box[3] * sy)
    region = sheet.crop((x0, y0, x1, y1)).convert('RGB')
    l, t, r, b = tile_box(np.asarray(region).astype(np.float32))
    # 柔らかい縁を少し内側で切る(地の色がふちに残らないように)
    inset = max(1, round((r - l) * 0.03))
    art = region.crop((l + inset, t + inset, r - inset, b - inset))
    big = tile * SS
    art = art.resize((big, big), Image.LANCZOS)
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * RADIUS), fill=255)
    art.putalpha(mask)
    art = art.resize((tile, tile), Image.LANCZOS)
    out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(art, ((canvas - tile) // 2, (canvas - tile) // 2))
    return out


def preview(images, path):
    """確認用: 上の段に実寸、下の段に4倍を、明るい地と暗い地(左右)に並べる。"""
    k = 4
    col = max(im.width for im in images) * k + 24
    top = max(im.height for im in images) + 24
    h = top + max(im.height for im in images) * k + 24
    sheet = Image.new('RGBA', (col * len(images) * 2, h), (246, 240, 230, 255))
    sheet.paste((40, 40, 46, 255), (col * len(images), 0, col * len(images) * 2, h))
    for half in (0, 1):
        for i, im in enumerate(images):
            x = (half * len(images) + i) * col + 12
            sheet.alpha_composite(im, (x, 12))
            sheet.alpha_composite(im.resize((im.width * k, im.height * k), Image.NEAREST), (x, top))
    sheet.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--sheet', help='確認用の一覧画像の書き出し先')
    ap.add_argument('--store', help='ストアの掲載用のアイコン(96px のタイル)の書き出し先')
    args = ap.parse_args()
    sheet = Image.open(args.src)
    done = []
    for size, (box, tile) in TILES.items():
        im = make(sheet, box, tile, size)
        im.save(OUT / f'icon-{size}.png', optimize=True)
        done.append(im)
        print(f'icon-{size}.png')
    if args.sheet:
        preview(done, args.sheet)
    if args.store:
        make(sheet, TILES[128][0], 96, 128).save(args.store, optimize=True)
        print(args.store)


if __name__ == '__main__':
    main()
