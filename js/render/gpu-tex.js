import { skinSheets, skin2Uniforms, SKIN2_GLSL } from './skins2.js?v=6419a29-mwcpnaz0';
import { packArt } from './pack-art.js?v=6419a29-mwcpnaz0';
// GPU-baked textures for ultra graphics. Everything is procedural and drawn by a fragment
// shader into a render target once (milliseconds on a graphics card), so 4096 x 4096 maps
// cost nothing at start-up and nothing is downloaded.
//
//   bakeNormal(renderer, heightCanvas, strength, wrap): normal map from a height canvas.
//   bakeDetail(renderer, kind, size): tiling micro-detail, packed RGBA:
//        RG = normal xy, B = albedo multiplier (0.5 = x1), A = roughness multiplier (0.5 = x1).
//   bakeSkin(renderer, index, size): one of SKINS, { albedo, rm } (rm: G roughness, B metalness).
//   triplanar(material, opts): shader patch that maps a skin and/or detail by the surface's
//        own 3D position (no UV stretching on long thin parts), with edge wear from UVs.
import * as THREE from '../../vendor/three/three.module.min.js?v=6419a29-mwcpnaz0';

const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Periodic noise: every function tiles over uv 0..1 when its period is a whole number.
const NOISE = /* glsl */`
varying vec2 vUv;
uniform float texel;
float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float hash1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float pnoise(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 a = mod(i, per), b = mod(i + vec2(1.0, 0.0), per), c = mod(i + vec2(0.0, 1.0), per), d = mod(i + 1.0, per);
  return mix(mix(dot(hash2(a), f), dot(hash2(b), f - vec2(1.0, 0.0)), u.x),
             mix(dot(hash2(c), f - vec2(0.0, 1.0)), dot(hash2(d), f - 1.0), u.x), u.y);
}
float fbm(vec2 uv, float per, int oct) {
  float a = 0.5, s = 0.0;
  vec2 P = vec2(per);
  for (int i = 0; i < 9; i++) {
    if (i >= oct) break;
    s += a * pnoise(uv * P, P);
    P *= 2.0; a *= 0.5;
  }
  return s;   // about -0.6..0.6
}
float fbm2(vec2 uv, vec2 per, int oct) {
  float a = 0.5, s = 0.0;
  vec2 P = per;
  for (int i = 0; i < 9; i++) {
    if (i >= oct) break;
    s += a * pnoise(uv * P, P);
    P *= 2.0; a *= 0.5;
  }
  return s;
}
// Periodic Voronoi: x = nearest distance, y = second nearest, z = cell hash.
vec3 voronoi(vec2 uv, vec2 per) {
  vec2 p = uv * per, i = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 c = mod(i + g, per);
    vec2 o = 0.5 + 0.45 * hash2(c);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = hash1(c); } else if (d < d2) d2 = d;
  }
  return vec3(d1, d2, id);
}
`;

/* ---------- baking plumbing ---------- */

let quad = null;
const bakeMats = new Map();
function bake(renderer, frag, size, uniforms = {}, { mip = true } = {}) {
  if (!quad) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    quad = { scene: new THREE.Scene(), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mesh: new THREE.Mesh(g) };
    quad.mesh.frustumCulled = false;
    quad.scene.add(quad.mesh);
  }
  const rt = new THREE.WebGLRenderTarget(size, size, {
    depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    generateMipmaps: mip, minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // One material (one compiled shader) per fragment program, reused for every bake: building
  // the big skin shader again for each of 200 thumbnails froze the page.
  let mat = bakeMats.get(frag);
  if (!mat) {
    mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: false, uniforms: {} });
    bakeMats.set(frag, mat);
    if (bakeMats.size > 24) { const [k, old] = bakeMats.entries().next().value; old.dispose(); bakeMats.delete(k); }
  }
  for (const k of Object.keys(mat.uniforms)) if (k !== 'texel' && !(k in uniforms)) mat.uniforms[k].value = null;
  mat.uniforms.texel = mat.uniforms.texel || { value: 0 };
  mat.uniforms.texel.value = 1 / size;
  for (const [k, u] of Object.entries(uniforms)) { if (mat.uniforms[k]) mat.uniforms[k].value = u.value; else mat.uniforms[k] = { value: u.value }; }
  quad.mesh.material = mat;
  const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
  renderer.autoClear = true;
  renderer.setRenderTarget(rt);
  renderer.render(quad.scene, quad.cam);
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAuto;
  rt.texture.userData.rt = rt;    // dispose the target through the texture
  return rt.texture;
}
export function disposeBaked(tex) { if (tex && tex.userData.rt) tex.userData.rt.dispose(); }

// Normal map from a greyscale height canvas (Sobel, like range-tex's CPU version).
export function bakeNormal(renderer, heightCanvas, strength = 2, wrap = true) {
  const src = new THREE.CanvasTexture(heightCanvas);
  src.wrapS = src.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  src.generateMipmaps = false; src.minFilter = THREE.LinearFilter;
  const W = heightCanvas.width, H = heightCanvas.height;
  const size = Math.max(W, H);
  const frag = /* glsl */`
    varying vec2 vUv; uniform sampler2D h; uniform vec2 px; uniform float strength;
    float s(float x, float y) { return texture2D(h, vUv + vec2(x, y) * px).r; }
    void main() {
      float dx = (s(1.,-1.) + 2.*s(1.,0.) + s(1.,1.)) - (s(-1.,-1.) + 2.*s(-1.,0.) + s(-1.,1.));
      float dy = (s(-1.,1.) + 2.*s(0.,1.) + s(1.,1.)) - (s(-1.,-1.) + 2.*s(0.,-1.) + s(1.,-1.));
      vec3 n = normalize(vec3(-dx * strength, -dy * strength, 1.0));
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
    }`;
  // A non-square canvas is baked at its longer side; the shader reads the source by uv.
  const t = bake(renderer, frag, size, { h: { value: src }, px: { value: new THREE.Vector2(1 / W, 1 / H) }, strength: { value: strength } });
  src.dispose();
  if (!wrap) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/* ---------- micro detail ---------- */

const DETAIL = {
  // Concrete: pores, aggregate, fine cracks.
  concrete: `
    float H(vec2 uv) {
      float n = fbm(uv, 32.0, 7) * 0.6;
      vec3 v = voronoi(uv, vec2(40.0));
      float pores = sstep(0.12, 0.0, v.x) * step(0.82, v.z);
      float crack = sstep(0.035, 0.0, v.y - v.x) * step(0.7, hash1(vec2(v.z * 91.0, 3.0))) * 0.6;
      return 0.5 + n - pores * 0.6 - crack;
    }
    vec2 AR(vec2 uv) { float n = fbm(uv + 0.37, 16.0, 6); return vec2(1.0 + n * 0.25, 1.0 + n * 0.3); }`,
  // Painted steel: orange-peel paint, light scratches, a few chips.
  paint: `
    float H(vec2 uv) {
      float peel = fbm(uv, 96.0, 3) * 0.35;
      // Scratches run along the two tile axes so the texture still tiles seamlessly.
      float a = pnoise(vec2(uv.x * 7.0, uv.y * 260.0), vec2(7.0, 260.0));
      float b = pnoise(vec2(uv.x * 260.0, uv.y * 7.0), vec2(260.0, 7.0));
      float scr = max(sstep(0.02, 0.0, abs(a)) * step(0.25, fbm(uv, 8.0, 3) + 0.4),
                      sstep(0.02, 0.0, abs(b)) * step(0.25, fbm(uv + 3.0, 8.0, 3) + 0.4));
      return 0.5 + peel - scr * 0.35;
    }
    vec2 AR(vec2 uv) { float g = fbm(uv * 1.0 + 3.1, 6.0, 5); return vec2(1.0 + g * 0.18, 1.0 + g * 0.25); }`,
  // Brushed / machined metal: fine directional lines.
  brushed: `
    float H(vec2 uv) { return 0.5 + fbm2(uv, vec2(2.0, 900.0), 3) * 0.6 + fbm(uv, 64.0, 3) * 0.1; }
    vec2 AR(vec2 uv) { float l = fbm2(uv, vec2(4.0, 600.0), 2); return vec2(1.0 + l * 0.15, 1.0 + l * 0.35); }`,
};

export function bakeDetail(renderer, kind, size = 4096, strength = 3) {
  const frag = NOISE + DETAIL[kind] + /* glsl */`
    uniform float strength;
    void main() {
      vec2 uv = vUv;
      float h = H(uv), hx = H(uv + vec2(texel, 0.0)), hy = H(uv + vec2(0.0, texel));
      vec2 d = vec2(h - hx, h - hy) / texel * strength * 0.002;   // slope per uv, size independent
      vec2 ar = AR(uv);
      gl_FragColor = vec4(clamp(d * 0.5 + 0.5, 0.0, 1.0), clamp(ar * 0.5, 0.0, 1.0));
    }`;
  return bake(renderer, frag, size, { strength: { value: strength } });
}

/* ---------- weapon skins ---------- */

// One shader draws every skin (core/skins.js) from a pattern number, four colours, a few
// numbers and two finishes. Outputs: colour, an accent mask m (which finish applies), and
// a glow mask g (lines that light up, used by Black Ice and some Epics).
const SKIN_GLSL = /* glsl */`
uniform int pattern;
uniform vec3 c0, c1, c2, c3;
uniform vec4 prm;          // scale (whole number), warp, threshold shift, spare
// Black Ice cracks: two broken networks (big, fine) and radiating splinters. 0..1 = in a crack.
float iceCracks(vec2 uv, float S) {
  vec2 wq = uv + vec2(fbm(uv, 8.0 * S, 4), fbm(uv + 5.0, 8.0 * S, 4)) * 0.025;
  vec3 v1 = voronoi(wq, vec2(5.0 * S));
  vec3 v2 = voronoi(wq + 0.31, vec2(13.0 * S));
  float brk1 = sstep(-0.05, 0.12, fbm(uv + 3.7, 6.0 * S, 4));
  float brk2 = sstep(0.05, 0.2, fbm(uv + 8.1, 10.0 * S, 4));
  float big = sstep(0.02, 0.003, v1.y - v1.x) * brk1;
  float fine = sstep(0.009, 0.0015, v2.y - v2.x) * brk2 * sstep(0.35, 0.0, v1.y - v1.x + 0.1 * fbm(uv, 16.0, 3));
  vec2 p = wq * 9.0 * S, ci = floor(p), f = fract(p);
  vec2 o = 0.5 + 0.4 * hash2(mod(ci, vec2(9.0 * S)));
  vec2 d = f - o;
  float a = atan(d.y, d.x);
  float rays = pow(abs(cos(a * 3.0 + hash1(ci) * 6.0)), 40.0);
  float star = rays * sstep(0.5, 0.0, length(d)) * step(0.6, hash1(mod(ci, vec2(9.0 * S)) + 4.0));
  return max(big, max(fine * 0.8, star * 0.9));
}
// Black Ice emblem: a six-armed snowflake, different per skin (seed). 0..1 = on a line.
float iceFlake(vec2 q, float R, float seed) {
  float r = length(q);
  if (r > R * 1.15) return 0.0;
  float a = mod(atan(q.y, q.x) + 6.2831853, 1.0471976);
  a = abs(a - 0.5235988);                                    // fold into one twelfth
  vec2 p = vec2(cos(a), sin(a)) * r;                         // the arm runs along +x
  float w = R * 0.03;
  float d = abs(p.y) + max(p.x - R, 0.0);                    // the arm
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float bx = R * (0.22 + 0.19 * fi + 0.05 * hash1(vec2(seed, fi)));
    float bl = R * (0.12 + 0.3 * hash1(vec2(seed + 3.0, fi))) * (1.0 - 0.2 * fi);
    vec2 o = p - vec2(bx, 0.0), dir = vec2(0.5, 0.8660254);  // a branch at 60 degrees
    d = min(d, length(o - dir * clamp(dot(o, dir), 0.0, bl)));
  }
  d = min(d, abs(r - R * (0.1 + 0.06 * hash1(vec2(seed, 9.0)))));             // the centre ring
  float tip = length(p - vec2(R, 0.0)) - R * 0.045;                         // a bead on each tip
  return max(sstep(w, w * 0.35, d), sstep(0.004, 0.0, tip));
}
// Black Ice: a deep glossy colour with cloudy frozen depths, shattered cracks with lit and
// shadowed edges, frost ferns feathering out from the big cracks, trapped air bubbles, sparkles
// and an etched snowflake emblem. g (glow) lights the cracks, the ferns and the emblem.
void iceSkin(vec2 uv, float S, out vec3 col, out float m, out float g) {
  float seed = prm.w;
  float mott = fbm(uv, 4.0, 6);
  col = mix(c0, c3, sstep(-0.15, 0.35, mott));                           // lighter patches
  // frozen depth: cloudy layers deep in the ice, lit from inside
  float deep = fbm(uv + vec2(fbm(uv + 2.0, 3.0, 4), fbm(uv + 7.0, 3.0, 4)) * 0.12, 5.0, 6);
  col = mix(col, c3 * 1.7 + c1 * 0.05, sstep(0.05, 0.45, deep) * 0.38);
  col = mix(col, c3 * 1.4, sstep(0.25, 0.45, fbm(uv + 9.0, 7.0, 5)) * 0.4);
  // cracks cut into the finish: a dark core, a lit upper edge and a shadowed lower edge
  float crack = iceCracks(uv, S);
  float e = 0.0022;
  float bev = iceCracks(uv + vec2(-e, e), S) - iceCracks(uv + vec2(e, -e), S);
  // frost ferns: fine parallel feathers growing from the big cracks, a direction per shard
  vec2 wq = uv + vec2(fbm(uv, 8.0 * S, 4), fbm(uv + 5.0, 8.0 * S, 4)) * 0.025;
  vec3 v1 = voronoi(wq, vec2(5.0 * S));
  float near = sstep(0.22, 0.0, v1.y - v1.x + 0.12 * fbm(uv + 1.3, 12.0 * S, 4));
  float k = floor(v1.z * 6.0);
  vec2 kv = k < 1.0 ? vec2(1, 2) : k < 2.0 ? vec2(2, -1) : k < 3.0 ? vec2(1, -2) : k < 4.0 ? vec2(2, 1) : k < 5.0 ? vec2(1, 3) : vec2(3, -1);
  float stripe = abs(sin(dot(uv, kv) * S * 6.2831853 * 18.0 + fbm(uv, 16.0 * S, 3) * 3.0));
  float fern = pow(stripe, 6.0) * near * sstep(-0.1, 0.25, fbm(uv + 4.4, 9.0 * S, 4));
  // trapped air bubbles: small bright rings with a dark heart
  vec3 vb = voronoi(uv, vec2(36.0 * S));
  float keep = step(0.86, vb.z), rr = vb.x;
  float bubble = keep * sstep(0.16, 0.12, rr) * sstep(0.06, 0.1, rr);
  float bubbleIn = keep * sstep(0.08, 0.04, rr);
  // sparkles
  vec2 sp = uv * 160.0, sc = floor(sp);
  float spark = sstep(0.12, 0.0, length(fract(sp) - 0.5 - 0.3 * hash2(mod(sc, vec2(160.0))))) * step(0.93, hash1(mod(sc, vec2(160.0)) + 2.0));
  // the emblem: one snowflake per tile, placed and drawn from the skin's seed
  vec2 cen = vec2(0.35 + 0.3 * hash1(vec2(seed, 1.0)), 0.35 + 0.3 * hash1(vec2(seed, 2.0)));
  float flake = seed > 0.0 ? iceFlake(fract(uv * S) - cen, 0.3, seed) : 0.0;
  col = mix(col, mix(c1, c2, 0.3), fern * 0.6);
  col = mix(col, c1, crack * 0.9);
  col = mix(col, c0 * 0.12, pow(crack, 2.5) * 0.9);
  col += c2 * max(bev, 0.0) * 0.9;
  col *= 1.0 - max(-bev, 0.0) * 0.7;
  col = mix(col, c3 * 0.5, bubbleIn * 0.6);
  col = mix(col, c2, bubble * 0.7);
  col = mix(col, mix(c2, c1, 0.4), flake * 0.9);
  col = mix(col, c2, spark);
  m = max(crack, max(flake, fern * 0.5)); g = max(max(crack * 0.35, spark), max(flake * 0.85, fern * 0.3 + bubble * 0.2));
}
void skinAt(vec2 uv, out vec3 col, out float m, out float g) {
  float S = max(1.0, floor(prm.x + 0.5)), W = prm.y, T = prm.z;
  float grain = fbm(uv, 128.0, 3) * 0.06;
  m = 0.0; g = 0.0;
  if (pattern == 0) {                // contour lines
    float h = fbm(uv, 3.0 * S, 6) * (0.8 + 0.4 * W);
    float t = fract(h * 14.0);
    float line = sstep(0.07, 0.02, 0.5 - abs(t - 0.5));
    float major = sstep(0.035, 0.01, 0.5 - abs(fract(h * 14.0 / 5.0) - 0.5));
    col = mix(mix(c0, c1, line * 0.85), c2, major);
    m = max(line, major); g = m;
  } else if (pattern == 1) {         // pixel (digital) camo
    float px = 48.0 * S;
    vec2 q = (floor(uv * px) + 0.5) / px;
    float n = fbm(q, 4.0 * S, 4) + 0.35 * fbm(q + 5.0, 8.0 * S, 3) + T;
    col = n > 0.12 ? c2 : (n > -0.08 ? c1 : c0);
    m = n > 0.12 ? 1.0 : 0.0;
  } else if (pattern == 2) {         // woodland
    float a = fbm(uv, 3.0 * S, 6), b = fbm(uv + 7.3, 4.0 * S, 6), c = fbm(uv + 2.1, 6.0 * S, 5);
    col = c0;
    col = mix(col, c1, sstep(-0.02, 0.02, a + T));
    col = mix(col, c2, sstep(0.08, 0.12, b + T));
    col = mix(col, c3, sstep(0.2, 0.24, c + T));
  } else if (pattern == 3) {         // tiger stripes
    float w = fbm(uv, 4.0, 5) * 1.6 * W;
    float st = sin(6.2831853 * (uv.x * 7.0 * S + w));
    float stripe = sstep(0.35, 0.45, st + fbm(uv + 3.0, 8.0, 4) * 0.8 + T);
    col = mix(c0, c1, stripe);
    col = mix(col, c2, sstep(0.5, 0.6, fbm(uv + 9.0, 5.0, 4) + 0.4) * (1.0 - stripe));
    m = stripe;
  } else if (pattern == 4) {         // worn coating over bare metal
    vec3 base = c0 * (1.0 + fbm(uv, 6.0, 5) * 0.25);
    float worn = sstep(0.26, 0.3, fbm(uv + 1.7, 5.0, 7) - T);
    float scr = sstep(0.015, 0.0, abs(pnoise(vec2(uv.x * 260.0, uv.y * 7.0), vec2(260.0, 7.0)))) * step(0.1, fbm(uv, 4.0, 3));
    m = max(worn, scr);
    col = mix(base, c1, m);
  } else if (pattern == 5) {         // hex cells
    vec2 q = vec2(uv.x * 16.0 * S, uv.y * 18.0 * S);
    float row = floor(q.y);
    float best = 9.0, second = 9.0, id = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      float r = row + float(j);
      vec2 c = vec2(floor(q.x) + float(i) + 0.5 + 0.5 * mod(r, 2.0), r + 0.5);
      vec2 d = (q - c) * vec2(1.0, 0.866);
      float dist = max(abs(d.x) * 0.866 + abs(d.y) * 0.5, abs(d.y));
      if (dist < best) { second = best; best = dist; id = hash1(mod(c, vec2(16.0, 18.0) * S)); } else if (dist < second) second = dist;
    }
    float edge = sstep(0.035, 0.0, second - best);
    vec3 cell = id < 0.55 ? c0 : (id < 0.85 ? c1 : c2);
    col = mix(cell, c3, edge * 0.8);
    m = edge; g = edge;
  } else if (pattern == 6) {         // damascus bands
    float w = fbm(uv, 2.0, 5) * 0.9 + fbm(uv + 4.0, 6.0, 4) * 0.25;
    float v = sin(6.2831853 * (uv.y * 22.0 * S + uv.x * 3.0 + w * 6.0 * W));
    float b = sstep(-0.35, 0.35, v + T);
    col = mix(c0, c1, b); m = b;
  } else if (pattern == 7) {         // soft blotches
    float a = fbm(uv, 3.0 * S, 6), b = fbm(uv + 4.4, 5.0 * S, 6), sp = fbm(uv + 8.8, 24.0, 4);
    col = c0;
    col = mix(col, c1, sstep(0.02, 0.09, a + T));
    col = mix(col, c2, sstep(0.14, 0.2, b + T));
    col = mix(col, c3, sstep(0.22, 0.26, sp));
  } else if (pattern == 8) {         // carbon twill
    vec2 q = uv * 48.0 * S;
    vec2 c = floor(q), f = fract(q);
    float dir = mod(c.x + c.y, 2.0);
    float fib = dir > 0.5 ? f.x : f.y;
    float tow = 0.5 + 0.5 * cos(6.2831853 * fib);
    col = c0 + c1 * tow * (dir > 0.5 ? 0.9 : 0.55);
    m = tow;
  } else if (pattern == 9) {         // splinter shards
    vec2 wq = uv + vec2(fbm(uv, 4.0, 4), fbm(uv + 2.0, 4.0, 4)) * 0.05 * W;
    vec3 v = voronoi(wq, vec2(9.0, 5.0) * S);
    col = v.z < 0.3 ? c0 : (v.z < 0.55 ? c1 : (v.z < 0.8 ? c2 : c3));
    col *= 1.0 - sstep(0.03, 0.0, v.y - v.x) * 0.5;
    m = v.z >= 0.8 ? 1.0 : 0.0;
  } else if (pattern == 10) {        // black ice (see iceSkin)
    iceSkin(uv, S, col, m, g);
  } else if (pattern == 11) {        // fade
    float t = sstep(0.15, 0.85, uv.y + fbm(uv, 4.0, 5) * 0.3 * W + T);
    float dith = step(hash1(floor(uv * 256.0)), t);
    col = mix(c0, c1, mix(t, dith, 0.35));
    col = mix(col, c2, sstep(0.48, 0.5, fract(uv.y * 2.0 * S)) * 0.0);
    m = t;
  } else if (pattern == 12) {        // diagonal stripes
    float d = fract((uv.x + uv.y) * 6.0 * S + fbm(uv, 3.0, 3) * 0.1 * W);
    float stripe = sstep(0.02, 0.0, abs(d - 0.25) - 0.12);
    float pin = sstep(0.015, 0.0, abs(d - 0.62) - 0.012);
    col = mix(mix(c0, c1, stripe), c2, pin);
    m = stripe;
  } else if (pattern == 13) {        // marble veins
    float v = abs(sin(6.2831853 * (uv.x * 2.0 * S + fbm(uv, 3.0, 6) * 2.5 * W)));
    float vein = sstep(0.12, 0.0, v);
    float v2 = abs(sin(6.2831853 * (uv.y * 3.0 * S + fbm(uv + 3.0, 4.0, 6) * 3.0)));
    float vein2 = sstep(0.06, 0.0, v2) * 0.6;
    col = c0 * (0.85 + 0.3 * fbm(uv + 6.0, 6.0, 5));
    col = mix(col, c2, vein2);
    col = mix(col, c1, vein);
    m = max(vein, vein2); g = vein * 0.5;
  } else if (pattern == 15) {        // blossom branch: painted branches and five-petal flowers on lacquer
    float paper = fbm(uv, 6.0, 5);
    col = mix(c3, c3 * 0.82 + c2 * 0.18, sstep(-0.1, 0.4, paper));
    vec2 wq = uv + vec2(fbm(uv, 3.0, 5), fbm(uv + 3.3, 3.0, 5)) * 0.06 * W;
    vec3 v = voronoi(wq, vec2(3.0 * S, 3.0 * S));
    float thick = 0.02 + 0.045 * sstep(-0.3, 0.4, fbm(uv + 7.0, 4.0, 4));
    float branch = sstep(thick, thick * 0.4, v.y - v.x);
    float twig = sstep(0.008, 0.002, abs(fract(dot(wq, vec2(7.0, 3.0)) * S + fbm(uv, 8.0, 3) * 0.6) - 0.5) - 0.47) * sstep(0.3, 0.05, v.y - v.x);
    col = mix(col, c0, max(branch, twig * 0.8));
    // flowers: on a fine lattice, only near branches
    vec2 p = wq * 5.0 * S, ci = floor(p), f = fract(p);
    float flower = 0.0, centre = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cc = mod(ci + g, vec2(5.0 * S));
      vec2 o = 0.5 + 0.35 * hash2(cc);
      vec2 d = g + o - f;
      float r = length(d), a = atan(d.y, d.x) + hash1(cc) * 6.28;
      float petal = 0.22 + 0.08 * cos(5.0 * a);
      float keep = step(0.45, hash1(cc + 7.0));
      flower = max(flower, sstep(petal, petal - 0.04, r) * keep);
      centre = max(centre, sstep(0.07, 0.04, r) * keep);
    }
    flower *= sstep(0.5, 0.15, v.y - v.x);
    col = mix(col, c1 * (0.8 + 0.4 * fbm(uv + 2.0, 32.0, 3)), flower);
    col = mix(col, c2, centre * flower);
    m = flower; g = 0.0;
  } else if (pattern == 16) {        // breaking waves with foam lines
    float y = uv.y * 4.0 * S;
    float row = floor(y), fy = fract(y);
    float crest = 0.55 + 0.25 * sin(6.2831853 * (uv.x * (2.0 + mod(row, 3.0)) * S + row * 0.37) + fbm(uv + row, 4.0, 4) * 3.0 * W);
    float body = sstep(crest + 0.02, crest - 0.02, fy);
    float foam = sstep(0.025, 0.0, abs(fy - crest)) + sstep(0.012, 0.0, abs(fy - crest + 0.08)) * 0.7 + sstep(0.01, 0.0, abs(fy - crest + 0.16)) * 0.4;
    col = mix(c0, c1, body * (0.4 + 0.6 * fy));
    col = mix(col, c2, sstep(0.3, 0.6, fbm(uv + 4.0, 6.0, 5)) * body * 0.4);
    col = mix(col, c3, clamp(foam, 0.0, 1.0));
    m = clamp(foam, 0.0, 1.0); g = 0.0;
  } else {                           // circuit traces
    float N = 12.0 * S;
    vec2 q = uv * N, c = floor(q), f = fract(q);
    float h = hash1(mod(c, vec2(N)));
    float tr = 0.0;
    if (h < 0.45) tr = sstep(0.06, 0.03, abs(f.y - 0.5));
    else if (h < 0.9) tr = sstep(0.06, 0.03, abs(f.x - 0.5));
    float pad = sstep(0.16, 0.12, length(f - 0.5)) * step(0.75, hash1(mod(c + 3.0, vec2(N))));
    col = c0 * (0.8 + 0.3 * fbm(uv, 8.0, 3));
    col = mix(col, c1, tr);
    col = mix(col, c2, pad);
    m = max(tr, pad); g = tr;
  }
  col *= 1.0 + grain;
}
`;

function skinUniforms(def) {
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  return {
    pattern: { value: def.pattern }, c0: { value: v3(def.c[0]) }, c1: { value: v3(def.c[1]) }, c2: { value: v3(def.c[2]) }, c3: { value: v3(def.c[3]) },
    prm: { value: new THREE.Vector4(...(def.p || [1, 1, 0, 0])) },
  };
}

// Bake a skin (core/skins.js definition). albedo: sqrt-encoded colour + edge-wear noise in A;
// rm: R glow mask, G roughness, B metalness (finer detail is not needed at half size).
export function bakeSkin(renderer, def, size = 4096) {
  // Enhanced Graphics pack v5: the redrawn skins (js/render/skins2.js) at High / Ultra sizes
  const v2 = size >= 2048 && skinSheets.ready;
  const head = NOISE + SKIN_GLSL + (v2 ? SKIN2_GLSL : '');
  const s2 = v2 ? skin2Uniforms(def) : {};
  const at = v2 ? 'float hh; skinAt2(vUv, col, m, g, hh);' : 'skinAt(vUv, col, m, g);';
  const enhanced = size >= 2048 && !!packArt.finish;
  const finish = enhanced ? packArt.finish : {};
  const u = { ...skinUniforms(def), ...s2, finishGrain: { value: finish.grain || 0 } };
  const albedo = bake(renderer, head + /* glsl */`
    uniform float finishGrain;
    void main() {
      vec3 col; float m, g; ${at}
      col *= 1.0 + finishGrain * sin(vUv.y * 1608.495) * (0.3 + 0.7 * m);
      float wearNoise = 0.5 + fbm(vUv + 11.0, 24.0, 6);      // ragged edge-wear threshold
      gl_FragColor = vec4(sqrt(clamp(col, 0.0, 1.0)), clamp(wearNoise, 0.0, 1.0));   // sqrt-encoded: finer steps in dark finishes
    }`, size, u);
  const rmu = { finishRough: { value: finish.roughnessVariation || 0 }, finishMetal: { value: finish.paintMetalReduction || 0 }, ...skinUniforms(def), ...s2, rmA: { value: new THREE.Vector2(def.rm[0], def.rm[1]) }, rmB: { value: new THREE.Vector2(def.rm[2], def.rm[3]) } };
  const rm = bake(renderer, head + /* glsl */`
    uniform vec2 rmA, rmB; uniform float finishRough, finishMetal;
    void main() { vec3 col; float m, g; ${at} vec2 r = mix(rmA, rmB, m); if (finishRough > 0.0) { r.x = clamp(r.x + finishRough * (0.5 + fbm(vUv, 128.0, 3)), 0.06, 1.0); r.y = clamp(r.y - finishMetal * m, 0.0, 1.0); } gl_FragColor = vec4(g, r.x, r.y, 1.0); }`,
  Math.max(128, size >> 1), rmu);
  // High / ultra: a relief map from the design (accent shapes raised, glow lines cut in),
  // turned into a normal map on the GPU, so the skin catches light like layered paint.
  let normal = null;
  if (size >= 2048) {
    const hu = { ...skinUniforms(def), ...s2 };
    const h = bake(renderer, head + /* glsl */`
      void main() { vec3 col; float m, g; ${v2 ? 'float hh; skinAt2(vUv, col, m, g, hh);' : 'skinAt(vUv, col, m, g); float hh = 0.5;'} float lum = dot(col, vec3(0.3, 0.5, 0.2));
        float h = pattern == 10 ? 0.75 - m * 0.7 + fbm(vUv, 48.0, 4) * 0.06 : ${v2 ? 'hh + fbm(vUv, 96.0, 3) * 0.04' : '0.5 + m * 0.35 - g * 0.25 + lum * 0.15 + fbm(vUv, 96.0, 3) * 0.08'};
        gl_FragColor = vec4(vec3(h), 1.0); }`,
    Math.max(512, size >> 1), hu, { mip: false });
    normal = bakeNormalFromTexture(renderer, h, h.image.width, def.pattern === 10 ? 9.0 : 3.0);
    disposeBaked(h);
  }
  return { albedo, rm, normal, def, wear: def.wear * (enhanced ? finish.wear : 1), clearcoat: def.clearcoat, glow: def.glow };
}

// Normal map from a height render target texture (Sobel), tiling.
export function bakeNormalFromTexture(renderer, heightTex, size, strength = 2) {
  const frag = /* glsl */`
    varying vec2 vUv; uniform sampler2D h; uniform float px; uniform float strength;
    float s(float x, float y) { return texture2D(h, vUv + vec2(x, y) * px).r; }
    void main() {
      float dx = (s(1.,-1.) + 2.*s(1.,0.) + s(1.,1.)) - (s(-1.,-1.) + 2.*s(-1.,0.) + s(-1.,1.));
      float dy = (s(-1.,1.) + 2.*s(0.,1.) + s(1.,1.)) - (s(-1.,-1.) + 2.*s(0.,-1.) + s(1.,-1.));
      gl_FragColor = vec4(normalize(vec3(-dx * strength, -dy * strength, 1.0)) * 0.5 + 0.5, s(0., 0.));   // height kept in A
    }`;
  return bake(renderer, frag, size, { h: { value: heightTex }, px: { value: 1 / size }, strength: { value: strength } });
}

// A small picture of a skin for menus: a canvas (sRGB-ish: the stored sqrt colour).
export function skinThumb(renderer, def, size = 96) {
  const t = bake(renderer, NOISE + SKIN_GLSL + /* glsl */`
    void main() { vec3 col; float m, g; skinAt(vUv * 0.5, col, m, g); gl_FragColor = vec4(sqrt(clamp(col, 0.0, 1.0)), 1.0); }`,
  size, skinUniforms(def), { mip: false });
  const rt = t.userData.rt;
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  rt.dispose();
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d'), img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  g.putImageData(img, 0, 0);
  return cv;
}

/* ---------- triplanar shader patch ---------- */

// Patches a MeshStandardMaterial / MeshPhysicalMaterial:
//   skin: { albedo, rm, wear } replaces the base colour, roughness and metalness, mapped by
//         object-space position (scale: tiles per metre); edges of each part's UV square
//         wear through to bare metal (box parts map 0..1 per face).
//   detail: packed micro-detail (bakeDetail), detailScale tiles per metre, detailStrength.
//   hd: the mesh is an Enhanced Graphics pack model with a baked aDetail attribute (ambient
//       occlusion, edge, cavity): crevices darken, and paint wears off its real edges.
//   hdEdge / hdEdgeCol / hdEdgeMetal: edge wear of a part without a skin (0 = none).
//   depth: skin relief depth in metres (parallax: the design looks layered, not printed).
export function triplanar(material, { skin = null, detail = null, scale = 3, detailScale = 2, detailStrength = 1, gain = 1, hd = false, hdEdge = 0, hdEdgeCol = [0.32, 0.33, 0.35], hdEdgeMetal = 1, depth = 0 } = {}) {
  const uniforms = {
    triScale: { value: scale }, detScale: { value: detailScale }, detStrength: { value: detailStrength },
    skinAlbedo: { value: skin ? skin.albedo : null }, skinRM: { value: skin ? skin.rm : null }, skinNormal: { value: skin ? skin.normal : null },
    skinWear: { value: skin ? skin.wear : 0 }, detailMap: { value: detail }, triGain: { value: gain },
    skinGlow: { value: new THREE.Vector3(...((skin && skin.glow) || [0, 0, 0])) },
    // Look per rarity: a colour fade along the gun, and the inspect-only animations
    // (triAnim 0..1 is driven by the weapon rig while you inspect; triTime is seconds).
    fadeA: { value: new THREE.Vector3() }, fadeB: { value: new THREE.Vector3() }, fadeAmt: { value: 0 },
    triTime: { value: 0 }, triAnim: { value: 0 }, animFlow: { value: 0 }, sweepCol: { value: new THREE.Vector3(1, 1, 1) },
    reliefK: { value: (skin && skin.def && skin.def.pattern === 10 ? 2.2 : 0.9) * (hd ? 1.5 : 1) },
    triAO: { value: hd ? 1 : 0 }, hdEdge: { value: hdEdge }, hdEdgeCol: { value: new THREE.Vector3(...hdEdgeCol) }, hdEdgeMetal: { value: hdEdgeMetal },
    reliefDepth: { value: depth },
    iceFrost: { value: 0 }, iceWave: { value: 9 }, iceGlow: { value: 0 },   // Black Ice inspect (viewmodel animateSkins)
  };
  const def = skin && skin.def;
  if (def) {
    const L = { common: [0.12, 0, 0.35], rare: [0.35, 0.3, 0.6], epic: [0.55, 1, 0.9], blackice: [0.3, 1, 1], legendary: [0, 0, 1], factory: [0, 0, 0.4] }[def.rarity] || [0, 0, 0.4];
    uniforms.fadeA.value.set(...def.c[1]);
    uniforms.fadeB.value.set(...(def.rarity === 'common' ? def.c[0] : def.c[3]));
    uniforms.fadeAmt.value = L[0];
    uniforms.animFlow.value = L[1];
    const g = def.glow && def.glow.some((v) => v > 0) ? def.glow : def.c[1];
    uniforms.sweepCol.value.set(...g.map((v) => Math.min(1, 0.35 + v * 0.6))).multiplyScalar(L[2]);
  }
  material.userData.tri = uniforms;
  const defs = (skin ? '#define TRI_SKIN\n' : '') + (skin && skin.normal ? '#define TRI_SKIN_NORMAL\n' : '') + (detail ? '#define TRI_DETAIL\n' : '') +
    (hd ? '#define TRI_HD\n' : '') + (hd && depth > 0 && skin && skin.normal ? '#define TRI_PARALLAX\n' : '');
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = defs + 'varying vec3 vTriPos; varying vec3 vTriN; varying vec3 vTriAX; varying vec3 vTriAY; varying vec3 vTriAZ;\n' +
      '#ifdef TRI_HD\nattribute vec4 aDetail; varying vec4 vDet;\n#endif\n#ifdef TRI_PARALLAX\nvarying vec3 vTriView;\n#endif\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vTriPos = position; vTriN = normal;
        #ifdef TRI_HD
          vDet = aDetail;
        #endif
        #ifdef TRI_PARALLAX
          vTriView = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - position;
        #endif
        vTriAX = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vTriAY = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vTriAZ = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);`);
    const head = defs + /* glsl */`
      varying vec3 vTriPos; varying vec3 vTriN; varying vec3 vTriAX; varying vec3 vTriAY; varying vec3 vTriAZ;
      uniform float triScale, detScale, detStrength, skinWear, triGain;
      uniform vec3 skinGlow, fadeA, fadeB, sweepCol;
      uniform float fadeAmt, triTime, triAnim, animFlow, reliefK;
      uniform sampler2D skinAlbedo, skinRM, skinNormal, detailMap;
      uniform float triAO, hdEdge, hdEdgeMetal, reliefDepth, iceFrost, iceWave, iceGlow;
      uniform vec3 hdEdgeCol;
      #ifdef TRI_HD
        varying vec4 vDet;
      #endif
      #ifdef TRI_PARALLAX
        varying vec3 vTriView;
      #endif
      vec2 triOX = vec2(0.0), triOY = vec2(0.0), triOZ = vec2(0.0);   // parallax offsets per projection
      vec3 triW() { vec3 w = pow(abs(normalize(vTriN)), vec3(4.0)); return w / (w.x + w.y + w.z); }
      float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
      vec4 triTex(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy + triOX) * w.x + texture2D(t, p.xz + triOY) * w.y + texture2D(t, p.xy + triOZ) * w.z; }
    `;
    let f = head + sh.fragmentShader;
    f = f.replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
      vec3 tw = triW();
      float triWear = 0.0;
      #ifdef TRI_SKIN
        // While inspecting, Epic and Black Ice patterns flow slowly across the gun.
        vec3 triP = vTriPos * triScale + vec3(0.0, triTime * 0.05, triTime * 0.035) * triAnim * animFlow;
        float relief = 0.5;
        #ifdef TRI_PARALLAX
        {
          // Parallax: shift each projection's lookup along the view by the design's height,
          // so raised paint and engraved lines sit at different depths.
          vec3 V = normalize(vTriView);
          float hx = texture2D(skinNormal, triP.zy).a, hy = texture2D(skinNormal, triP.xz).a, hz = texture2D(skinNormal, triP.xy).a;
          float k = reliefDepth * triScale;
          triOX = V.zy / (abs(V.x) + 0.35) * (hx - 0.5) * k;
          triOY = V.xz / (abs(V.y) + 0.35) * (hy - 0.5) * k;
          triOZ = V.xy / (abs(V.z) + 0.35) * (hz - 0.5) * k;
          relief = hx * tw.x + hy * tw.y + hz * tw.z;
        }
        #endif
        vec4 sk = triTex(skinAlbedo, triP, tw);
        #if defined( USE_NORMALMAP ) || defined( USE_MAP )
          #ifdef USE_NORMALMAP
            vec2 wuv = fract(vNormalMapUv);
          #else
            vec2 wuv = fract(vMapUv);
          #endif
          float ed = min(min(wuv.x, 1.0 - wuv.x), min(wuv.y, 1.0 - wuv.y));
          triWear = sstep(0.035 * skinWear, 0.0, ed - (sk.a - 0.5) * 0.03 * skinWear) * step(0.001, skinWear);
        #endif
        #ifdef TRI_HD
          // Paint chips off the model's real edges (baked edge mask), raggedly.
          float ew = vDet.g * (0.45 + 0.55 * min(skinWear, 1.4)) + (sk.a - 0.5) * 0.6;
          triWear = sstep(0.48, 0.56, ew) * step(0.001, skinWear);
        #endif
        vec3 base = sk.rgb * sk.rgb;
        // Colour fade from the stock to the muzzle (Rare and up).
        vec3 fc = mix(fadeB, fadeA, sstep(0.35, -0.55, vTriPos.z));
        base = mix(base, mix(base, fc * (0.6 + 0.8 * dot(base, vec3(0.33))) + fc * 0.25, 0.65), fadeAmt);
        diffuseColor.rgb = mix(base, vec3(0.36, 0.36, 0.38), triWear) * triGain;   // bare steel at the edges
        #ifdef TRI_HD
          diffuseColor.rgb *= 1.0 - triWear * (1.0 - triWear) * 1.6;     // dark rim where the paint is chipped
        #endif
        #ifdef TRI_PARALLAX
          diffuseColor.rgb *= mix(1.0, 0.62 + 0.76 * relief, (1.0 - triWear) * 0.6);   // low parts of the design in shade
        #endif
        // Inspect: a band of light sweeps along the gun.
        float sweepX = mod(triTime * 0.55, 1.7) - 0.95;
        float sweep = exp(-pow(vTriPos.z - sweepX + vTriPos.y * 0.6, 2.0) * 90.0) * triAnim;
        diffuseColor.rgb += sweepCol * sweep * (1.0 - triWear) * 0.9;
        // Black Ice inspect: frost spreads over the gun, the wipe (iceWave, moving to the muzzle) clears it
        float frost = iceFrost * step(vTriPos.z, iceWave) * sstep(0.25, 0.75, sk.a + 0.15);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.86, 0.95), frost * 0.75);
      #endif
      #ifdef TRI_DETAIL
        vec4 dt = triTex(detailMap, vTriPos * detScale, tw);
        diffuseColor.rgb *= mix(1.0, dt.b * 2.0, detStrength);
      #endif
      float hdWear = 0.0;
      #ifdef TRI_HD
        // Parts without a skin: worn edges (bare metal on coated parts, lighter scuffs on
        // polymer) and grime in inside corners.
        #ifdef TRI_DETAIL
          float hn = dt.b;
        #else
          float hn = 0.5;
        #endif
        hdWear = sstep(0.5, 0.62, vDet.g * hdEdge + (hn - 0.5) * 0.9) * step(0.001, hdEdge);
        diffuseColor.rgb = mix(diffuseColor.rgb, hdEdgeCol, hdWear);
        diffuseColor.rgb *= 1.0 - vDet.b * 0.35;
      #endif`);
    f = f.replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
      #ifdef TRI_SKIN
        vec4 skrm = triTex(skinRM, triP, tw);
        roughnessFactor = mix(mix(skrm.g, 0.3, triWear), 0.85, iceFrost * step(vTriPos.z, iceWave) * 0.8);
      #endif
      #ifdef TRI_DETAIL
        roughnessFactor = clamp(roughnessFactor * mix(1.0, dt.a * 2.0, detStrength), 0.04, 1.0);
      #endif
      #ifdef TRI_HD
        roughnessFactor = mix(roughnessFactor, 0.32, hdWear);
        roughnessFactor = min(1.0, roughnessFactor + vDet.b * 0.15);
      #endif`);
    f = f.replace('#include <metalnessmap_fragment>', /* glsl */`#include <metalnessmap_fragment>
      #ifdef TRI_SKIN
        metalnessFactor = mix(skrm.b, 1.0, triWear);
      #endif
      #ifdef TRI_HD
        metalnessFactor = mix(metalnessFactor, hdEdgeMetal, hdWear);
      #endif`);
    // Baked ambient occlusion (pack models): ambient and reflections fade in crevices and
    // under parts; direct light a little.
    f = f.replace('#include <aomap_fragment>', /* glsl */`#include <aomap_fragment>
      #ifdef TRI_HD
      {
        float hao = clamp(mix(1.0, pow(vDet.r, 1.6) * (1.0 - vDet.b * 0.35), triAO), 0.0, 1.0);
        reflectedLight.indirectDiffuse *= hao;
        reflectedLight.indirectSpecular *= mix(1.0, hao, 0.9);
        reflectedLight.directDiffuse *= mix(1.0, hao, 0.45);
        reflectedLight.directSpecular *= mix(1.0, hao, 0.6);
      }
      #endif`);
    f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #ifdef TRI_SKIN
        // Glowing lines; they pulse while inspecting.
        totalEmissiveRadiance += skinGlow * skrm.r * (1.0 - triWear) * (1.0 + triAnim * (0.9 + 0.9 * sin(triTime * 5.0)));
        totalEmissiveRadiance += sweepCol * sweep * (1.0 - triWear) * 0.6;
        totalEmissiveRadiance += (skinGlow * skrm.r * iceGlow * 3.0 + sweepCol * exp(-pow(vTriPos.z - iceWave, 2.0) * 900.0) * step(0.001, iceFrost + iceGlow) * 1.5) * (1.0 - triWear);
      #endif`);
    f = f.replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
      #ifdef TRI_SKIN_NORMAL
      {
        // Relief of the skin's design (paint edges, cracks), mapped like the colour.
        vec2 sx = texture2D(skinNormal, triP.zy + triOX).rg * 2.0 - 1.0;
        vec2 sy = texture2D(skinNormal, triP.xz + triOY).rg * 2.0 - 1.0;
        vec2 sz = texture2D(skinNormal, triP.xy + triOZ).rg * 2.0 - 1.0;
        vec3 sn = (sx.x * vTriAZ + sx.y * vTriAY) * tw.x + (sy.x * vTriAX + sy.y * vTriAZ) * tw.y + (sz.x * vTriAX + sz.y * vTriAY) * tw.z;
        normal = normalize(normal + sn * (1.0 - triWear) * reliefK);
      }
      #endif
      #ifdef TRI_DETAIL
      {
        vec3 p = vTriPos * detScale;
        vec2 nx = texture2D(detailMap, p.zy).rg * 2.0 - 1.0;
        vec2 ny = texture2D(detailMap, p.xz).rg * 2.0 - 1.0;
        vec2 nz = texture2D(detailMap, p.xy).rg * 2.0 - 1.0;
        vec3 dn = (nx.x * vTriAZ + nx.y * vTriAY) * tw.x + (ny.x * vTriAX + ny.y * vTriAZ) * tw.y + (nz.x * vTriAX + nz.y * vTriAY) * tw.z;
        normal = normalize(normal + dn * detStrength);
      }
      #endif`);
    sh.fragmentShader = f;
  };
  material.customProgramCacheKey = () => 'tri' + defs.replace(/\n/g, '');
  material.needsUpdate = true;
  return material;
}
