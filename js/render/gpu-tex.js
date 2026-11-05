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
import * as THREE from '../../vendor/three/three.module.min.js';

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
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { texel: { value: 1 / size }, ...uniforms },
  });
  quad.mesh.material = mat;
  const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
  renderer.autoClear = true;
  renderer.setRenderTarget(rt);
  renderer.render(quad.scene, quad.cam);
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAuto;
  mat.dispose();
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

// Ten original finishes, one per loadout slot. name: shown in the HUD in ultra.
// clearcoat: lacquer layer on top (carbon, anodised). wear: how much bare metal shows at edges.
export const SKINS = [
  { name: 'Contour Crimson', clearcoat: 0.6, wear: 0.6 },
  { name: 'Arctic Digital', clearcoat: 0, wear: 0.8 },
  { name: 'Deep Woodland', clearcoat: 0, wear: 0.7 },
  { name: 'Night Tiger', clearcoat: 0.2, wear: 0.6 },
  { name: 'Desert Veteran', clearcoat: 0, wear: 1.4 },
  { name: 'Teal Hexcore', clearcoat: 0.5, wear: 0.5 },
  { name: 'Damascus', clearcoat: 0.8, wear: 0.2 },
  { name: 'Dry Ridge', clearcoat: 0, wear: 0.9 },
  { name: 'Carbon Weave', clearcoat: 1.0, wear: 0.3 },
  { name: 'Concrete Splinter', clearcoat: 0, wear: 0.8 },
];

// Each skin: col(uv) -> rgb, rm(uv) -> vec2(roughness, metalness).
const SKIN_GLSL = /* glsl */`
uniform int skin;
void skinAt(vec2 uv, out vec3 col, out vec2 rm) {
  float grain = fbm(uv, 128.0, 3) * 0.06;
  if (skin == 0) {           // Contour Crimson: topographic lines on black anodising
    float h = fbm(uv, 3.0, 6);
    float t = fract(h * 14.0);
    float line = sstep(0.07, 0.02, 0.5 - abs(t - 0.5));                      // thin contour lines
    float major = sstep(0.035, 0.01, 0.5 - abs(fract(h * 14.0 / 5.0) - 0.5)); // every fifth, bolder
    col = mix(vec3(0.03, 0.03, 0.035), vec3(0.62, 0.05, 0.06), max(line * 0.8, major));
    rm = vec2(mix(0.32, 0.25, line), 0.85);
  } else if (skin == 1) {    // Arctic Digital: pixel camo
    vec2 q = (floor(uv * 72.0) + 0.5) / 72.0;
    float n = fbm(q, 4.0, 4) + 0.35 * fbm(q + 5.0, 9.0, 3);
    col = n > 0.12 ? vec3(0.30, 0.36, 0.43) : (n > -0.08 ? vec3(0.60, 0.63, 0.67) : vec3(0.86, 0.88, 0.9));
    rm = vec2(0.62, 0.08);
  } else if (skin == 2) {    // Deep Woodland: four-colour blobs
    float a = fbm(uv, 3.0, 6), b = fbm(uv + 7.3, 4.0, 6), c = fbm(uv + 2.1, 6.0, 5);
    col = vec3(0.50, 0.46, 0.33);
    col = mix(col, vec3(0.22, 0.29, 0.17), sstep(-0.02, 0.02, a));
    col = mix(col, vec3(0.32, 0.22, 0.14), sstep(0.08, 0.12, b));
    col = mix(col, vec3(0.06, 0.06, 0.05), sstep(0.2, 0.24, c));
    rm = vec2(0.7, 0.05);
  } else if (skin == 3) {    // Night Tiger: warped stripes
    float w = fbm(uv, 4.0, 5) * 1.6;
    float s = sin(6.2831853 * (uv.x * 7.0 + w));
    float stripe = sstep(0.35, 0.45, s + fbm(uv + 3.0, 8.0, 4) * 0.8);
    col = mix(vec3(0.26, 0.27, 0.24), vec3(0.035, 0.035, 0.04), stripe);
    col = mix(col, vec3(0.13, 0.13, 0.14), sstep(0.5, 0.6, fbm(uv + 9.0, 5.0, 4) + 0.4) * (1.0 - stripe));
    rm = vec2(0.5, 0.3);
  } else if (skin == 4) {    // Desert Veteran: flat dark earth cerakote, heavily worn
    vec3 fde = vec3(0.46, 0.37, 0.26) * (1.0 + fbm(uv, 6.0, 5) * 0.25);
    float worn = sstep(0.26, 0.3, fbm(uv + 1.7, 5.0, 7));
    float scr = sstep(0.015, 0.0, abs(pnoise(vec2(uv.x * 260.0, uv.y * 7.0), vec2(260.0, 7.0)))) * step(0.1, fbm(uv, 4.0, 3));
    float bare = max(worn, scr);
    col = mix(fde, vec3(0.3, 0.3, 0.32), bare);
    rm = vec2(mix(0.62, 0.28, bare), mix(0.15, 1.0, bare));
  } else if (skin == 5) {    // Teal Hexcore: hex cells, dark carbon and teal
    vec2 q = vec2(uv.x * 16.0, uv.y * 18.0);
    float row = floor(q.y);
    float best = 9.0, second = 9.0, id = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      float r = row + float(j);
      vec2 c = vec2(floor(q.x) + float(i) + 0.5 + 0.5 * mod(r, 2.0), r + 0.5);
      vec2 d = (q - c) * vec2(1.0, 0.866);
      float dist = max(abs(d.x) * 0.866 + abs(d.y) * 0.5, abs(d.y));
      if (dist < best) { second = best; best = dist; id = hash1(mod(c, vec2(16.0, 18.0))); } else if (dist < second) second = dist;
    }
    float edge = sstep(0.035, 0.0, second - best);
    vec3 cell = id < 0.55 ? vec3(0.05, 0.055, 0.06) : (id < 0.85 ? vec3(0.04, 0.16, 0.17) : vec3(0.08, 0.30, 0.31));
    col = mix(cell, vec3(0.2, 0.55, 0.55), edge * 0.7);
    rm = vec2(mix(0.38, 0.25, edge), 0.45);
  } else if (skin == 6) {    // Damascus: folded steel bands
    float w = fbm(uv, 2.0, 5) * 0.9 + fbm(uv + 4.0, 6.0, 4) * 0.25;
    float v = sin(6.2831853 * (uv.y * 22.0 + uv.x * 3.0 + w * 6.0));
    float b = sstep(-0.35, 0.35, v);
    col = mix(vec3(0.16, 0.165, 0.18), vec3(0.66, 0.67, 0.69), b);
    rm = vec2(mix(0.4, 0.2, b), 1.0);
  } else if (skin == 7) {    // Dry Ridge: soft multi-terrain blotches
    float a = fbm(uv, 3.0, 6), b = fbm(uv + 4.4, 5.0, 6), sp = fbm(uv + 8.8, 24.0, 4);
    col = vec3(0.64, 0.57, 0.44);
    col = mix(col, vec3(0.43, 0.43, 0.30), sstep(0.02, 0.09, a));
    col = mix(col, vec3(0.47, 0.34, 0.22), sstep(0.14, 0.2, b));
    col = mix(col, vec3(0.28, 0.21, 0.14), sstep(0.22, 0.26, sp));
    rm = vec2(0.72, 0.05);
  } else if (skin == 8) {    // Carbon Weave: 2x2 twill, lacquered
    vec2 q = uv * 48.0;
    vec2 c = floor(q), f = fract(q);
    float dir = mod(c.x + c.y, 2.0);
    float fib = dir > 0.5 ? f.x : f.y;
    float tow = 0.5 + 0.5 * cos(6.2831853 * fib);
    float sheen = dir > 0.5 ? 0.9 : 0.55;
    col = vec3(0.025) + vec3(0.06, 0.062, 0.068) * tow * sheen;
    rm = vec2(0.32, 0.0);
  } else {                   // Concrete Splinter: angular cells in greys and steel blue
    vec2 wq = uv + vec2(fbm(uv, 4.0, 4), fbm(uv + 2.0, 4.0, 4)) * 0.05;
    vec3 v = voronoi(wq, vec2(9.0, 5.0));
    col = v.z < 0.3 ? vec3(0.58, 0.59, 0.6) : (v.z < 0.55 ? vec3(0.34, 0.35, 0.37) : (v.z < 0.8 ? vec3(0.13, 0.135, 0.145) : vec3(0.22, 0.29, 0.38)));
    col *= 1.0 - sstep(0.03, 0.0, v.y - v.x) * 0.5;
    rm = vec2(0.58, 0.12);
  }
  col *= 1.0 + grain;
}
`;

export function bakeSkin(renderer, index, size = 4096) {
  const head = NOISE + SKIN_GLSL;
  const albedo = bake(renderer, head + /* glsl */`
    void main() {
      vec3 col; vec2 rm; skinAt(vUv, col, rm);
      float wearNoise = 0.5 + fbm(vUv + 11.0, 24.0, 6);      // ragged edge-wear threshold
      gl_FragColor = vec4(sqrt(clamp(col, 0.0, 1.0)), clamp(wearNoise, 0.0, 1.0));   // sqrt-encoded: finer steps in dark finishes
    }`, size, { skin: { value: index } });
  const rm = bake(renderer, head + /* glsl */`
    void main() { vec3 col; vec2 rm; skinAt(vUv, col, rm); gl_FragColor = vec4(0.0, rm.x, rm.y, 1.0); }`,
  Math.max(256, size >> 1), { skin: { value: index } });
  return { albedo, rm, ...SKINS[index % SKINS.length] };
}

/* ---------- triplanar shader patch ---------- */

// Patches a MeshStandardMaterial / MeshPhysicalMaterial:
//   skin: { albedo, rm, wear } replaces the base colour, roughness and metalness, mapped by
//         object-space position (scale: tiles per metre); edges of each part's UV square
//         wear through to bare metal (box parts map 0..1 per face).
//   detail: packed micro-detail (bakeDetail), detailScale tiles per metre, detailStrength.
export function triplanar(material, { skin = null, detail = null, scale = 3, detailScale = 2, detailStrength = 1 } = {}) {
  const uniforms = {
    triScale: { value: scale }, detScale: { value: detailScale }, detStrength: { value: detailStrength },
    skinAlbedo: { value: skin ? skin.albedo : null }, skinRM: { value: skin ? skin.rm : null },
    skinWear: { value: skin ? skin.wear : 0 }, detailMap: { value: detail },
  };
  material.userData.tri = uniforms;
  const defs = (skin ? '#define TRI_SKIN\n' : '') + (detail ? '#define TRI_DETAIL\n' : '');
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = defs + 'varying vec3 vTriPos; varying vec3 vTriN; varying vec3 vTriAX; varying vec3 vTriAY; varying vec3 vTriAZ;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vTriPos = position; vTriN = normal;
        vTriAX = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vTriAY = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vTriAZ = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);`);
    const head = defs + /* glsl */`
      varying vec3 vTriPos; varying vec3 vTriN; varying vec3 vTriAX; varying vec3 vTriAY; varying vec3 vTriAZ;
      uniform float triScale, detScale, detStrength, skinWear;
      uniform sampler2D skinAlbedo, skinRM, detailMap;
      vec3 triW() { vec3 w = pow(abs(normalize(vTriN)), vec3(4.0)); return w / (w.x + w.y + w.z); }
      float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
      vec4 triTex(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }
    `;
    let f = head + sh.fragmentShader;
    f = f.replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
      vec3 tw = triW();
      float triWear = 0.0;
      #ifdef TRI_SKIN
        vec4 sk = triTex(skinAlbedo, vTriPos * triScale, tw);
        #if defined( USE_NORMALMAP ) || defined( USE_MAP )
          #ifdef USE_NORMALMAP
            vec2 wuv = fract(vNormalMapUv);
          #else
            vec2 wuv = fract(vMapUv);
          #endif
          float ed = min(min(wuv.x, 1.0 - wuv.x), min(wuv.y, 1.0 - wuv.y));
          triWear = sstep(0.035 * skinWear, 0.0, ed - (sk.a - 0.5) * 0.03 * skinWear) * step(0.001, skinWear);
        #endif
        diffuseColor.rgb = mix(sk.rgb * sk.rgb, vec3(0.36, 0.36, 0.38), triWear);   // bare steel
      #endif
      #ifdef TRI_DETAIL
        vec4 dt = triTex(detailMap, vTriPos * detScale, tw);
        diffuseColor.rgb *= mix(1.0, dt.b * 2.0, detStrength);
      #endif`);
    f = f.replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
      #ifdef TRI_SKIN
        vec4 skrm = triTex(skinRM, vTriPos * triScale, tw);
        roughnessFactor = mix(skrm.g, 0.3, triWear);
      #endif
      #ifdef TRI_DETAIL
        roughnessFactor = clamp(roughnessFactor * mix(1.0, dt.a * 2.0, detStrength), 0.04, 1.0);
      #endif`);
    f = f.replace('#include <metalnessmap_fragment>', /* glsl */`#include <metalnessmap_fragment>
      #ifdef TRI_SKIN
        metalnessFactor = mix(skrm.b, 1.0, triWear);
      #endif`);
    f = f.replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
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
  material.customProgramCacheKey = () => 'tri' + defs;
  material.needsUpdate = true;
  return material;
}
