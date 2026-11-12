# Jade Coil's bare gun: the skin painting (data/skins/jade-coil.webp) with the jade dragon taken out
# (a band along its spine, traced from 07-jade-coil.png), filled smoothly from the bronze around it.
# The inspect fades to it while the dragon has come alive and left the gun. Its spine is also the
# 3D dragon's resting pose (JADE_SPINE in js/scene/inspect-effects.js).
#   python3 tools/jade-bare.py
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
SPINE = [(230, 378), (280, 360), (320, 330), (370, 330), (420, 370), (470, 430), (530, 445), (590, 410), (640, 360), (700, 330), (760, 345),
         (830, 390), (900, 440), (960, 460), (1020, 430), (1080, 380), (1140, 350), (1220, 345), (1300, 335), (1370, 320), (1430, 302)]
src = Image.open('data/skins/jade-coil.webp').convert('RGB'); W, H = src.size
m = Image.new('L', (W, H)); d = ImageDraw.Draw(m)
for i in range(len(SPINE) - 1):
    w = int(84 - 40 * i / (len(SPINE) - 1))                      # thick at the head, thinner to the tail
    d.line([SPINE[i], SPINE[i + 1]], fill=255, width=w)
    d.ellipse([SPINE[i][0] - w // 2, SPINE[i][1] - w // 2, SPINE[i][0] + w // 2, SPINE[i][1] + w // 2], fill=255)
d.ellipse([190, 320, 350, 420], fill=255)                                                     # the head
jm = np.asarray(src).astype(np.float32); r, g, bb = jm[..., 0], jm[..., 1], jm[..., 2]
jade = ((g > r * 1.04) & (g > bb * 1.08) & (jm.max(2) - jm.min(2) > 18) & (jm.mean(2) > 30)) | ((g > r * 0.92) & (g > bb * 1.3) & (jm.mean(2) > 60))
jade &= np.asarray(Image.new('L', (W, H), 0).point(lambda v: v)) == 0
yy, xx = np.mgrid[0:H, 0:W]; jade &= (xx > 180) & (xx < 1460) & (yy > 260) & (yy < 500)
m = Image.fromarray(np.maximum(np.asarray(m), jade.astype(np.uint8) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))
hole = np.asarray(m.filter(ImageFilter.MaxFilter(5))) > 0
hole &= (xx > 170) & (xx < 1470)
# fill by diffusion at a quarter size, then put it back at full size with a little grain
s = 4; small = np.asarray(src.resize((W // s, H // s), Image.LANCZOS)).astype(np.float32)
hs = np.asarray(Image.fromarray(hole.astype(np.uint8) * 255).resize((W // s, H // s), Image.NEAREST)) > 0
col = small.copy(); col[hs] = small[~hs].mean(0)
for _ in range(600):
    avg = (np.roll(col, 1, 0) + np.roll(col, -1, 0) + np.roll(col, 1, 1) + np.roll(col, -1, 1)) / 4
    col[hs] = avg[hs]
fill = np.asarray(Image.fromarray(col.clip(0, 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)).astype(np.float32)
out = np.asarray(src).astype(np.float32).copy()
rng = np.random.default_rng(7)
out[hole] = fill[hole] * (0.88 + 0.24 * rng.random((hole.sum(), 1)))
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save('data/skins/jade-coil-bare.webp', quality=88, method=6)
print('filled', int(hole.sum()), 'px')
