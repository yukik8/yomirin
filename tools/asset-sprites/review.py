#!/usr/bin/env python3
"""Validate every sprite and build a portable light/dark artwork review page.

python tools/asset-sprites/review.py --out work/asset-redraw/review.html
Requires Pillow, numpy and scipy. Does not change artwork.
"""

import argparse
import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import binary_erosion

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def inspect():
    manifest = json.loads((HERE / 'manifest.json').read_text())
    entries, stats, seen = [], [], set()
    for sheet in manifest['sheets']:
        frames = []
        for frame in sheet['frames']:
            name = frame['file']
            assert name not in seen, f'Duplicate output: {name}'
            seen.add(name)
            path = ROOT / 'extension/assets' / name
            with Image.open(path) as im:
                assert im.mode == 'RGBA', f'Missing alpha: {name}'
                assert im.size == (frame['width'], frame['height']), f'Changed dimensions: {name}'
                rgba = np.array(im)
            alpha = rgba[..., 3]
            assert not alpha[:3].any() and not alpha[-3:].any(), f'Clipped top/bottom: {name}'
            assert not alpha[:, :3].any() and not alpha[:, -3:].any(), f'Clipped sides: {name}'
            assert (alpha > 0).any() and (alpha == 0).any(), f'Empty/missing transparency: {name}'
            # Erode the drawn silhouette, then inspect the inside, not the antialiased edge.
            core = binary_erosion(alpha > 8, iterations=3)
            assert core.any(), f'No solid interior: {name}'
            opaque = float((alpha[core] == 255).mean())
            assert opaque >= .98, f'Translucent interior: {name} ({opaque:.1%} opaque)'
            stats.append({'file': name, 'width': im.width, 'height': im.height,
                          'opaque_core_fraction': round(opaque, 5), 'bytes': path.stat().st_size})
            frames.append({'name': name, 'width': im.width, 'height': im.height,
                           'src': 'data:image/webp;base64,' + base64.b64encode(path.read_bytes()).decode()})
        entries.append({'id': Path(sheet['source']).stem, 'frames': frames})
    actual = {str(p.relative_to(ROOT / 'extension/assets')) for p in (ROOT / 'extension/assets').rglob('*.webp')}
    assert seen == actual, f'Missing/unexpected assets: {seen ^ actual}'
    return entries, stats


HTML = '''<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>よみりん 透過素材の確認</title>
<style>
:root{color-scheme:light;--bg:#f6f0e6;--paper:#fdfaf3;--ink:#4f3a2c;--line:#4f3a2c22;font-family:system-ui,sans-serif;color:var(--ink)}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}header{position:sticky;top:0;background:var(--paper);padding:18px 24px;border-bottom:1px solid var(--line);z-index:2;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
h1{font-size:18px;margin:0}header p{font-size:12px;margin:0;opacity:.7}button,select,input{font:inherit}button,select{border:1px solid var(--line);border-radius:999px;padding:7px 13px;background:var(--paper);color:var(--ink);cursor:pointer}
button[aria-pressed=true]{background:#ecd7c3}label{font-size:13px;display:flex;align-items:center;gap:6px}main{padding:12px 24px 48px}section{margin:20px 0 32px}h2{font-size:15px;margin:0 0 12px;font-weight:600}
.frames{display:flex;gap:8px;align-items:end;overflow:auto;padding:12px;border:1px solid var(--line);border-radius:16px;background:var(--paper)}figure{margin:0;flex:0 0 auto;text-align:center}figcaption{font-size:11px;padding:8px 4px;opacity:.7}figure img{display:block;object-fit:contain;margin:auto}
body.dark{--bg:#171b25;--paper:#202632;--ink:#f0e8dc;--line:#f0e8dc25;color-scheme:dark}.checker .frames{background-color:#eee7dc;background-image:conic-gradient(#d9d1c5 25%,transparent 0 50%,#d9d1c5 0 75%,transparent 0);background-size:24px 24px;color:#4f3a2c}
.stage{display:flex;align-items:end;justify-content:center;min-height:260px;border:1px solid var(--line);border-radius:16px;margin-bottom:10px;background:var(--paper);padding:12px}.stage img{display:block}.controls{display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:13px}
@media(max-width:650px){header{padding:14px}main{padding:8px 12px}h1{font-size:16px}}
</style>
<header><div><h1>よみりん · 透過素材の確認</h1><p>18話・88コマ / くまと小物48枚。画像はこのHTMLだけで表示できます。</p></div>
<button data-theme="light" aria-pressed="true">明るい背景</button><button data-theme="dark" aria-pressed="false">暗い背景</button><button data-theme="checker" aria-pressed="false">透過の確認</button>
<label>表示倍率<input id="scale" type="range" min="0.2" max="0.8" step="0.05" value="0.45"><output id="scale-out">0.45</output></label></header>
<main id="main"></main>
<script>
const sheets=__DATA__;
const names={books:'本積み',castle:'本のお城',pancakes:'パンケーキ',blocks:'謎タワー',balloons:'風船',stars:'星集め',clouds:'雲作り',bed:'寝床',boxes:'段ボール',plant:'謎の植物',bonsai:'盆栽',flag:'旗立て',rainbow:'虹建設',snowman:'雪だるま',gift:'謎の箱',cookies:'クッキー',yarn:'毛糸',boat:'紙の船','poses-basics':'基本の姿・顔','poses-reading-a':'読むポーズ 1','poses-reading-b':'読むポーズ 2','poses-reactions':'リアクション','poses-fever-a':'フィーバー 1','poses-fever-b':'フィーバー 2','poses-props':'小物と余白の素材','poses-effects':'花・葉・星'};
for(const sheet of sheets){const section=document.createElement('section');section.dataset.sheet=sheet.id;const h=document.createElement('h2');h.textContent=names[sheet.id]||sheet.id;section.append(h);
if(!sheet.id.startsWith('poses-')){const stage=document.createElement('div');stage.className='stage';const img=new Image();img.alt=names[sheet.id];stage.append(img);const controls=document.createElement('div');controls.className='controls';const label=document.createElement('label');label.textContent='コマを切り替える';const input=document.createElement('input');input.type='range';input.min=1;input.max=sheet.frames.length;input.value=1;input.step=1;input.setAttribute('aria-label',names[sheet.id]+'のコマ');const output=document.createElement('output');label.append(input);controls.append(label,output);const update=()=>{const f=sheet.frames[input.value-1];img.src=f.src;img.dataset.width=f.width;img.dataset.height=f.height;output.value=input.value+'/'+sheet.frames.length;resize()};input.addEventListener('input',update);section.append(stage,controls);section._update=update;}
const strip=document.createElement('div');strip.className='frames';for(const frame of sheet.frames){const figure=document.createElement('figure');const img=new Image();img.src=frame.src;img.alt=frame.name;img.dataset.width=frame.width;img.dataset.height=frame.height;const cap=document.createElement('figcaption');cap.textContent=frame.name.split('/')[1];figure.append(img,cap);strip.append(figure);}section.append(strip);document.getElementById('main').append(section);if(section._update)section._update();}
function resize(){const k=+document.getElementById('scale').value;document.getElementById('scale-out').value=k.toFixed(2);for(const img of document.querySelectorAll('img[data-width]')){img.style.width=img.dataset.width*k+'px';img.style.height=img.dataset.height*k+'px'}for(const section of document.querySelectorAll('section')){const sheet=sheets.find(s=>s.id===section.dataset.sheet);const stage=section.querySelector('.stage');if(stage)stage.style.height=Math.max(...sheet.frames.map(f=>f.height))*k+28+'px'}}
document.getElementById('scale').addEventListener('input',resize);for(const button of document.querySelectorAll('[data-theme]'))button.addEventListener('click',()=>{document.body.className=button.dataset.theme==='light'?'':button.dataset.theme;for(const b of document.querySelectorAll('[data-theme]'))b.setAttribute('aria-pressed',String(b===button))});resize();
</script></html>'''


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    entries, stats = inspect()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(HTML.replace('__DATA__', json.dumps(entries, ensure_ascii=False)), encoding='utf-8')
    args.out.with_suffix('.json').write_text(json.dumps({'count': len(stats), 'assets': stats}, indent=2) + '\n')
    print(f'{len(stats)} sprites verified; review: {args.out}')
