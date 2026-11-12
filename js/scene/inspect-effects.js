import * as THREE from '../../vendor/three/three.module.min.js?v=1e8153e-mwd9o8rz';
import { mulberry32 } from '../core/prng.js?v=1e8153e-mwd9o8rz';
import { mergeStatic } from './sight-model.js?v=1e8153e-mwd9o8rz';

const FROST_SECONDS = 4.35, FROST_PEAK = 0.59;
// The Legendaries' inspects run twice as long as an ordinary one (8.4 s).
const SAKURA_SECONDS = 8.4, SAKURA_PEAK = 0.54;
const KILN_SECONDS = 8.4, KILN_PEAK = 0.57;
const ABYSS_SECONDS = 8.4, ABYSS_PEAK = 0.57;
const VESPER_SECONDS = 8.4, VESPER_PEAK = 0.57;
const smooth = THREE.MathUtils.smoothstep;

const ICE_CLIP = { root: [
  [0, 0, 0, 0, 0, 0, 0],
  [0.18, -0.076, 0.084, -0.095, 0.16, 0.62, -0.08],
  [0.37, -0.088, 0.101, -0.134, 0.12, 0.96, -0.20],
  [0.59, -0.094, 0.108, -0.151, 0.15, 1.12, -0.075],
  [0.75, -0.078, 0.088, -0.108, 0.21, 0.75, 0.09],
  [1, 0, 0, 0, 0, 0, 0],
] };

const SAKURA_CLIP = { root: [
  [0, 0, 0, 0, 0, 0, 0],
  [0.20, -0.078, 0.084, -0.087, 0.11, 0.75, 0.17],
  [0.39, -0.089, 0.097, -0.124, 0.14, 1.07, 0.05],
  [0.59, -0.092, 0.105, -0.144, 0.16, 1.17, -0.085],
  [0.76, -0.073, 0.083, -0.101, 0.15, 0.77, -0.17],
  [1, 0, 0, 0, 0, 0, 0],
] };

// Storm Kiln: tilt the side panel into the light, hold while the waves lift and the crest rolls.
const KILN_CLIP = { root: [
  [0, 0, 0, 0, 0, 0, 0],
  [0.19, -0.074, 0.08, -0.09, 0.13, 0.82, 0.12],
  [0.40, -0.086, 0.094, -0.122, 0.17, 1.10, 0.02],
  [0.60, -0.09, 0.1, -0.14, 0.12, 1.16, -0.07],
  [0.78, -0.07, 0.08, -0.098, 0.13, 0.74, -0.14],
  [1, 0, 0, 0, 0, 0, 0],
] };

// Abyssal Crown: roll the receiver towards you so the depth dial faces the camera.
const ABYSS_CLIP = { root: [
  [0, 0, 0, 0, 0, 0, 0],
  [0.2, -0.07, 0.085, -0.1, 0.1, 0.9, 0.3],
  [0.42, -0.082, 0.098, -0.13, 0.12, 1.12, 0.42],
  [0.62, -0.085, 0.1, -0.14, 0.1, 1.15, 0.36],
  [0.8, -0.066, 0.078, -0.096, 0.1, 0.7, 0.12],
  [1, 0, 0, 0, 0, 0, 0],
] };

const frostProxy = new THREE.MeshBasicMaterial();

// Capture the gun, magazine and optic shells before hands and moving parts are added.
// The resulting meshes draw only during the inspect, and reuse the real attachment shapes.
export function prepareFrost(gun, mag, optic) {
  const bounds = new THREE.Box3().setFromObject(gun);
  const surfaces = [];
  const inverse = new THREE.Matrix4();
  for (const group of [gun, mag, optic]) {
    group.updateMatrixWorld(true);
    inverse.copy(group.matrixWorld).invert();
    const shell = new THREE.Group();
    group.traverseVisible(part => {
      if (!part.isMesh || part.material.transparent || part.material.isMeshBasicMaterial || !part.geometry.attributes.normal) return;
      const mesh = new THREE.Mesh(part.geometry, frostProxy);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.multiplyMatrices(inverse, part.matrixWorld);
      shell.add(mesh);
    });
    mergeStatic(shell);
    if (shell.children.length) surfaces.push({ group, mesh: shell.children[0] });
  }

  const magBounds = new THREE.Box3().setFromObject(mag), ray = new THREE.Raycaster();
  const magAnchors = [], normalMatrix = new THREE.Matrix3();
  if (!magBounds.isEmpty()) {
    for (const side of [-1, 1]) for (const row of [0.18, 0.38, 0.64, 0.79]) {
      ray.ray.origin.set(side * 0.16, THREE.MathUtils.lerp(magBounds.min.y, magBounds.max.y, row), (magBounds.min.z + magBounds.max.z) * 0.5);
      ray.ray.direction.set(-side, 0, 0);
      const hit = ray.intersectObject(mag, true)[0];
      if (hit) {
        const normal = hit.face.normal.clone().applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
        magAnchors.push({ point: hit.point.addScaledVector(normal, 0.0015), normal });
      }
    }
  }
  return { bounds, surfaces, magAnchors };
}

const frostVertex = /* glsl */`
  uniform mat4 toGun;
  varying vec3 vGun, vView, vNormal;
  void main() {
    vGun = (toGun * vec4(position, 1.0)).xyz;
    vNormal = normalize(normalMatrix * normal);
    vec4 view = modelViewMatrix * vec4(position + normal * 0.00020, 1.0);
    vView = -view.xyz;
    gl_Position = projectionMatrix * view;
  }
`;

const frostFragment = /* glsl */`
  uniform float cover, front, pulse, clock;
  varying vec3 vGun, vView, vNormal;
  float hash3(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f *= f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x),
                   mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                   mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    if (vGun.z > front + 0.08) discard;
    vec3 n = normalize(vNormal), v = normalize(vView);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);
    float cluster = noise3(vGun * 38.0);
    float reached = smoothstep(-0.034, 0.046, front - vGun.z + (cluster - 0.5) * 0.062);
    #ifdef LOW_INSPECT
      float rime = cluster;
    #else
      float rime = noise3(vGun * 116.0 + cluster * 0.85);
    #endif
    float grain = noise3(vGun * 496.0 + rime * 0.58);
    vec2 planes = vec2(vGun.y + vGun.z * 0.64 + vGun.x * 0.52, vGun.y - vGun.z * 0.46 - vGun.x * 0.74);
    vec2 facets = abs(fract(planes * vec2(276.0, 247.0) + vec2(grain * 0.13, grain * 0.24)) - 0.5);
    float needles = (1.0 - smoothstep(0.022, 0.115, min(facets.x, facets.y))) * smoothstep(0.48, 0.85, rime);
    float density = smoothstep(0.31, 0.76, cluster * 0.53 + rime * 0.28 + grain * 0.21 + rim * 0.07);
    float sparkle = smoothstep(0.78, 0.95, grain) * pow(max(0.0, sin(grain * 61.0 + clock * 4.6 + dot(n,v) * 12.0)), 6.0);
    float key = pow(max(dot(n, normalize(v + vec3(-0.32, 0.84, 0.42))), 0.0), 18.0);
    vec3 color = mix(vec3(0.20, 0.41, 0.58), vec3(0.82, 0.94, 1.0), grain * 0.45 + rime * 0.20 + rim * 0.25 + needles * 0.1);
    color += vec3(0.54, 0.73, 0.86) * (0.25 * key + sparkle * (0.34 + pulse * 0.65));
    float alpha = cover * reached * density * (0.19 + rim * 0.28 + grain * 0.23 + needles * 0.14 + sparkle * 0.18);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// A short history of actual weapon poses lets particles stay where they were emitted
// while the gun turns. Motion, lifetime and rendering run on the GPU in two local batches.
const POSE_COUNT = 11, POSE_INTERVAL = 0.145;
function emitterTrail(gun) {
  const pose = Array.from({ length: POSE_COUNT }, () => new THREE.Matrix4());
  const times = new Float32Array(POSE_COUNT);
  const clock = { value: -1 };
  return {
    uniforms: { clock, pose: { value: pose }, poseTime: { value: times } },
    update(time) {
      if (time < 0) { clock.value = -1; return; }
      gun.updateWorldMatrix(true, false);
      pose[0].copy(gun.matrixWorld);
      times[0] = time;
      if (clock.value < 0 || time < clock.value) {
        for (let i = 1; i < POSE_COUNT; i++) { pose[i].copy(pose[0]); times[i] = time; }
      } else if (time - times[1] >= POSE_INTERVAL) {
        for (let i = POSE_COUNT - 1; i > 0; i--) { pose[i].copy(pose[i - 1]); times[i] = times[i - 1]; }
      }
      clock.value = time;
    },
  };
}

const particleVertex = /* glsl */`
  uniform float clock, endTime;
  uniform mat4 pose[${POSE_COUNT}];
  uniform float poseTime[${POSE_COUNT}];
  attribute vec3 emitter, direction;
  attribute vec4 seed, timing;
  varying vec2 vCorner;
  varying vec3 vSeed;
  varying float vAlpha, vAge;

  mat4 poseAt(float birth) {
    for (int i = 1; i < ${POSE_COUNT}; i++) {
      if (birth < poseTime[i]) continue;
      float k = clamp((poseTime[i-1] - birth) / max(0.0001, poseTime[i-1] - poseTime[i]), 0.0, 1.0);
      return pose[i-1] * (1.0 - k) + pose[i] * k;
    }
    return pose[${POSE_COUNT - 1}];
  }

  void main() {
    float birth = timing.x + timing.z * floor(max(0.0, clock - timing.x) / timing.z);
    float age = clock - birth;
    float p = age / timing.y;
    if (p <= 0.0 || p >= 1.0 || birth > endTime) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float impulse = timing.w;
    mat4 emitted = poseAt(birth);
    vec3 origin = (emitted * vec4(emitter, 1.0)).xyz;
    vec3 outward = normalize((emitted * vec4(direction, 0.0)).xyz);
    float s = seed.x * 6.283185;
    float spin = seed.y * 6.283185;
    float fade = 1.0 - smoothstep(0.55, 1.0, p);
    vec2 radius;
    #ifdef MIST
      float push = (1.0 - exp(-age * 3.8)) * mix(0.018, 0.065, impulse) * mix(0.7, 1.3, seed.z);
      vec3 curl = vec3(sin(age * 6.3 + s) - sin(s), 0.0, cos(age * 4.8 + s) - cos(s)) * 0.016;
      origin += outward * push + curl * smoothstep(0.0, 0.3, p) + vec3(0.0, age * mix(0.064, 0.13, seed.w), 0.0);
      float size = (0.012 + 0.038 * p) * mix(0.7, 1.38, seed.z) * mix(1.0, 1.28, impulse);
      radius = vec2(size * 0.72, size * 1.42);
      spin = 0.55 * sin(s + age * 2.0);
      vAlpha = mix(0.17, 0.21, impulse) * smoothstep(0.0, 0.16, p) * fade;
    #else
      vec3 scatter = vec3(cos(s) * 0.095, 0.088 + seed.w * 0.15, sin(s) * 0.075);
      #ifdef PETAL
        vec3 lift = (scatter + outward * 0.13) * vec3(1.0, 1.0, 0.56);
        origin += lift * (1.0 - exp(-2.2 * age)) + vec3(sin(s + age * 7.5) * age * 0.032, -0.145 * age * age, age * 0.018);
        radius = vec2(0.0045, 0.0068) * mix(0.54, 1.16, seed.z);
        radius.x *= 0.24 + 0.76 * abs(cos(spin + age * mix(5.5, 12.0, seed.w)));
      #else
        origin += (scatter + outward * mix(0.07, 0.24, impulse)) * age - vec3(0.0, 0.19 * age * age, 0.0);
        radius = vec2(0.00125, 0.0028) * mix(0.36, 1.2, seed.z);
        #ifdef DROP
          radius = vec2(0.0034, 0.004) * mix(0.55, 1.3, seed.z);
          spin = 0.0;
        #endif
        #ifdef SPLASH
          // flung off the glaze in every direction, then falling
          vec3 fling = normalize(outward + (seed.xyz - 0.5) * 1.8 + vec3(0.0, 0.7, 0.0));
          origin = (emitted * vec4(emitter, 1.0)).xyz + fling * mix(0.22, 0.6, seed.w) * age - vec3(0.0, 1.1 * age * age, 0.0);
          radius = vec2(1.0) * mix(0.0012, 0.0032, seed.z);
        #endif
        #ifdef JET
          // out of the barrel like a fire hydrant: a hard, straight stream that barely drops
          vec3 aim = normalize(outward + (seed.xyz - 0.5) * 0.06);
          origin = (emitted * vec4(emitter, 1.0)).xyz + aim * mix(3.2, 4.4, seed.w) * age - vec3(0.0, 0.3 * age * age, 0.0);
          radius = vec2(1.0) * mix(0.0016, 0.0042, seed.z) * (1.0 + age);
        #endif
        #ifdef WIND
          // a streak blown along to the muzzle, drawn along its own direction
          vec3 vd = (viewMatrix * vec4(outward, 0.0)).xyz;
          origin = (emitted * vec4(emitter, 1.0)).xyz + outward * mix(0.25, 0.45, seed.w) * age;
          radius = vec2(0.0007, mix(0.012, 0.025, seed.z));
        #endif
        #ifdef DRIP
          // a bead swells on the edge, then lets go and falls
          origin = (emitted * vec4(emitter, 1.0)).xyz - vec3(0.0, age * 0.006 + 1.6 * pow(max(0.0, age - 0.18), 2.0), 0.0);
          radius = vec2(0.0011, mix(0.0014, 0.0032, smoothstep(0.1, 0.4, age))) * mix(0.7, 1.25, seed.z);
        #endif
        #if defined(BUBBLE) || defined(SPECK)
          // underwater: drift out of the seam, then rise and wobble (no gravity)
          origin = (emitted * vec4(emitter, 1.0)).xyz + outward * 0.012 * (1.0 - exp(-3.0 * age))
            + vec3(sin(s + age * 5.5) * 0.004, age * mix(0.035, 0.07, seed.w), cos(s + age * 4.0) * 0.003);
          radius = vec2(1.0) * mix(0.0012, 0.0032, seed.z);
          #ifdef SPECK
            radius = vec2(1.0) * mix(0.0006, 0.0013, seed.z);
          #endif
          #ifdef GLINT
            origin = (emitted * vec4(emitter, 1.0)).xyz + outward * 0.02 * (1.0 - exp(-2.0 * age)) + vec3(sin(s + age * 3.0) * 0.003, age * 0.012, 0.0);
            radius = vec2(1.0) * mix(0.0012, 0.003, seed.z);
          #endif
          spin = 0.0;
        #endif
        #ifdef GATHER
          // drawn in from all round to the shell
          origin = (emitted * vec4(emitter, 1.0)).xyz + outward * 0.09 * smoothstep(0.0, 1.0, p);
          radius = vec2(1.0) * mix(0.0012, 0.0026, seed.z);
        #endif
        #ifdef BURST
          // thrown forward out of the muzzle in a wide cone, slowing in the air
          vec3 cone = normalize(outward + (seed.xyz - 0.5) * 1.1);
          origin = (emitted * vec4(emitter, 1.0)).xyz + cone * mix(0.4, 1.2, seed.w) * (1.0 - exp(-3.0 * age)) / 3.0;
          radius = vec2(1.0) * mix(0.0012, 0.003, seed.z);
        #endif
      #endif
      spin += age * (seed.x - 0.5) * 12.0;
      #ifdef WIND
        spin = atan(vd.y, vd.x) - 1.5708;                 // streaks stay lined up with the wind
      #endif
      vAlpha = smoothstep(0.0, 0.09, p) * fade;
    #endif
    vec2 d = position.xy * radius;
    vec4 view = viewMatrix * vec4(origin, 1.0);
    view.xy += mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * d;
    gl_Position = projectionMatrix * view;
    vCorner = position.xy;
    vSeed = seed.xyz;
    vAge = p;
  }
`;

const particleFragment = /* glsl */`
  uniform vec3 tint;
  varying vec2 vCorner;
  varying vec3 vSeed;
  varying float vAlpha, vAge;
  #ifdef MIST
    float hash2(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    float noise2(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f *= f * (3.0 - 2.0 * f);
      return mix(mix(hash2(i), hash2(i + vec2(1,0)), f.x), mix(hash2(i + vec2(0,1)), hash2(i + vec2(1)), f.x), f.y);
    }
  #endif
  void main() {
    vec2 p = vCorner;
    float a;
    vec3 c;
    #ifdef MIST
      float r = dot(p, p);
      if (r >= 1.0) discard;
      vec2 q = p * vec2(2.1, 3.5) + vSeed.xy * 11.0 - vec2(vAge * 0.95, vAge * 2.4);
      float curl = noise2(q * 0.78);
      float cloud = noise2(q + vec2(curl * 1.8, -curl * 0.84));
      #ifndef LOW_INSPECT
        cloud = cloud * 0.68 + noise2(q * 2.16) * 0.32;
      #endif
      a = vAlpha * exp(-2.6 * r) * (1.0 - smoothstep(0.51, 1.0, r)) * smoothstep(0.25, 0.74, cloud);
      c = mix(tint * vec3(0.74, 0.90, 1.0), vec3(0.81, 0.93, 1.0), cloud * 0.72);
    #elif defined(PETAL)
      float notch = (1.0 - smoothstep(0.0, 0.26, abs(p.x))) * max(0.0, p.y) * 0.20;
      float silhouette = length(vec2(p.x * (1.20 - 0.28 * p.y), p.y * 0.98)) + notch;
      a = vAlpha * (1.0 - smoothstep(0.84, 0.98, silhouette));
      float vein = (1.0 - smoothstep(0.0, 0.15, abs(p.x))) * (1.0 - smoothstep(-0.35, 0.72, p.y));
      float sheen = pow(max(0.0, sin(vAge * 23.0 + vSeed.x * 11.0 + p.x * 2.5)), 3.0);
      c = mix(vec3(0.19, 0.018, 0.058), tint, smoothstep(-0.85, 0.76, p.y) * 0.64 + vSeed.y * 0.28);
      c += vec3(0.42, 0.13, 0.22) * (vein * 0.2 + sheen * 0.68);
    #elif defined(BUBBLE)
      float r = dot(p, p);
      if (r >= 1.0) discard;
      float rimB = smoothstep(0.55, 0.95, r);
      float glint = 1.0 - smoothstep(0.0, 0.06, dot(p - vec2(-0.35, 0.4), p - vec2(-0.35, 0.4)));
      c = mix(vec3(0.2, 0.55, 0.5), vec3(0.75, 1.0, 0.95), rimB) + glint;
      a = vAlpha * (0.08 + rimB * 0.55 + glint * 0.7);
    #elif defined(SPECK)
      float r = dot(p, p);
      if (r >= 1.0) discard;
      c = tint * 1.6;
      a = vAlpha * exp(-3.0 * r) * (0.6 + 0.4 * sin(vAge * 30.0 + vSeed.x * 20.0));
    #elif defined(WIND)
      a = vAlpha * 0.32 * (1.0 - smoothstep(0.0, 1.0, abs(p.x))) * (1.0 - smoothstep(0.3, 1.0, abs(p.y)));
      c = vec3(0.86, 0.93, 1.0);
    #elif defined(DROP)
      // a clear bead: dark refracted rim, bright catch-light up and to the left
      float r = dot(p, p);
      if (r >= 1.0) discard;
      float rimD = smoothstep(0.45, 1.0, r);
      float spec = 1.0 - smoothstep(0.0, 0.09, dot(p - vec2(-0.32, 0.36), p - vec2(-0.32, 0.36)));
      c = mix(vec3(0.72, 0.84, 0.96), vec3(0.10, 0.18, 0.34), rimD) + vec3(1.0) * spec;
      a = vAlpha * (0.32 + rimD * 0.45 + spec * 0.6);
    #else
      float glint = pow(max(0.0, sin(vAge * 19.0 + vSeed.x * 23.0)), 5.0);
      float shape = abs(p.x + p.y * 0.23) * (1.20 - p.y * 0.26) + abs(p.y + p.x * 0.19);
      a = vAlpha * (0.52 + glint * 0.48) * (1.0 - smoothstep(0.67, 0.98, shape));
      float facet = smoothstep(-0.04, 0.12, p.x - p.y * 0.12);
      c = mix(tint * 0.36, vec3(0.90, 0.97, 1.0), glint * 0.67 + facet * 0.28);
    #endif
    if (a < 0.002) discard;
    gl_FragColor = vec4(c, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const particleBudget = { mist: [22, 38, 54, 70], chip: [20, 34, 48, 62], petal: [28, 46, 64, 84], drop: [14, 22, 30, 40], drip: [80, 140, 200, 260], splash: [120, 200, 300, 400], jet: [160, 280, 400, 520], wind: [30, 50, 70, 90], gather: [40, 70, 100, 130], burst: [40, 70, 100, 140], bubble: [12, 18, 26, 34], speck: [10, 16, 22, 30], glint: [60, 100, 150, 200] };
const particleTier = { low: 0, standard: 1, high: 2, ultra: 3 };

function particles(kind, tier, anchors, tint, trail, rng) {
  const mist = kind === 'mist', petals = kind === 'petal', drops = ['drop', 'drip', 'splash', 'jet', 'wind'].includes(kind), deep = ['bubble', 'speck', 'glint', 'gather', 'burst'].includes(kind);
  const seconds = petals ? SAKURA_SECONDS : drops ? KILN_SECONDS : deep ? ABYSS_SECONDS : FROST_SECONDS;
  const peak = (petals ? SAKURA_PEAK : drops ? KILN_PEAK : deep ? ABYSS_PEAK : FROST_PEAK) * seconds;
  const k = seconds / 4.2;                              // timings below were set for a 4.2 s inspect
  const count = particleBudget[kind][tier], positions = [], directions = [], seeds = [], timing = [];
  for (let i = 0; i < count; i++) {
    const anchor = anchors[Math.floor(rng() * anchors.length)];
    positions.push(...anchor.point.toArray());
    directions.push(...anchor.normal.toArray());
    seeds.push(rng(), rng(), rng(), rng());
    const burst = mist ? i % 4 === 0 : i % 5 !== 1 && i % 5 !== 3;
    let start, life, period = 10;
    if (mist && !burst) {
      start = 0.24 + rng() * 0.88;
      period = 0.65 + rng() * 0.42;
      life = 0.61 + rng() * 0.29;
    } else if (mist) {
      start = peak - 0.08 + rng() * 0.16;
      life = 0.64 + rng() * 0.23;
    } else if (kind === 'jet') {                          // the hydrant: a steady stream out of the barrel
      start = seconds * (0.35 + 0.42 * rng());
      life = 0.5 + rng() * 0.3;
    } else if (kind === 'wind') {                         // gusts rushing along the gun to the muzzle
      start = seconds * (0.15 + 0.7 * rng());
      life = 0.6 + rng() * 0.4;
    } else if (kind === 'gather') {                       // light drawn into the spinning shell before the blast
      start = seconds * (0.4 + 0.24 * rng());
      life = 0.5 + rng() * 0.3;
    } else if (kind === 'burst') {                        // sparks thrown out of the muzzle by the blast
      start = seconds * (0.69 + 0.03 * rng());
      life = 0.4 + rng() * 0.3;
    } else if (kind === 'splash') {                       // five bursts of spray as the waves lift and the crest surges
      start = seconds * (0.28 + 0.1 * Math.floor(rng() * 5)) + rng() * 0.18;
      life = 0.7 + rng() * 0.5;
    } else if (kind === 'drip') {                         // water beads up all over the underside and falls, all through
      start = (0.9 + rng() * 2.6) * k;
      life = 0.55 + rng() * 0.5;
    } else if (kind === 'glint') {                        // glints all over the glass from the first light to the end
      start = (0.7 + rng() * 2.6) * k;
      life = 0.6 + rng() * 0.8;
    } else if (deep) {                                   // a sparse stream from the seams around the peak, rising slowly
      start = peak + (-0.35 + rng() * 1.0) * k;
      life = 0.9 + rng() * 0.7;
    } else if (drops) {                                  // one short arc of droplets off the crest
      start = peak - 0.04 + rng() * 0.14;
      life = 0.42 + rng() * 0.3;
    } else if (petals) {
      start = burst ? peak + (-0.15 + rng() * 0.29) * k : peak + (-0.55 + rng() * 1.25) * k;
      life = 0.63 + rng() * 0.60;
    } else {
      start = burst ? peak - 0.10 + rng() * 0.24 : 1.03 + rng() * 1.33;
      life = 0.41 + rng() * 0.38;
    }
    timing.push(start, life, period, burst ? 1 : 0);
  }
  const geo = new THREE.InstancedBufferGeometry();
  // The GPU moves these quads from the emitters. They do not extend the gun's model bounds.
  geo.boundingBox = new THREE.Box3();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('emitter', new THREE.InstancedBufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('direction', new THREE.InstancedBufferAttribute(new Float32Array(directions), 3));
  geo.setAttribute('seed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 4));
  geo.setAttribute('timing', new THREE.InstancedBufferAttribute(new Float32Array(timing), 4));
  geo.instanceCount = count;
  const defines = kind === 'jet' ? { DROP: 1, JET: 1 } : kind === 'wind' ? { WIND: 1 } : kind === 'gather' ? { SPECK: 1, GATHER: 1 } : kind === 'burst' ? { SPECK: 1, BURST: 1 } :
    mist ? { MIST: 1 } : petals ? { PETAL: 1 } : kind === 'drip' ? { DROP: 1, DRIP: 1 } : kind === 'splash' ? { DROP: 1, SPLASH: 1 } : kind === 'glint' ? { SPECK: 1, GLINT: 1 } : drops ? { DROP: 1 } : kind === 'bubble' ? { BUBBLE: 1 } : kind === 'speck' ? { SPECK: 1 } : {};
  if (mist && tier === 0) defines.LOW_INSPECT = 1;
  const material = new THREE.ShaderMaterial({
    defines,
    uniforms: { ...trail.uniforms, endTime: { value: seconds * 0.78 }, tint: { value: tint } },
    vertexShader: particleVertex, fragmentShader: particleFragment, transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = mist ? 'Inspect vapour' : petals ? 'Inspect petals' : drops ? 'Inspect droplets' : deep ? 'Inspect ' + kind + 's' : 'Inspect ice flecks';
  mesh.frustumCulled = false;
  mesh.renderOrder = mist ? 3 : 4;
  return mesh;
}

export function frostInspect(gun, frost, crystals, skin, quality) {
  const { bounds, surfaces, magAnchors } = frost;
  const tier = particleTier[quality] ?? 1;
  const cover = { value: 0 }, front = { value: bounds.min.z }, pulse = { value: 0 }, clock = { value: 0 };
  gun.updateWorldMatrix(true, false);
  const inverse = new THREE.Matrix4().copy(gun.matrixWorld).invert();
  const meshes = surfaces.map(({ group, mesh }) => {
    group.updateWorldMatrix(true, false);
    const toGun = new THREE.Matrix4().multiplyMatrices(inverse, group.matrixWorld);
    mesh.material = new THREE.ShaderMaterial({
      defines: tier === 0 ? { LOW_INSPECT: 1 } : {},
      uniforms: { toGun: { value: toGun }, cover, front, pulse, clock }, vertexShader: frostVertex, fragmentShader: frostFragment,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    mesh.name = 'Inspect surface frost';
    group.add(mesh);
    return mesh;
  });
  const trail = emitterTrail(gun), rng = mulberry32(skin.id * 1181);
  const tint = new THREE.Color(...skin.ice).lerp(new THREE.Color(0xcbe8ff), 0.84);
  const fallback = { point: bounds.getCenter(new THREE.Vector3()).setY(bounds.max.y), normal: new THREE.Vector3(0, 1, 0) };
  const crown = crystals?.anchors.length ? crystals.anchors : [fallback];
  const vapour = particles('mist', tier, [...crown, ...magAnchors, ...magAnchors], tint, trail, rng);
  const flecks = particles('chip', tier, crown, tint, trail, rng);
  gun.add(vapour, flecks);
  meshes.push(vapour, flecks);
  for (const mesh of meshes) mesh.visible = false;
  const ice = crystals?.mesh.material.userData.ice;
  let phase = -1;
  return {
    clip: ICE_CLIP, seconds: FROST_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      const freeze = smooth(p, 0.08, 0.43) * (1 - smooth(p, 0.70, 1));
      const sweep = smooth(p, 0.075, 0.50);
      cover.value = freeze;
      front.value = THREE.MathUtils.lerp(bounds.min.z - 0.05, bounds.max.z + 0.065, sweep);
      pulse.value = smooth(p, FROST_PEAK - 0.085, FROST_PEAK + 0.015) * (1 - smooth(p, FROST_PEAK + 0.015, FROST_PEAK + 0.19));
      clock.value = p * FROST_SECONDS;
      if (ice) { ice.iceT.value = active ? p : 1; ice.iceFront.value = front.value; ice.iceGlow.value = pulse.value; }
      for (const mesh of meshes) mesh.visible = active && freeze > 0.001;
      trail.update(active ? clock.value : -1);
    },
    dispose() {
      for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); }
      if (crystals) { crystals.mesh.geometry.dispose(); crystals.mesh.material.dispose(); }
    },
  };
}

// A real cupped, notched cherry petal. The ridgeline and lip catch light as it unfolds.
function cherryPetal() {
  const geo = new THREE.BufferGeometry(), pos = [], colors = [], indices = [];
  const base = new THREE.Color(0x8e224d), lip = new THREE.Color(0xe885aa), col = new THREE.Color();
  const rows = 8, cols = 6;
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
    const t = i / rows, side = 2 * j / cols - 1, edge = Math.abs(side);
    const notch = (1 - edge) ** 3 * smooth(t, 0.72, 1) * 0.15;
    pos.push(t * 1.05 - notch, side * (0.055 + 0.42 * Math.sin(t * 2.05)), 0.21 * t ** 2 + 0.14 * side ** 2 * t + 0.05 * (1 - edge) * t);
    col.copy(base).lerp(lip, 0.67 * t + 0.28 * edge).multiplyScalar(1 - 0.11 * (1 - edge) ** 5);
    colors.push(col.r, col.g, col.b);
    if (i < rows && j < cols) {
      const a = i * (cols + 1) + j, b = a + cols + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function cherryHeart(material) {
  const group = new THREE.Group(), sphere = new THREE.SphereGeometry(1, 7, 5);
  const core = new THREE.Mesh(sphere, material);
  core.scale.set(0.74, 0.74, 0.39);
  group.add(core);
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7, z = 0.38 + i % 3 * 0.15;
    const x = Math.cos(angle) * 0.49, y = Math.sin(angle) * 0.49;
    const stem = new THREE.Mesh(sphere, material), tip = new THREE.Mesh(sphere, material);
    stem.position.set(x, y, z * 0.42); stem.scale.set(0.09, 0.09, z * 0.66);
    tip.position.set(x, y, z); tip.scale.set(0.16, 0.16, 0.22);
    group.add(stem, tip);
  }
  mergeStatic(group);
  sphere.dispose();
  return group.children[0].geometry;
}

export function sakuraInspect(gun, blossoms, quality, roots = []) {
  const trail = emitterTrail(gun), tier = particleTier[quality] ?? 1;
  const anchors = blossoms.flatMap(flower => Array.from({ length: 5 }, (_, i) => {
    const angle = i * Math.PI * 0.4 + flower.point.z * 14;
    const tip = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.26).multiplyScalar(flower.size * 1.6);
    return { point: tip.applyQuaternion(flower.rotation).add(flower.point), normal: flower.normal };
  }));
  const falling = particles('petal', tier, anchors, new THREE.Color(0xde6897), trail, mulberry32(201031));
  const petals = new THREE.InstancedMesh(cherryPetal(), new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.39, side: THREE.DoubleSide, emissive: 0x421426, emissiveIntensity: 0.26,
  }), blossoms.length * 5);
  const pollen = new THREE.MeshStandardMaterial({
    color: 0xf1b87d, roughness: 0.44, metalness: 0.23, emissive: 0x673222, emissiveIntensity: 0.22,
  });
  const hearts = new THREE.InstancedMesh(cherryHeart(pollen), pollen, blossoms.length);
  petals.name = 'Inspect opening blossoms';
  hearts.name = 'Inspect blossom centres';
  for (const mesh of [petals, hearts]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.boundingBox = new THREE.Box3();
  }
  const meshes = [petals, hearts, falling];
  for (const mesh of meshes) { mesh.visible = false; mesh.frustumCulled = false; gun.add(mesh); }
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3(), size = new THREE.Vector3();
  const q = new THREE.Quaternion(), qRadial = new THREE.Quaternion(), qCurl = new THREE.Quaternion();
  const y = new THREE.Vector3(0, 1, 0), z = new THREE.Vector3(0, 0, 1);
  let phase = -1;
  return {
    clip: SAKURA_CLIP, seconds: SAKURA_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const mesh of meshes) mesh.visible = active && p > 0.13 && p < 0.98;
      trail.update(active ? p * SAKURA_SECONDS : -1);
      // roots creep over the gun, then draw back before idle
      const reach = active ? smooth(p, 0.1, 0.55) * (1 - smooth(p, 0.8, 0.97)) : 0;
      for (const root of roots) {
        const n = Math.floor(root.geometry.index.count * reach / 36) * 36;    // whole rings of the tube
        root.geometry.setDrawRange(0, n); root.visible = n > 0;
        for (const m of root.userData.sprouts) {               // sprouts open as the root reaches them
          const g = Math.max(0, Math.min(1, (reach - m.userData.at) / 0.12));
          m.visible = g > 0.01; m.scale.copy(m.userData.base).multiplyScalar(g);
        }
      }
      if (!petals.visible) return;
      for (let i = 0; i < blossoms.length; i++) {
        const flower = blossoms[i], start = 0.17 + 0.13 * (i * 7 % 11) / 10;
        const close = smooth(p, 0.71 + start * 0.18, 0.96);
        const grow = smooth(p, start, start + 0.16) * (1 - close);
        const open = smooth(p, start + 0.06, start + 0.22) * (1 - close * 0.8);
        const scale = Math.max(0.000001, flower.size * grow * 1.64);
        point.copy(flower.point).addScaledVector(flower.normal, 0.0009 + scale * 0.26);
        size.set(0.21, 0.21, 0.16).multiplyScalar(scale);
        hearts.setMatrixAt(i, matrix.compose(point, flower.rotation, size));
        size.setScalar(scale);
        for (let j = 0; j < 5; j++) {
          const sway = Math.sin(p * 32 + i * 1.8 + j * 0.62) * 0.083 * open;
          qRadial.setFromAxisAngle(z, j * Math.PI * 0.4 + flower.point.z * 14 + sway);
          qCurl.setFromAxisAngle(y, -1.39 + open * (1.27 + (j % 2) * 0.12) + sway);
          q.copy(flower.rotation).multiply(qRadial).multiply(qCurl);
          petals.setMatrixAt(i * 5 + j, matrix.compose(point, q, size));
        }
      }
      petals.instanceMatrix.needsUpdate = hearts.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); if (mesh.isInstancedMesh) mesh.dispose(); }
    },
  };
}

// Storm Kiln: the raised waves lift in turn from handguard to receiver, the tallest crest rolls
// over once and throws a short arc of droplets, a cool highlight runs over the silver seams,
// then everything settles back into the glaze.
export function kilnInspect(gun, { reliefs, under, surface, muzzle }, quality) {
  const trail = emitterTrail(gun), tier = particleTier[quality] ?? 1;
  // water runs off the porcelain: beads form all along the underside and drip
  const drops = particles('drip', tier, under.length ? under : [{ point: new THREE.Vector3(), normal: new THREE.Vector3(0, -1, 0) }], new THREE.Color(0xbfdcff), trail, mulberry32(202077));
  const spray = [...surface, ...reliefs.map(r => ({ point: r.base.clone(), normal: r.normal.clone() }))];
  const splash = particles('splash', tier, spray.length ? spray : [{ point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) }], new THREE.Color(0xbfdcff), trail, mulberry32(202093));
  // the hydrant out of the barrel, and wind rushing along the gun to the muzzle
  const [my, mz] = muzzle || [0, -0.5], tip = new THREE.Vector3(0, my, mz);
  const jet = particles('jet', tier, [{ point: tip.clone(), normal: new THREE.Vector3(0, 0.12, -1).normalize() }], new THREE.Color(0xbfdcff), trail, mulberry32(202101));
  const gusts = (surface.length ? surface : [{ point: new THREE.Vector3(), normal: new THREE.Vector3(1, 0, 0) }]).map((a, i) => {
    const from = a.point.clone().addScaledVector(a.normal, 0.04 + (i * 37 % 10) * 0.012).add(new THREE.Vector3(0, ((i * 13 % 7) - 3) * 0.012, 0.06));
    return { point: from, normal: tip.clone().sub(from).normalize() };
  });
  const wind = particles('wind', tier, gusts, new THREE.Color(0xffffff), trail, mulberry32(202117));
  drops.visible = splash.visible = jet.visible = wind.visible = false;
  gun.add(drops, splash, jet, wind);
  const order = [...new Set(reliefs.map(r => Math.round(r.base.z * 1000)))].sort((a, b) => a - b);
  const glazes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artPhase && !glazes.includes(u.artPhase)) glazes.push(u.artPhase); });
  let phase = -1;
  return {
    clip: KILN_CLIP, seconds: KILN_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const g of glazes) g.value = active ? p : -1;
      drops.visible = splash.visible = jet.visible = wind.visible = active && p > 0.12;
      trail.update(active ? p * KILN_SECONDS : -1);
      reliefs.forEach((r) => {
        const k = order.indexOf(Math.round(r.base.z * 1000)), start = 0.17 + k * 0.045;
        const lift = active ? smooth(p, start, start + 0.12) * (1 - smooth(p, 0.72, 0.93)) : 0;
        // the crest surges once at the peak, above the rest
        const surge = r.crest && active ? Math.sin(smooth(p, KILN_PEAK - 0.08, KILN_PEAK + 0.06) * Math.PI) * 0.007 : 0;
        r.group.position.copy(r.base).addScaledVector(r.normal, lift * (r.crest ? 0.012 : 0.008) + surge);
      });
    },
    dispose() { for (const m of [drops, splash, jet, wind]) { m.geometry.dispose(); m.material.dispose(); } },
  };
}

// Abyssal Crown: the dial's needle sinks, teal caustics run through the inlays (shader, artPhase),
// the nautilus ribs open a fraction in sequence and let out bubbles and dim glowing specks; then
// the needle settles, the ribs close and the last bubbles rise clear.
// a soft round flare (the muzzle, when the blast arrives)
let flareTex = null;
function flare(tint) {
  if (!flareTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    flareTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, color: tint, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  m.renderOrder = 5;
  return m;
}
export function abyssInspect(gun, { reliefs, dials, muzzle }, quality) {
  const trail = emitterTrail(gun), tier = particleTier[quality] ?? 1;
  const anchors = reliefs.map(r => ({ point: r.base.clone().add(new THREE.Vector3(0, ...(r.ring ? [r.ring[1], r.ring[0]] : [0, 0]))), normal: r.normal.clone() }));
  const fallback = [{ point: new THREE.Vector3(), normal: new THREE.Vector3(1, 0, 0) }];
  const bubbles = particles('bubble', tier, anchors.length ? anchors : fallback, new THREE.Color(0x9ff5e6), trail, mulberry32(203011));
  const specks = particles('speck', tier, anchors.length ? anchors : fallback, new THREE.Color(0x8dffb0), trail, mulberry32(203029));
  for (const m of [bubbles, specks]) { m.visible = false; gun.add(m); }
  const glazes = [], blasts = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artPhase && !glazes.includes(u.artPhase)) { glazes.push(u.artPhase); blasts.push(u.artBlast); } });
  // the nautilus on the handguard spins (the ring nearest the muzzle); the stock's opens its ribs
  const front = Math.min(...reliefs.map(r => r.ring?.[0] ?? 0));
  const shell = reliefs.filter(r => r.ring && r.ring[0] === front);
  for (const r of shell) r.group.matrixAutoUpdate = false;
  const [my, mz] = muzzle || [0, -0.6];
  const glow = flare(new THREE.Color(0x6fffe0)); glow.position.set(0, my, mz - 0.01); glow.visible = false; gun.add(glow);
  // build-up: light drawn in to the spinning shell, which flares brighter and brighter
  const centres = shell.length ? [...new Map(shell.map(r => [Math.sign(r.normal.x), new THREE.Vector3(r.base.x * 1.6, r.ring[1], r.ring[0])])).values()] : [];
  const pull = [];
  centres.forEach((c, n) => { for (let i = 0; i < 24; i++) { const d = new THREE.Vector3(Math.sin(i * 2.4 + n), Math.cos(i * 1.7), Math.sin(i * 0.9 + n * 2)).normalize(); pull.push({ point: c.clone().addScaledVector(d, 0.09), normal: d.clone().negate() }); } });
  const gather = particles('gather', tier, pull.length ? pull : fallback, new THREE.Color(0x9ffff0), trail, mulberry32(203041));
  const cores = centres.map(c => { const f = flare(new THREE.Color(0x7dffe6)); f.position.copy(c); f.visible = false; gun.add(f); return f; });
  // the blast: sparks out of the muzzle and a shockwave ring
  const sparks = particles('burst', tier, [{ point: new THREE.Vector3(0, my, mz), normal: new THREE.Vector3(0, 0, -1) }], new THREE.Color(0x8dfff0), trail, mulberry32(203057));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40), new THREE.MeshBasicMaterial({ color: 0x8dfff0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  ring.position.set(0, my, mz - 0.02); ring.visible = false;
  for (const m of [gather, sparks]) { m.visible = false; gun.add(m); }
  gun.add(ring);
  const M = new THREE.Matrix4(), R = new THREE.Matrix4(), T = new THREE.Matrix4();
  let phase = -1;
  return {
    clip: ABYSS_CLIP, seconds: ABYSS_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const g of glazes) g.value = active ? p : -1;
      bubbles.visible = specks.visible = active && p > 0.3;
      trail.update(active ? p * ABYSS_SECONDS : -1);
      const sink = active ? smooth(p, 0.2, 0.5) * (1 - smooth(p, 0.7, 0.92)) : 0;
      // the shell winds up faster and faster (six full turns, so it ends where it began) ...
      const spin = active ? Math.pow(smooth(p, 0.22, 0.62), 3) * Math.PI * 12 : 0;
      for (const d of dials) d.needle.rotation.z = d.rest - sink * 2.3 - spin * 2 + (active ? Math.sin(p * 40) * 0.03 * sink : 0);
      for (const r of shell) {
        R.makeRotationX(spin * Math.sign(r.normal.x || 1));
        M.makeTranslation(r.base.x, r.ring[1], r.ring[0]).multiply(R).multiply(T.makeTranslation(0, -r.ring[1], -r.ring[0]));
        r.group.matrix.copy(M);
      }
      // ... and at full speed sends a blast of light down the barrel that flares at the muzzle
      const b = active ? smooth(p, 0.6, 0.7) : 0, on = active && p > 0.6 && p < 0.74;
      for (const u of blasts) u.value = on ? front + (mz - front) * b : -9;
      const flash = on ? Math.max(0, 1 - Math.abs(p - 0.7) / 0.04) : 0;
      glow.visible = flash > 0.01;
      glow.scale.setScalar(0.04 + flash * 0.16); glow.material.opacity = flash;
      gather.visible = active && p > 0.38 && p < 0.72;
      sparks.visible = active && p > 0.68;
      const charge = active ? smooth(p, 0.4, 0.68) * (1 - smooth(p, 0.69, 0.73)) : 0;
      for (const f of cores) { f.visible = charge > 0.01; f.scale.setScalar(0.02 + charge * 0.07 + Math.sin(p * 300) * 0.004 * charge); f.material.opacity = charge; }
      const wave = active ? smooth(p, 0.69, 0.78) : 0, waveOn = active && p > 0.69 && p < 0.8;
      ring.visible = waveOn; ring.scale.setScalar(0.005 + wave * 0.16); ring.material.opacity = waveOn ? (1 - wave) * 0.9 : 0;
      reliefs.forEach((r, i) => {
        if (shell.includes(r)) return;
        const k = i % 10, start = ABYSS_PEAK - 0.12 + k * 0.012;           // the stock's whorl: one rib after another
        const open = active ? smooth(p, start, start + 0.08) * (1 - smooth(p, 0.74, 0.9)) : 0;
        r.group.position.copy(r.base).addScaledVector(r.normal, open * 0.0045);
      });
    },
    dispose() { for (const m of [bubbles, specks, gather, sparks, ring]) { m.geometry.dispose(); m.material.dispose(); } for (const f of [glow, ...cores]) f.material.dispose(); },
  };
}

// Vesper Glass: turn the dark pewter into the light so the panes catch it one arch at a time
// (shader, artPhase); at the peak the rose window's inner ring turns a few degrees in its frame and
// a concentrated reflection slides across the receiver; a few coloured glints fade beside the glass;
// the ring seats flush again before idle.
export function vesperInspect(gun, { reliefs, surface }, quality) {
  const trail = emitterTrail(gun), tier = Math.max(0, (particleTier[quality] ?? 1) - 1);
  const anchors = reliefs.map(r => ({ point: new THREE.Vector3(r.base.x, r.ring[1], r.ring[0]), normal: r.normal.clone() }));
  const fallback = [{ point: new THREE.Vector3(), normal: new THREE.Vector3(1, 0, 0) }];
  const over = [...anchors, ...surface];
  const glints = [new THREE.Color(0xff3a4e), new THREE.Color(0xb05cff), new THREE.Color(0xffb04a)].map((tint, i) => particles('glint', particleTier[quality] ?? 1, over.length ? over : fallback, tint, trail, mulberry32(204001 + i * 17)));
  for (const m of glints) { m.visible = false; gun.add(m); }
  // The temporal fracture: shards of glass burst off the gun, hang in the air stuttering as if time
  // has caught, while cracks of light split the space around it; then it all runs backwards.
  const rng = mulberry32(204077), nShards = [40, 80, 120, 160][particleTier[quality] ?? 1];
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.012, 0, -0.009, -0.008, 0, 0.01, -0.006, 0.0012], 3));
  tri.computeVertexNormals();
  const shards = new THREE.InstancedMesh(tri, new THREE.MeshPhysicalMaterial({ color: 0xe6d8ff, emissive: 0x3a1250, roughness: 0.04, metalness: 0,
    transparent: true, opacity: 0.6, iridescence: 1, iridescenceIOR: 1.5, side: THREE.DoubleSide, depthWrite: false }), nShards);
  shards.name = 'Inspect glass shards'; shards.frustumCulled = false; shards.visible = false;
  const from = over.length ? over : fallback;
  const shard = Array.from({ length: nShards }, () => {
    const a = from[Math.floor(rng() * from.length)];
    const dir = a.normal.clone().multiplyScalar(0.9).add(new THREE.Vector3(rng() - 0.5, rng() - 0.3, rng() - 0.5)).normalize();
    return { at: a.point.clone(), dir, dist: 0.08 + rng() * 0.34, axis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), turn: 2 + rng() * 6, size: 0.6 + rng() * 1.6 };
  });
  const centre = from.reduce((c, a) => c.add(a.point), new THREE.Vector3()).multiplyScalar(1 / from.length);
  // The fractures in the air: spider-web breaks in invisible panes around the gun. From each impact
  // point jagged cracks run outwards, joined by rings, built as thin solid strands (they catch the
  // light from every angle). They spread from the impact.
  const cracks = new THREE.Group(), panes = [];
  const strand = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xd9c8ff, emissiveIntensity: 1.6, roughness: 0.15, metalness: 0, transparent: true, opacity: 0 });
  const jag = (a, b, n) => { const pts = [a]; for (let k = 1; k < n; k++) pts.push(a.clone().lerp(b, k / n).add(new THREE.Vector3(rng() - 0.5, rng() - 0.5, 0).multiplyScalar(0.012))); pts.push(b); return pts; };
  const tubes = [], rifts = [];
  const riftU = { uTime: { value: 0 }, uOpen: { value: 0 } };
  const riftMat = new THREE.ShaderMaterial({ uniforms: riftU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime, uOpen; varying vec2 vP;
      void main(){
        vec2 q = vP / vec2(0.42, 0.95); float d = clamp(length(q), 0.0, 1.0), a = atan(q.y, q.x);
        float swirl = sin(a * 3.0 + uTime * 2.2 - d * 9.0) * 0.5 + 0.5;
        float veins = pow(abs(sin(a * 7.0 - uTime * 0.7 + sin(d * 14.0 + uTime) * 1.5)), 12.0) * (1.0 - d);
        vec3 deep = vec3(0.03, 0.0, 0.02), red = vec3(0.85, 0.06, 0.04);
        vec3 c = mix(deep, red * 0.6, swirl * (1.0 - d) * 0.7) + red * veins * 1.4;
        c += vec3(1.0, 0.35, 0.12) * pow(d, 5.0) * 2.4;          // the burning lip
        gl_FragColor = vec4(c, uOpen * (0.92 + 0.08 * d));
      }` });
  // spores drifting out of the rifts
  const nSpores = [30, 60, 90, 120][particleTier[quality] ?? 1], spore = [];
  const sporeGeo = new THREE.BufferGeometry(); sporeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nSpores * 3), 3));
  const spores = new THREE.Points(sporeGeo, new THREE.PointsMaterial({ color: 0xffd9c8, size: 0.004, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  spores.frustumCulled = false; spores.visible = false;
  for (let n = 0; n < 4; n++) {
    const pane = new THREE.Group();
    const R = 0.07 + rng() * 0.06, spokes = 9 + Math.floor(rng() * 5), ends = [];
    for (let i = 0; i < spokes; i++) {
      const a = i / spokes * Math.PI * 2 + (rng() - 0.5) * 0.4, r = R * (0.6 + rng() * 0.45);
      const end = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0); ends.push(end);
      tubes.push({ pane, pts: jag(new THREE.Vector3(), end, 6), w: 0.0011 });
    }
    for (const f of [0.35, 0.65]) for (let i = 0; i < spokes; i++) {      // the rings that join neighbouring cracks
      if (rng() < 0.25) continue;
      tubes.push({ pane, pts: jag(ends[i].clone().multiplyScalar(f * (0.9 + rng() * 0.2)), ends[(i + 1) % spokes].clone().multiplyScalar(f * (0.9 + rng() * 0.2)), 3), w: 0.0007 });
    }
    // the rift: the break tears open into a tall slit onto another dimension, dark and red-lit inside
    const lip = [];
    for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2, j = 0.85 + rng() * 0.3; lip.push(new THREE.Vector2(Math.cos(a) * 0.42 * j, Math.sin(a) * 0.95 * j)); }
    const rift = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(lip)), riftMat);
    rift.position.z = 0.0005; rift.scale.x = 0.001; rift.userData.R = R; pane.add(rift); rifts.push(rift);
    // somewhere around the gun, turned a different way each
    const dir = new THREE.Vector3(rng() - 0.5, rng() * 0.6 - 0.1, rng() - 0.5).normalize();
    pane.position.copy(centre).addScaledVector(dir, 0.12 + rng() * 0.12);
    pane.quaternion.setFromEuler(new THREE.Euler(rng() * 1.2 - 0.6, rng() * Math.PI, rng() * Math.PI));
    cracks.add(pane); panes.push(pane);
  }
  for (const t of tubes) t.pane.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(t.pts, false, 'catmullrom', 0.1), t.pts.length * 2, t.w, 3, false), strand));
  for (let i = 0; i < nSpores; i++) spore.push({ pane: panes[i % panes.length], x: (rng() - 0.5) * 0.05, y: (rng() - 0.5) * 0.12, v: new THREE.Vector3(rng() - 0.5, rng() * 0.5 + 0.2, rng() * 1.2 + 0.3).multiplyScalar(0.05), t0: rng() });
  cracks.add(spores);
  cracks.name = 'Inspect time cracks'; cracks.visible = false;
  cracks.traverse(o => { o.frustumCulled = false; });
  gun.add(shards, cracks);
  const sm = new THREE.Matrix4(), sq = new THREE.Quaternion(), sp = new THREE.Vector3(), ss = new THREE.Vector3();
  const glazes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artPhase && !glazes.includes(u.artPhase)) glazes.push(u.artPhase); });
  const M = new THREE.Matrix4(), R = new THREE.Matrix4(), T = new THREE.Matrix4();
  for (const r of reliefs) r.group.matrixAutoUpdate = false;
  let phase = -1;
  return {
    clip: KILN_CLIP, seconds: VESPER_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const g of glazes) g.value = active ? p : -1;
      for (const m of glints) m.visible = active && p > 0.15;
      // burst (0.36-0.46), caught in time and stuttering (to 0.62), then rewinding into the gun (to 0.74)
      const out = active ? smooth(p, 0.36, 0.46) * (1 - smooth(p, 0.62, 0.74)) : 0;
      const caught = active && p > 0.46 && p < 0.62, tick = Math.floor(p * 160);
      shards.visible = out > 0.002;
      if (shards.visible) {
        shard.forEach((h, i) => {
          const j = caught ? (((tick * 31 + i * 17) % 7) - 3) * 0.0012 : 0;      // the stutter: jumps between frozen frames
          sp.copy(h.at).addScaledVector(h.dir, h.dist * out + j);
          sq.setFromAxisAngle(h.axis, h.turn * out + (caught ? j * 40 : 0));
          ss.setScalar(h.size * Math.min(1, out * 3));
          shards.setMatrixAt(i, sm.compose(sp, sq, ss));
        });
        shards.instanceMatrix.needsUpdate = true;
      }
      // the breaks spread from their impact points, flicker while time is caught, then seal
      const spread = active ? smooth(p, 0.42, 0.47) : 0, seal = active ? 1 - smooth(p, 0.6, 0.67) : 0;
      cracks.visible = spread * seal > 0.01;
      for (const pane of panes) pane.scale.setScalar(Math.max(0.001, spread));
      strand.opacity = spread * seal * (0.75 + 0.25 * ((tick % 3) / 2));
      // the rifts tear open after the cracks, hold while time is caught, then close before the seal
      const open = active ? smooth(p, 0.46, 0.52) * (1 - smooth(p, 0.58, 0.64)) : 0;
      riftU.uOpen.value = open; riftU.uTime.value = active ? p * VESPER_SECONDS : 0;
      for (const r of rifts) r.scale.set(r.userData.R * Math.max(0.001, open), r.userData.R * (0.6 + 0.4 * open), 1);
      spores.visible = open > 0.01; spores.material.opacity = open * 0.9;
      if (spores.visible) {
        const pos = sporeGeo.attributes.position, w = new THREE.Vector3();
        spore.forEach((s, i) => {
          const age = ((p - 0.46) / 0.18 + s.t0) % 1;
          w.set(s.x * open, s.y, 0).addScaledVector(s.v, age).applyMatrix4(s.pane.matrix);
          pos.setXYZ(i, w.x, w.y, w.z);
        });
        pos.needsUpdate = true;
      }
      trail.update(active ? p * VESPER_SECONDS : -1);
      const turn = active ? smooth(p, VESPER_PEAK - 0.1, VESPER_PEAK + 0.04) * (1 - smooth(p, 0.74, 0.9)) * 0.17 : 0;   // about 10 degrees
      for (const r of reliefs) {
        // turn about the rose window's centre, around the gun's side normal
        R.makeRotationX(turn * Math.sign(r.normal.x || 1));
        M.makeTranslation(r.base.x, r.ring[1], r.ring[0]).multiply(R).multiply(T.makeTranslation(0, -r.ring[1], -r.ring[0]));
        r.group.matrix.copy(M);
      }
    },
    dispose() { for (const m of [...glints, shards]) { m.geometry.dispose(); m.material.dispose(); } cracks.traverse(o => o.geometry?.dispose()); strand.dispose(); riftMat.dispose(); spores.material.dispose(); },
  };
}
