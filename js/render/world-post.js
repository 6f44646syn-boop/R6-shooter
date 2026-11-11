// World post-processing (Range, Battle and the match modes share it): the world is drawn
// into an off-screen image with its depth, then
//   1. ambient occlusion (High / Ultra): screen-space, at half resolution from the depth
//      (normals rebuilt from depth, 12 spiral samples, rotated per pixel), then a two-pass
//      depth-aware blur so it stays clean without smearing over edges;
//   2. resolve: occlusion applied, ACES tone mapping and sRGB when drawing to the screen;
//      temporal anti-aliasing (optional): the camera is jittered by a sub-pixel Halton
//      offset each frame, the last frame is reprojected through the depth, and its colour is
//      clamped to this frame's neighbourhood (no ghost trails behind moving players);
//   3. output: upscaled to the screen (when the world is drawn at a lower resolution, e.g.
//      dynamic resolution) with contrast-adaptive sharpening, plus FXAA when TAA is off.
// The weapon is drawn afterwards straight to the screen, so it never smears or blurs.
import * as THREE from '../../vendor/three/three.module.min.js?v=6ac6c85-mwblm6td';

const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const DEPTH = /* glsl */`
uniform sampler2D tDepth; uniform float near, far;
float linDepth(vec2 uv) { float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }`;

const AO = DEPTH + /* glsl */`
uniform vec2 res, tanHalf; uniform float radius, intensity, bias; uniform float frame;
varying vec2 vUv;
vec3 viewPos(vec2 uv) { float z = linDepth(uv); return vec3((uv * 2.0 - 1.0) * tanHalf * z, -z); }
void main() {
  float z = linDepth(vUv);
  if (z > far * 0.98) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  vec2 px = 1.0 / res;
  // Normal from the closer neighbour on each axis (no halos at depth edges).
  vec3 l = viewPos(vUv - vec2(px.x, 0.0)), r = viewPos(vUv + vec2(px.x, 0.0));
  vec3 d = viewPos(vUv - vec2(0.0, px.y)), u = viewPos(vUv + vec2(0.0, px.y));
  vec3 dx = abs(r.z - P.z) < abs(P.z - l.z) ? r - P : P - l;
  vec3 dy = abs(u.z - P.z) < abs(P.z - d.z) ? u - P : P - d;
  vec3 N = normalize(cross(dx, dy));
  float rs = radius / (z * tanHalf.y * 2.0);                 // radius in screen units (0..1 of height)
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float ang = ign * 6.2831853 + frame * 1.7;
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float t = (float(i) + 0.5) / 12.0;
    float a = ang + float(i) * 2.399963;
    vec2 o = vec2(cos(a), sin(a) * res.x / res.y) * rs * t * res.y / res.x;
    vec3 S = viewPos(vUv + o) - P;
    float dd = dot(S, S);
    float k = max(0.0, dot(S, N) - bias * z) / (dd + 0.01 * radius * radius);
    occ += k * clamp(1.0 - dd / (radius * radius * 4.0), 0.0, 1.0);
  }
  gl_FragColor = vec4(vec3(clamp(1.0 - intensity * occ / 12.0 * radius, 0.0, 1.0)), 1.0);
}`;

const BLUR = DEPTH + /* glsl */`
uniform sampler2D tAO; uniform vec2 dir;
varying vec2 vUv;
void main() {
  float z0 = linDepth(vUv), s = 0.0, w = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + dir * float(i);
    float wd = exp(-abs(linDepth(uv) - z0) / (0.02 * z0 + 0.02)) * (1.0 - abs(float(i)) / 4.5);
    s += texture2D(tAO, uv).r * wd; w += wd;
  }
  gl_FragColor = vec4(vec3(s / max(w, 1e-4)), 1.0);
}`;

const RESOLVE = DEPTH + /* glsl */`
uniform sampler2D tScene, tAO, tHist;
uniform vec2 res, jitter;
uniform float aoOn, aoMin, display, exposure, aces, taaOn, histOk, feedback, showAO;
uniform mat4 invVP, prevVP;
varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces3(vec3 c) {      // three.js ACES filmic (same look as the screen path)
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= exposure / 0.6;
  c = IN * c; c = RRTAndODTFit(c); c = OUT * c;
  return clamp(c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(0.0031308, c)); }
vec3 look(vec2 uv) {
  vec3 c = texture2D(tScene, uv).rgb;
  if (aoOn > 0.5) c *= max(aoMin, texture2D(tAO, uv).r);
  if (display > 0.5) { c = aces > 0.5 ? aces3(c) : clamp(c * exposure, 0.0, 1.0); c = toSRGB(c); }
  return c;
}
vec3 rgb2ycocg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 ycocg2rgb(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
void main() {
  vec2 uv = vUv;
  if (showAO > 0.5) { gl_FragColor = vec4(vec3(texture2D(tAO, uv).r), 1.0); return; }
  vec3 c = look(uv);
  if (taaOn < 0.5) { gl_FragColor = vec4(c, 1.0); return; }
  // Neighbourhood box (YCoCg) of this frame.
  vec2 px = 1.0 / res;
  vec3 mn = rgb2ycocg(c), mx = mn, cc = mn;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    if (x == 0 && y == 0) continue;
    vec3 s = rgb2ycocg(look(uv + vec2(float(x), float(y)) * px));
    mn = min(mn, s); mx = max(mx, s);
  }
  // Where this pixel was last frame (through its depth; the world does not move).
  float zr = texture2D(tDepth, uv).x;
  vec4 wp = invVP * vec4(uv * 2.0 - 1.0, zr * 2.0 - 1.0, 1.0);
  wp /= wp.w;
  vec4 pc = prevVP * wp;
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (histOk < 0.5 || any(lessThan(puv, vec2(0.0))) || any(greaterThan(puv, vec2(1.0)))) { gl_FragColor = vec4(c, 1.0); return; }
  vec3 h = clamp(rgb2ycocg(texture2D(tHist, puv).rgb), mn, mx);
  // Less history when the pixel moved a lot (fast turns), so it stays sharp.
  float motion = length((puv - uv) * res);
  float fb = mix(feedback, 0.6, clamp(motion / 24.0, 0.0, 1.0));
  gl_FragColor = vec4(ycocg2rgb(mix(cc, h, fb)), 1.0);
}`;

const OUTPUT = /* glsl */`
uniform sampler2D tSrc; uniform vec2 srcRes; uniform float sharpen, fxaaOn;
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 fxaa(vec2 uv, vec2 px) {
  vec3 nw = texture2D(tSrc, uv + vec2(-1.0, -1.0) * px).rgb, ne = texture2D(tSrc, uv + vec2(1.0, -1.0) * px).rgb;
  vec3 sw = texture2D(tSrc, uv + vec2(-1.0, 1.0) * px).rgb, se = texture2D(tSrc, uv + vec2(1.0, 1.0) * px).rgb;
  vec3 m = texture2D(tSrc, uv).rgb;
  float lnw = luma(nw), lne = luma(ne), lsw = luma(sw), lse = luma(se), lm = luma(m);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  if (lmax - lmin < max(0.0312, lmax * 0.125)) return m;
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), ((lnw + lsw) - (lne + lse)));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), vec2(-8.0), vec2(8.0)) * px;
  vec3 a = 0.5 * (texture2D(tSrc, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tSrc, uv - dir * 0.5).rgb + texture2D(tSrc, uv + dir * 0.5).rgb);
  float lb = luma(b);
  return (lb < lmin || lb > lmax) ? a : b;
}
void main() {
  vec2 px = 1.0 / srcRes;
  vec3 c = fxaaOn > 0.5 ? fxaa(vUv, px) : texture2D(tSrc, vUv).rgb;
  if (sharpen > 0.0) {
    // Contrast-adaptive sharpening: less where the neighbourhood already has contrast.
    vec3 n = texture2D(tSrc, vUv + vec2(0.0, px.y)).rgb, s = texture2D(tSrc, vUv - vec2(0.0, px.y)).rgb;
    vec3 e = texture2D(tSrc, vUv + vec2(px.x, 0.0)).rgb, w = texture2D(tSrc, vUv - vec2(px.x, 0.0)).rgb;
    vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
    vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
    vec3 wgt = -amp * mix(0.125, 0.2, sharpen);
    c = clamp((c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt), 0.0, 1.0);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const HALTON = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export class WorldPost {
  constructor(renderer) {
    this.r = renderer;
    this.o = { ao: false, taa: false, sharpen: 0, scale: 1 };
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(tri);
    this.quad.frustumCulled = false;
    this.qs = new THREE.Scene(); this.qs.add(this.quad);
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    this.depthU = { tDepth: { value: null }, near: { value: 0.05 }, far: { value: 100 } };
    this.aoMat = mk(AO, { ...this.depthU, res: { value: new THREE.Vector2() }, tanHalf: { value: new THREE.Vector2() }, radius: { value: 0.6 }, intensity: { value: 3.2 }, bias: { value: 0.015 }, frame: { value: 0 } });
    this.blurMat = mk(BLUR, { ...this.depthU, tAO: { value: null }, dir: { value: new THREE.Vector2() } });
    this.resMat = mk(RESOLVE, {
      ...this.depthU, tScene: { value: null }, tAO: { value: null }, tHist: { value: null }, res: { value: new THREE.Vector2() }, jitter: { value: new THREE.Vector2() },
      aoOn: { value: 0 }, aoMin: { value: 0.3 }, showAO: { value: 0 }, display: { value: 1 }, exposure: { value: 1 }, aces: { value: 0 }, taaOn: { value: 0 }, histOk: { value: 0 }, feedback: { value: 0.9 },
      invVP: { value: new THREE.Matrix4() }, prevVP: { value: new THREE.Matrix4() },
    });
    this.outMat = mk(OUTPUT, { tSrc: { value: null }, srcRes: { value: new THREE.Vector2() }, sharpen: { value: 0 }, fxaaOn: { value: 1 } });
    this.rt = null; this.n = 0;
    this.prevVP = new THREE.Matrix4(); this.vp = new THREE.Matrix4(); this.prevKey = '';
    this._v4 = new THREE.Vector4();
  }
  // o: { ao, taa, sharpen (0..1), scale (world resolution / output, for upscaling) }
  set(o) { Object.assign(this.o, o); }
  get active() { return !!this.on; }

  _targets(w, h) {
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    for (const t of [this.rt, this.ao1, this.ao2, this.h0, this.h1]) if (t) t.dispose();
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType) });
    this.rt.depthTexture.minFilter = this.rt.depthTexture.magFilter = THREE.NearestFilter;
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), o8 = { type: THREE.UnsignedByteType, depthBuffer: false };
    this.ao1 = new THREE.WebGLRenderTarget(hw, hh, o8);
    this.ao2 = new THREE.WebGLRenderTarget(hw, hh, o8);
    this.h0 = new THREE.WebGLRenderTarget(w, h, o8);
    this.h1 = new THREE.WebGLRenderTarget(w, h, o8);
    this.histOk = false;
  }
  _pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.qs, this.cam); }

  // Draw scene through camera into target (null: the screen, in the current viewport).
  // display: tone map and encode for the screen (false: linear, for a later pass).
  draw(scene, camera, target = null, display = target === null) {
    const r = this.r, o = this.o;
    const vp = target ? this._v4.set(0, 0, target.width, target.height) : r.getCurrentViewport(this._v4);
    const ow = Math.max(1, vp.z | 0), oh = Math.max(1, vp.w | 0);
    const w = Math.max(1, Math.round(ow * Math.min(1, o.scale))), h = Math.max(1, Math.round(oh * Math.min(1, o.scale)));
    this._targets(w, h);
    const prevTarget = r.getRenderTarget(), scissor = r.getScissorTest();
    // Camera jitter for TAA (restored right after drawing).
    const pm = camera.projectionMatrix, saved8 = pm.elements[8], saved9 = pm.elements[9];
    this.n++;
    const key = camera.uuid + w + 'x' + h + (display ? 1 : 0);
    if (key !== this.prevKey) { this.histOk = false; this.prevKey = key; }
    camera.updateMatrixWorld();
    this.vp.multiplyMatrices(pm, camera.matrixWorldInverse);
    if (o.taa) {
      const k = (this.n % 8) + 1;
      const jx = (HALTON(k, 2) - 0.5) * 2 / w, jy = (HALTON(k, 3) - 0.5) * 2 / h;
      pm.elements[8] += jx; pm.elements[9] += jy;
      camera.projectionMatrixInverse.copy(pm).invert();
    }
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, camera);
    if (o.taa) { pm.elements[8] = saved8; pm.elements[9] = saved9; camera.projectionMatrixInverse.copy(pm).invert(); }
    this.depthU.tDepth.value = this.rt.depthTexture;
    this.depthU.near.value = camera.near; this.depthU.far.value = camera.far;
    if (o.ao) {
      const U = this.aoMat.uniforms;
      U.res.value.set(this.ao1.width, this.ao1.height);
      const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      U.tanHalf.value.set(ty * camera.aspect, ty);
      U.frame.value = o.taa ? this.n % 8 : 0;
      this._pass(this.aoMat, this.ao1);
      this.blurMat.uniforms.tAO.value = this.ao1.texture; this.blurMat.uniforms.dir.value.set(1.5 / this.ao1.width, 0);
      this._pass(this.blurMat, this.ao2);
      this.blurMat.uniforms.tAO.value = this.ao2.texture; this.blurMat.uniforms.dir.value.set(0, 1.5 / this.ao1.height);
      this._pass(this.blurMat, this.ao1);
    }
    const R = this.resMat.uniforms;
    R.tScene.value = this.rt.texture; R.tAO.value = this.ao1.texture; R.aoOn.value = o.ao ? 1 : 0;
    R.res.value.set(w, h); R.display.value = display ? 1 : 0;
    R.exposure.value = r.toneMapping === THREE.NoToneMapping ? 1 : r.toneMappingExposure;
    R.aces.value = r.toneMapping === THREE.ACESFilmicToneMapping ? 1 : 0;
    R.taaOn.value = o.taa ? 1 : 0;
    R.showAO.value = this.showAO && o.ao ? 1 : 0;      // debug: the occlusion alone
    const out = this.n % 2 ? this.h0 : this.h1, hist = this.n % 2 ? this.h1 : this.h0;
    R.tHist.value = hist.texture; R.histOk.value = this.histOk && o.taa ? 1 : 0;
    R.invVP.value.copy(this.vp).invert(); R.prevVP.value.copy(this.prevVP);
    this._pass(this.resMat, out);
    this.prevVP.copy(this.vp);
    this.histOk = !!o.taa;
    const OU = this.outMat.uniforms;
    OU.tSrc.value = out.texture; OU.srcRes.value.set(w, h);
    OU.sharpen.value = o.sharpen; OU.fxaaOn.value = o.taa ? 0 : 1;
    this.quad.material = this.outMat;
    r.setRenderTarget(target || prevTarget);
    r.setScissorTest(scissor);
    r.render(this.qs, this.cam);
  }
}
