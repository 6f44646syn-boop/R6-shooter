// Rain for the match maps that build their own scene (Bomb): streaks falling round the viewer, kept out of
// the buildings (roofs: rectangles [x0, z0, x1, z1] where no rain falls below `under` metres). Moves in the
// vertex shader; a frame sets the time and the viewer's position.
import * as THREE from '../../vendor/three/three.module.min.js?v=53a8f5f-mwpr23xg';

// heavy: a storm (more, longer, slanted streaks). roofs: up to 6 rectangles.
export function rainFx({ heavy = false, roofs = [], under = 6 } = {}) {
  const N = heavy ? 5200 : 3400, len = heavy ? 0.9 : 0.6, pos = new Float32Array(N * 6), seed = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = Math.random() * 40, y = Math.random() * 22, z = Math.random() * 40, s = Math.random();
    pos.set([x, y, z, x, y - len, z], i * 6);
    seed.set([s, s], i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const R = new Float32Array(24);
  roofs.slice(0, 6).forEach((r, k) => R.set(r, k * 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uT: { value: 0 }, uC: { value: new THREE.Vector3() }, uRoof: { value: R }, uN: { value: Math.min(6, roofs.length) }, uUnder: { value: under }, uSlant: { value: heavy ? 0.35 : 0.08 } },
    vertexShader: `
      attribute float aSeed; uniform float uT, uUnder, uSlant, uN; uniform vec3 uC; uniform float uRoof[24]; varying float vA;
      void main() {
        vec3 p = position; float fall = uT * (13.0 + aSeed * 4.0);
        p.y = mod(p.y - fall, 22.0); p.x += p.y * uSlant;
        p.xz = mod(p.xz - uC.xz + 20.0, 40.0) + uC.xz - 20.0; p.y += uC.y - 8.0;
        vA = 0.34;
        for (int k = 0; k < 6; k++) { if (float(k) >= uN) break;
          if (p.x > uRoof[k * 4] && p.x < uRoof[k * 4 + 2] && p.z > uRoof[k * 4 + 1] && p.z < uRoof[k * 4 + 3] && p.y < uUnder) vA = 0.0; }
        if (p.y < 0.0) vA = 0.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `varying float vA; void main() { if (vA <= 0.0) discard; gl_FragColor = vec4(0.72, 0.76, 0.82, vA); }`,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.userData.tick = (t, cam) => { mat.uniforms.uT.value = t; if (cam) mat.uniforms.uC.value.copy(cam); };
  return lines;
}

// "auto" weather turns in a rotation from one match to the next (clear, rain, clear, storm); snow maps stay
// snowy, indoor maps clear. The turn is kept on this PC between visits.
const ROTATION = ['clear', 'rain', 'clear', 'storm'];
export function nextWeather(map) {
  if (map?.indoor) return 'clear';
  if (map?.snow) return 'snow';
  if (/[?&]test\b/.test(globalThis.location?.search || '')) return 'clear';   // (test runs: the map's own weather, so checks repeat)
  let k = 0;
  try { k = (Number(localStorage.getItem('recoilRange.weatherTurn')) || 0) % ROTATION.length; localStorage.setItem('recoilRange.weatherTurn', String(k + 1)); } catch (e) { k = Math.floor(Math.random() * ROTATION.length); }
  return ROTATION[k];
}
