# Trace a gun from its Legendary concept (a side view, muzzle left, dark backdrop) into
# js/scene/<name>-model.js: gun-space outlines (z, y in metres) extruded across the gun.
#   python3 tools/trace-gun.py g8|c8
# The silhouette comes from detail (the backdrop is smooth) and colour; parts are cut from it by
# region so each gets its own thickness. (The F2 is traced by tools/f2-trace.py from its painted shell.)
import json, sys
import numpy as np
from PIL import Image
from trace_lib import grow, components, outline

# Per gun, in concept pixels (1400 wide): scale, the grip and handguard anchors (where the hands go),
# what to cut away (floor glow, the optic, which the game fits itself), the parts and their
# thickness, the magazine, and raised relief (rings of segments: they lift in the inspect).
GUNS = {
  'g8': dict(name='G8A1', export='G8', src='docs/legendary-skins/02-abyssal-crown.png', scale=0.000752, bg=33,
    grip=(985, 0.09), hg=(455, -0.03), body_depth=0.055,
    cut=lambda xx, yy: (yy >= 318) | ((yy > 300) & ~(((xx > 322) & (xx < 398)) | ((xx > 455) & (xx < 530)))),
    regions=[('barrel', 0.024, 'steel', True, lambda xx, yy: (xx < 100) & (yy > 180)),
             ('front sight', 0.012, 'black', True, lambda xx, yy: (xx >= 82) & (xx < 118) & (yy <= 180)),
             ('rear sight', 0.02, 'black', True, lambda xx, yy: (xx >= 462) & (xx < 518) & (yy < 172)),
             ('rail', 0.024, 'black', True, lambda xx, yy: (xx >= 330) & (xx < 462) & (yy < 175)),
             ('grip', 0.032, 'black', True, lambda xx, yy: (xx >= 455) & (xx < 532) & (yy > 236)),
             ('trigger guard', 0.02, 'black', True, lambda xx, yy: (xx >= 398) & (xx < 455) & (yy > 236))],
    mag=(0.062, lambda xx, yy: (xx >= 322) & (xx < 398) & (yy > 228)),
    rings=[(627, 405, 48, 0.38, 10, 'rib'), (1300, 440, 52, 0.38, 10, 'rib')]),
  'r4': dict(name='R4-C', export='R4', src='docs/legendary-skins/00-sakura-gilt-r4c.jpg', flip=True, scale=0.80 / 1382,
    detect='colour', orig_w=768, fill_holes=900, close=7,
    black=[[(346,300),(436,300),(452,380),(455,440),(445,465),(385,472),(368,440),(355,370)],                 # magazine
           [(668,221),(768,221),(768,243),(668,243)],                                                            # barrel
           [(676,216),(698,172),(722,150),(734,154),(730,216)],                                                  # front sight
           [(6,206),(30,204),(33,346),(9,348)]],                                                                 # butt pad
    grip=(990, 0.05), hg=(483, -0.03), body_depth=0.05,
    cut=lambda xx, yy: (yy > 432) | ((xx >= 72) & (xx < 205) & (yy < 158)),
    regions=[('barrel', 0.022, 'black', False, lambda xx, yy: (xx < 86) & (yy > 140)),
             ('front sight', 0.012, 'black', False, lambda xx, yy: (xx >= 22) & (xx < 82) & (yy <= 180)),
             ('rear sight', 0.016, 'black', True, lambda xx, yy: (xx >= 418) & (xx < 462) & (yy < 186)),
             ('grip', 0.03, 'black', True, lambda xx, yy: (xx >= 449) & (xx < 540) & (yy > 262)),
             ('trigger guard', 0.016, 'black', True, lambda xx, yy: (xx >= 385) & (xx < 449) & (yy > 262))],
    mag=(0.03, lambda xx, yy: (xx >= 282) & (xx < 388) & (yy > 258)),
    rings=[]),
  'c8': dict(name='C8-SFW', export='C8', src='docs/legendary-skins/03-vesper-glass.png', scale=0.84 / 1350,
    grip=(980, 0.05), hg=(410, -0.03), body_depth=0.05,
    cut=lambda xx, yy: (yy >= 369) | ((yy > 346) & (xx > 452) & (xx < 530)) | ((yy > 336) & ~(((xx > 282) & (xx < 364)) | ((xx > 452) & (xx < 530)))) | ((xx >= 316) & (xx < 404) & (yy < 142)),
    regions=[('barrel', 0.024, 'black', False, lambda xx, yy: (xx < 118) & (yy > 140)),
             ('front sight', 0.012, 'black', True, lambda xx, yy: (xx >= 98) & (xx < 126) & (yy <= 140)),
             ('rear sight', 0.016, 'black', True, lambda xx, yy: (xx >= 446) & (xx < 488) & (yy < 145)),
             ('grip', 0.03, 'black', True, lambda xx, yy: (xx >= 448) & (xx < 532) & (yy > 232)),
             ('trigger guard', 0.016, 'black', True, lambda xx, yy: (xx >= 380) & (xx < 448) & (yy > 230))],
    mag=(0.03, lambda xx, yy: (xx >= 280) & (xx < 366) & (yy > 245)),
    rings=[(783, 368, 62, 0.42, 8, 'pane')]),
}
cfg = GUNS[sys.argv[1] if len(sys.argv) > 1 else 'g8']
S = cfg['scale']
GX, GZ = cfg['grip']; HY, HYG = cfg['hg']
def gun14(x, y): return [round(GZ + (x - GX) * S, 5), round(HYG - (y - HY) * S, 5)]
to_gun = lambda x, y: gun14(2 * x, 2 * y)

im = Image.open(cfg['src']).convert('RGB')
if cfg.get('flip'): im = im.transpose(Image.FLIP_LEFT_RIGHT)       # muzzle to the left, like the others
H14 = round(1400 * im.height / im.width)                            # concept units: 1400 wide
a = np.asarray(im.resize((700, H14 // 2), Image.LANCZOS)).astype(np.float32)
lum = a.mean(2); H, W = lum.shape
def box(m, r):
    c = np.cumsum(np.cumsum(np.pad(m, ((r + 1, r), (r + 1, r)), mode='edge'), 0), 1)
    return (c[2*r+1:, 2*r+1:] - c[:-2*r-1, 2*r+1:] - c[2*r+1:, :-2*r-1] + c[:-2*r-1, :-2*r-1]) / (2 * r + 1) ** 2
mean = box(lum, 2); std = np.sqrt(np.maximum(box(lum * lum, 2) - mean * mean, 0))
bgl = cfg.get('bg') or np.median(np.concatenate([lum[:20].ravel(), lum[-20:].ravel()]))
yy, xx = np.mgrid[0:H, 0:W]
if cfg.get('detect') == 'colour':
    # a coloured finish on a noisy backdrop: the body by colour, the black parts drawn from the image
    sat = a.max(2) - a.min(2)
    gun = ((sat > 22) & (lum > 60)) | (lum > 150)
    r = cfg.get('close', 3)
    gun = grow(grow(gun, r, 'or'), r, 'and')
    from PIL import ImageDraw
    extra = Image.new('L', (W, H)); d = ImageDraw.Draw(extra)
    ow = cfg['orig_w']; k = 700 / ow
    for poly in cfg['black']:
        d.polygon([((ow - x if cfg.get('flip') else x) * k, y * k) for x, y in poly], fill=255)
    gun |= np.asarray(extra) > 0
else:
    gun = (std > 2.2) | (np.abs(lum - bgl) > 14) | (a.max(2) - a.min(2) > 9)
    gun = grow(grow(gun, 3, 'or'), 3, 'and')
gun = grow(grow(gun, 1, 'and'), 1, 'or')
gun &= ~cfg['cut'](xx, yy)
lab, sizes = components(gun); gun = lab == max(sizes, key=sizes.get)
hl, hs = components(~gun); edge = set(hl[0, :]) | set(hl[-1, :]) | set(hl[:, 0]) | set(hl[:, -1])
for h, hn in hs.items():
    if h not in edge and hn < cfg.get('fill_holes', 0): gun |= hl == h      # dark ports and details inside the finish
np.save('/tmp/' + sys.argv[1] + '-gun-mask.npy', gun) if len(sys.argv) > 2 else None

taken = np.zeros_like(gun); parts = []
for name, d, col, paint, region in cfg['regions']:
    lab, sizes = components(gun & region(xx, yy))
    for k, n in sizes.items():
        if n < 20: continue
        r = lab == k; taken |= r
        hl, hs = components(~r); edge = set(hl[0, :]) | set(hl[-1, :]) | set(hl[:, 0]) | set(hl[:, -1])
        holes = [outline(hl == h, to_gun) for h, hn in hs.items() if h not in edge and hn > 15]
        parts.append({ 'name': name, 'depth': d, 'color': col, 'paint': paint, 'outer': outline(r, to_gun), 'holes': holes })
md, mregion = cfg['mag']
mag = gun & mregion(xx, yy); taken |= mag
lab, sizes = components(mag); mag = lab == max(sizes, key=sizes.get)
body = gun & ~taken
lab, sizes = components(body); body = lab == max(sizes, key=sizes.get)
hl, hs = components(~body); edge = set(hl[0, :]) | set(hl[-1, :]) | set(hl[:, 0]) | set(hl[:, -1])
relief = []
for cx, cy, r, inner, n, kind in cfg['rings']:
    for i in range(n):
        a0, a1 = i * 2 * np.pi / n, (i + 1) * 2 * np.pi / n - 0.05
        arc = lambda rad: [(cx + rad * np.cos(t), cy + rad * np.sin(t)) for t in np.linspace(a0, a1, 5)]
        relief.append({ 'kind': kind, 'area': 0, 'outer': [gun14(x, y) for x, y in arc(r) + arc(r * inner)[::-1]], 'centre': gun14(cx, cy) })
out = {
  'body': { 'depth': cfg['body_depth'], 'outer': outline(body, to_gun), 'holes': [outline(hl == h, to_gun) for h, hn in hs.items() if h not in edge and hn > 25] if cfg.get('body_holes') else [] },
  'parts': parts,
  'mag': { 'name': 'magazine', 'depth': md, 'color': 'black', 'paint': True, 'outer': outline(mag, to_gun), 'holes': [] },
  'relief': relief,
  'art': [gun14(0, 0)[0], gun14(1400, 0)[0], gun14(0, H14)[1], gun14(0, 0)[1]],
}
name = sys.argv[1] if len(sys.argv) > 1 else 'g8'
open('js/scene/' + name + '-model.js', 'w').write(
  '// The ' + cfg['name'] + ', traced from its Legendary concept (' + cfg['src'] + ') at real size.\n'
  '// Gun space, metres: [z, y] outlines extruded across x. Generated by tools/trace-gun.py ' + name + '.\n'
  'export const ' + cfg['export'] + ' = ' + json.dumps(out, separators=(',', ':')) + ';\n')
print(name, 'body', len(out['body']['outer']), 'holes', len(out['body']['holes']), 'parts', [(p['name'], len(p['outer'])) for p in parts], 'art', out['art'])
