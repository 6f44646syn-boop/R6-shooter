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
//   Max graphics (o.max, with scene.userData.maxEnv = { sun: DirectionalLight, fog: Color, wet }):
//      bloom (bright parts, quarter resolution, two-pass blur), sun shafts (a radial march
//      towards the sun over the sky in the depth, half resolution), floor reflections
//      (screen-space: rays marched through the depth from upward-facing surfaces, stronger
//      when wet), distance and height fog, then colour grading and a vignette in the resolve.
// The weapon is drawn afterwards straight to the screen, so it never smears or blurs.
import * as THREE from '../../vendor/three/three.module.min.js?v=99c5c3a-mwcr7mqy';

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
uniform sampler2D tBloom, tShaft, tSSR; uniform float maxOn, fogK, wet; uniform vec3 fogCol, sunCol;
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
  if (maxOn > 0.5) {
    vec4 r = texture2D(tSSR, uv);
    c = mix(c, r.rgb * mix(1.0, 0.8, wet), clamp(r.a, 0.0, 0.85));
    // fog: thicker with distance, thinner with height; the sky keeps its own colour
    float zr = texture2D(tDepth, uv).x;
    if (zr < 0.99999) {
      vec4 wp = invVP * vec4(uv * 2.0 - 1.0, zr * 2.0 - 1.0, 1.0); wp /= wp.w;
      float d = linDepth(uv), f = (1.0 - exp(-d * fogK)) * exp(-max(wp.y, 0.0) * 0.12);
      c = mix(c, fogCol, clamp(f, 0.0, 0.85));
    }
    c += texture2D(tBloom, uv).rgb * 0.55 + sunCol * texture2D(tShaft, uv).r;
  }
  if (display > 0.5) {
    c = aces > 0.5 ? aces3(c) : clamp(c * exposure, 0.0, 1.0);
    if (maxOn > 0.5) {
      // grading: a little more colour and contrast, warm highlights, cool shadows, a vignette
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.1);
      c += vec3(0.025, 0.008, -0.02) * smoothstep(0.45, 1.0, l) + vec3(-0.012, 0.0, 0.02) * (1.0 - smoothstep(0.0, 0.4, l));
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      c *= 1.0 - 0.3 * pow(clamp(length(uv - 0.5) * 1.3, 0.0, 1.0), 2.4);
      c = clamp(c, 0.0, 1.0);
    }
    c = toSRGB(c);
  }
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

const BRIGHT = /* glsl */`
uniform sampler2D tScene; uniform vec2 px; varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) c += texture2D(tScene, vUv + vec2(float(x), float(y)) * px).rgb;
  c /= 9.0;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * max(l - 0.85, 0.0) / max(l, 1e-4), 1.0);
}`;
const GAUSS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 dir; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270;
  c += (texture2D(tSrc, vUv + dir * 1.3846).rgb + texture2D(tSrc, vUv - dir * 1.3846).rgb) * 0.3162;
  c += (texture2D(tSrc, vUv + dir * 3.2308).rgb + texture2D(tSrc, vUv - dir * 3.2308).rgb) * 0.0703;
  gl_FragColor = vec4(c, 1.0);
}`;
const SHAFTS = /* glsl */`
uniform sampler2D tDepth; uniform vec2 sunUV; uniform float sunOn; varying vec2 vUv;
void main() {
  vec2 d = (sunUV - vUv) / 48.0;
  vec2 uv = vUv; float acc = 0.0, w = 1.0;
  for (int i = 0; i < 48; i++) { uv += d; acc += step(0.99999, texture2D(tDepth, clamp(uv, 0.001, 0.999)).x) * w; w *= 0.965; }
  float near = 1.0 - smoothstep(0.0, 1.1, length((vUv - sunUV) * vec2(1.6, 1.0)));
  gl_FragColor = vec4(vec3(acc / 20.0 * sunOn * near), 1.0);
}`;
const SSR = DEPTH + /* glsl */`
uniform sampler2D tScene; uniform mat4 invVP, VP; uniform vec3 camPos; uniform vec2 res; uniform float wet;
varying vec2 vUv;
vec3 wpos(vec2 uv) { float z = texture2D(tDepth, uv).x; vec4 p = invVP * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
void main() {
  gl_FragColor = vec4(0.0);
  if (texture2D(tDepth, vUv).x >= 0.99999) return;
  vec2 px = 2.0 / res;
  vec3 P = wpos(vUv), N = normalize(cross(wpos(vUv + vec2(px.x, 0.0)) - P, wpos(vUv + vec2(0.0, px.y)) - P));
  if (dot(N, camPos - P) < 0.0) N = -N;
  if (N.y < 0.9) return;                                      // floors, tables, puddles
  vec3 V = normalize(P - camPos), R = reflect(V, N), Q = P + N * 0.02;
  float st = 0.12;
  for (int i = 0; i < 32; i++) {
    Q += R * st; st *= 1.11;
    vec4 c = VP * vec4(Q, 1.0);
    if (c.w <= 0.0) break;
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (any(lessThan(suv, vec2(0.0))) || any(greaterThan(suv, vec2(1.0)))) break;
    float sceneZ = linDepth(suv), rayZ = c.w;
    if (rayZ > sceneZ && rayZ - sceneZ < 0.5 + st) {
      vec2 e = smoothstep(0.0, 0.12, suv) * smoothstep(1.0, 0.88, suv);
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
      gl_FragColor = vec4(texture2D(tScene, suv).rgb, e.x * e.y * mix(0.35, 1.0, wet) * fres * (1.0 - float(i) / 32.0));
      return;
    }
  }
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
    const R0 = this.resMat.uniforms;
    Object.assign(R0, { tBloom: { value: null }, tShaft: { value: null }, tSSR: { value: null }, maxOn: { value: 0 }, fogK: { value: 0.006 }, wet: { value: 0 }, fogCol: { value: new THREE.Color() }, sunCol: { value: new THREE.Color() } });
    this.brightMat = mk(BRIGHT, { tScene: { value: null }, px: { value: new THREE.Vector2() } });
    this.gaussMat = mk(GAUSS, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    this.shaftMat = mk(SHAFTS, { tDepth: this.depthU.tDepth, sunUV: { value: new THREE.Vector2() }, sunOn: { value: 0 } });
    this.ssrMat = mk(SSR, { ...this.depthU, tScene: { value: null }, invVP: { value: new THREE.Matrix4() }, VP: { value: new THREE.Matrix4() }, camPos: { value: new THREE.Vector3() }, res: { value: new THREE.Vector2() }, wet: { value: 0 } });
    this.outMat = mk(OUTPUT, { tSrc: { value: null }, srcRes: { value: new THREE.Vector2() }, sharpen: { value: 0 }, fxaaOn: { value: 1 } });
    this.rt = null; this.n = 0;
    this.prevVP = new THREE.Matrix4(); this.vp = new THREE.Matrix4(); this.prevKey = '';
    this._v4 = new THREE.Vector4();
  }
  // o: { ao, taa, sharpen (0..1), scale (world resolution / output, for upscaling), max }
  set(o) { Object.assign(this.o, o); }
  get active() { return !!this.on; }

  _targets(w, h) {
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    for (const t of [this.rt, this.ao1, this.ao2, this.h0, this.h1, this.b1, this.b2, this.s1, this.r1]) if (t) t.dispose();
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType) });
    this.rt.depthTexture.minFilter = this.rt.depthTexture.magFilter = THREE.NearestFilter;
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), o8 = { type: THREE.UnsignedByteType, depthBuffer: false };
    this.ao1 = new THREE.WebGLRenderTarget(hw, hh, o8);
    this.ao2 = new THREE.WebGLRenderTarget(hw, hh, o8);
    this.h0 = new THREE.WebGLRenderTarget(w, h, o8);
    this.h1 = new THREE.WebGLRenderTarget(w, h, o8);
    const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2), hf = { type: THREE.HalfFloatType, depthBuffer: false };
    this.b1 = new THREE.WebGLRenderTarget(qw, qh, hf); this.b2 = new THREE.WebGLRenderTarget(qw, qh, hf);
    this.s1 = new THREE.WebGLRenderTarget(hw, hh, o8); this.r1 = new THREE.WebGLRenderTarget(hw, hh, hf);
    this.histOk = false;
  }
  // Max graphics: bloom, sun shafts and floor reflections into their targets; fog and colours
  // for the resolve.
  _max(env, camera, w, h) {
    const R = this.resMat.uniforms, tv = this._tv || (this._tv = new THREE.Vector3());
    this.brightMat.uniforms.tScene.value = this.rt.texture; this.brightMat.uniforms.px.value.set(1 / w, 1 / h);
    this._pass(this.brightMat, this.b1);
    for (let k = 0; k < 2; k++) {
      const G = this.gaussMat.uniforms;
      G.tSrc.value = this.b1.texture; G.dir.value.set((1 + k) / this.b1.width, 0); this._pass(this.gaussMat, this.b2);
      G.tSrc.value = this.b2.texture; G.dir.value.set(0, (1 + k) / this.b1.height); this._pass(this.gaussMat, this.b1);
    }
    const S = this.shaftMat.uniforms, sun = env.sun;
    let on = 0;
    if (sun) {
      tv.copy(sun.position).sub(sun.target.position).normalize().multiplyScalar(500).add(camera.position).project(camera);
      const front = tv.z < 1;
      S.sunUV.value.set(tv.x * 0.5 + 0.5, tv.y * 0.5 + 0.5);
      on = front ? Math.min(1, sun.intensity / 2) : 0;
      R.sunCol.value.copy(sun.color).multiplyScalar(0.55 * on);
    }
    S.sunOn.value = on;
    if (on > 0) this._pass(this.shaftMat, this.s1);
    else { this.r.setRenderTarget(this.s1); this.r.clear(); }
    const Q = this.ssrMat.uniforms;
    Q.tScene.value = this.rt.texture; Q.invVP.value.copy(this.vp).invert(); Q.VP.value.copy(this.vp); Q.camPos.value.copy(camera.getWorldPosition(tv)); Q.res.value.set(w, h); Q.wet.value = env.wet || 0;
    this._pass(this.ssrMat, this.r1);
    R.tBloom.value = this.b1.texture; R.tShaft.value = this.s1.texture; R.tSSR.value = this.r1.texture;
    R.fogCol.value.copy(env.fog || new THREE.Color(0x9fb4c8)); R.fogK.value = env.fogK ?? 0.006; R.wet.value = env.wet || 0;
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
    const R = this.resMat.uniforms, env = o.max && scene.userData.maxEnv;
    R.maxOn.value = env ? 1 : 0;
    if (env) this._max(env, camera, w, h);
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
