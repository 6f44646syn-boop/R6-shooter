// The solid boxes of a Battle map, from its layout (no three.js: shared by the arena, the
// match-mode map builder and the tests). Boxes are solid; stairs become one box per step;
// a ramp becomes thin slices (smooth to look at, steps for collision, standing and bullets).
export const RAMP_SLICE = 0.25;      // ramps collide as thin steps this long

// One layout entry as the pieces it stands for: itself, and its point mirror when the map
// (or the entry) is mirrored. Stairs and ramps get their direction.
export function layoutPieces(map) {
  const out = [];
  for (const b0 of map.layout) {
    const b = (b0.stairs || b0.ramp) && !b0.dir ? { ...b0, dir: b0.stairs || b0.ramp } : b0;
    out.push(b);
    if (b.mirror ?? map.mirror) out.push({ ...b, x: -b.x, z: -b.z, dir: b.dir ? (b.dir[0] === '+' ? '-' : '+') + b.dir[1] : undefined });
  }
  return out;
}
export function span(b) {
  const minX = b.x - b.w / 2, maxX = b.x + b.w / 2, minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
  return { minX, maxX, minZ, maxZ, along: b.dir[1] === 'x' ? b.w : b.d };
}
// Piece i of n along dir: [x0, x1] and [z0, z1].
export function piece(s, dir, i, n) {
  let a0 = i * s.along / n, a1 = (i + 1) * s.along / n;
  if (dir[0] === '-') { const t0 = s.along - a1; a1 = s.along - a0; a0 = t0; }
  return [dir[1] === 'x' ? [s.minX + a0, s.minX + a1] : [s.minX, s.maxX], dir[1] === 'z' ? [s.minZ + a0, s.minZ + a1] : [s.minZ, s.maxZ]];
}
export const stairCount = (b) => Math.max(1, Math.round((b.y1 - (b.y || 0)) / (b.rise || 0.3)));
export const rampCount = (b) => Math.max(1, Math.ceil(span(b).along / RAMP_SLICE));

// Every solid of the map, in layout order: { minX, maxX, minY, maxY, minZ, maxZ, h, kind, i }
// (ramp: true on ramp slices; src: the layout piece it came from).
export function layoutSolids(map) {
  const boxes = [];
  const solid = (minX, maxX, minY, maxY, minZ, maxZ, src, extra) => { boxes.push({ minX, maxX, minY, maxY, minZ, maxZ, h: maxY, kind: src.kind, i: boxes.length, src, ...extra }); };
  for (const b of layoutPieces(map)) {
    const y0 = b.y || 0;
    if (b.stairs) {
      const s = span(b), n = stairCount(b), base = b.base ?? y0;
      for (let i = 0; i < n; i++) { const [bx, bz] = piece(s, b.dir, i, n); solid(bx[0], bx[1], base, y0 + (b.y1 - y0) * (i + 1) / n, bz[0], bz[1], b); }
    } else if (b.ramp) {
      const s = span(b), base = b.base ?? 0, n = rampCount(b);
      for (let i = 0; i < n; i++) { const [bx, bz] = piece(s, b.dir, i, n); solid(bx[0], bx[1], base, y0 + (b.y1 - y0) * (i + 0.5) / n, bz[0], bz[1], b, { ramp: true }); }
    } else solid(b.x - b.w / 2, b.x + b.w / 2, y0, y0 + b.h, b.z - b.d / 2, b.z + b.d / 2, b);
  }
  return boxes;
}
// The four walls round a map as solids (outside it, 1 m thick, far taller than anything thrown).
export function edgeSolids(hx, hz) {
  return [[-hx - 1, hx + 1, -hz - 1, -hz], [-hx - 1, hx + 1, hz, hz + 1], [-hx - 1, -hx, -hz, hz], [hx, hx + 1, -hz, hz]]
    .map(([minX, maxX, minZ, maxZ]) => ({ minX, maxX, minY: 0, maxY: 1e4, minZ, maxZ, kind: 'edge' }));
}
