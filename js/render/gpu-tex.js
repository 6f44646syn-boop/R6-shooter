import { skinSheets, skin2Uniforms, SKIN2_GLSL } from './skins2.js?v=d0aee3b-mwdla33w';
import { packArt } from './pack-art.js?v=d0aee3b-mwdla33w';
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
import * as THREE from '../../vendor/three/three.module.min.js?v=d0aee3b-mwdla33w';

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
uniform vec4 prm;
uniform float skinSeed, skinTier;
vec2 skinOffset() { return vec2(hash1(vec2(skinSeed, 7.0)), hash1(vec2(skinSeed, 19.0))); }
// Black Ice cracks: two broken networks (big, fine) and radiating splinters. 0..1 = in a crack.
float iceCracks(vec2 uv, float S) {
  vec2 wq = uv + vec2(fbm(uv, 8.0 * S, 4), fbm(uv + 5.0, 8.0 * S, 4)) * 0.025;
  vec3 v1 = voronoi(wq, vec2(5.0 * S));
  vec3 v2 = voronoi(wq + 0.31, vec2(13.0 * S));
  float brk1 = sstep(-0.05, 0.12, fbm(uv + 3.7, 6.0 * S, 4));
  float brk2 = sstep(0.05, 0.2, fbm(uv + 8.1, 10.0 * S, 4));
  float big = sstep(0.013 + 0.011 * prm.z, 0.003, v1.y - v1.x) * brk1;
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
void iceSkin(vec2 uv, float S, out vec3 col, out float m, out float g, out float height) {
  float seed = prm.w;
  uv += skinOffset();
  float mott = fbm(uv, 4.0, 6);
  col = mix(c0, c3, sstep(-0.15, 0.35, mott));                           // lighter patches
  // frozen depth: cloudy layers deep in the ice, lit from inside
  float deep = fbm(uv + vec2(fbm(uv + 2.0, 3.0, 4), fbm(uv + 7.0, 3.0, 4)) * 0.12, 5.0, 6);
  col = mix(col, c3 * 2.15 + c1 * 0.055, sstep(-0.04, 0.43, deep) * 0.61);
  col = mix(col, c3 * 1.4, sstep(0.25, 0.45, fbm(uv + 9.0, 7.0, 5)) * 0.4);
  // cracks cut into the finish: a dark core, a lit upper edge and a shadowed lower edge
  float crack = iceCracks(uv, S);
  float e = 0.0022;
  float bev = iceCracks(uv + vec2(-e, e), S) - iceCracks(uv + vec2(e, -e), S);
  // frost ferns: fine parallel feathers growing from the big cracks, a direction per shard
  vec2 wq = uv + vec2(fbm(uv, 8.0 * S, 4), fbm(uv + 5.0, 8.0 * S, 4)) * 0.025;
  vec3 v1 = voronoi(wq, vec2(5.0 * S));
  float near = sstep(0.08 + prm.y * 0.22, 0.0, v1.y - v1.x + 0.12 * fbm(uv + 1.3, 12.0 * S, 4));
  float k = floor(v1.z * 6.0);
  vec2 kv = k < 1.0 ? vec2(1, 2) : k < 2.0 ? vec2(2, -1) : k < 3.0 ? vec2(1, -2) : k < 4.0 ? vec2(2, 1) : k < 5.0 ? vec2(1, 3) : vec2(3, -1);
  float stripe = abs(sin(dot(uv, kv) * S * 6.2831853 * 18.0 + fbm(uv, 16.0 * S, 3) * 3.0));
  float fern = pow(stripe, 5.0) * near * sstep(-0.18, 0.24, fbm(uv + 4.4, 9.0 * S, 4));
  // trapped air bubbles: small bright rings with a dark heart
  vec3 vb = voronoi(uv, vec2(36.0 * S));
  float keep = step(0.95 - prm.y * 0.16, vb.z), rr = vb.x;
  float bubble = keep * sstep(0.16, 0.12, rr) * sstep(0.06, 0.1, rr);
  float bubbleIn = keep * sstep(0.08, 0.04, rr);
  // sparkles
  vec2 sp = uv * 160.0, sc = floor(sp);
  float spark = sstep(0.12, 0.0, length(fract(sp) - 0.5 - 0.3 * hash2(mod(sc, vec2(160.0))))) * step(0.93, hash1(mod(sc, vec2(160.0)) + 2.0));
  // the emblem: one snowflake per tile, placed and drawn from the skin's seed
  vec2 cen = vec2(0.35 + 0.3 * hash1(vec2(seed, 1.0)), 0.35 + 0.3 * hash1(vec2(seed, 2.0)));
  float flake = iceFlake(fract(uv * S) - cen, 0.18 + prm.y * 0.055, seed);
  // Refraction through the fractured faces and pale rime across their edges.
  float face = sstep(0.05, 0.75, v1.y - v1.x);
  float rime = near * sstep(-0.12, 0.28, fbm(uv + vec2(0.44, 3.8), 23.0, 4));
  col *= 0.8 + 0.55 * mix(v1.z, 1.0, face);
  col = mix(col, c1 * 0.76 + c2 * 0.12, rime * prm.y * 0.26);
  col = mix(col, mix(c1, c2, 0.3), fern * 0.28);
  col = mix(col, c1, crack * 0.9);
  col = mix(col, c0 * 0.12, pow(crack, 2.5) * 0.9);
  col += c2 * max(bev, 0.0) * 0.9;
  col *= 1.0 - max(-bev, 0.0) * 0.7;
  col = mix(col, c3 * 0.5, bubbleIn * 0.6);
  col = mix(col, c2, bubble * 0.43);
  col = mix(col, mix(c2, c1, 0.4), flake * 0.51);
  col = mix(col, c2, spark * 0.68);
  m = clamp(max(crack, max(flake, rime * 0.7 + fern * 0.35)), 0.0, 1.0);
  g = max(max(crack * 0.18, spark * 0.75), max(flake * 0.32, fern * 0.21 + bubble * 0.13));
  height = clamp(0.58 + face * (0.09 + v1.z * 0.13) - crack * 0.48 + bev * 0.075
    + rime * 0.11 + fern * 0.14 + flake * 0.08 - bubbleIn * 0.04 + fbm(uv, 64.0, 3) * 0.06, 0.0, 1.0);
}
void skinAt(vec2 uv, out vec3 col, out float m, out float g) {
  float S = max(1.0, floor(prm.x + 0.5)), W = prm.y, T = prm.z;
  float height;
  if (pattern == 10) { iceSkin(uv, S, col, m, g, height); return; }
  if (pattern == 17) { // Sakura's pack swatch. The equipped finish is calculated from the mesh.
    m = sstep(0.37, 0.48, uv.y);
    col = mix(mix(c3, c0, sstep(0.03, 0.39, uv.x)), c1, m * 0.87);
    g = 0.0;
    return;
  }
  if (skinTier >= 0.0) uv += skinOffset();
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
  if (skinTier >= 0.0) {
    float finish = pnoise(vec2(uv.x * 9.0, uv.y * 145.0), vec2(9.0, 145.0));
    float useWear = sstep(0.16, 0.38, fbm(uv + 6.4, 21.0, 4));
    if (skinTier < 0.5) col *= 0.94 + finish * 0.10 - useWear * 0.16;
    else if (skinTier < 1.5) col = mix(col * (1.0 + finish * 0.09), c3, m * useWear * 0.32);
    else col += max(finish - 0.24, 0.0) * (0.1 + m * 0.21) * mix(c1, c3, 0.56);
  }
}
`;

function skinUniforms(def) {
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  return {
    pattern: { value: def.pattern }, c0: { value: v3(def.c[0]) }, c1: { value: v3(def.c[1]) }, c2: { value: v3(def.c[2]) }, c3: { value: v3(def.c[3]) },
    prm: { value: new THREE.Vector4(...(def.p || [1, 1, 0, 0])) },
    skinSeed: { value: def.id }, skinTier: { value: { common: 0, rare: 1, epic: 2 }[def.rarity] ?? -1 },
  };
}

// Bake a skin (core/skins.js definition). albedo: sqrt-encoded colour + edge-wear noise in A;
// rm: R glow mask, G roughness, B metalness (finer detail is not needed at half size).
export function bakeSkin(renderer, def, size = 4096) {
  // Enhanced Graphics pack v5: the redrawn skins (js/render/skins2.js) at High / Ultra sizes
  const relief = def.pattern === 10;
  const v2 = !relief && size >= 2048 && skinSheets.ready;
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
  if (size >= 2048 || (relief && size >= 1024)) {
    const hu = { ...skinUniforms(def), ...s2 };
    const height = def.pattern === 10 ? 'iceSkin(vUv, max(1.0, prm.x), col, m, g, h);'
      : v2 ? 'skinAt2(vUv, col, m, g, h); h += fbm(vUv, 96.0, 3) * 0.04;'
        : 'skinAt(vUv, col, m, g); h = 0.5 + m * 0.35 - g * 0.25 + dot(col, vec3(0.3, 0.5, 0.2)) * 0.15 + fbm(vUv, 96.0, 3) * 0.08;';
    const h = bake(renderer, head + /* glsl */`
      void main() { vec3 col; float m, g, h; ${height}
        gl_FragColor = vec4(vec3(clamp(h, 0.0, 1.0)), 1.0); }`,
    Math.max(512, size >> 1), hu, { mip: false });
    normal = bakeNormalFromTexture(renderer, h, h.image.width, def.pattern === 10 ? 6.0 : 3.0);
    disposeBaked(h);
  }
  return { albedo, rm, normal, def, scale: def.scale, wear: def.wear * (enhanced ? finish.wear : 1), clearcoat: def.clearcoat, glow: def.glow };
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
// Skin artwork (same site), loaded once per file; shown when it arrives.
const artTextures = new Map();
function artTexture(url) {
  if (!artTextures.has(url)) {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
    artTextures.set(url, t);
  }
  return artTextures.get(url);
}
export function triplanar(material, { skin = null, detail = null, scale = 3, detailScale = 2, detailStrength = 1, gain = 1, hd = false, hdEdge = 0, hdEdgeCol = [0.32, 0.33, 0.35], hdEdgeMetal = 1, depth = 0 } = {}) {
  const uniforms = {
    triScale: { value: scale }, detScale: { value: detailScale }, detStrength: { value: detailStrength },
    skinAlbedo: { value: skin?.albedo ?? null }, skinRM: { value: skin?.rm ?? null }, skinNormal: { value: skin?.normal ?? null },
    skinWear: { value: skin?.wear ?? 0 }, detailMap: { value: detail }, triGain: { value: gain },
    skinGlow: { value: new THREE.Vector3(...((skin && skin.glow) || [0, 0, 0])) },
    // Look per rarity: a colour fade along the gun, and the inspect-only animations
    // (triAnim 0..1 is driven by the weapon rig while you inspect; triTime is seconds).
    fadeA: { value: new THREE.Vector3() }, fadeB: { value: new THREE.Vector3() }, fadeAmt: { value: 0 },
    triTime: { value: 0 }, triAnim: { value: 0 }, sweepCol: { value: new THREE.Vector3(1, 1, 1) },
    reliefK: { value: (skin?.def?.pattern === 10 ? 1.65 : 0.9) * (hd ? 1.5 : 1) },
    triAO: { value: hd ? 1 : 0 }, hdEdge: { value: hdEdge }, hdEdgeCol: { value: new THREE.Vector3(...hdEdgeCol) }, hdEdgeMetal: { value: hdEdgeMetal },
    reliefDepth: { value: depth },
  };
  const def = skin && skin.def;
  const sakura = def?.pattern === 17, painted = !!def?.art;
  if (painted) {
    // Painted Legendaries: the concept painting laid out in gun space (def.artRect) on the gun traced
    // from it. Looks: 'porcelain' (glaze, crazing, silver seams) or 'bronze' (metal, glowing teal inlays).
    Object.assign(uniforms, {
      artMap: { value: artTexture(def.art) }, artMap2: { value: artTexture(def.artPeak || def.art) }, artMix: { value: 0 }, artMixSide: { value: 0 }, artRect: { value: new THREE.Vector4(...def.artRect) },
      artDark: { value: new THREE.Vector3(...def.c[2]) }, artPhase: { value: -1 }, artBlast: { value: -9 }, artMode: { value: { bronze: 1, glass: 2, resin: 2, jade: 2, opal: 2, lacquer: 3, gilt: 3, velvet: 7, orrery: 5, forge: 4, amber: 6 }[def.artLook] || 0 },
    });
  } else if (sakura) {
    const [gold, pink, pearl, black] = def.c.map(c => new THREE.Vector3(...c));
    Object.assign(uniforms, {
      sakuraGold: { value: gold }, sakuraPink: { value: pink }, sakuraPearl: { value: pearl }, sakuraBlack: { value: black },
      sakuraRM: { value: new THREE.Vector4(...def.rm) },
    });
  } else if (def) {
    const L = { common: [0.12, 0, 0.35], rare: [0.35, 0.3, 0.6], epic: [0.30, 1, 0.9], blackice: [0.3, 1, 1], legendary: [0, 0, 1], factory: [0, 0, 0.4] }[def.rarity] || [0, 0, 0.4];
    uniforms.fadeA.value.set(...def.c[1]);
    uniforms.fadeB.value.set(...(def.rarity === 'common' ? def.c[0] : def.c[3]));
    uniforms.fadeAmt.value = L[0];
    const g = def.glow && def.glow.some((v) => v > 0) ? def.glow : def.c[1];
    uniforms.sweepCol.value.set(...g.map((v) => Math.min(1, 0.35 + v * 0.6))).multiplyScalar(L[2]);
  }
  material.userData.tri = uniforms;
  const defs = (sakura ? '#define TRI_SAKURA\n' : painted ? '#define TRI_ART\n' : skin ? '#define TRI_SKIN\n' : '') +
    (skin && skin.normal ? '#define TRI_SKIN_NORMAL\n' : '') + (detail ? '#define TRI_DETAIL\n' : '') +
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
      uniform float fadeAmt, triTime, triAnim, reliefK;
      uniform sampler2D skinAlbedo, skinRM, skinNormal, detailMap;
      uniform float triAO, hdEdge, hdEdgeMetal, reliefDepth;
      uniform vec3 hdEdgeCol;
      #ifdef TRI_ART
        uniform sampler2D artMap, artMap2;      // artMap2: a second painting the inspect can fade into (artMix)
        uniform float artMix, artMixSide;      // artMixSide: 0 both sides, or only the side of x this sign
        uniform vec4 artRect;
        uniform vec3 artDark;
        uniform float artMode, artBlast;
        uniform float artPhase;
        // Fine crazing in the glaze: the edges of small irregular cells.
        float artCraze(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          float d1 = 8.0, d2 = 8.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 o = fract(sin(vec2(dot(i + g, vec2(127.1, 311.7)), dot(i + g, vec2(269.5, 183.3)))) * 43758.5453);
            float d = length(g + o - f);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          return 1.0 - smoothstep(0.0, 0.07, d2 - d1);
        }
      #endif
      #ifdef TRI_SAKURA
        uniform vec3 sakuraGold, sakuraPink, sakuraPearl, sakuraBlack;
        uniform vec4 sakuraRM;
        float scuffHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float scuffNoise(vec2 p) {
          vec2 i = floor(p), a = fract(p);
          a = a * a * (3.0 - 2.0 * a);
          return mix(mix(scuffHash(i), scuffHash(i + vec2(1, 0)), a.x),
            mix(scuffHash(i + vec2(0, 1)), scuffHash(i + 1.0), a.x), a.y);
        }
      #endif
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
      #ifdef TRI_SAKURA
        // Smooth gradients in gun space so the transition follows the hardware without a texture.
        float stock = sstep(0.194, 0.248, vTriPos.z) * sstep(-0.020, 0.025, vTriPos.y);
        float guard = sstep(-0.121, -0.199, vTriPos.z) * sstep(-0.327, -0.264, vTriPos.z);
        float grip = sstep(-0.031, -0.092, vTriPos.y) * sstep(-0.010, 0.016, vTriPos.z) * sstep(0.130, 0.088, vTriPos.z);
        float enamel = max(max(stock, guard * 0.94), grip);
        float ends = max(sstep(0.031, 0.191, vTriPos.z), sstep(-0.208, -0.324, vTriPos.z));
        float underside = sstep(-0.005, -0.058, vTriPos.y) * 0.32;
        float blackBlend = (1.0 - (1.0 - ends) * (1.0 - underside)) * (1.0 - enamel * 0.58);
        vec3 rose = mix(sakuraPink, sakuraPearl, sstep(-0.070, 0.044, vTriPos.y) * 0.42);
        vec2 wornUV = vTriPos.zy + vTriPos.x * vec2(0.37, 0.62);
        float scuffs = sstep(0.44, 0.75, scuffNoise(wornUV * vec2(55, 155))) *
          sstep(0.28, 0.76, scuffNoise(wornUV * vec2(29, 45) + 11.0));
        vec2 stroke = vec2(wornUV.x * 64.0, (wornUV.y + wornUV.x * 0.13) * 365.0);
        vec2 strokeCell = floor(stroke), strokeUV = fract(stroke);
        float strokeSeed = scuffHash(strokeCell);
        float scratch = sstep(0.135, 0.033, abs(strokeUV.y - (0.19 + strokeSeed * 0.62))) *
          sstep(0.46, 0.21, abs(strokeUV.x - 0.5)) * step(0.82, strokeSeed);
        scratch *= sstep(0.30, 0.70, scuffNoise(wornUV * vec2(43, 94)));
        float chips = 0.0;
        #ifdef TRI_HD
          chips = sstep(0.50, 0.71, vDet.g + scuffNoise(wornUV * 215.0) * 0.23) *
            sstep(0.38, 0.66, scuffNoise(wornUV * vec2(185, 265)));
        #endif
        float weathering = clamp(scuffs * 0.83 + scratch * 0.72 + chips * 0.70, 0.0, 1.0);
        vec3 finish = mix(mix(sakuraGold, rose, enamel), sakuraBlack, blackBlend);
        finish = mix(finish, finish * vec3(0.62, 0.46, 0.34), scuffs * 0.65);
        finish = mix(finish, vec3(0.48, 0.42, 0.34), scratch * 0.38 + chips * 0.56);
        diffuseColor.rgb = finish * triGain;
      #elif defined( TRI_ART )
        vec2 kuv = clamp(vec2((vTriPos.z - artRect.x) / (artRect.y - artRect.x), (vTriPos.y - artRect.z) / (artRect.w - artRect.z)), 0.002, 0.998);
        // The painting is a side view: faces turned away from the side (the nose, top edges, the
        // window's inner walls) take a soft local average instead of a smeared stripe.
        float kSide = sstep(0.35, 0.8, abs(normalize(vTriN).x));
        // Amber Reliquary: in the inspect the resin sloshes, the painting inside the amber swaying in waves
        float kAmberOn = artPhase < 0.0 ? 0.0 : step(5.5, artMode) * step(artMode, 6.5) * sstep(0.08, 0.2, artPhase) * (1.0 - sstep(0.85, 0.97, artPhase));
        if (kAmberOn > 0.0) {
          vec3 a0 = texture2D(artMap, kuv).rgb;
          float amb = sstep(0.25, 0.45, a0.r) * sstep(0.15, 0.3, a0.r - a0.b) * sstep(0.04, 0.12, a0.g);
          kuv += amb * kAmberOn * 0.006 * vec2(sin(kuv.y * 40.0 + triTime * 3.0 + 2.0 * sin(kuv.x * 18.0 - triTime * 2.2)), cos(kuv.x * 30.0 - triTime * 2.6));
        }
        vec3 kArt = mix(texture2D(artMap, kuv, 5.0).rgb, texture2D(artMap, kuv).rgb, kSide);
        // the second painting sweeps in from the muzzle to the stock as artMix rises (and back out as it falls)
        float kWipe = mix(artRect.x - 0.05, artRect.y + 0.05, artMix);
        if (artMix > 0.0) kArt = mix(kArt, mix(texture2D(artMap2, kuv, 5.0).rgb, texture2D(artMap2, kuv).rgb, kSide), sstep(0.015, -0.015, vTriPos.z - kWipe) * (artMixSide == 0.0 ? 1.0 : step(0.0, vTriPos.x * artMixSide)));
        float kLum = dot(kArt, vec3(0.3, 0.59, 0.11)), kSat = max(kArt.r, max(kArt.g, kArt.b)) - min(kArt.r, min(kArt.g, kArt.b));
        // grey in the painting = the silver-filled seams and the moon
        float kSilver = sstep(0.09, 0.035, kSat) * sstep(0.12, 0.3, kLum);
        float kBelow = 0.0;           // (the traced F2's grip and magazine are their own black parts)
        float kBronze = step(0.5, artMode) * step(artMode, 1.5), kStained = step(1.5, artMode) * step(artMode, 2.5) + step(5.5, artMode) * step(artMode, 6.5), kLacq = step(2.5, artMode) * step(artMode, 5.5) + step(6.5, artMode);
        float kGold = sstep(0.06, 0.18, kArt.r - kArt.b) * sstep(0.02, 0.08, kArt.g - kArt.b) * sstep(0.1, 0.3, kArt.g / max(kArt.r, 0.001)) * kLacq;   // lacquer: the gilt
        float kTeal = sstep(0.04, 0.14, kArt.g - kArt.r) * sstep(0.02, 0.09, kArt.b - kArt.r) * kBronze;   // bronze: the teal inlays
        float kGlass = sstep(0.06, 0.2, kSat) * kStained;                                                 // glass: the coloured panes
        float kCraze = (1.0 - kBronze - kStained - kLacq) * artCraze(vec2(vTriPos.z + vTriPos.x * 0.6, vTriPos.y) * 150.0) * (1.0 - kSilver) * sstep(0.35, 0.6, kLum);
        float kBrush = 0.85 + 0.3 * fract(sin(floor(vTriPos.y * 2600.0) * 91.7) * 4375.5);
        vec3 kGlaze = kArt * (1.0 - kCraze * 0.16);
        diffuseColor.rgb = mix(kGlaze, artDark * kBrush, kBelow) * triGain * (1.0 + 1.3 * step(0.5, artMode) * step(artMode, 1.5));   // the bronze is a dark painting: lifted so it reads
      #elif defined( TRI_SKIN )
        vec3 triP = vTriPos * triScale;     // fixed to the gun (it used to flow while inspecting)
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
      #ifdef TRI_SAKURA
        roughnessFactor = mix(mix(sakuraRM.x, sakuraRM.z, enamel), 0.51, weathering);
      #elif defined( TRI_ART )
        roughnessFactor = mix(mix(mix(mix(0.12, 0.2, kSilver), 0.34, kBelow), mix(0.42, 0.07, kTeal), kBronze), mix(0.45, 0.05, kGlass), kStained);
        roughnessFactor = mix(roughnessFactor, mix(0.14, 0.18, kGold), kLacq);
      #elif defined( TRI_SKIN )
        vec4 skrm = triTex(skinRM, triP, tw);
        roughnessFactor = mix(skrm.g, 0.3, triWear);
      #endif
      #ifdef TRI_DETAIL
        roughnessFactor = clamp(roughnessFactor * mix(1.0, dt.a * 2.0, detStrength), 0.04, 1.0);
      #endif
      #if defined( TRI_HD ) && !defined( TRI_SAKURA )
        roughnessFactor = mix(roughnessFactor, 0.32, hdWear);
        roughnessFactor = min(1.0, roughnessFactor + vDet.b * 0.15);
      #endif`);
    f = f.replace('#include <metalnessmap_fragment>', /* glsl */`#include <metalnessmap_fragment>
      #ifdef TRI_SAKURA
        metalnessFactor = mix(sakuraRM.y, sakuraRM.w, enamel);
      #elif defined( TRI_ART )
        metalnessFactor = mix(mix(mix(kSilver, 0.75, kBelow), 0.35 * (1.0 - kTeal), kBronze), 0.55 * (1.0 - kGlass), kStained);
        metalnessFactor = mix(metalnessFactor, mix(0.2, 0.92, kGold), kLacq);
      #elif defined( TRI_SKIN )
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
      #ifdef TRI_ART
        // porcelain: lightning strikes light the silver repair seams (artBlast: the flash, -9 when off)
        totalEmissiveRadiance += vec3(0.75, 0.86, 1.0) * kSilver * max(artBlast, 0.0) * (1.0 - step(0.5, artMode)) * 4.0;
        // bronze: the teal inlays glow faintly; while inspecting, caustics drift through them
        float kc = pow(0.5 + 0.5 * sin(vTriPos.z * 190.0 + triTime * 2.1 + 2.0 * sin(vTriPos.y * 160.0 - triTime * 1.6)), 6.0);
        float kRise = artPhase < 0.0 ? 0.0 : sin(clamp(artPhase, 0.0, 1.0) * 3.14159);
        totalEmissiveRadiance += vec3(0.08, 0.85, 0.72) * kTeal * (0.05 + kc * (0.12 + kRise * 1.1));
        // the blast of light the spinning shell sends down the barrel (artBlast: its z, -9 when off)
        totalEmissiveRadiance += vec3(0.25, 1.0, 0.85) * exp(-pow(vTriPos.z - artBlast, 2.0) * 900.0) * 3.5 * kBronze;
        // glass: the panes glow with their own colour; in the inspect a concentrated stained-glass
        // reflection slides along the receiver and breaks up as the angle changes
        float kSlide = artPhase < 0.0 ? 0.0 : exp(-pow(vTriPos.z - mix(-0.32, 0.26, sstep(0.25, 0.75, artPhase)) + vTriPos.y * 0.5, 2.0) * 140.0);
        totalEmissiveRadiance += (kArt * kGlass * (0.85 + kSlide * 3.4) + kArt * kSlide * (1.0 - kGlass) * 0.25 * kStained) * (1.0 - 0.6 * step(5.5, artMode));   // (amber: a softer glow)
        // Forgeheart: the molten seam always smoulders; in the inspect a heat front runs along it from
        // the handguard into the receiver, burns yellow at the peak and cools to deep red, and a dull
        // red glow creeps through the dark cracks between the plates.
        float kForge = step(3.5, artMode) * step(artMode, 4.5);
        // Velvet Ante: while the cards hold their ring the gun charges with their pink kinetic glow: the
        // gold edges light up in sequence muzzle to stock, the ivory cards glow, the whole gun pulses
        float kVel = step(6.5, artMode), kVelOn = artPhase < 0.0 ? 0.0 : sstep(0.55, 0.64, artPhase) * (1.0 - sstep(0.78, 0.86, artPhase));
        float kIvory = sstep(0.45, 0.65, kLum) * sstep(0.12, 0.04, kSat);
        float kSeq = sstep(-0.02, 0.02, mix(-0.25, 0.45, sstep(0.55, 0.68, artPhase)) - vTriPos.z);
        // ... and a gloss sweeps over it, stock to muzzle, as it comes up and again after the cards fall
        float kShine = artPhase < 0.0 ? 0.0 : exp(-pow(vTriPos.z - mix(0.45, -0.3, sstep(0.08, 0.36, artPhase)) + vTriPos.y * 0.6, 2.0) * 260.0) * (1.0 - sstep(0.36, 0.42, artPhase))
          + exp(-pow(vTriPos.z - mix(0.45, -0.3, sstep(0.84, 0.97, artPhase)) + vTriPos.y * 0.6, 2.0) * 260.0) * sstep(0.82, 0.86, artPhase);
        totalEmissiveRadiance += kVel * kShine * vec3(1.0, 0.92, 0.76) * (0.35 + 1.4 * kGold);
        totalEmissiveRadiance += kVel * kVelOn * vec3(1.0, 0.22, 0.7) * (0.7 + 0.3 * sin(triTime * 14.0)) * (kGold * 2.2 * kSeq + kIvory * 0.7 + 0.06);
        // the sloshing resin's surface: a bright meniscus line tilting back and forth through the amber
        float kAmb = kGlass * step(5.5, artMode);
        totalEmissiveRadiance += kAmberOn * kAmb * vec3(1.0, 0.78, 0.35) * 1.2 * exp(-pow((kuv.y - 0.66 - 0.06 * sin(triTime * 1.8) * (kuv.x - 0.45) * 4.0 - 0.012 * sin(kuv.x * 40.0 + triTime * 4.0)) * 70.0, 2.0));
        totalEmissiveRadiance += kForge * step(0.001, artMix) * step(artMix, 0.999) * vec3(1.0, 0.42, 0.05) * 2.0 * exp(-pow((vTriPos.z - kWipe) * 70.0, 2.0));   // the burning edge of the sweep
        // Midnight Orrery: while the portal is open the gold constellation lines light up, a starlight
        // sweep runs along them stock to barrel, the midnight blue takes a nebula sheen and stars twinkle in it
        float kOrr = step(4.5, artMode) * step(artMode, 5.5), kOrrOn = artPhase < 0.0 ? 0.0 : sstep(0.15, 0.3, artPhase) * (1.0 - sstep(0.85, 0.97, artPhase));
        float kStarSweep = exp(-pow(vTriPos.z - mix(0.35, -0.3, sstep(0.3, 0.8, artPhase)), 2.0) * 120.0);
        totalEmissiveRadiance += kOrr * kOrrOn * (vec3(1.0, 0.72, 0.32) * kGold * (0.35 + 1.8 * kStarSweep) + vec3(0.25, 0.3, 0.9) * kArt * sstep(0.0, 0.08, kArt.b - kArt.r) * 0.9);
        vec2 kCell = floor(vTriPos.zy * 320.0), kOff = fract(vTriPos.zy * 320.0) - 0.5;
        float kSeed = fract(sin(dot(kCell, vec2(127.1, 311.7))) * 43758.5453);
        totalEmissiveRadiance += kOrr * kOrrOn * vec3(0.85, 0.9, 1.0) * 2.5 * step(0.975, kSeed) * sstep(0.3, 0.0, length(kOff)) * (0.5 + 0.5 * sin(triTime * 5.0 + kSeed * 40.0)) * kSide;
        float kMolten = kForge * sstep(0.4, 0.75, kArt.r) * sstep(0.25, 0.5, kArt.r - kArt.b);
        float kHeat = artPhase < 0.0 ? 0.0 : sstep(0.0, 0.05, mix(-0.5, 0.2, sstep(0.08, 0.42, artPhase)) - vTriPos.z) * (1.0 - sstep(0.8, 0.97, artPhase));
        float kHot = artPhase < 0.0 ? 0.0 : sstep(0.42, 0.57, artPhase) * (1.0 - sstep(0.6, 0.86, artPhase));
        vec3 kFire = mix(vec3(0.75, 0.07, 0.01), vec3(1.0, 0.72, 0.22), kHot);
        totalEmissiveRadiance += kMolten * (vec3(1.0, 0.35, 0.05) * 0.5 + kFire * kHeat * (1.2 + 3.5 * kHot));
        vec3 kNearArt = texture2D(artMap, kuv, 4.0).rgb;                  // blurred: is the seam close by?
        float kNear = kForge * sstep(0.04, 0.16, kNearArt.r - kNearArt.b);
        totalEmissiveRadiance += vec3(0.45, 0.03, 0.0) * kNear * (1.0 - sstep(0.03, 0.1, kLum)) * kHeat * (0.15 + 0.35 * kHot);
      #endif
      #ifdef TRI_SKIN
        // Glowing lines; they pulse while inspecting.
        totalEmissiveRadiance += skinGlow * skrm.r * (1.0 - triWear) * (1.0 + triAnim * (0.9 + 0.9 * sin(triTime * 5.0)));
        totalEmissiveRadiance += sweepCol * sweep * (1.0 - triWear) * 0.6;
      #endif`);
    f = f.replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
      #ifdef TRI_ART
      {
        // Raised glaze where the painting is light (the cloud scrolls, wave foam); seams sunk in.
        vec2 e = vec2(1.0 / 2048.0, 1.0 / 512.0);
        float lx = dot(texture2D(artMap, kuv + vec2(e.x, 0.0)).rgb, vec3(0.3, 0.59, 0.11)) - kLum;
        float ly = dot(texture2D(artMap, kuv + vec2(0.0, e.y)).rgb, vec3(0.3, 0.59, 0.11)) - kLum;
        normal = normalize(normal - (vTriAZ * lx + vTriAY * ly) * 2.2 * kSide);
      }
      {
        // Storm Kiln: water ripples run over the glaze, rings spreading from three points and a swell
        // along the gun; faint at rest, strong in the inspect (the light rolls over them in 3D)
        if (artMode < 0.5) {
          float rAmp = artPhase < 0.0 ? 0.28 : 0.28 + 2.4 * sstep(0.08, 0.22, artPhase) * (1.0 - sstep(0.85, 0.97, artPhase));
          rAmp *= 1.0 + 1.8 * sstep(-0.05, -0.4, vTriPos.z);          // strongest along the front end
          vec2 rp = vTriPos.zy, rg = vec2(0.0); float rh = 0.0;
          for (int i = 0; i < 3; i++) {
            vec2 c = vec2(-0.3 + 0.25 * float(i), 0.03 - 0.025 * float(i)), v = rp - c;
            float d = length(v) + 1e-4;
            rg += cos(170.0 * d - triTime * 5.0 - float(i) * 2.0) * v / d * exp(-d * 5.0);
            rh += sin(170.0 * d - triTime * 5.0 - float(i) * 2.0) * exp(-d * 5.0);
          }
          rg.x += 0.6 * cos(rp.x * 110.0 + rp.y * 40.0 + triTime * 3.2);
          rh += 0.6 * sin(rp.x * 110.0 + rp.y * 40.0 + triTime * 3.2);
          normal = normalize(normal - (vTriAZ * rg.x + vTriAY * rg.y) * rAmp * kSide);
          diffuseColor.rgb *= 1.0 + 0.08 * rAmp * rh * kSide;          // crests catch light, troughs fall into shade
        }
      }
      #endif
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
