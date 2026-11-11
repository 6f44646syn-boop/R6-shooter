// Enhanced Graphics pack v5: physically based map materials, authored as procedural GLSL and
// baked offline at high resolution (tools/build-materials.mjs renders them in headless Chrome).
// Every material is original and tiles seamlessly: all noise is periodic over the texture.
//
// A material is a GLSL function  void surf(vec2 uv, vec2 p, inout S s)
//   uv: 0..1 over the texture; p: the same point in metres (uv * tile)
//   s.c   base colour (sRGB)       s.h  height in metres (for the normal map and occlusion)
//   s.r   roughness                s.m  metalness            s.ao  occlusion the material bakes in
// Output per material: <name>-albedo.webp, <name>-normal.webp (OpenGL, +Y up), <name>-orm.webp
// (R occlusion, G roughness, B metalness: three.js aoMap / roughnessMap / metalnessMap).

export const LIB = /* glsl */ `
precision highp float;
uniform vec2 uTile; uniform float uSeed;
struct S { vec3 c; float h; float r; float m; float ao; };
const float PI = 3.14159265;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031 + uSeed * .0137); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973) + uSeed * .0137); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// periodic gradient noise: x in lattice units, period per (lattice units), about -0.7..0.7
float gn(vec2 x, vec2 per) {
  vec2 i = floor(x), f = fract(x), u = f * f * f * (f * (f * 6. - 15.) + 10.);
  vec2 g00 = hash22(mod(i, per)) * 2. - 1., g10 = hash22(mod(i + vec2(1, 0), per)) * 2. - 1.;
  vec2 g01 = hash22(mod(i + vec2(0, 1), per)) * 2. - 1., g11 = hash22(mod(i + vec2(1, 1), per)) * 2. - 1.;
  return mix(mix(dot(g00, f), dot(g10, f - vec2(1, 0)), u.x), mix(dot(g01, f - vec2(0, 1)), dot(g11, f - vec2(1, 1)), u.x), u.y);
}
// fbm over the tile: base = periods across the tile at the first octave; ~0..1
float fbm(vec2 uv, vec2 base, int oct) {
  float s = 0., a = .5, n = 0.; vec2 per = floor(base + .5);
  for (int i = 0; i < 10; i++) { if (i >= oct) break; s += a * gn(uv * per, per); n += a; a *= .5; per *= 2.; }
  return clamp(s / n * 1.4 + .5, 0., 1.);
}
float ridge(vec2 uv, vec2 base, int oct) {
  float s = 0., a = .5, n = 0.; vec2 per = floor(base + .5);
  for (int i = 0; i < 10; i++) { if (i >= oct) break; s += a * (1. - abs(gn(uv * per, per) * 1.6)); n += a; a *= .5; per *= 2.; }
  return clamp(s / n, 0., 1.);
}
// periodic Worley: F1, F2, cell id hash
vec3 vor(vec2 uv, vec2 per) {
  vec2 x = uv * per, i = floor(x), f = fract(x); float d1 = 9., d2 = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++) {
    vec2 o = vec2(xx, y), c = mod(i + o, per), pt = o + hash22(c) * .9 + .05 - f; float d = length(pt);
    if (d < d1) { d2 = d1; d1 = d; id = hash12(c + 7.1); } else if (d < d2) d2 = d;
  }
  return vec3(d1, d2, id);
}
float sat(float x) { return clamp(x, 0., 1.); }
float sstep(float a, float b, float x) { return smoothstep(a, b, x); }
vec3 hex(float r, float g, float b) { return vec3(r, g, b) / 255.; }
vec3 hex(int r, int g, int b) { return vec3(float(r), float(g), float(b)) / 255.; }
// rows of boards / bricks: returns (local u 0..1, local v 0..1, row id, cell id) in a grid of
// n.x by n.y cells per tile, every other row shifted by 'shift'
vec4 cells(vec2 uv, vec2 n, float shift) {
  vec2 q = uv * n; float row = floor(q.y); q.x += mod(row, 2.) * shift; float col = floor(q.x);
  return vec4(fract(q), row, hash12(vec2(mod(col, n.x), row) + 3.7));
}
// a groove (0 in the joint, 1 away): distance d from an edge in metres, width w
float groove(float d, float w) { return sstep(0., w, d); }
// wear and dirt helpers
float grime(vec2 uv, float k) { return fbm(uv + .37, uTile * 1.3, 6) * k; }
`;

// name: { tile: [w, h] metres the texture spans, size: [w, h] pixels, big: shown large (Ultra 2048),
//         glsl: body of surf() }
export const MATERIALS = {
  /* ---------- outdoors ---------- */
  grass: { tile: [6, 6], size: [2048, 2048], big: true, glsl: `
    float pat = fbm(uv, vec2(3), 6), dry = fbm(uv + 4.1, vec2(2), 5);
    float blades = ridge(uv + .2, uTile * 9., 3);
    vec3 a = hex(78, 110, 46), b = hex(104, 138, 60), d = hex(138, 128, 74);
    s.c = mix(mix(a, b, pat), d, sstep(.62, .85, dry) * .55) * (.8 + .35 * blades);
    float clover = sstep(.18, .1, vor(uv, uTile * 2.2).x) * sstep(.55, .7, fbm(uv + 9., vec2(4), 4));
    s.c = mix(s.c, hex(70, 118, 52), clover * .6);
    s.h = blades * .012 + pat * .01; s.r = .92 - blades * .1; s.ao = .75 + .25 * blades;` },
  lawn: { tile: [6, 6], size: [2048, 2048], big: true, glsl: `
    float pat = fbm(uv, vec2(3), 6), blades = ridge(uv + .3, uTile * 10., 3);
    float stripe = step(.5, fract(uv.x * 2.));          // mowing stripes, 1.5 m wide
    vec3 a = hex(84, 128, 52), b = hex(112, 150, 66);
    s.c = mix(a, b, pat) * (.82 + .3 * blades) * mix(.92, 1.08, stripe);
    s.h = blades * .01; s.r = .9; s.ao = .78 + .22 * blades;` },
  dirt: { tile: [6, 6], size: [2048, 2048], big: true, glsl: `
    float n = fbm(uv, vec2(4), 7), coarse = fbm(uv + 2.3, vec2(1.5), 4);
    vec3 v = vor(uv, uTile * 5.); float peb = sstep(.32, .18, v.x) * step(.55, v.z);
    vec3 a = hex(122, 100, 74), b = hex(150, 126, 96), wet = hex(92, 76, 58);
    s.c = mix(mix(a, b, n), wet, sstep(.62, .8, coarse) * .7);
    s.c = mix(s.c, mix(hex(140, 136, 128), hex(100, 96, 90), v.z), peb);
    s.h = n * .02 + peb * (.012 - v.x * .03) + coarse * .03; s.r = mix(.95, .7, sstep(.62, .8, coarse)); s.ao = 1. - peb * .2;` },
  asphalt: { tile: [6, 6], size: [2048, 2048], big: true, glsl: `
    float n = fbm(uv, vec2(6), 7); vec3 v = vor(uv, uTile * 40.);
    float agg = sstep(.4, .15, v.x) * v.z;
    float crack = sstep(.03, .0, abs(ridge(uv + 5., vec2(2), 4) - .82)) * sstep(.5, .7, fbm(uv + 8., vec2(2), 3));
    s.c = vec3(.28 + n * .08) + agg * .12 - crack * .12; s.c *= hex(255, 252, 248);
    s.h = agg * .002 + n * .003 - crack * .006; s.r = .82 + .1 * n; s.ao = 1. - crack * .5;` },
  /* ---------- walls ---------- */
  house: { tile: [2.4, 3.2], size: [1536, 2048], big: true, glsl: `
    // painted plaster; a skirting board at the floor and a cornice at the top (the texture
    // spans the full wall height: p.y = 0 at the floor)
    float pl = fbm(uv, vec2(6, 8), 7), roller = fbm(vec2(uv.x * 3., uv.y * .4), vec2(18, 3), 3);
    vec3 paint = hex(222, 214, 197);
    s.c = paint * (.95 + .07 * pl + .03 * roller); s.h = pl * .0012 + roller * .0004; s.r = .78 + .08 * pl;
    float sk = .14;                                         // skirting 14 cm
    if (p.y < sk) { float g = groove(sk - p.y, .006) * groove(p.y, .004) * (1. - .4 * sstep(.05, .052, p.y) * sstep(.06, .058, p.y));
      s.c = hex(236, 232, 224) * (.92 + .08 * fbm(uv, vec2(40, 2), 4)); s.h = .012 * g + (p.y > .05 && p.y < .06 ? -.002 : 0.); s.r = .42; }
    float top = uTile.y - p.y;
    if (top < .09) { s.c = hex(232, 228, 218); s.h = .01 * groove(.09 - top, .01) + .004 * sin(top * 140.); s.r = .5; }
    s.c *= 1. - grime(uv, .05) * sstep(.6, .0, p.y);         // scuffs near the floor
    s.ao = 1. - .18 * sstep(.3, .0, p.y);` },
  /* ---------- building exteriors (the outer faces of the Bomb buildings) ---------- */
  brick: { tile: [2.4, 3.2], size: [1536, 2048], big: true, glsl: `
    // red brick about 21 x 6.5 cm (+1 cm mortar), stretcher bond; a concrete plinth at the floor,
    // a soldier course under the eaves; burnt and pale bricks, chipped arrises, soot and
    // efflorescence (white salt bloom) rising from the plinth, dark rain streaks from the top
    float y = p.y, plinth = .32, top = uTile.y - .2;
    vec2 n = vec2(11., 43.), bs = uTile / n;                 // whole bricks per tile (seamless)
    vec4 b = cells(uv, n, .5);
    float ex = min(b.x, 1. - b.x) * bs.x, ey = min(b.y, 1. - b.y) * bs.y;
    float chip = fbm(uv, n * vec2(.5, 1.), 3) * .004;
    float e = min(ex, ey) - .005 - chip, j = groove(e, .0035);
    float tone = b.w, burn = step(.86, hash12(vec2(b.w * 91., b.z)));
    float fine = fbm(uv, n * 2., 5), sand = sstep(.55, .2, vor(uv, uTile * 120.).x);
    vec3 brk = mix(hex(146, 62, 44), hex(176, 88, 60), tone) * (.84 + .28 * fine);
    brk = mix(brk, hex(92, 44, 36), burn * .7);
    brk = mix(brk, hex(196, 132, 104), step(.93, fract(b.w * 13.7)) * .6);
    vec3 mort = hex(178, 170, 156) * (.82 + .2 * fbm(uv + 4., uTile * 20., 4));
    s.c = mix(mort, brk * (1. - sand * .08), j);
    s.h = j * (.006 + fine * .0015) - (1. - j) * .002 + sand * .0002;
    s.r = mix(.95, .82, j); s.ao = mix(.55, 1., j) * (1. - (1. - j) * .1);
    // soldier course: bricks on end along the top
    if (y > top) { float u2 = fract(uv.x * uTile.x / .075), v2 = (y - top) / .2;
      float jj = groove(min(min(u2, 1. - u2) * .075, min(v2, 1. - v2) * .2) - .005, .0035);
      float id = hash12(vec2(floor(uv.x * uTile.x / .075), 9.));
      s.c = mix(mort, mix(hex(140, 58, 42), hex(170, 84, 58), id) * (.85 + .25 * fine), jj); s.h = jj * .009; s.ao = mix(.5, 1., jj); }
    // concrete plinth
    if (y < plinth) { float pn = fbm(uv, uTile * 3., 7);
      s.c = hex(150, 146, 138) * (.82 + .26 * pn) * (1. - sstep(.6, .9, fbm(uv + 8., uTile * 6., 4)) * .15);
      s.h = .014 + pn * .0015; s.r = .9; s.ao = 1.;
      if (y > plinth - .025) { s.h = .014 - (y - (plinth - .025)) * .5; s.ao = .8; } }
    // weathering
    float salt = sstep(.6, .85, fbm(uv + 2.3, uTile * vec2(2., 1.), 6)) * step(plinth, y);
    s.c = mix(s.c, hex(214, 210, 200), salt * .22 * sstep(.9, .35, y));
    float streak = sstep(.45, .9, fbm(vec2(uv.x * 7., uv.y * .35), vec2(17, 1), 5)) * sstep(top - 1.6, top, y);
    s.c *= 1. - streak * .28; s.r -= streak * .1;
    s.c *= 1. - sstep(.3, .0, y) * .15;` },
  siding: { tile: [2.4, 3.2], size: [1536, 2048], big: true, glsl: `
    // painted timber clapboard 15 cm reveal, each board's lower edge stands proud; corner of
    // a pale trim at the eaves, a stone plinth; the paint is chalky and peels in places
    float y = p.y, plinth = .3, top = uTile.y - .16;
    float rv = .15, k = fract((y - plinth) / rv), row = floor((y - plinth) / rv);
    float lap = (1. - k) * .016 + sstep(.06, .0, k) * -.004;          // the board tapers upwards
    float shadow = sstep(.0, .08, k);
    float gr = fbm(vec2(uv.x * 2., (y - plinth) / rv / uTile.y * 22.), vec2(8, 22), 6);
    float id = hash12(vec2(row, 3.)), butt = step(.97, fract(uv.x * 3. + id * 7.));
    vec3 paint = hex(196, 204, 196) * (.9 + .08 * id);
    float peel = sstep(.8, .83, fbm(uv + 6., vec2(3, 4), 6)) * sstep(.5, 1.2, y) * sstep(top, top - .4, y);
    vec3 wood = mix(hex(120, 100, 76), hex(150, 128, 98), gr);
    s.c = mix(paint * (.9 + .12 * gr), wood, peel) * mix(.62, 1., shadow) * (1. - butt * .35);
    s.h = lap + gr * .0006 - peel * .0004 - butt * .002; s.r = mix(.72, .9, peel); s.ao = mix(.55, 1., shadow);
    if (y > top) { s.c = hex(236, 234, 226) * (.92 + .08 * gr); s.h = .022; s.r = .6; s.ao = 1. - sstep(top + .02, top, y) * .3; }
    if (y < plinth) { vec4 st = cells(uv, vec2(uTile.x / .4, 2.), .5); float j = groove(min(min(st.x, 1. - st.x) * .4, min(st.y, 1. - st.y) * .15) - .006, .006);
      float pn = fbm(uv, uTile * 6., 6);
      s.c = mix(hex(110, 104, 96), hex(150, 142, 128) * (.8 + .3 * st.w) * (.85 + .25 * pn), j); s.h = j * (.02 + pn * .003); s.r = .9; s.ao = mix(.5, 1., j); }
    s.c *= 1. - grime(uv, .12) * sstep(1., .0, y);` },
  ashlar: { tile: [2.4, 3.2], size: [1536, 2048], big: true, glsl: `
    // dressed limestone blocks 60 x 40 cm with fine V-joints, a rusticated base course and a
    // moulded cornice; tooled faces, fossil flecks, green-grey weathering low down
    float y = p.y, base = .8, top = uTile.y - .3;
    vec4 b = cells(uv, vec2(uTile.x / .6, uTile.y / .4), .5);
    float e = min(min(b.x, 1. - b.x) * .6, min(b.y, 1. - b.y) * .4);
    float j = groove(e - .002, .008);
    float n = fbm(uv, uTile * 4., 8), tool = fbm(vec2(uv.x * 40., uv.y * 2.), vec2(96, 6), 3);
    float fleck = sstep(.08, .03, vor(uv, uTile * 70.).x);
    vec3 st = mix(hex(214, 206, 188), hex(196, 186, 166), b.w) * (.9 + .14 * n) * (1. - fleck * .12);
    s.c = st * mix(.7, 1., j); s.h = j * .008 + n * .0012 + tool * .0003 - fleck * .0005; s.r = .82; s.ao = mix(.55, 1., j);
    if (y < base) { vec4 r = cells(uv, vec2(uTile.x / 1.2, 2.), .5); float er = min(min(r.x, 1. - r.x) * 1.2, min(r.y, 1. - r.y) * .4);
      float rus = sstep(.0, .05, er); float rough = fbm(uv + 3., uTile * 10., 6);
      s.c = mix(hex(120, 116, 106), hex(170, 162, 146) * (.8 + .3 * r.w) * (.8 + .3 * rough), rus); s.h = rus * (.03 + rough * .01); s.r = .92; s.ao = mix(.4, 1., rus); }
    if (y > top) { float t = (y - top) / .3;
      float prof = t < .25 ? .03 : t < .45 ? .05 - (t - .25) * .1 : t < .7 ? .07 : .09;
      s.c = hex(222, 216, 200) * (.92 + .1 * n); s.h = prof; s.r = .7; s.ao = .7 + .3 * fract(t * 4.); }
    float green = sstep(.5, .8, fbm(uv + 1.1, uTile * 2., 6)) * sstep(1.5, .2, y);
    s.c = mix(s.c, s.c * hex(170, 180, 160), green * .5);
    s.c *= 1. - sstep(.5, .9, fbm(vec2(uv.x * 9., uv.y * .4), vec2(21, 1), 5)) * sstep(top - 1.5, top, y) * .2;` },
  flashing: { tile: [1, .25], size: [1024, 256], glsl: `
    // roof edge: galvanised steel flashing, spangle and white rust, a folded drip lip below,
    // screw heads every 25 cm, a lapped joint every metre; dark run-off under the lip
    float y = p.y / uTile.y, n = fbm(uv, vec2(8, 4), 6);
    vec3 sp = vor(uv, vec2(60, 30)); float spangle = sp.z * .12;
    vec3 zinc = hex(150, 156, 160) * (.86 + spangle + .1 * n);
    float wr = sstep(.6, .8, fbm(uv + 3., vec2(10, 5), 6));
    s.c = mix(zinc, hex(196, 198, 192), wr * .5); s.r = mix(.42, .75, wr); s.m = mix(.85, .4, wr); s.h = 0.;
    if (y > .86) { s.h = .004; s.c *= 1.08; }                        // the top fold
    if (y < .16) { float t = y / .16; s.h = -.006 * (1. - t); s.c *= .55 + .45 * t; s.ao = .6 + .4 * t; }   // the drip lip
    vec2 q = vec2(fract(uv.x * 4.) - .5, y - .55); float screw = sstep(.012, .008, length(q * vec2(uTile.x / 4., uTile.y)));
    s.c = mix(s.c, hex(70, 74, 78), screw); s.h += screw * .002;
    float lap = sstep(.004, .0, abs(fract(uv.x) - .5) - .496); s.h -= lap * .002; s.ao *= 1. - lap * .4;` },
  walltop: { tile: [1, 1], size: [1024, 1024], glsl: `
    float n = fbm(uv, vec2(4), 6); s.c = hex(168, 160, 144) * (.88 + .2 * n); s.h = n * .002; s.r = .85;` },
  block: { tile: [2, 2], size: [2048, 2048], big: true, glsl: `
    // concrete blocks 40 x 20 cm, running bond, recessed mortar
    vec4 b = cells(uv, vec2(5, 10), .5); vec2 m = vec2(min(b.x, 1. - b.x) * .4, min(b.y, 1. - b.y) * .2);
    float edge = min(m.x, m.y), j = groove(edge - .004, .006);
    float pores = sstep(.12, .05, vor(uv, uTile * 60.).x) * .8;
    float n = fbm(uv, vec2(10), 7);
    vec3 blockC = hex(170, 166, 156) * (.88 + .16 * b.w + .1 * n) * (1. - pores * .25);
    s.c = mix(hex(140, 136, 126) * (.9 + .1 * n), blockC, j);
    s.h = j * (.008 + n * .002 - pores * .002); s.r = .9; s.ao = mix(.6, 1., j) * (1. - pores * .3);` },
  concrete: { tile: [2, 2], size: [2048, 2048], big: true, glsl: `
    // poured concrete: formwork seams every metre, tie holes, pores, water stains
    float n = fbm(uv, vec2(5), 8), big = fbm(uv + 3., vec2(1.5), 4);
    float seam = groove(abs(fract(uv.x * 2.) - .5) * 1. - .496, .002) ; seam = 1. - (1. - groove(min(fract(uv.x * 2.), 1. - fract(uv.x * 2.)), .003)) * .6;
    vec2 th = fract(uv * 2.) - .5; float tie = sstep(.012, .008, length(th * 1. - vec2(0., .25)) ) + sstep(.012, .008, length(th - vec2(0., -.25)));
    float pores = sstep(.1, .03, vor(uv, uTile * 90.).x);
    vec3 col = mix(hex(150, 146, 138), hex(176, 172, 164), n) * mix(.88, 1.04, big);
    float stain = sstep(.55, .85, fbm(vec2(uv.x * 3., uv.y * .6), vec2(6, 1), 5)) * .18;
    s.c = col * (1. - stain) * (1. - pores * .3) * (1. - tie * .5) * mix(.85, 1., seam);
    s.h = n * .0015 - pores * .0015 - tie * .006 + (seam - 1.) * .002; s.r = .88 - stain * .2; s.ao = (1. - pores * .4) * (1. - tie * .5);` },
  fence: { tile: [2, 2], size: [1024, 1024], glsl: `
    // weathered vertical boards 10 cm, a rail behind
    vec4 b = cells(uv.yx, vec2(1, 20), 0.); float x = b.y; float id = b.w;
    float gr = fbm(vec2(uv.x * 20., uv.y * .5), vec2(400, 2), 5);
    float gap = groove(min(fract(uv.x * 20.), 1. - fract(uv.x * 20.)) * .1, .006);
    vec3 w = mix(hex(150, 144, 134), hex(184, 176, 164), id) * (.82 + .3 * gr);
    s.c = mix(hex(40, 38, 36), w, gap); s.h = gap * (.01 + gr * .002); s.r = .9; s.ao = mix(.3, 1., gap);` },
  barn: { tile: [2.4, 3.2], size: [1536, 2048], big: true, glsl: `
    // red barn boards with battens, sun-bleached towards the top
    float k = fract(uv.x * 12.), id = hash12(vec2(floor(uv.x * 12.), 1.));
    float batten = sstep(.04, .03, abs(k - .0)) + sstep(.04, .03, abs(k - 1.));
    float gr = fbm(vec2(uv.x * 12., uv.y * 1.), vec2(144, 4), 6);
    vec3 red = mix(hex(128, 40, 32), hex(156, 58, 44), id) * (.8 + .32 * gr);
    float fade = fbm(uv + 1.7, vec2(3, 4), 5) * .25 + p.y / uTile.y * .15;
    s.c = mix(red, hex(170, 120, 108), fade); s.c = mix(s.c, s.c * .7, batten);
    s.h = gr * .002 + batten * .012; s.r = .86; s.ao = 1. - .25 * sstep(.06, .0, k) ;` },
  rust: { tile: [2.6, 2.6], size: [2048, 2048], big: true, glsl: `
    // shipping container: corrugated painted steel, rust where the paint is worn
    float k = fract(uv.x * 9.); float cor = sin(k * PI * 2.);
    float rustN = fbm(uv, vec2(4), 7), chip = sstep(.62, .7, rustN + .15 * fbm(uv + 2., vec2(20), 4));
    vec3 paint = hex(122, 58, 40) * (.9 + .15 * fbm(uv + 5., vec2(8), 5));
    vec3 rusty = mix(hex(110, 52, 26), hex(150, 84, 40), fbm(uv + 9., vec2(30), 5));
    float streak = sstep(.5, .9, fbm(vec2(uv.x * 9., uv.y * .4), vec2(81, 2), 4)) * .3;
    s.c = mix(paint, rusty, chip) * (1. - streak * .5);
    s.h = cor * .012 - chip * .0006; s.r = mix(.55, .92, chip); s.m = mix(.3, .1, chip); s.ao = .85 + .15 * cor;` },
  /* ---------- floors ---------- */
  wood: { tile: [3, 3], size: [2048, 2048], big: true, glsl: `
    // oak floor: boards 15 cm wide along x, 1-1.5 m long with staggered ends, varnished
    float j = floor(uv.y * 20.), across = fract(uv.y * 20.), off = hash12(vec2(j, 11.));
    float u = uv.x * 2. + off, seg = floor(u), along = fract(u), id = hash12(vec2(mod(seg, 2.), j) + 5.3);
    float grain = fbm(vec2(uv.x * 2. + id * 3., uv.y * 20. + id), vec2(8, 160), 6);
    float fig = fbm(vec2(uv.x * 6. + id * 9., uv.y * 40.), vec2(12, 320), 4);
    float rings = sin((across * .15 + id) * 140. + grain * 10. + uv.x * 3.) * .5 + .5;
    vec3 c1 = mix(hex(146, 100, 60), hex(184, 138, 90), id);
    s.c = mix(c1 * .72, c1, rings * .5 + grain * .3 + fig * .2) * (.92 + .1 * fbm(uv + id, vec2(4), 3));
    float gap = groove(min(across, 1. - across) * .15, .0012) * groove(min(along, 1. - along) * 1.5, .0015);
    float bevel = sstep(.0, .004, min(across, 1. - across) * .15);
    s.c *= mix(.3, 1., gap); s.h = gap * (.003 * bevel + rings * .0002 + fig * .0002); s.r = .32 + .14 * grain + (1. - gap) * .4; s.ao = mix(.35, 1., gap);` },
  deck: { tile: [3, 3], size: [2048, 2048], big: true, glsl: `
    // outdoor deck: 14 cm boards with 6 mm gaps, weathered grey-brown, screw heads
    float k = fract(uv.y * 21.); float id = hash12(vec2(floor(uv.y * 21.), 2.));
    float grain = fbm(vec2(uv.x * 2., uv.y * 21.), vec2(12, 420), 6);
    vec3 w = mix(hex(146, 120, 92), hex(170, 150, 126), id) * (.8 + .3 * grain);
    w = mix(w, hex(150, 146, 140), fbm(uv + 3., vec2(3), 4) * .4);
    float gap = groove(min(k, 1. - k) * .143, .004);
    vec2 sc = vec2(fract(uv.x * 5.), k); float screw = sstep(.006, .004, length((sc - vec2(.5, .5)) * vec2(.6, .143)));
    s.c = mix(hex(30, 26, 22), w, gap) * (1. - screw * .5); s.h = gap * (.01 + grain * .001) - screw * .001; s.r = .8; s.m = screw * .6; s.ao = mix(.2, 1., gap);` },
  carpet: { tile: [2, 2], size: [1024, 1024], glsl: `
    // deep red wool carpet with a gold border band
    float f = fbm(uv, uTile * 60., 3), tuft = ridge(uv, uTile * 120., 2);
    vec3 red = hex(108, 36, 40) * (.8 + .3 * f + .1 * tuft);
    float e = min(min(uv.x, 1. - uv.x), min(uv.y, 1. - uv.y)) * uTile.x;
    float band = sstep(.08, .1, e) * sstep(.16, .14, e);
    s.c = mix(red, hex(196, 156, 82) * (.85 + .2 * f), band);
    s.h = tuft * .0015; s.r = .98; s.ao = .8 + .2 * tuft;` },
  carpet2: { tile: [2, 2], size: [1024, 1024], glsl: `
    // office carpet tiles 50 cm, laid quarter-turned
    vec2 q = uv * 4.; vec2 t = floor(q), f = fract(q); float turn = mod(t.x + t.y, 2.);
    vec2 g = turn > .5 ? f.yx : f;
    float lines = sin(g.x * 220.) * .5 + .5, f2 = fbm(uv, uTile * 50., 3);
    s.c = hex(70, 82, 98) * (.82 + .14 * lines + .12 * f2);
    float seam = groove(min(min(f.x, 1. - f.x), min(f.y, 1. - f.y)) * .5, .002);
    s.c *= mix(.7, 1., seam); s.h = lines * .0006 + f2 * .0006; s.r = .97; s.ao = mix(.75, 1., seam);` },
  tiles: { tile: [1.6, 1.6], size: [1024, 1024], glsl: `
    // 40 cm ceramic floor tiles, two tones, grout
    vec2 q = uv * 4.; vec2 t = floor(q), f = fract(q); float alt = mod(t.x + t.y, 2.);
    float e = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y)) * .4; float j = groove(e - .002, .002);
    float n = fbm(uv, vec2(12), 5), sp = sstep(.08, .04, vor(uv, uTile * 40.).x) * .3;
    vec3 tile = mix(hex(214, 208, 196), hex(186, 178, 164), alt) * (.94 + .08 * n) * (1. - sp * .2);
    s.c = mix(hex(120, 112, 100), tile, j); s.h = j * .004 + n * .0003; s.r = mix(.8, .22, j); s.ao = mix(.6, 1., j);` },
  tiles2: { tile: [1.6, 1.6], size: [1024, 1024], glsl: `
    // 20 cm white glazed tiles
    vec2 q = uv * 8.; vec2 f = fract(q); float id = hash12(floor(q));
    float e = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y)) * .2; float j = groove(e - .0015, .0015);
    float bevel = sstep(.0, .006, e);
    s.c = mix(hex(150, 158, 166), hex(232, 233, 230) * (.97 + .04 * id), j);
    s.h = j * .003 * bevel; s.r = mix(.7, .12, j); s.ao = mix(.65, 1., j);` },
  marble: { tile: [3, 3], size: [2048, 2048], big: true, glsl: `
    // polished marble slabs 75 cm with veins
    vec2 q = uv * 4.; vec2 f = fract(q), t = floor(q); float id = hash12(t);
    vec2 w = uv + vec2(fbm(uv, vec2(3), 5), fbm(uv + 7., vec2(3), 5)) * .25;
    float vein = sstep(.06, .0, abs(ridge(w + id, vec2(2), 5) - .86)) ;
    float vein2 = sstep(.02, .0, abs(ridge(w * 1. + 3.3, vec2(5), 4) - .9)) * .5;
    vec3 base = mix(hex(232, 228, 220), hex(214, 208, 198), fbm(uv + id, vec2(6), 5));
    s.c = base * (1. - vein * .35 - vein2 * .2) ; s.c = mix(s.c, hex(170, 162, 150), vein * .4);
    float e = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y)) * .75; float j = groove(e - .0008, .001);
    s.c *= mix(.7, 1., j); s.h = j * .002; s.r = mix(.5, .08, j); s.ao = mix(.7, 1., j);` },
  stone: { tile: [3, 3], size: [2048, 2048], big: true, glsl: `
    // irregular stone pavers
    vec3 v = vor(uv, vec2(6)); float e = v.y - v.x; float j = groove(e * .5 - .01, .012);
    float n = fbm(uv, vec2(10), 7), id = v.z;
    vec3 st = mix(hex(146, 140, 130), hex(176, 168, 152), id) * (.85 + .2 * n);
    s.c = mix(hex(96, 90, 80) * (.8 + .3 * fbm(uv + 3., vec2(30), 4)), st, j);
    s.h = j * (.015 + n * .004 - v.x * .01); s.r = mix(.95, .75, j) - n * .05; s.ao = mix(.5, 1., j);` },
  /* ---------- ceilings, roofs ---------- */
  ceiling: { tile: [1.2, 1.2], size: [1024, 1024], glsl: `
    // 60 cm suspended ceiling tiles with fissures, metal grid
    vec2 f = fract(uv * 2.); float e = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y)) * .6;
    float grid = sstep(.012, .014, e); float fis = sstep(.35, .2, ridge(uv, uTile * 30., 3)) * .5;
    float n = fbm(uv, uTile * 40., 4);
    s.c = mix(hex(200, 202, 204), hex(232, 230, 224) * (.95 + .05 * n) * (1. - fis * .15), grid);
    s.h = grid * (.004 - fis * .001); s.r = mix(.5, .95, grid); s.m = (1. - grid) * .6; s.ao = mix(.7, 1., grid) * (1. - fis * .2);` },
  roof: { tile: [2, 2], size: [2048, 2048], big: true, glsl: `
    // asphalt shingles: 33 cm tabs in rows of 14 cm exposure, granules, a little moss
    vec4 b = cells(uv, vec2(6, 14), .5); float tab = b.x, row = b.y, id = b.w;
    float gran = fbm(uv, uTile * 120., 3) , g2 = sstep(.15, .05, vor(uv, uTile * 160.).x);
    vec3 col = mix(hex(60, 58, 56), hex(84, 80, 76), id) * (.8 + .3 * gran + .1 * g2);
    float moss = sstep(.68, .82, fbm(uv + 6., vec2(3), 6)) * sstep(.6, .0, row) ;
    col = mix(col, hex(86, 98, 54), moss * .6);
    float edge = groove(min(tab, 1. - tab) * .33, .003) * groove(row * .14, .003);
    s.c = col * mix(.45, 1., edge); s.h = row * .004 + edge * .002 + gran * .0005; s.r = .93; s.ao = mix(.35, 1., edge * (.6 + .4 * row));` },
  /* ---------- furniture and props (fitted per face: uv 0..1 is one face) ---------- */
  crate: { tile: [1, 1], size: [1024, 1024], glsl: `
    // wooden crate face: frame, planks, a diagonal brace, nails, a stencil
    float k = fract(uv.y * 6.), id = hash12(vec2(floor(uv.y * 6.), 4.));
    float gr = fbm(vec2(uv.x * 2., uv.y * 6.), vec2(4, 72), 6);
    vec3 w = mix(hex(150, 112, 70), hex(176, 136, 88), id) * (.8 + .3 * gr);
    float e = min(min(uv.x, 1. - uv.x), min(uv.y, 1. - uv.y));
    float frame = sstep(.1, .095, e), brace = sstep(.06, .055, abs(uv.x - uv.y) * .707) * (1. - frame);
    float gap = groove(min(k, 1. - k) * .166, .004);
    vec3 dark = hex(120, 86, 50) * (.85 + .25 * gr);
    s.c = mix(w * mix(.4, 1., gap), dark, max(frame, brace));
    s.h = gap * .004 + (frame + brace) * .015;
    vec2 nl = fract(uv * 10.); float nail = frame * sstep(.08, .06, length(nl - .5)) * step(.5, hash12(floor(uv * 10.)));
    s.c = mix(s.c, hex(90, 90, 92), nail); s.m = nail; s.r = .85 - nail * .4;
    float sten = (1. - frame) * (1. - brace) * sstep(.02, .0, abs(length(uv - vec2(.5, .62)) - .1)) * .6; s.c *= 1. - sten;
    s.ao = mix(.5, 1., gap) * (1. - .3 * sstep(.12, .1, e) * (1. - frame));` },
  cabinet: { tile: [1, 1], size: [1024, 1024], glsl: `
    // cabinet front: two doors with panels and handles
    float gr = fbm(vec2(uv.x * 4., uv.y * 1.), vec2(8, 2), 6);
    vec3 w = hex(126, 98, 72) * (.85 + .2 * gr);
    vec2 d = vec2(fract(uv.x * 2.), uv.y); float e = min(min(d.x, 1. - d.x), min(d.y, 1. - d.y));
    float doorEdge = groove(e * .5 - .004, .003), panel = sstep(.08, .09, e);
    float handle = sstep(.012, .008, length((d - vec2(mod(floor(uv.x * 2.), 2.) > .5 ? .1 : .9, .55)) * vec2(1., .3)));
    s.c = w * mix(.4, 1., doorEdge) * mix(1., .92, panel); s.c = mix(s.c, hex(200, 190, 160), handle);
    s.h = doorEdge * .006 - panel * .003 + handle * .01; s.r = mix(.5, .25, handle); s.m = handle; s.ao = mix(.5, 1., doorEdge);` },
  tableTop: { tile: [1, 1], size: [1024, 1024], glsl: `
    float gr = fbm(vec2(uv.x * 2., uv.y * 10.), vec2(4, 60), 6), rings = sin(uv.y * 90. + gr * 12.) * .5 + .5;
    float plank = fract(uv.x * 4.), j = groove(min(plank, 1. - plank) * .25, .002);
    s.c = mix(hex(120, 78, 44), hex(166, 116, 70), rings * .6 + gr * .4) * mix(.5, 1., j);
    s.h = j * .002 + rings * .0003; s.r = .3 + gr * .15; s.ao = mix(.6, 1., j);` },
  fabric: { tile: [1, 1], size: [1024, 1024], glsl: `
    // woven upholstery with a seam and buttons
    float wx = sin(uv.x * 900.), wy = sin(uv.y * 900.); float weave = (wx * step(0., wy) + wy * step(wy, 0.)) * .5 + .5;
    float f = fbm(uv, vec2(8), 5);
    vec3 c = hex(110, 92, 74) * (.82 + .15 * weave + .12 * f);
    float seam = sstep(.006, .0, abs(uv.y - .5)) ; vec2 bt = fract(uv * vec2(4, 2)) - .5; float button = sstep(.04, .03, length(bt));
    s.c = c * (1. - seam * .4) * (1. - button * .3); s.h = weave * .0008 - seam * .003 - button * .004 + f * .002; s.r = .95; s.ao = 1. - seam * .3 - button * .4;` },
  bedTop: { tile: [1, 2], size: [1024, 2048], glsl: `
    // a made bed seen from above: pillow at the head, folded sheet, quilted blanket
    float n = fbm(uv, vec2(6, 12), 5); vec2 q = fract(uv * vec2(6, 12)); float quilt = sstep(.0, .1, min(min(q.x, 1. - q.x), min(q.y, 1. - q.y)));
    vec3 blanket = hex(60, 92, 138) * (.85 + .15 * n) * mix(.85, 1., quilt);
    float pillow = sstep(.06, .04, max(abs(uv.x - .5) - .34, abs(uv.y - .1) - .055) );
    float sheet = sstep(.24, .23, uv.y) * (1. - pillow);
    s.c = blanket; s.c = mix(s.c, hex(236, 232, 222) * (.92 + .08 * n), sheet); s.c = mix(s.c, hex(240, 238, 230), pillow);
    s.h = quilt * .008 * (1. - sheet) + pillow * .03 + n * .003; s.r = .96; s.ao = mix(.75, 1., quilt);` },
  shelf: { tile: [1, 2], size: [1024, 2048], glsl: `
    // bookshelf front: four shelves of books of different sizes and colours
    float row = floor(uv.y * 4.), v = fract(uv.y * 4.);
    float board = sstep(.07, .06, v) + sstep(.97, .98, v);
    float x = uv.x * 1.; float bx = x * 40., bid = floor(bx + hash12(vec2(row, 1.)) * 3.); float bh = .55 + .4 * hash12(vec2(bid, row));
    float r = hash12(vec2(bid, row + 9.));
    vec3 book = r < .2 ? hex(150, 40, 36) : r < .4 ? hex(40, 70, 130) : r < .55 ? hex(50, 110, 70) : r < .7 ? hex(180, 150, 70) : r < .85 ? hex(70, 50, 40) : hex(200, 190, 170);
    float spine = sstep(.0, .08, min(fract(bx), 1. - fract(bx)));
    float has = step(v, .07 + bh * .88) * step(.15, hash12(vec2(bid, row + 3.)) + .2);
    vec3 wood = hex(92, 66, 44) * (.85 + .2 * fbm(uv, vec2(4, 8), 5));
    s.c = mix(wood * .45, book * mix(.6, 1., spine) * (1. - .3 * sstep(.8, 1., fract(bx))), has * (1. - board));
    s.c = mix(s.c, wood, board); s.h = has * (1. - board) * .02 + board * .03; s.r = .7; s.ao = mix(.45, 1., max(board, has * spine));` },
  barrier: { tile: [1, 1], size: [1024, 1024], glsl: `
    // concrete barrier with red and white hazard stripes, chipped
    float n = fbm(uv, vec2(8), 7); float chip = sstep(.66, .72, fbm(uv + 3., vec2(6), 6));
    float stripe = step(.5, fract((uv.x + uv.y) * 4.));
    vec3 paint = mix(hex(220, 214, 204), hex(200, 52, 34), stripe);
    s.c = mix(paint * (.9 + .1 * n), hex(150, 146, 138) * (.85 + .2 * n), chip) * (1. - grime(uv, .12));
    s.h = n * .002 - chip * .0015; s.r = mix(.6, .92, chip); s.ao = 1. - chip * .2;` },
  planterTop: { tile: [1, 1], size: [1024, 1024], glsl: `
    // soil with small plants and flowers
    vec3 v = vor(uv, vec2(9)); float plant = sstep(.42, .2, v.x); float flower = sstep(.12, .06, v.x) * step(.6, v.z);
    float soil = fbm(uv, vec2(12), 6);
    vec3 leaf = mix(hex(60, 98, 40), hex(96, 140, 58), ridge(uv * 1., vec2(30), 3));
    s.c = mix(hex(70, 52, 36) * (.8 + .3 * soil), leaf, plant); s.c = mix(s.c, mix(hex(214, 96, 128), hex(240, 210, 90), v.z), flower);
    s.h = plant * (.03 - v.x * .04) + soil * .004; s.r = mix(.98, .7, plant); s.ao = mix(.6, 1., plant);` },
  water: { tile: [1, 1], size: [1024, 1024], glsl: `
    float w = fbm(uv, vec2(4), 6), r = ridge(uv + w * .2, vec2(6), 4);
    s.c = mix(hex(40, 92, 120), hex(70, 130, 160), w) + r * .08; s.h = w * .006 + r * .002; s.r = .05; s.ao = 1.;` },
  carSide: { tile: [4.5, 1.5], size: [2048, 683], glsl: `
    // car side (painted white, tinted per car): windows, door lines, handles, wheels and arches
    float x = uv.x, y = uv.y;   // y = 0 at the bottom
    float glassArea = step(.6, y) * step(y, .92) * step(.18, x + (.92 - y) * .4) * step(x - (.92 - y) * .35, .86);
    float pillar = sstep(.008, .004, abs(x - .52)) * glassArea;
    float doorLine = sstep(.003, .0, abs(x - .53)) + sstep(.003, .0, abs(x - .26)) * step(y, .62) + sstep(.003, .0, abs(x - .78)) * step(y, .62);
    float sill = sstep(.006, .002, abs(y - .2));
    float handle = sstep(.012, .006, length((vec2(x, y) - vec2(.45, .52)) * vec2(1., 3.))) + sstep(.012, .006, length((vec2(x, y) - vec2(.72, .52)) * vec2(1., 3.)));
    vec2 wc = vec2(fract(x * 1.) , y); float d1 = length((vec2(x, y) - vec2(.18, .2)) * vec2(4.5, 1.5)), d2 = length((vec2(x, y) - vec2(.82, .2)) * vec2(4.5, 1.5));
    float d = min(d1, d2); float tyre = sstep(.34, .33, d), rim = sstep(.2, .19, d), arch = sstep(.39, .37, d);
    vec3 body = vec3(.92); float metal = 0.;
    s.c = body; s.r = .25; s.m = 0.;
    s.c = mix(s.c, vec3(.05, .06, .07), arch);
    s.c = mix(s.c, hex(18, 24, 30), glassArea * (1. - pillar)); s.c = mix(s.c, vec3(.08), pillar);
    s.c *= 1. - doorLine * .6 * (1. - glassArea) - sill * .3; s.c = mix(s.c, vec3(.75), handle);
    s.c = mix(s.c, vec3(.06), tyre); s.c = mix(s.c, vec3(.62), rim * (.7 + .3 * step(.5, fract(atan(y - .2, x - .18) * 1.6))));
    s.r = mix(s.r, .08, glassArea); s.r = mix(s.r, .9, tyre * (1. - rim)); s.m = rim + handle;
    s.h = -doorLine * .002 - sill * .002 + handle * .004 - arch * (1. - tyre) * .01 + tyre * .01; s.ao = 1. - arch * (1. - tyre) * .5;` },
  carTop: { tile: [2, 4.5], size: [912, 2048], glsl: `
    float x = uv.x, y = uv.y;
    float roof = step(.12, x) * step(x, .88) * step(.28, y) * step(y, .72);
    float wind = step(.12, x) * step(x, .88) * (step(.72, y) * step(y, .84) + step(.18, y) * step(y, .28));
    float hoodLine = sstep(.004, .0, abs(y - .9)) + sstep(.004, .0, abs(y - .12));
    s.c = vec3(.92); s.c = mix(s.c, hex(18, 24, 30), wind); s.c *= 1. - hoodLine * .5 - roof * .04;
    s.r = mix(.25, .08, wind); s.h = roof * .01 - hoodLine * .002; s.ao = 1.;` },
  softWall: { tile: [1, 2], size: [1024, 2048], glsl: `
    // breakable drywall over studs: paper face, taped seams, screw dots
    float n = fbm(uv, vec2(6, 12), 6);
    float seam = sstep(.04, .0, abs(uv.x - .5)) * .3; vec2 sc = fract(uv * vec2(2, 8)); float screw = sstep(.02, .01, length(sc - vec2(.5, .5)) );
    s.c = hex(214, 204, 182) * (.94 + .06 * n) * (1. - seam * .15) * (1. - screw * .3);
    s.h = n * .001 + seam * .001 - screw * .0008; s.r = .9; s.ao = 1. - screw * .2;` },
  metal: { tile: [1, 2], size: [1024, 2048], glsl: `
    // reinforcement: steel plate with bolted straps
    float n = fbm(uv, vec2(4, 8), 6), brushed = fbm(vec2(uv.x * 1., uv.y * 60.), vec2(2, 240), 3);
    float strap = 0.; for (int i = 0; i < 3; i++) { float y = (float(i) + .5) / 3.; strap = max(strap, sstep(.06, .055, abs(uv.y - y))); }
    vec2 bt = fract(uv * vec2(6, 3)) - .5; float bolt = strap * sstep(.08, .06, length(bt * vec2(1., 3.)));
    s.c = mix(hex(98, 106, 116), hex(60, 66, 74), strap) * (.85 + .15 * n + .08 * brushed) * (1. - grime(uv, .1));
    s.h = strap * .006 + bolt * .006 + brushed * .0003; s.r = mix(.45, .6, strap) - brushed * .1; s.m = .85; s.ao = 1. - .2 * sstep(.075, .06, abs(fract(uv.y * 3.) - .5) - .41);` },
  boards: { tile: [1, 2], size: [1024, 2048], glsl: `
    // a boarded-up doorway: vertical planks, two cross rails and a diagonal, nails
    float k = fract(uv.x * 4.), id = hash12(vec2(floor(uv.x * 4.), 6.));
    float gr = fbm(vec2(uv.x * 4., uv.y * 1.), vec2(16, 6), 6);
    vec3 w = mix(hex(140, 104, 64), hex(170, 132, 84), id) * (.82 + .26 * gr);
    float gap = groove(min(k, 1. - k) * .25, .005);
    float rail = sstep(.04, .035, abs(uv.y - .12)) + sstep(.04, .035, abs(uv.y - .86));
    float diag = sstep(.04, .035, abs((uv.y - .5) * 2. - (uv.x - .5) * 3.6) * .25);
    float cross = max(rail, diag);
    s.c = mix(w * mix(.3, 1., gap), hex(110, 78, 44) * (.85 + .25 * gr), cross);
    s.h = gap * .006 + cross * .02; s.r = .85; s.ao = mix(.3, 1., gap) * mix(1., .9, cross);` },
  railTex: { tile: [1, 1], size: [512, 512], glsl: `
    float gr = fbm(vec2(uv.x * 2., uv.y * 8.), vec2(4, 32), 5);
    s.c = hex(96, 74, 52) * (.85 + .25 * gr); s.h = gr * .002; s.r = .55;` },
  bark: { tile: [1, 2], size: [512, 1024], glsl: `
    float r = ridge(vec2(uv.x * 1., uv.y * .3), vec2(10, 3), 5); float n = fbm(uv, vec2(4, 8), 5);
    s.c = mix(hex(60, 44, 32), hex(104, 82, 62), r) * (.85 + .2 * n); s.h = r * .02; s.r = .95; s.ao = .6 + .4 * r;` },
  leaves: { tile: [1, 1], size: [1024, 1024], glsl: `
    vec3 v = vor(uv, vec2(14)); float leaf = sstep(.5, .2, v.x); float vein = sstep(.02, .0, abs(v.x - .25)) * .3;
    s.c = mix(hex(40, 72, 30), mix(hex(64, 110, 44), hex(110, 150, 60), v.z), leaf) * (1. - vein);
    s.h = leaf * (.01 - v.x * .02); s.r = .7; s.ao = mix(.45, 1., leaf);` },

  /* ---------- Battle maps (js/battle/maps.js: same layouts as their own textures) ---------- */
  bContainer: { tile: [1, 1], size: [1024, 1024], glsl: `
    // container steel, neutral (each box tints it): 8 ribs a metre, rust runs from the top
    float k = fract(uv.x * 8.), rib = sin(k * PI * 2.); float n = fbm(uv, vec2(4), 6);
    float run = sstep(.45, .85, fbm(vec2(uv.x * 8., uv.y * .6), vec2(64, 2), 5)) * sstep(.2, .9, uv.y);
    float chip = sstep(.7, .76, fbm(uv + 3., vec2(10), 6));
    s.c = vec3(.78 + .12 * rib * .5 + .06 * n); s.c = mix(s.c, hex(150, 92, 54), run * .45 + chip * .7);
    s.h = rib * .012; s.r = mix(.5, .85, max(run, chip)); s.m = mix(.55, .2, chip); s.ao = .82 + .18 * rib;` },
  bMetalpanel: { tile: [1.2, 3.6], size: [768, 2048], glsl: `
    // perimeter wall: dark steel panels 1.2 m wide with louvred vents, ribs, bolted seams
    float n = fbm(uv, vec2(3, 9), 6), br = fbm(vec2(uv.x * 40., uv.y), vec2(40, 9), 3);
    float seam = groove(min(uv.x, 1. - uv.x) * 1.2, .004) * groove(abs(p.y - 1.8), .004);
    float rib = sstep(.02, .0, abs(fract(uv.x * 3.) - .5) - .47);
    vec2 vq = vec2((uv.x - .5) * 1.2, p.y - 2.45); float vent = step(abs(vq.x), .3) * step(abs(vq.y), .45);
    float louvre = vent * (sin(p.y * 70.) * .5 + .5);
    float kick = sstep(.42, .4, p.y);
    vec3 col = hex(92, 98, 106) * (.85 + .15 * n + .05 * br) * mix(1., .78, kick) * (1. - grime(uv, .2) * sstep(1.4, 0., p.y));
    s.c = mix(col, hex(28, 30, 34), vent * (1. - louvre * .6)) * mix(.75, 1., seam);
    s.h = seam * .004 + rib * .006 + kick * .003 + louvre * .012 - vent * .01; s.r = .55 - br * .1 + kick * .15; s.m = .7; s.ao = mix(.5, 1., seam) * (1. - vent * (1. - louvre) * .6);` },
  bYardfloor: { tile: [2, 2], size: [2048, 2048], big: true, glsl: `
    // yard: 1 m concrete slabs with saw cuts, oil stains, tyre marks
    vec2 f = fract(uv * 2.); float e = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y)) * 1.; float j = groove(e - .003, .003);
    float n = fbm(uv, vec2(6), 8), id = hash12(floor(uv * 2.));
    float oil = sstep(.66, .86, fbm(uv + id, vec2(3), 5)) * .16; float pores = sstep(.1, .03, vor(uv, uTile * 80.).x);
    s.c = hex(170, 166, 158) * (.82 + .2 * n + .06 * id) * (1. - oil) * (1. - pores * .2); s.c *= mix(.5, 1., j);
    s.h = j * .003 + n * .001 - pores * .001; s.r = mix(.9, .55, oil); s.ao = mix(.5, 1., j);` },
  bGrating: { tile: [.6, .6], size: [512, 512], glsl: `
    // steel grating: bearing bars every 3.75 cm, cross bars every 7.5 cm, dark below
    float bx = fract(uv.x * 16.), by = fract(uv.y * 8.);
    float bar = sstep(.18, .12, abs(bx - .5) - .32 + .32) ; bar = sstep(.85, .9, bx) ; float cross = sstep(.9, .94, by);
    float metal = max(sstep(.82, .88, bx), cross);
    s.c = mix(hex(24, 26, 28), hex(150, 156, 162) * (.85 + .15 * fbm(uv, vec2(8), 4)), metal);
    s.h = metal * .02; s.r = mix(.9, .45, metal); s.m = metal * .9; s.ao = mix(.2, 1., metal);` },
  bSnow: { tile: [6, 6], size: [2048, 2048], big: true, glsl: `
    // trodden snow: footprints in trails, drift ridges, blue shade in hollows, sparkle
    float n = fbm(uv, vec2(3), 7), drift = ridge(uv + .3, vec2(2), 4), fine = fbm(uv + 1.3, vec2(24), 4);
    // footprints: pairs along wandering trails
    float trail = sstep(.05, .0, abs(fbm(vec2(uv.x * 2., 0.) + vec2(0., uv.y * 0.), vec2(4, 1), 3) - uv.y * 0. - .5 + (uv.y - .5) * .0));
    vec2 q = uv * vec2(18, 18); vec2 c = fract(q) - .5, id2 = floor(q); float h1 = hash12(mod(id2, 18.));
    float foot = step(.55, h1) * sstep(.18, .1, length(c * vec2(1.9, 1.) + vec2(h1 - .5, 0.) * .3));
    float hollow = sstep(.4, .7, fbm(uv + 6., vec2(5), 5));
    s.c = mix(hex(200, 214, 232), hex(248, 250, 253), n * .5 + drift * .3 + fine * .2) * mix(1., .9, hollow);
    s.c = mix(s.c, hex(176, 192, 214), foot * .55);
    s.c += sstep(.985, 1., hash12(floor(uv * 2048.))) * .25;
    s.h = n * .04 + drift * .03 + fine * .004 - foot * .025; s.r = .6 - drift * .1; s.ao = 1. - foot * .35 - hollow * .1;` },
  bLogs: { tile: [2.4, 2.4], size: [2048, 2048], big: true, glsl: `
    // log wall: 8 logs per texture height, round in section, chinking between, snow on top
    float row = floor(uv.y * 8.), v = fract(uv.y * 8.); float id = hash12(vec2(row, 3.));
    float round_ = sqrt(max(0., 1. - pow(v * 2. - 1., 2.)));
    float gr = fbm(vec2(uv.x * 2. + id * 5., uv.y * 8.), vec2(5, 64), 6);
    vec3 wood = mix(hex(110, 70, 38), hex(160, 108, 62), id) * (.7 + .4 * gr) * (.55 + .45 * round_);
    float chink = sstep(.1, .04, min(v, 1. - v)); float snow = sstep(.84, .9, v) * sstep(.55, .75, fbm(uv + row, vec2(6, 8), 4));
    s.c = mix(wood, hex(190, 180, 160), chink); s.c = mix(s.c, hex(236, 242, 248), snow);
    s.h = round_ * .06 + gr * .002 + snow * .01; s.r = mix(.85, .6, snow); s.ao = mix(.35, 1., round_);` },
  bPlank: { tile: [2, 1.6], size: [2048, 1638], glsl: `
    // weathered vertical planks 25 cm, nails top and bottom, snow along the top edge
    float k = fract(uv.x * 8.), id = hash12(vec2(floor(uv.x * 8.), 7.));
    float gr = fbm(vec2(uv.x * 8. + id * 3., uv.y), vec2(64, 4), 6);
    vec3 w = mix(hex(98, 70, 46), hex(128, 94, 62), id) * (.75 + .35 * gr);
    float gap = groove(min(k, 1. - k) * .25, .004);
    vec2 nl = vec2(k, uv.y); float nail = sstep(.006, .004, length((nl - vec2(.5, .12)) * vec2(.25, 1.6))) + sstep(.006, .004, length((nl - vec2(.5, .88)) * vec2(.25, 1.6)));
    float snow = sstep(.95, .97, uv.y) * sstep(.4, .6, fbm(uv, vec2(16, 2), 4) + .3);
    s.c = mix(hex(30, 22, 14), w, gap); s.c = mix(s.c, vec3(.4), nail); s.c = mix(s.c, hex(238, 243, 248), snow);
    s.h = gap * (.008 + gr * .002) + snow * .006; s.r = .88; s.m = nail * .7; s.ao = mix(.3, 1., gap);` },
  bCasinocarpet: { tile: [2.5, 2.5], size: [2048, 2048], big: true, glsl: `
    // casino carpet: deep red with a gold diamond lattice and navy medallions, worn paths
    vec2 q = uv * 4.; vec2 c = fract(q) - .5; float d = abs(c.x) + abs(c.y);
    float lattice = sstep(.025, .0, abs(d - .38)); float med = sstep(.1, .08, length(c));
    vec2 c2 = fract(q + .5) - .5; float ring = sstep(.02, .0, abs(length(c2) - .16));
    float tuft = ridge(uv, uTile * 100., 2), f = fbm(uv, uTile * 40., 3), wear = sstep(.6, .9, fbm(uv + 2., vec2(2), 5)) * .25;
    vec3 col = hex(112, 16, 30) * (.85 + .2 * f + .1 * tuft);
    col = mix(col, hex(222, 172, 70), lattice * .9 + ring * .5); col = mix(col, hex(30, 42, 92), med);
    s.c = col * (1. - wear * .4) + wear * .05; s.h = tuft * .002; s.r = .97; s.ao = .8 + .2 * tuft;` },
  bWoodpanel: { tile: [2, 5], size: [820, 2048], glsl: `
    // casino walls: dark mahogany panelling in two raised fields, brass trim at the dado
    float gr = fbm(vec2(uv.x * 3., uv.y * 1.), vec2(6, 5), 6), fig = fbm(vec2(uv.x * 10., uv.y * 2.), vec2(20, 10), 4);
    vec3 wood = mix(hex(58, 28, 16), hex(96, 50, 28), gr * .6 + fig * .4);
    float y = uv.y; float dado = sstep(.012, .008, abs(y - .5));
    float f1 = sstep(.0, .01, min(min(uv.x - .06, .94 - uv.x), min(y - .55, .96 - y)));
    float f2 = sstep(.0, .01, min(min(uv.x - .06, .94 - uv.x), min(y - .06, .45 - y)));
    float field = max(f1, f2), edge = max(sstep(.006, .0, abs(min(min(uv.x - .06, .94 - uv.x), min(y - .55, .96 - y)))), sstep(.006, .0, abs(min(min(uv.x - .06, .94 - uv.x), min(y - .06, .45 - y)))));
    s.c = wood * mix(.85, 1., field); s.c = mix(s.c, hex(200, 150, 60), max(dado, edge * .8));
    s.h = field * .006 + dado * .01 + edge * .004; s.r = mix(.35, .25, field) ; s.m = max(dado, edge * .8) * .9; s.ao = mix(.6, 1., field);` },
  bFelt: { tile: [1, 1], size: [1024, 1024], glsl: `
    float f = fbm(uv, vec2(80), 3), nap = fbm(uv + 1., vec2(6), 5);
    float arc = sstep(.006, .0, abs(length((uv - vec2(.5, .1)) * vec2(1., 1.)) - .6)) * step(.18, uv.x) * step(uv.x, .82);
    s.c = hex(12, 104, 58) * (.8 + .15 * f + .1 * nap); s.c = mix(s.c, hex(236, 214, 150), arc * .8);
    s.h = f * .0006; s.r = .95; s.ao = 1.;` },
  bLino: { tile: [2, 2], size: [1024, 1024], glsl: `
    // school linoleum: 50 cm tiles in two colours, terrazzo flecks, polished
    vec2 q = uv * 4.; vec2 f = fract(q); float alt = mod(floor(q.x) + floor(q.y), 2.);
    vec3 v = vor(uv, uTile * 70.); float fleck = sstep(.25, .1, v.x);
    vec3 base = mix(hex(142, 154, 166), hex(216, 210, 194), alt);
    s.c = mix(base, mix(hex(90, 90, 90), hex(244, 240, 230), v.z), fleck * .5);
    float j = groove(min(min(f.x, 1. - f.x), min(f.y, 1. - f.y)) * .5, .0015);
    s.c *= mix(.7, 1., j); s.h = j * .0015; s.r = mix(.6, .28, j); s.ao = mix(.7, 1., j);` },
  bSchoolwall: { tile: [2, 4], size: [1024, 2048], glsl: `
    // painted block wall: cream above, blue below, a yellow stripe (as the school's own)
    vec4 b = cells(uv, vec2(5, 20), .5); float e = min(min(b.x, 1. - b.x) * .4, min(b.y, 1. - b.y) * .2); float j = groove(e - .002, .004);
    float y = 1. - uv.y; float low = step(.62, y), stripe = step(.6, y) * step(y, .63);
    vec3 paint = mix(hex(236, 228, 207), hex(63, 106, 154), low); paint = mix(paint, hex(232, 181, 48), stripe);
    float n = fbm(uv, vec2(8, 16), 6);
    s.c = paint * (.93 + .08 * n) * mix(.8, 1., j); s.h = j * .004 + n * .0008; s.r = .55; s.ao = mix(.65, 1., j);` },
  bLockers: { tile: [1.2, 1.2], size: [1024, 1024], glsl: `
    // lockers 30 cm wide: blue doors, vents, handles, a little rust at the bottom
    float k = fract(uv.x * 4.); float e = min(k, 1. - k) * .3; float gap = groove(e, .003);
    vec2 vt = vec2(k, uv.y); float vent = step(.25, k) * step(k, .75) * step(.75, uv.y) * step(uv.y, .92) * step(.5, fract(uv.y * 60.));
    float handle = sstep(.02, .01, abs(k - .8) * .3) * step(.4, uv.y) * step(uv.y, .5);
    float n = fbm(uv, vec2(6), 5), rust = sstep(.12, .0, uv.y) * sstep(.5, .7, fbm(uv + 3., vec2(12), 4));
    s.c = hex(46, 111, 176) * (.85 + .15 * n) * mix(.4, 1., gap) * (1. - vent * .6); s.c = mix(s.c, hex(200, 204, 210), handle); s.c = mix(s.c, hex(120, 70, 40), rust * .6);
    s.h = gap * .004 - vent * .002 + handle * .006; s.r = mix(.45, .8, rust); s.m = .6; s.ao = mix(.4, 1., gap) * (1. - vent * .4);` },
  bBasement: { tile: [4, 4], size: [2048, 2048], big: true, glsl: `
    // basement floor: dark damp concrete, stains, cracks, a joint grid every 2 m
    float n = fbm(uv, vec2(8), 8), damp = sstep(.55, .8, fbm(uv + 4., vec2(3), 5));
    float crack = sstep(.025, .0, abs(ridge(uv + 1., vec2(3), 5) - .85)) * sstep(.4, .6, fbm(uv + 7., vec2(3), 3));
    vec2 f = fract(uv * 2.); float j = groove(min(min(f.x, 1. - f.x), min(f.y, 1. - f.y)) * 2., .004);
    s.c = hex(80, 84, 78) * (.75 + .3 * n) * (1. - damp * .3) * (1. - crack * .5) * mix(.6, 1., j);
    s.h = n * .002 - crack * .004 + j * .002; s.r = mix(.85, .35, damp); s.ao = mix(.6, 1., j) * (1. - crack * .4);` },
  bBlockwall: { tile: [2, 3.4], size: [1204, 2048], glsl: `
    // basement block wall: grey above, green-painted below a yellow line, damp drips
    vec4 b = cells(uv, vec2(5, 17), .5); float e = min(min(b.x, 1. - b.x) * .4, min(b.y, 1. - b.y) * .2); float j = groove(e - .003, .004);
    float y = 1. - uv.y; float low = step(.55, y), stripe = step(.53, y) * step(y, .55);
    float n = fbm(uv, vec2(8, 14), 6), drip = sstep(.5, .9, fbm(vec2(uv.x * 6., uv.y * .5), vec2(12, 2), 5)) * sstep(.0, .6, uv.y);
    vec3 paint = mix(hex(150, 150, 140) * (.85 + .2 * b.w), hex(46, 84, 60) * (.85 + .2 * b.w), low); paint = mix(paint, hex(232, 192, 64), stripe);
    s.c = paint * (.85 + .2 * n) * (1. - drip * .3) * mix(.6, 1., j); s.h = j * .006 + n * .001; s.r = mix(.8, .5, drip); s.ao = mix(.55, 1., j);` },
  bRustmetal: { tile: [1, 1], size: [1024, 1024], glsl: `
    // boilers and barrels: grey painted steel going to rust, seams every 25 cm
    float n = fbm(uv, vec2(6), 7), rust = sstep(.5, .75, fbm(uv + 2., vec2(5), 6));
    float seam = sstep(.006, .0, abs(fract(uv.y * 4.) - .5) - .494);
    s.c = mix(hex(90, 94, 96) * (.85 + .2 * n), mix(hex(122, 58, 26), hex(154, 90, 42), fbm(uv + 5., vec2(30), 4)), rust) * (1. - seam * .4);
    s.h = seam * -.002 + rust * .0008 + n * .0005; s.r = mix(.55, .9, rust); s.m = mix(.7, .25, rust); s.ao = 1. - seam * .3;` },
};
