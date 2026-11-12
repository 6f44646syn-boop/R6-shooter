# Outline tracing for the traced gun models (tools/f2-trace.py, tools/g8-trace.py): binary masks
# on a concept side view -> simplified outlines. Masks are numpy bool arrays [y, x].
from collections import deque
import numpy as np

def grow(m, r, op):
    o = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            sh = np.roll(np.roll(m, dy, 0), dx, 1)
            o = (o | sh) if op == 'or' else (o & sh)
    return o
def components(m):
    H, W = m.shape
    lab = np.zeros(m.shape, int); n = 0; sizes = {}
    for y0, x0 in zip(*np.where(m)):
        if lab[y0, x0]: continue
        n += 1; q = deque([(y0, x0)]); lab[y0, x0] = n; c = 0
        while q:
            y, x = q.popleft(); c += 1
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < H and 0 <= xx < W and m[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n; q.append((yy, xx))
        sizes[n] = c
    return lab, sizes
def trace(m):
    H, W = m.shape
    ys, xs = np.where(m); i = np.lexsort((xs, ys))[0]; start = (xs[i], ys[i])
    dirs = [(-1, 0), (-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1)]
    pts = [start]; cur = start; back = 0
    for _ in range(200000):
        for k in range(8):
            d = (back + 1 + k) % 8; nx, ny = cur[0] + dirs[d][0], cur[1] + dirs[d][1]
            if 0 <= nx < W and 0 <= ny < H and m[ny, nx]:
                back = (d + 4) % 8; cur = (nx, ny); break
        if cur == start: break
        pts.append(cur)
    return pts
def simplify(pts, eps):
    pts = np.array(pts, float)
    def dp(i, j):
        if j <= i + 1: return [i]
        p, q = pts[i], pts[j]; seg = q - p; L = np.hypot(*seg) or 1e-9
        v = pts[i + 1:j] - p; d = np.abs(seg[0] * v[:, 1] - seg[1] * v[:, 0]) / L
        k = int(np.argmax(d))
        return dp(i, i + 1 + k) + dp(i + 1 + k, j) if d[k] > eps else [i]
    far = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
    return pts[dp(0, far) + dp(far, len(pts) - 1)].tolist()
def outline(m, to_gun, eps=0.8): return [to_gun(x, y) for x, y in simplify(trace(m), eps)]
