#!/usr/bin/env python3
"""ストーリー集の1枚絵から、話ごとのコマを切り抜いて extension/assets/story/<話>-<コマ>.webp に書き出す。

    python3 -I tools/story-sprites/cut.py docs/style/ref/story-sheet-1.png [--sheet out.png] [--only books pancakes]

- 絵は 6行×3列の話のパネル(淡い色の帯)。パネルは紙の地(生成り)との境目で自動で見つける
- パネルの中のコマの区切り(「→」のある所。→ が無い所は絵の隙間)は STORIES の cuts に、絵の x 座標で書く。
  → の小さな塊は捨てる
- パネルの地はグラデーションなので、場所ごとの地の色を、絵の無い所からぼかして求める
- コマの中の、一番大きい塊とそれに触れる塊だけを残す(飛び散る部品があるコマは keep に番号を書く)。
  塊は真ん中のある側のコマに入れる(→ より上にはみ出す風船も切らない)。横に続く水のように、区切りをまたいで
  つながった絵がある話は clip にして、区切りの線で切り、線の近くはぼかして消す
- 話の id とコマの数は extension/src/content/stories.js と同じ
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'extension' / 'assets' / 'story'
REF = (1536, 1024)

# 絵の中の順(左上から右へ・上から下へ)に、話の id と、コマの区切りの x(絵の座標)。コマは左から 1, 2, …
# 区切りを (x, y) で書いたものは、絵の影とつながった → の位置(その周りを消す)。
# keep: 離れた部品(飛び散る本・紙吹雪・帽子など)も残すコマの番号。clip: 区切りの線で切る(横に続く水)
STORIES = [
    ('books', [89, 169, 247, 324, 405], {6}),  # 1 本積み
    ('castle', [606, 683, 771, 868], set()),  # 2 本のお城
    ('pancakes', [1099, 1168, 1244, 1327, 1416], set()),  # 3 パンケーキ
    ('blocks', [99, 186, 277, 372], {5}),  # 4 謎タワー
    ('balloons', [641, 768, 865], set()),  # 5 風船
    ('stars', [1120, 1212, 1314, 1414], {5}),  # 6 星集め
    ('clouds', [96, 170, 250, (380, 488)], set()),  # 7 雲作り
    ('bed', [605, 683, 779, 902], set()),  # 8 寝床
    ('boxes', [1101, 1195, 1302, (1408, 487)], set()),  # 9 段ボール
    ('plant', [98, 186, 275, 382], set()),  # 10 謎の植物
    ('bonsai', [658, 779, 889], set()),  # 11 盆栽
    ('flag', [1109, 1212, 1348], set()),  # 12 旗立て
    ('rainbow', [103, 234, 358], set()),  # 13 虹建設
    ('snowman', [614, 708, 788, 877], {5}),  # 14 雪だるま
    ('gift', [1107, 1189, 1283, 1377], {5}),  # 15 謎の箱
    ('cookies', [82, 157, 241, 330, 421], set()),  # 16 クッキー
    ('yarn', [610, 677, 778, 876], set()),  # 17 毛糸
    ('boat', [1111, 1214, 1342], set(), 'clip'),  # 18 紙の船
]

K = 1  # 1536×1024 の絵に対する倍率(4倍に拡大したシートなら 4。main で決める)
_SESSION = None

PAGE_TOL = 6  # 紙の地とみなす色の距離(パネル探し)
FG = 22  # パネルの地からこれだけ離れた色を絵とみなす
SOFT = 70  # 線の外の淡いにじみは、地からの距離 / SOFT の不透明度にする
TITLE = (200, 50)  # パネルの左上の見出し(番号と話の名前)が収まる四角
ARROW = 110  # → の塊の大きさ(画素数)の上限
FEATHER = 12  # 区切りの近くで、にじみをぼかして消す幅
INSET = 5  # パネルの角の丸みと縁を避ける


def runs(mask):
    """True が続く区間 [(start, stop), …]。"""
    out = []
    start = None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(mask)))
    return out


def panels(img):
    """話のパネルの矩形 (x0, y0, x1, y1) を、左上から右へ・上から下へ。"""
    page = img[5, 5]
    d = np.sqrt(((img - page) ** 2).sum(axis=2))
    rows = [r for r in runs((d < PAGE_TOL).mean(axis=1) < 0.6) if r[1] - r[0] > 100 * K]
    out = []
    for y0, y1 in rows:
        cols = [c for c in runs((d[y0 + 10 * K : y1 - 10 * K] < PAGE_TOL).mean(axis=0) < 0.6) if c[1] - c[0] > 200 * K]
        out += [(x0, y0, x1, y1) for x0, x1 in cols]
    return out


def ground(rgb):
    """場所ごとの地の色(絵の無い所の色をぼかして広げる)と、地からの距離。"""
    med = np.median(rgb.reshape(-1, 3), axis=0)
    w = (np.sqrt(((rgb - med) ** 2).sum(axis=2)) < 40).astype(np.float32)
    for _ in range(3):
        num = np.stack([ndimage.gaussian_filter(rgb[..., k] * w, 12 * K) for k in range(3)], axis=-1)
        den = ndimage.gaussian_filter(w, 12 * K)[..., None] + 1e-6
        bg = num / den
        dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
        w = (dist < FG * 0.6).astype(np.float32)
    return bg, dist


def ai_alpha(rgb, where):
    """AI の切り抜き(rembg・isnet-anime)。where(主役の塊の周り)の範囲だけを見せて、不透明度 0〜1 を返す。"""
    global _SESSION
    from rembg import new_session, remove

    if _SESSION is None:
        _SESSION = new_session('isnet-anime')
    ys, xs = np.nonzero(where)
    pad = 8 * K
    t, b = max(0, ys.min() - pad), min(where.shape[0], ys.max() + pad + 1)
    l, r = max(0, xs.min() - pad), min(where.shape[1], xs.max() + pad + 1)
    crop = Image.fromarray(rgb[t:b, l:r].round().astype(np.uint8), 'RGB')
    out = np.zeros(where.shape, np.float32)
    out[t:b, l:r] = np.asarray(remove(crop, session=_SESSION))[..., 3] / 255
    return out * where


def cut_frame(rgb, bg, dist, fg, keep_all, feather, matte='ai'):
    """コマ(区切りの間)の絵を切り抜いて RGBA に。feather は (左, 右) の端でにじみをぼかすか。"""
    lab, n = ndimage.label(fg)
    if n == 0:
        return None
    sizes = ndimage.sum(fg, lab, range(1, n + 1))
    main = int(np.argmax(sizes)) + 1
    keep = lab == main
    near_main = ndimage.binary_dilation(keep, iterations=3 * K)
    for i, size in enumerate(sizes, start=1):
        if i == main:
            continue
        if keep_all and size >= sizes[main - 1] * 0.01:
            keep |= lab == i
        elif size >= sizes[main - 1] * 0.06 and (near_main & (lab == i)).any():
            keep |= lab == i
    filled = ndimage.binary_fill_holes(keep)
    holes = filled & ~keep

    # 線の内側(穴)は不透明。線の外の淡い所(にじみ・影)は地からの距離で半透明にし、色は地を差し引いて戻す
    alpha = np.where(holes, 1.0, np.clip(dist / SOFT, 0, 1)) * filled
    if matte == 'ai':
        # 主役の塊(とそれに触れる塊)の形は AI に任せる(縁がきれいで、影を拾わない)。
        # 離れた部品(keep)は AI が落とすので、色の距離の切り抜きをそのまま使う
        body = ndimage.binary_fill_holes(lab == main) | (near_main & filled)
        zone = ndimage.binary_dilation(body, iterations=4 * K)
        ai = ai_alpha(rgb, zone)
        if ai.max() >= 0.5:
            alpha = np.where(zone, ai, alpha)
        else:
            print('  AI が絵を見つけられなかったコマ: 色の距離で切る')
    w = alpha.shape[1]
    ramp = np.ones(w, np.float32)
    x = np.arange(w, dtype=np.float32)
    if feather[0]:
        ramp = np.minimum(ramp, np.clip(x / (FEATHER * K), 0, 1))
    if feather[1]:
        ramp = np.minimum(ramp, np.clip((w - 1 - x) / (FEATHER * K), 0, 1))
    alpha = alpha * ramp[None, :]
    a = np.maximum(alpha, 1e-3)[..., None]
    soft = (alpha < 1)[..., None]
    color = np.where(soft, np.clip(bg + (rgb - bg) / a, 0, 255), rgb)

    ys, xs = np.nonzero(alpha > 0.03)
    pad = 3 * K
    t, b = max(0, ys.min() - pad), min(alpha.shape[0], ys.max() + pad + 1)
    l, r = max(0, xs.min() - pad), min(alpha.shape[1], xs.max() + pad + 1)
    out = np.dstack([color[t:b, l:r], alpha[t:b, l:r] * 255]).round().astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def cut_story(img, box, cuts, keep, mode='', matte='ai'):
    x0, y0, x1, y1 = box
    inset = INSET * K
    rgb = img[y0 + inset : y1 - inset, x0 + inset : x1 - inset]
    bg, dist = ground(rgb)
    fg = dist > FG
    lab, n = ndimage.label(fg)
    objs = ndimage.find_objects(lab)
    # 見出し(番号と話の名前): 左上の四角に収まる塊だけ捨てる(はみ出す風船などは残す)
    for i, (ys, xs_) in enumerate(objs, start=1):
        if ys.stop <= TITLE[1] * K and xs_.stop <= TITLE[0] * K:
            fg[lab == i] = False
    # 区切りの座標は 1536 幅の絵で測ったもの。拡大したシートでは K 倍
    arrows = [(c[0] * K, c[1] * K) for c in cuts if isinstance(c, tuple)]
    xs = [(c[0] if isinstance(c, tuple) else c) * K - x0 - inset for c in cuts]
    # → を捨てる: 区切りの線にかかる小さな塊。絵の影とつながった → は、表に書いた高さの周りだけ消す
    for x in xs:
        for i in np.unique(lab[:, max(0, x - 7 * K) : x + 7 * K]):
            if i and (lab == i).sum() <= ARROW * K * K:
                fg[lab == i] = False
    for x, y in arrows:
        lx, ly = x - x0 - inset, y - y0 - inset
        fg[max(0, ly - 7 * K) : ly + 7 * K, max(0, lx - 6 * K) : lx + 6 * K] = False
    edges = [0, *xs, rgb.shape[1]]
    if mode != 'clip':
        # 塊ごとに、真ん中のある側のコマへ
        lab, n = ndimage.label(fg)
        centers = [(sl[1].start + sl[1].stop) / 2 for sl in ndimage.find_objects(lab)]
        side = np.searchsorted(xs, centers, side='right')
    frames = []
    for k in range(len(edges) - 1):
        if mode == 'clip':
            sl = np.s_[:, edges[k] : edges[k + 1]]
            part = fg[sl]
            feather = (k > 0, k < len(edges) - 2)
        else:
            sl = np.s_[:, :]
            part = np.isin(lab, np.nonzero(side == k)[0] + 1)
            feather = (False, False)
        im = cut_frame(rgb[sl], bg[sl], dist[sl], part, k + 1 in keep, feather, matte)
        if im is None:
            raise SystemExit(f'空のコマ: {box} の {k + 1}コマ目')
        frames.append(im)
    return frames


def contact(rows, path):
    """切り抜きの確認用: 話ごとに1行、薄い地と濃い地を交互に。"""
    cell = 150
    cols = max(len(fr) for _, fr in rows)
    sheet = Image.new('RGBA', (cols * cell + 20, len(rows) * cell), (246, 240, 230, 255))
    for r, (name, frames) in enumerate(rows):
        if r % 2:
            sheet.paste(Image.new('RGBA', (sheet.width, cell), (60, 70, 90, 255)), (0, r * cell))
        for c, im in enumerate(frames):
            k = min((cell - 12) / im.width, (cell - 12) / im.height, 2)
            big = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
            sheet.alpha_composite(big, (20 + c * cell + (cell - big.width) // 2, r * cell + (cell - big.height) // 2))
    sheet.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--sheet', help='確認用の一覧画像の書き出し先')
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--matte', choices=['ai', 'color'], default='ai', help='切り抜き: AI(rembg)か 色の距離')
    args = ap.parse_args()
    pil = Image.open(args.src).convert('RGB')
    global K
    K = pil.width // REF[0]
    if K < 1 or pil.size != (REF[0] * K, REF[1] * K):
        raise SystemExit(f'絵の大きさが {REF} の整数倍ではない: {pil.size}')
    img = np.asarray(pil).astype(np.float32)
    boxes = panels(img)
    if len(boxes) != len(STORIES):
        raise SystemExit(f'パネルが {len(boxes)} 枚見つかった({len(STORIES)} 枚のはず)')
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for (name, cuts, keep, *mode), box in zip(STORIES, boxes):
        if args.only and name not in args.only:
            continue
        frames = cut_story(img, box, cuts, keep, *(mode or ['']), args.matte)
        for old in OUT.glob(f'{name}-*.webp'):
            old.unlink()
        for k, im in enumerate(frames, start=1):
            # 色がにじまないよう高品質で。exact で透明な所の色も残す(縁に地の色が戻らない)
            im.save(OUT / f'{name}-{k}.webp', 'WEBP', quality=95, method=6, exact=True)
        print(f'{name:9s} {len(frames)}コマ ' + ' '.join(f'{im.width}x{im.height}' for im in frames))
        rows.append((name, frames))
    if args.sheet:
        contact(rows, args.sheet)


if __name__ == '__main__':
    main()
