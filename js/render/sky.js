// The match maps' sky and the lighting palette that comes from it. The sky is drawn first and
// everything else takes its colours from it: the sun (a warm, low key light, never white), the
// hemisphere fill (cool sky above, warm bounce below, so shadows are slate blue, not grey), the
// fog and the background (the horizon's colour, so far things melt into the sky).
//   skyPalette(preset) -> { dir, sun, sunI, zenith, horizon, ground, fog, hemiSky, hemiGround }
//   makeSky(palette) -> a dome (radius 150) with scattering, the sun's disc and glow, and
//   drifting clouds lit from the sun's side; sky.userData.tick(t) moves the clouds.
import * as THREE from '../../vendor/three/three.module.min.js?v=c833319-mwdf0xz1';

// Golden hour by default; each map can pick its own (look.js L.time).
const PRESETS = {
  golden: { elev: 16, azim: -38, sun: 0xffc27a, sunI: 3.1, zenith: 0x3d6db5, horizon: 0xf2c79a, ground: 0x6b5a4a, hemiSky: 0x7f9fd6, hemiGround: 0x6a5240, fog: 0xd9b996 },
  morning: { elev: 24, azim: 40, sun: 0xffd9a8, sunI: 3.0, zenith: 0x4a7fcc, horizon: 0xd8e2ea, ground: 0x6a6258, hemiSky: 0x8fb1e2, hemiGround: 0x6a5a48, fog: 0xc6d2dc },
  dusk: { elev: 9, azim: -60, sun: 0xffa064, sunI: 2.8, zenith: 0x34509a, horizon: 0xf0a070, ground: 0x5a4a48, hemiSky: 0x8a8fc8, hemiGround: 0x6a5040, fog: 0xc89078 },
};
export function skyPalette(name = 'golden') {
  const p = PRESETS[name] || PRESETS.golden, e = THREE.MathUtils.degToRad(p.elev), a = THREE.MathUtils.degToRad(p.azim);
  const C = (h) => new THREE.Color(h);
  return { dir: new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).normalize(), sun: C(p.sun), sunI: p.sunI,
    zenith: C(p.zenith), horizon: C(p.horizon), ground: C(p.ground), fog: C(p.fog), hemiSky: C(p.hemiSky), hemiGround: C(p.hemiGround) };
}

const FRAG = /* glsl */`
uniform vec3 sunDir, sunCol, zenith, horizon, ground; uniform float time;
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  vec3 v = normalize(vDir);
  float h = v.y, mu = max(dot(v, sunDir), 0.0);
  // scattering: a deep zenith, a bright warm horizon, brighter still towards the sun
  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.42));
  col = mix(col, horizon * 1.08 + sunCol * 0.08, pow(mu, 3.0) * 0.55 * (1.0 - clamp(h, 0.0, 1.0)));
  col += sunCol * (pow(mu, 12.0) * 0.35 + pow(mu, 180.0) * 1.2);
  // below the horizon: haze over the ground
  col = mix(col, mix(horizon, ground, clamp(-h * 3.0, 0.0, 1.0)), step(h, 0.0));
  // clouds on a plane above: drifting, thinning at the horizon, lit on the sun's side
  if (h > 0.0) {
    vec2 uv = v.xz / (h + 0.08) * 0.9 + vec2(time * 0.006, time * 0.002);
    float n = fbm(uv * 1.6), d = fbm(uv * 1.6 + sunDir.xz * 0.05);
    float cov = smoothstep(0.48, 0.78, n) * smoothstep(0.0, 0.18, h);
    vec3 lit = mix(horizon * 0.9 + vec3(0.06), sunCol * 1.15, clamp((n - d) * 6.0 + 0.4, 0.0, 1.0));
    vec3 base = mix(zenith, ground, 0.35) * 0.9 + horizon * 0.25;
    vec3 cc = mix(base, lit, smoothstep(0.5, 0.85, n));
    cc += sunCol * pow(mu, 8.0) * 0.6 * (1.0 - smoothstep(0.55, 0.9, n));   // silver lining towards the sun
    col = mix(col, cc, cov * 0.92);
  }
  // the sun's disc (bright enough to bloom)
  col += sunCol * smoothstep(0.99955, 0.9998, mu) * 8.0;
  gl_FragColor = vec4(col, 1.0);
}`;
const VERT = /* glsl */`varying vec3 vDir; void main() { vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;

export function makeSky(pal) {
  const u = { sunDir: { value: pal.dir.clone() }, sunCol: { value: pal.sun.clone() }, zenith: { value: pal.zenith.clone() }, horizon: { value: pal.horizon.clone() }, ground: { value: pal.ground.clone() }, time: { value: 0 } };
  const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 24), m);
  dome.renderOrder = -1; dome.frustumCulled = false;
  // centred on whichever camera draws it, so it never reaches past the far plane
  dome.onBeforeRender = (r, sc, cam) => { dome.position.copy(cam.position); dome.updateMatrixWorld(); };
  dome.userData.tick = (t) => { u.time.value = t; };
  dome.userData.sky = true;
  return dome;
}
