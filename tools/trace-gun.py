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
  # The rest of the Legendaries: their concepts are 1536 x 1024; regions are in the 700-wide grid.
  # thresh: detail, brightness and colour thresholds for these darker, smoother backdrops.
  'ak': dict(name='AK-12', export='AK', src='docs/legendary-skins/04-forgeheart.png', tex='forgeheart', scale=0.94 / 1344, thresh=(5, 22, 16),
    grip=(957, 0.07), hg=(415, -0.03), body_depth=0.05, fill_textured=True, body_holes=True,
    cut=lambda xx, yy: yy > 345,
    regions=[('front sight', 0.012, 'black', False, lambda xx, yy: (xx >= 100) & (xx < 135) & (yy < 168)),
             ('barrel', 0.022, 'steel', False, lambda xx, yy: (xx < 142) & (yy >= 168)),
             ('rail', 0.024, 'black', False, lambda xx, yy: (xx >= 270) & (xx < 445) & (yy < 156)),
             ('rear sight', 0.016, 'black', False, lambda xx, yy: (xx >= 445) & (xx < 490) & (yy < 152)),
             ('trigger guard', 0.016, 'black', True, lambda xx, yy: (xx >= 405) & (xx < 452) & (yy > 222)),
             ('grip', 0.03, 'black', True, lambda xx, yy: (xx >= 452) & (xx < 530) & (yy > 228))],
    mag=(0.03, lambda xx, yy: (xx >= 285) & (xx < 405) & (yy > 215)), rings=[]),
  'evo': dict(name='Scorpion EVO 3 A1', export='EVO', src='docs/legendary-skins/05-midnight-orrery.png', tex='midnight-orrery', scale=0.63 / 1328, thresh=(5, 22, 16),
    grip=(820, 0.07), hg=(456, -0.03), body_depth=0.046, fill_textured=True, body_holes=True,
    cut=lambda xx, yy: yy > 392,
    regions=[('barrel', 0.02, 'black', False, lambda xx, yy: (xx < 75) & (yy > 160)),
             ('front sight', 0.012, 'black', True, lambda xx, yy: (xx >= 128) & (xx < 158) & (yy < 120)),
             ('rear sight', 0.012, 'black', True, lambda xx, yy: (xx >= 425) & (xx < 450) & (yy < 120)),
             ('trigger guard', 0.016, 'black', True, lambda xx, yy: (xx >= 300) & (xx < 380) & (yy > 232) & (yy < 285)),
             ('grip', 0.03, 'black', True, lambda xx, yy: (xx >= 380) & (xx < 490) & (yy > 232))],
    mag=(0.026, lambda xx, yy: (xx >= 195) & (xx < 300) & (yy > 232)), rings=[]),
  'compact': dict(name='MP5K', export='MP5K', src='docs/legendary-skins/06-amber-reliquary.png', tex='amber-reliquary', scale=0.56 / 1294, thresh=(5, 22, 16),
    grip=(890, 0.06), hg=(398, -0.03), body_depth=0.046, fill_textured=True, body_holes=True,
    cut=lambda xx, yy: yy > 405,
    regions=[('barrel', 0.02, 'black', False, lambda xx, yy: (xx < 95) & (yy > 128)),
             ('front sight', 0.012, 'black', True, lambda xx, yy: (xx >= 95) & (xx < 128) & (yy < 95)),
             ('rear sight', 0.02, 'black', True, lambda xx, yy: (xx >= 465) & (xx < 525) & (yy < 96)),
             ('foregrip', 0.03, 'black', True, lambda xx, yy: (xx >= 128) & (xx < 185) & (yy > 200)),
             ('trigger guard', 0.016, 'black', True, lambda xx, yy: (xx >= 320) & (xx < 420) & (yy > 205)),
             ('grip', 0.03, 'black', True, lambda xx, yy: (xx >= 420) & (xx < 535) & (yy > 205))],
    mag=(0.026, lambda xx, yy: (xx >= 195) & (xx < 320) & (yy > 205)), rings=[]),
  'smg': dict(name='T-5 SMG', export='T5', src='docs/legendary-skins/07-jade-coil.png', tex='jade-coil', scale=0.6 / 1354, thresh=(5, 22, 16),
    grip=(680, 0.05), hg=(468, -0.03), body_depth=0.046, fill_textured=True, body_holes=True,
    cut=lambda xx, yy: yy > 410,
    regions=[('barrel', 0.02, 'black', False, lambda xx, yy: (xx < 85) & (yy > 140)),
             ('front sight', 0.012, 'black', True, lambda xx, yy: (xx >= 155) & (xx < 185) & (yy < 112)),
             ('rear sight', 0.012, 'black', True, lambda xx, yy: (xx >= 425) & (xx < 450) & (yy < 112)),
             ('trigger guard', 0.016, 'black', True, lambda xx, yy: (xx >= 200) & (xx < 315) & (yy > 215) & (yy < 280)),
             ('grip', 0.03, 'black', True, lambda xx, yy: (xx >= 315) & (xx < 412) & (yy > 215) & (yy < 342))],
    mag=(0.026, lambda xx, yy: (xx >= 340) & (xx < 440) & (yy >= 342)), rings=[]),
  'machinepistol': dict(name='SMG-11', export='SMG11', src='docs/legendary-skins/08-velvet-ante.png', tex='velvet-ante', scale=0.6 / 1330, thresh=(5, 22, 16),
    grip=(540, 0.03), hg=(356, -0.03), body_depth=0.042, fill_textured=True, body_holes=True,
    cut=lambda xx, yy: yy > 412,
    regions=[('barrel', 0.02, 'black', False, lambda xx, yy: (xx < 95) & (yy > 95)),
             ('trigger guard', 0.016, 'black', True, lambda xx, yy: (xx >= 160) & (xx < 238) & (yy > 178) & (yy < 235)),
             ('grip', 0.03, 'black', True, lambda xx, yy: (xx >= 238) & (xx < 335) & (yy > 178) & (yy < 300)),
             ('stock', 0.022, 'black', True, lambda xx, yy: xx >= 440)],
    mag=(0.024, lambda xx, yy: (xx >= 235) & (xx < 335) & (yy >= 300)), rings=[]),
  'pdw': dict(name='MP7', export='MP7', src='docs/legendary-skins/09-opal-overture.png', tex='opal-overture', scale=0.64 / 1360, thresh=(5, 22, 16),
    grip=(690, 0.02), hg=(416, -0.03), body_depth=0.044, fill_textured=True, body_holes=True,
    cut=lambda xx, yy: yy > 421,
    regions=[('barrel', 0.018, 'black', False, lambda xx, yy: (xx < 85) & (yy > 130)),
             ('front sight', 0.012, 'black', True, lambda xx, yy: (xx >= 140) & (xx < 165) & (yy < 92)),
             ('rear sight', 0.012, 'black', True, lambda xx, yy: (xx >= 480) & (xx < 505) & (yy < 92)),
             ('foregrip', 0.026, 'black', True, lambda xx, yy: (xx >= 112) & (xx < 162) & (yy > 205)),
             ('trigger guard', 0.016, 'black', True, lambda xx, yy: (xx >= 235) & (xx < 300) & (yy > 200) & (yy < 245)),
             ('grip', 0.03, 'black', True, lambda xx, yy: (xx >= 300) & (xx < 405) & (yy > 200) & (yy < 336))],
    mag=(0.024, lambda xx, yy: (xx >= 300) & (xx < 400) & (yy >= 336)), rings=[]),
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
    T = cfg.get('thresh', (2.2, 14, 9))
    gun = (std > T[0]) | (np.abs(lum - bgl) > T[1]) | (a.max(2) - a.min(2) > T[2])
    gun = grow(grow(gun, 3, 'or'), 3, 'and')
gun = grow(grow(gun, 1, 'and'), 1, 'or')
gun &= ~cfg['cut'](xx, yy)
lab, sizes = components(gun); gun = lab == max(sizes, key=sizes.get)
hl, hs = components(~gun); edge = set(hl[0, :]) | set(hl[-1, :]) | set(hl[:, 0]) | set(hl[:, -1])
for h, hn in hs.items():
    if h not in edge and hn < cfg.get('fill_holes', 0): gun |= hl == h      # dark ports and details inside the finish
    # a real opening shows the smooth backdrop; a dark part of the gun is textured or darker than it
    elif h not in edge and cfg.get('fill_textured') and (std[hl == h].mean() > 1.3 or lum[hl == h].mean() < bgl - 10): gun |= hl == h
if cfg.get('tex') and 'tex' in sys.argv:
    # the painted skin: the concept, its backdrop filled outwards from the gun's edge (the sides sample it)
    full = np.asarray(im).astype(np.float32); FH, FW = full.shape[:2]
    known = np.asarray(Image.fromarray(gun.astype(np.uint8) * 255).resize((FW, FH), Image.NEAREST)) > 0
    col = full * known[..., None]; k = known.astype(np.float32)
    while not known.all():
        sc = sum(np.roll(col, d, ax) for ax in (0, 1) for d in (-1, 1)); sk = sum(np.roll(k, d, ax) for ax in (0, 1) for d in (-1, 1))
        grow_ = ~known & (sk > 0)
        col[grow_] = sc[grow_] / sk[grow_][:, None]; known |= grow_; k = known.astype(np.float32)
    Image.fromarray(col.clip(0, 255).astype(np.uint8)).save('data/skins/' + cfg['tex'] + '.webp', quality=88, method=6)
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
