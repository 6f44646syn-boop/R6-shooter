# Forgeheart's peak painting: the owner's peak concept (docs/legendary-skins/04-forgeheart-peak.webp)
# laid on the frame of the base concept (04-forgeheart.png), so it maps onto the same traced AK-12,
# its backdrop filled outwards from the gun's edge (the sides sample it). Run after
# `python3 tools/trace-gun.py ak save` (it reads that gun mask).
#   python3 tools/forge-peak.py
import sys, numpy as np
from PIL import Image
sys.path.insert(0, 'tools')
from trace_lib import grow
B = Image.open('docs/legendary-skins/04-forgeheart-peak.webp').convert('RGB')
# measured by matching edges on the stock, grip, magazine and barrel: scale 0.995, then shift (12, 16) px
P = B.transform((1536, 1024), Image.AFFINE, (1 / 0.995, 0, -12 / 0.995, 0, 1 / 0.995, -16 / 0.995), resample=Image.BICUBIC)
gun = grow(np.load('/tmp/ak-gun-mask.npy'), 4, 'or')          # a little past the outline: the shard tips stand proud of it
full = np.asarray(P).astype(np.float32); FH, FW = full.shape[:2]
known = np.asarray(Image.fromarray(gun.astype(np.uint8) * 255).resize((FW, FH), Image.NEAREST)) > 0
col = full * known[..., None]; k = known.astype(np.float32)
while not known.all():
    sc = sum(np.roll(col, d, ax) for ax in (0, 1) for d in (-1, 1)); sk = sum(np.roll(k, d, ax) for ax in (0, 1) for d in (-1, 1))
    g = ~known & (sk > 0)
    col[g] = sc[g] / sk[g][:, None]; known |= g; k = known.astype(np.float32)
Image.fromarray(col.clip(0, 255).astype(np.uint8)).save('data/skins/forgeheart-peak.webp', quality=88, method=6)
print('data/skins/forgeheart-peak.webp')
