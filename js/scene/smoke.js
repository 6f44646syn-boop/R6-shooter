// Moving smoke (Max graphics): each column is a loop of soft puffs that rise, spread, drift with the
// wind and fade. Everything moves in the vertex shader, so a frame only sets the time.
import * as THREE from '../../vendor/three/three.module.min.js?v=e94e41c-mwu5yowd';

let puffTex = null;
function puff() {                               // a soft round puff, lighter in the middle
  if (puffTex) return puffTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(c);
  return puffTex;
}

// columns: [[x, z, big], ...] (fires on the ground). Returns a THREE.Points; call .userData.tick(t).
export function smokeColumns(columns, { perColumn = 34, wind = [0.55, -0.3] } = {}) {
  const n = columns.length * perColumn, pos = new Float32Array(n * 3), seed = new Float32Array(n * 2);
  let k = 0;
  for (const [x, z, big, y0 = 0] of columns) for (let i = 0; i < perColumn; i++, k++) {
    pos.set([x, y0 + (big ? 1.6 : 1.2), z], k * 3);
    seed.set([i / perColumn + Math.random() * 0.03, big ? 1.4 : 1], k * 2);   // (phase spread evenly; size)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uT: { value: 0 }, uMap: { value: puff() }, uWind: { value: new THREE.Vector2(...wind) }, uScale: { value: 1700 } },
    vertexShader: `
      attribute vec2 aSeed; uniform float uT; uniform vec2 uWind; uniform float uScale; varying float vA; varying float vDark;
      void main() {
        float life = 7.0, age = fract(uT / life + aSeed.x);            // 0 at the fire, 1 when gone
        float h = age * 9.0 * aSeed.y, s = aSeed.x * 43.7;
        vec3 p = position + vec3(uWind.x * h * 0.7 + sin(s + uT * 0.7) * 1.3 * age, h, uWind.y * h * 0.7 + cos(s * 1.3 + uT * 0.6) * 1.3 * age);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (0.5 + age * 2.2) * aSeed.y / -mv.z;
        vA = smoothstep(0.0, 0.08, age) * (1.0 - age) * 0.9;
        vDark = 1.0 - age;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; varying float vA; varying float vDark;
      void main() {
        vec4 c = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(mix(vec3(0.11, 0.11, 0.115), vec3(0.012, 0.012, 0.014), vDark)   /* (linear: dark grey when old, near black at the fire) */, c.a * vA);
      }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.userData.tick = (t) => { mat.uniforms.uT.value = t; };
  return points;
}

// Wind (Max): shared time and strength; materials patched by swayed() bend in it.
export const windU = { uWT: { value: 0 }, uWA: { value: 0 } };
const swayCache = new Map();
// A copy of material whose instances lean and wave in the wind, more the higher up (amount: metres at the top).
export function swayed(material, amount = 0.15) {
  const key = material.uuid + '|' + amount;
  if (swayCache.has(key)) return swayCache.get(key);
  const m = material.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWT = windU.uWT; sh.uniforms.uWA = windU.uWA;
    sh.vertexShader = 'uniform float uWT; uniform float uWA;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17, up = max(0.0, position.y + 0.5);
        float wv = uWA * ${amount.toFixed(3)} * up * (sin(uWT * 1.7 + ph) * 0.7 + sin(uWT * 3.1 + ph * 1.9) * 0.3 + 0.35);
        transformed.x += wv; transformed.z += wv * 0.45;
      #endif`);
  };
  m.customProgramCacheKey = () => 'sway' + amount;
  swayCache.set(key, m);
  return m;
}

// Dust motes floating round the viewer, and flocks of birds circling over the map (Max).
export function airLife(hx, hz) {
  const group = new THREE.Group();
  const N = 700, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) pos.set([Math.random() * 40, Math.random() * 12, Math.random() * 40], i * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uT: windU.uWT, uC: { value: new THREE.Vector3() }, uMap: { value: puff() } },
    vertexShader: `uniform float uT; uniform vec3 uC; varying float vA;
      void main() {
        vec3 p = position + vec3(uT * 0.35, sin(uT * 0.3 + position.x) * 0.4, uT * 0.12);
        p = mod(p - uC + vec3(20.0, 2.0, 20.0), vec3(40.0, 12.0, 40.0)) + uC - vec3(20.0, 2.0, 20.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = 26.0 / -mv.z; vA = clamp(1.0 - (-mv.z) / 22.0, 0.0, 1.0) * 0.55;
      }`,
    fragmentShader: `uniform sampler2D uMap; varying float vA;
      void main() { gl_FragColor = vec4(vec3(0.85, 0.8, 0.7), texture2D(uMap, gl_PointCoord).a * vA); }`,
  }));
  dust.frustumCulled = false;
  const wing = new THREE.BufferGeometry();                         // a bird: two thin wings in a shallow V
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, -0.55, 0.12, -0.05, 0, 0, -0.12, 0, 0, 0.12, 0.55, 0.12, -0.05, 0, 0, -0.12], 3));
  wing.computeVertexNormals();
  const B = 30, birds = new THREE.InstancedMesh(wing, new THREE.MeshBasicMaterial({ color: 0x1d1d22, side: THREE.DoubleSide }), B);
  birds.frustumCulled = false;
  const flock = Array.from({ length: B }, (_, i) => ({ f: i % 3, r: 18 + (i % 7) * 2.5, ph: i * 0.7, h: 26 + (i % 5) * 1.6 }));
  const centres = [[-hx * 0.4, -hz * 0.3], [hx * 0.35, hz * 0.2], [0, hz * 0.45]], M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3(), E = new THREE.Euler();
  group.add(dust, birds);
  group.userData.tick = (t, dt, cam) => {
    if (cam) dust.material.uniforms.uC.value.copy(cam);
    flock.forEach((b, i) => {
      const [cx, cz] = centres[b.f], a = t * 0.18 + b.ph, flap = Math.sin(t * 9 + i) * 0.5;
      P.set(cx + Math.cos(a) * b.r, b.h + Math.sin(t * 0.5 + i) * 0.6, cz + Math.sin(a) * b.r);
      Q.setFromEuler(E.set(0, -a, flap * 0.6));
      birds.setMatrixAt(i, M.compose(P, Q, S.set(1.4, 1 + flap, 1.4)));
    });
    birds.instanceMatrix.needsUpdate = true;
  };
  return group;
}
