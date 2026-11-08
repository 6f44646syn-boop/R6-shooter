// Rendering: world camera, then the weapon (its own scene and fixed-FOV camera) on top.
//
// Hip-fire: both draw straight to the screen. No post pass.
// Aiming:   both draw into one render target (the scene is still drawn once), then
//           - a half-resolution blur (downsample + two separable passes), unless quality < 3
//           - one full-screen composite: blur mask (outside a magnified lens, or the rails under
//             a 1x window), darkening and vignette, barrel distortion and colour fringing at the
//             lens rim (at most 1.5 px), coating tint, a glare streak that drifts with the view,
//             muzzle-flash light, and the reticle (emissive, additive) fixed at screen centre.
// Quality levels (auto-stepped down by main.js when frames are slow):
//   3 everything, 2 no blur, 1 no blur or fringing, 0 no blur, fringing or glare.
// Levels 1 and 0 take the FAST PATH: no off-screen image at all. The scene is drawn straight
// to the screen as in hip-fire, then one light full-screen pass is blended on top
// (result = effect + screen x darkening), which needs no texture reads of the scene. Only
// blur, fringing and distortion need the scene as a texture, so only levels 3 and 2 pay for it.
import * as THREE from '../../vendor/three/three.module.min.js?v=d55b29e-mw7pek9y';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COPY = /* glsl */`
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }`;

// 9-tap Gaussian folded into 5 bilinear taps.
const BLUR = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + dir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE = /* glsl */`
uniform sampler2D tScene, tBlur, tRet, tEtch;
uniform vec2 res, lensC, lensHalf, glareOff, gunBand, retC;
uniform float lensCorner, lensRound, mag, strength, blurOn, caOn, glareOn, flash, retHalf, retOn;
uniform vec3 tint;
varying vec2 vUv;

// Signed distance to the lens window in pixels (negative inside).
float sdLens(vec2 p) {
  vec2 q = p - lensC;
  if (lensRound > 0.5) {
    float k = lensHalf.y / max(lensHalf.x, 1.0);
    return length(vec2(q.x * k, q.y)) - lensHalf.y;
  }
  vec2 d = abs(q) - lensHalf + lensCorner;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - lensCorner;
}

void main() {
  vec2 p = vUv * res;
  vec2 px = 1.0 / res;
  float sd = sdLens(p);
  // Magnified lenses get a wide soft edge (no hard circle); 1x windows a crisp one.
  float soft = mag > 0.5 ? 0.03 * res.y : 0.003 * res.y;
  float inside = 1.0 - smoothstep(-soft, soft * 0.5, sd);
  float rn = clamp(1.0 + sd / max(min(lensHalf.x, lensHalf.y), 1.0), 0.0, 2.0); // 0 centre, 1 rim
  vec2 dir = normalize(p - lensC + vec2(1e-4));
  float rim = smoothstep(0.7, 1.0, rn) * inside * strength;

  // Barrel distortion and colour fringing near the rim (<= 1.5 px).
  vec2 uv = vUv - dir * rim * 1.2 * px;
  vec3 col;
  if (caOn > 0.5) {
    float ca = 1.5 * rim;
    col.r = texture2D(tScene, uv + dir * ca * px).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv - dir * ca * px).b;
  } else {
    col = texture2D(tScene, uv).rgb;
  }

  // Out of focus: everything outside a magnified lens; the rails/gun under a 1x window.
  float bm;
  if (mag > 0.5) {
    bm = 1.0 - inside;
  } else {
    float bottom = lensC.y - lensHalf.y;
    float below = 1.0 - smoothstep(bottom - 0.06 * res.y, bottom - 0.01 * res.y, p.y);
    float band = 1.0 - smoothstep(gunBand.x * 0.9, gunBand.x * 1.4, abs(p.x - lensC.x));
    bm = below * band * 0.9;
  }
  bm *= strength;
  if (blurOn > 0.5) col = mix(col, texture2D(tBlur, vUv).rgb, bm);

  if (mag > 0.5) {
    col *= 1.0 - 0.72 * (1.0 - inside) * strength;                   // darken outside the lens
    col *= 1.0 - 0.45 * smoothstep(0.78, 1.0, rn) * inside * strength; // edge darkening inside
    col = mix(col, col * tint, inside * strength);                     // coating tint
  } else {
    vec2 c = vUv - 0.5;
    col *= 1.0 - 0.3 * dot(c, c) * strength;                           // mild vignette
  }

  // High graphics: the scene was drawn linear into the target; tone map it here, as a
  // direct-to-screen draw would have, before the glass effects are added.
  #ifdef TONE_MAPPING
  col = toneMapping(col);
  #endif
  // Glare streak across the glass, drifting with the view.
  if (glareOn > 0.5) {
    vec2 q = p - lensC - glareOff;
    float d = dot(q, normalize(vec2(1.0, -1.0))) / (0.05 * res.y);
    col += vec3(0.85, 0.92, 1.0) * exp(-d * d) * inside * strength * (mag > 0.5 ? 0.045 : 0.025);
  }
  // Muzzle flash lighting the lens.
  col += vec3(1.0, 0.7, 0.4) * flash * inside * (mag > 0.5 ? 0.16 : 0.09);

  // Reticle: fixed at the screen centre, only seen through the glass.
  // Fixed at retC (the exact screen centre). Seen only through the glass once the sight is
  // in place; before that (start of the raise) it shows on its own so it is there from frame one.
  vec2 r = (p - retC) / (2.0 * retHalf) + 0.5;
  if (retOn > 0.0 && r.x > 0.0 && r.x < 1.0 && r.y > 0.0 && r.y < 1.0) {
    float m = mix(1.0, inside, strength);
    col *= 1.0 - texture2D(tEtch, r).a * m * retOn;
    col += texture2D(tRet, r).rgb * m * retOn * 1.4;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// Fast path: lens look as a blend on top of the already-drawn screen.
// gl_FragColor.rgb is added, gl_FragColor.a multiplies what is on screen.
const OVERLAY = /* glsl */`
uniform sampler2D tRet, tEtch;
uniform vec2 res, lensC, lensHalf, glareOff, retC;
uniform float lensCorner, lensRound, mag, strength, glareOn, flash, retHalf, retOn;
varying vec2 vUv;
float sdLens(vec2 p) {
  vec2 q = p - lensC;
  if (lensRound > 0.5) {
    float k = lensHalf.y / max(lensHalf.x, 1.0);
    return length(vec2(q.x * k, q.y)) - lensHalf.y;
  }
  vec2 d = abs(q) - lensHalf + lensCorner;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - lensCorner;
}
void main() {
  vec2 p = vUv * res;
  float sd = sdLens(p);
  float soft = mag > 0.5 ? 0.03 * res.y : 0.003 * res.y;
  float inside = 1.0 - smoothstep(-soft, soft * 0.5, sd);
  float rn = clamp(1.0 + sd / max(min(lensHalf.x, lensHalf.y), 1.0), 0.0, 2.0);
  float mul = 1.0;
  vec3 add = vec3(0.0);
  if (mag > 0.5) {
    mul *= 1.0 - 0.72 * (1.0 - inside) * strength;
    mul *= 1.0 - 0.45 * smoothstep(0.78, 1.0, rn) * inside * strength;
  } else {
    vec2 c = vUv - 0.5;
    mul *= 1.0 - 0.3 * dot(c, c) * strength;
  }
  if (glareOn > 0.5) {
    vec2 q = p - lensC - glareOff;
    float d = dot(q, normalize(vec2(1.0, -1.0))) / (0.05 * res.y);
    add += vec3(0.85, 0.92, 1.0) * exp(-d * d) * inside * strength * (mag > 0.5 ? 0.045 : 0.025);
  }
  add += vec3(1.0, 0.7, 0.4) * flash * inside * (mag > 0.5 ? 0.16 : 0.09);
  vec2 r = (p - retC) / (2.0 * retHalf) + 0.5;
  if (retOn > 0.0 && r.x > 0.0 && r.x < 1.0 && r.y > 0.0 && r.y < 1.0) {
    float m = mix(1.0, inside, strength);
    mul *= 1.0 - texture2D(tEtch, r).a * m * retOn;
    add += texture2D(tRet, r).rgb * m * retOn * 1.4;
  }
  gl_FragColor = vec4(add, mul);
  #include <colorspace_fragment>
}`;

export class LensPost {
  constructor(renderer, { samples = 0 } = {}) {
    this.renderer = renderer;
    // 8-bit targets: a multisampled half-float target measured 2x slower, and memory
    // bandwidth is what integrated GPUs run out of first. (sRGB-encoded targets would avoid
    // slight banding in very dark areas and are free on real GPUs, but could not be measured
    // here: the software renderer used for tests emulates them slowly.)
    const opts = { type: THREE.UnsignedByteType };
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { ...opts, samples });
    this.halfA = new THREE.WebGLRenderTarget(1, 1, { ...opts, depthBuffer: false });
    this.halfB = new THREE.WebGLRenderTarget(1, 1, { ...opts, depthBuffer: false });
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.copyMat = mk(COPY, { tSrc: { value: null } });
    this.blurMat = mk(BLUR, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    blank.needsUpdate = true;
    this.u = {
      tScene: { value: this.sceneRT.texture }, tBlur: { value: this.halfA.texture },
      tRet: { value: blank }, tEtch: { value: blank },
      res: { value: new THREE.Vector2(1, 1) }, lensC: { value: new THREE.Vector2() }, lensHalf: { value: new THREE.Vector2(1, 1) },
      glareOff: { value: new THREE.Vector2() }, gunBand: { value: new THREE.Vector2(1, 0) },
      lensCorner: { value: 0 }, lensRound: { value: 1 }, mag: { value: 0 }, strength: { value: 0 },
      blurOn: { value: 1 }, caOn: { value: 1 }, glareOn: { value: 1 }, flash: { value: 0 },
      retHalf: { value: 100 }, retOn: { value: 0 }, retC: { value: new THREE.Vector2() }, tint: { value: new THREE.Color(1, 1, 1) },
    };
    this.compMat = mk(COMPOSITE, this.u);
    this.overlayMat = mk(OVERLAY, this.u);
    this.overlayMat.transparent = true;
    this.overlayMat.toneMapped = false;   // blended on top of an already tone-mapped screen
    this.overlayMat.blending = THREE.CustomBlending;
    this.overlayMat.blendEquation = THREE.AddEquation;
    this.overlayMat.blendSrc = THREE.OneFactor;        // + effect
    this.overlayMat.blendDst = THREE.SrcAlphaFactor;   // + screen x darkening
    this.overlayMat.blendSrcAlpha = THREE.ZeroFactor;
    this.overlayMat.blendDstAlpha = THREE.OneFactor;
    this.quad = new THREE.Mesh(tri, this.copyMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.w = this.h = 1;
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.sceneRT.setSize(w, h);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    this.halfA.setSize(hw, hh);
    this.halfB.setSize(hw, hh);
    this.u.res.value.set(w, h);
  }

  _uniforms(p) {
    const u = this.u;
    u.caOn.value = p.quality >= 2 ? 1 : 0;
    u.glareOn.value = p.quality >= 1 ? 1 : 0;
    u.lensC.value.set(p.cx, p.cy);
    u.lensHalf.value.set(p.hw, p.hh);
    u.lensCorner.value = p.corner;
    u.lensRound.value = p.round ? 1 : 0;
    u.mag.value = p.mag ? 1 : 0;
    u.strength.value = p.strength;
    u.glareOff.value.set(p.glareX, p.glareY);
    u.gunBand.value.set(p.gunHalfW, 0);
    u.flash.value = p.flash;
    u.tint.value.setRGB(p.tint[0], p.tint[1], p.tint[2]);
    u.tRet.value = p.ret.texture;
    u.tEtch.value = p.ret.etch;
    u.retHalf.value = p.retHalf;
    u.retOn.value = p.retOn;
    u.retC.value.set(p.retX, p.retY);
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.cam);
  }

  // Draw world + weapon, with or without the lens pass. p: lens parameters (see main.js).
  render(world, worldCam, vm, vmCam, p) {
    const r = this.renderer;
    r.autoClear = false;
    if (!p) {
      r.setRenderTarget(null);
      r.clear();
      r.render(world, worldCam);
      if (vm) { r.clearDepth(); r.render(vm, vmCam); }
      return;
    }
    if (p.quality <= 1) {
      // Fast path: draw the scene straight to the screen, then blend the lens look on top.
      r.setRenderTarget(null);
      r.clear();
      r.render(world, worldCam);
      if (vm) { r.clearDepth(); r.render(vm, vmCam); }
      this._uniforms(p);
      this._pass(this.overlayMat, null);
      return;
    }
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(world, worldCam);
    if (vm) { r.clearDepth(); r.render(vm, vmCam); }
    const u = this.u;
    const blur = p.quality >= 3;
    if (blur) {
      this.copyMat.uniforms.tSrc.value = this.sceneRT.texture;
      this._pass(this.copyMat, this.halfA);
      this.blurMat.uniforms.tSrc.value = this.halfA.texture;
      this.blurMat.uniforms.dir.value.set(1.6 / this.halfA.width, 0);
      this._pass(this.blurMat, this.halfB);
      this.blurMat.uniforms.tSrc.value = this.halfB.texture;
      this.blurMat.uniforms.dir.value.set(0, 1.6 / this.halfA.height);
      this._pass(this.blurMat, this.halfA);
    }
    u.blurOn.value = blur ? 1 : 0;
    this._uniforms(p);
    this._pass(this.compMat, null);
  }
}
