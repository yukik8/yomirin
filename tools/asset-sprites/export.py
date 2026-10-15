#!/usr/bin/env python3
"""Export already-transparent, regularly spaced artwork. Never estimate a background.

python tools/asset-sprites/export.py [--only books boat] [--check]
Requires Pillow and numpy. Source artwork and the manifest are committed together.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = Path(__file__).with_name('manifest.json')


def normalize_alpha(image, limits):
    """Snap near-transparent/opaque generator noise; leave RGB completely unchanged."""
    pixels = np.array(image.convert('RGBA'))
    alpha = pixels[..., 3]
    alpha[alpha <= limits['transparent_max']] = 0
    alpha[alpha >= limits['opaque_min']] = 255
    return Image.fromarray(pixels)


def sprite(sheet, spec, index, limits):
    columns, rows = spec['columns'], spec['rows']
    col, row = index % columns, index // columns
    alpha = np.array(sheet.getchannel('A'))

    def gutter(profile, nominal, span):
        """Allow small grid placement errors, but split only through empty alpha."""
        low, high = max(1, round(nominal - span * .15)), min(len(profile) - 1, round(nominal + span * .15))
        candidates = [i for i in range(low, high) if profile[i-1:i+2].max() <= limits['transparent_max']]
        if not candidates:
            raise ValueError(f"No transparent gutter near {nominal}: {spec['source']}")
        return min(candidates, key=lambda i: abs(i - nominal))

    ys = [0] + [gutter(alpha.max(axis=1), k * sheet.height / rows, sheet.height / rows) for k in range(1, rows)] + [sheet.height]
    band = alpha[ys[row]:ys[row + 1]].max(axis=0)
    xs = [0] + [gutter(band, k * sheet.width / columns, sheet.width / columns) for k in range(1, columns)] + [sheet.width]
    box = spec['frames'][index].get('box', (xs[col], ys[row], xs[col + 1], ys[row + 1]))
    cell = normalize_alpha(sheet.crop(box), limits)
    bbox = cell.getchannel('A').getbbox()
    if not bbox:
        raise ValueError(f"Empty sprite: {spec['frames'][index]['file']}")
    # A cut through visible art must be corrected in the source, never feathered away.
    alpha = np.array(cell.getchannel('A'))
    if any(edge.max() > 32 for edge in (alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1])):
        raise ValueError(f"Artwork crosses a cell edge: {spec['frames'][index]['file']}")
    return cell.crop(bbox)


def export(manifest, only, check):
    count = 0
    for spec in manifest['sheets']:
        name = Path(spec['source']).stem
        if only and name not in only:
            continue
        with Image.open(ROOT / spec['source']) as source:
            for index, frame in enumerate(spec['frames']):
                art = sprite(source, spec, index, manifest['alpha_snap'])
                size = (frame['width'], frame['height'])
                # Keep the dimensions consumed by story.js and stage.js unchanged.
                # Fit without stretching; align the foot/object baseline at the bottom.
                scale = min((size[0] - 8) / art.width, (size[1] - 8) / art.height)
                if 'scale' in frame:
                    scale = min(scale, frame['scale'])
                art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.Resampling.LANCZOS)
                art = normalize_alpha(art, manifest['alpha_snap'])
                canvas = Image.new('RGBA', size)
                canvas.alpha_composite(art, ((size[0] - art.width) // 2, size[1] - 4 - art.height))
                dest = ROOT / 'extension/assets' / frame['file']
                if check:
                    with Image.open(dest) as current:
                        if not np.array_equal(np.array(current.convert('RGBA')), np.array(canvas)):
                            raise ValueError(f"Output differs from source: {dest.relative_to(ROOT)}")
                else:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    canvas.save(dest, 'WEBP', lossless=True, exact=True, method=6)
                count += 1
        print(f"{name}: {len(spec['frames'])} sprites {'verified' if check else 'exported'}")
    print(f'{count} sprites total')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', nargs='+')
    parser.add_argument('--check', action='store_true', help='Compare every RGBA pixel to the committed source export')
    args = parser.parse_args()
    export(json.loads(MANIFEST.read_text()), args.only, args.check)
