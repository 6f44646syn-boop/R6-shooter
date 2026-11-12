import * as THREE from '../../vendor/three/three.module.min.js?v=eca0e5a-mwdi3x0w';
import { mulberry32 } from '../core/prng.js?v=eca0e5a-mwdi3x0w';
import { mergeStatic } from './sight-model.js?v=eca0e5a-mwdi3x0w';

const FROST_SECONDS = 4.35, FROST_PEAK = 0.59;
// The Legendaries' inspects run twice as long as an ordinary one (8.4 s).
const SAKURA_SECONDS = 8.4, SAKURA_PEAK = 0.54;
const KILN_SECONDS = 8.4, KILN_PEAK = 0.57;
const ABYSS_SECONDS = 8.4, ABYSS_PEAK = 0.57;
const VESPER_SECONDS = 8.4, VESPER_PEAK = 0.57;
const FORGE_SECONDS = 8.4, FORGE_PEAK = 0.57;
const ORRERY_SECONDS = 8.4;
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
        #ifdef SPRAY
          // a fine sea spray: tiny droplets flicked up off the crest, hanging, then falling back
          vec3 flickUp = normalize(outward * 0.6 + vec3(0.0, 1.0, 0.0) + (seed.xyz - 0.5) * 0.8);
          origin = (emitted * vec4(emitter, 1.0)).xyz + flickUp * mix(0.15, 0.35, seed.w) * age - vec3(0.0, 0.6 * age * age, 0.0);
          radius = vec2(1.0) * mix(0.0005, 0.0011, seed.z);
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
          origin = (emitted * vec4(emitter, 1.0)).xyz + outward * mix(0.7, 1.2, seed.w) * age;
          radius = vec2(0.0016, mix(0.03, 0.07, seed.z));
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
          radius = vec2(1.0) * mix(0.0025, 0.006, seed.z);
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
        #ifdef SPARK
          // flicked off the seam, fast, then arcing down
          vec3 flick = normalize(outward + (seed.xyz - 0.5) * 1.3 + vec3(0.0, 0.5, 0.0));
          origin = (emitted * vec4(emitter, 1.0)).xyz + flick * mix(0.25, 0.6, seed.w) * age - vec3(0.0, 0.9 * age * age, 0.0);
          radius = vec2(1.0) * mix(0.0006, 0.0013, seed.z);
        #endif
        #ifdef FLAME
          // tongues of fire licking up off the skin: buoyant (faster as they rise), turbulent, and
          // shrinking as they burn out at the tip
          float rise = age * mix(0.07, 0.11, seed.w) + age * age * 0.35;
          origin = (emitted * vec4(emitter, 1.0)).xyz + outward * 0.004
            + vec3(sin(s + age * 19.0) * 0.003 * (0.3 + rise * 20.0), rise, cos(s * 1.7 + age * 15.0) * 0.002 * (0.3 + rise * 20.0));
          radius = vec2(0.75, 1.5) * mix(0.01, 0.022, seed.z) * smoothstep(0.0, 0.12, p) * (1.0 - 0.65 * p);
          spin = 0.0;
        #endif
        #ifdef SMOKE
          origin = (emitted * vec4(emitter, 1.0)).xyz + vec3(sin(s + age * 3.0) * 0.006, 0.03 + age * 0.09, 0.0);
          radius = vec2(1.0) * mix(0.012, 0.02, seed.z) * (0.5 + p * 1.6);
          spin = s + age * 0.8;
        #endif
        #ifdef EMBER
          // the heat shimmer: tiny embers wavering up off the seam
          origin = (emitted * vec4(emitter, 1.0)).xyz + outward * 0.004 + vec3(sin(s + age * 9.0) * 0.002, age * mix(0.03, 0.06, seed.w), 0.0);
          radius = vec2(1.0) * mix(0.0005, 0.001, seed.z);
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
      a = vAlpha * (0.14 + rimB * 0.75 + glint * 0.8);
    #elif defined(SPECK)
      float r = dot(p, p);
      if (r >= 1.0) discard;
      c = tint * 1.6;
      a = vAlpha * exp(-3.0 * r) * (0.6 + 0.4 * sin(vAge * 30.0 + vSeed.x * 20.0));
    #elif defined(FLAME)
      float r = dot(p, p);
      if (r >= 1.0) discard;
      // a teardrop, round below and drawn to a point above, flickering; white-yellow at the hot
      // core, orange, then red at the edges and as it burns out
      vec2 q = vec2(p.x * (1.0 + max(p.y, 0.0) * 1.2), p.y);
      float shape = 1.0 - smoothstep(0.25, 1.0, length(q));
      float flick = 0.75 + 0.25 * sin(vAge * 40.0 + vSeed.x * 30.0 + p.y * 6.0);
      float temp = shape * (1.0 - vAge) * flick;
      c = mix(vec3(0.75, 0.08, 0.0), vec3(1.0, 0.45, 0.04), smoothstep(0.1, 0.5, temp));
      c = mix(c, vec3(1.0, 0.86, 0.5), smoothstep(0.6, 0.95, temp));
      a = vAlpha * shape * pow(1.0 - vAge, 1.3) * 0.9;
    #elif defined(SMOKE)
      float r = dot(p, p);
      if (r >= 1.0) discard;
      c = vec3(0.09, 0.08, 0.08);
      a = vAlpha * 0.28 * exp(-2.5 * r) * (1.0 - vAge) * smoothstep(0.0, 0.2, vAge);
    #elif defined(WIND)
      a = vAlpha * 0.3 * (1.0 - smoothstep(0.0, 1.0, abs(p.x))) * (1.0 - smoothstep(0.3, 1.0, abs(p.y)));
      c = vec3(0.9, 0.95, 1.0);
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

const particleBudget = { mist: [22, 38, 54, 70], chip: [20, 34, 48, 62], petal: [28, 46, 64, 84], drop: [14, 22, 30, 40], drip: [80, 140, 200, 260], seaspray: [60, 100, 150, 200], seamist: [14, 24, 34, 44], splash: [120, 200, 300, 400], jet: [160, 280, 400, 520], wind: [15, 25, 35, 45], gather: [40, 70, 100, 130], burst: [40, 70, 100, 140], spark: [16, 26, 36, 48], flame: [140, 240, 340, 460], smoke: [16, 26, 36, 48], ember: [20, 34, 48, 64], bubble: [120, 200, 300, 400], speck: [10, 16, 22, 30], glint: [60, 100, 150, 200] };
const particleTier = { low: 0, standard: 1, high: 2, ultra: 3 };

function particles(kind, tier, anchors, tint, trail, rng) {
  const mist = kind === 'mist', petals = kind === 'petal', drops = ['drop', 'drip', 'splash', 'jet', 'wind', 'seaspray', 'seamist'].includes(kind), deep = ['bubble', 'speck', 'glint', 'gather', 'burst', 'spark', 'ember', 'flame', 'smoke'].includes(kind);
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
    } else if (kind === 'seaspray') {                     // fine spray flicked up off the painted crests, all through
      start = seconds * (0.18 + 0.65 * rng());
      life = 0.4 + rng() * 0.3;
    } else if (kind === 'seamist') {                      // and a fine mist rising off them
      start = seconds * (0.15 + 0.68 * rng());
      life = 1.0 + rng() * 0.5;
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
    } else if (kind === 'spark') {                        // hot sparks off the split, around the peak
      start = peak + (-0.15 + rng() * 0.7) * k;
      life = 0.3 + rng() * 0.3;
    } else if (kind === 'bubble') {                       // bubbling off the whole gun from the start
      start = seconds * (0.02 + 0.82 * rng());
      life = 0.9 + rng() * 0.7;
    } else if (kind === 'flame') {                        // the gun on fire while it is molten
      start = seconds * (0.38 + 0.4 * rng());
      life = 0.35 + rng() * 0.35;
    } else if (kind === 'smoke') {                        // a little smoke rolling off the flames
      start = seconds * (0.42 + 0.4 * rng());
      life = 1.0 + rng() * 0.6;
    } else if (kind === 'ember') {                        // the shimmer: embers rising off the seam while it is hot
      start = (1.4 + rng() * 3.4) * k;
      life = 0.7 + rng() * 0.6;
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
  const defines = kind === 'seamist' ? { MIST: 1 } : kind === 'seaspray' ? { DROP: 1, SPRAY: 1 } : kind === 'jet' ? { DROP: 1, JET: 1 } : kind === 'wind' ? { WIND: 1 } : kind === 'gather' ? { SPECK: 1, GATHER: 1 } : kind === 'burst' ? { SPECK: 1, BURST: 1 } : kind === 'spark' ? { SPECK: 1, SPARK: 1 } : kind === 'ember' ? { SPECK: 1, EMBER: 1 } : kind === 'flame' ? { FLAME: 1 } : kind === 'smoke' ? { SMOKE: 1 } :
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
export function kilnInspect(gun, { reliefs, under, surface, muzzle, charm }, quality) {
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
  // sea spray and a fine mist rising off the blue crests painted along the barrel (the front half)
  const crests = surface.filter(a => a.point.z < -0.15);
  const crestFrom = crests.length ? crests : spray.length ? spray : [{ point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) }];
  const seaSpray = particles('seaspray', tier, crestFrom, new THREE.Color(0xdcecff), trail, mulberry32(202131));
  const seaMist = particles('seamist', tier, crestFrom, new THREE.Color(0xe6f0ff), trail, mulberry32(202143));
  drops.visible = splash.visible = jet.visible = wind.visible = seaSpray.visible = seaMist.visible = false;
  gun.add(seaMist, drops, splash, jet, wind, seaSpray);
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
      drops.visible = splash.visible = jet.visible = wind.visible = seaSpray.visible = seaMist.visible = active && p > 0.12;
      trail.update(active ? p * KILN_SECONDS : -1);
      reliefs.forEach((r) => {
        const k = order.indexOf(Math.round(r.base.z * 1000)), start = 0.17 + k * 0.045;
        const lift = active ? smooth(p, start, start + 0.12) * (1 - smooth(p, 0.72, 0.93)) : 0;
        // the crest surges once at the peak, above the rest
        const surge = r.crest && active ? Math.sin(smooth(p, KILN_PEAK - 0.08, KILN_PEAK + 0.06) * Math.PI) * 0.007 : 0;
        r.group.position.copy(r.base).addScaledVector(r.normal, lift * (r.crest ? 0.012 : 0.008) + surge);
      });
      // the charm thrashes in the wind, blown towards the muzzle
      if (charm) {
        const gust = active ? smooth(p, 0.15, 0.3) * (1 - smooth(p, 0.82, 0.95)) : 0, t = p * KILN_SECONDS;
        charm.rotation.x = gust * (0.75 + 0.3 * Math.sin(t * 23) + 0.18 * Math.sin(t * 41));
        charm.rotation.z = gust * 0.35 * Math.sin(t * 17 + 1.3) + (active ? 0 : 0);
      }
    },
    dispose() { for (const m of [drops, splash, jet, wind, seaSpray, seaMist]) { m.geometry.dispose(); m.material.dispose(); } },
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
export function abyssInspect(gun, { reliefs, dials, muzzle, surface, under }, quality) {
  const trail = emitterTrail(gun), tier = particleTier[quality] ?? 1;
  const anchors = reliefs.map(r => ({ point: r.base.clone().add(new THREE.Vector3(0, ...(r.ring ? [r.ring[1], r.ring[0]] : [0, 0]))), normal: r.normal.clone() }));
  const fallback = [{ point: new THREE.Vector3(), normal: new THREE.Vector3(1, 0, 0) }];
  const allOver = [...anchors, ...surface, ...under];
  const bubbles = particles('bubble', tier, allOver.length ? allOver : fallback, new THREE.Color(0x9ff5e6), trail, mulberry32(203011));
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
      bubbles.visible = active; specks.visible = active && p > 0.3;
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
  // A tear in space: a long jagged slit with a glowing pale green / cyan lip, and inside another world,
  // deep blue going to crimson with drifting wisps. It starts as a thin glowing crack and opens wide.
  const riftMat = new THREE.ShaderMaterial({ uniforms: Object.assign(riftU, { uShow: { value: 0 } }), transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `attribute float aW; uniform float uOpen; varying float vEdge, vU;
      void main(){ vEdge = abs(sign(aW)); vU = position.x; vec3 q = position; q.y += aW * max(uOpen, 0.04);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0); }`,
    fragmentShader: `uniform float uTime, uOpen, uShow; varying float vEdge, vU;
      void main(){
        float rim = smoothstep(0.55, 1.0, vEdge);
        vec3 lip = mix(vec3(0.6, 1.0, 0.55), vec3(0.45, 0.9, 1.0), sin(vU * 9.0 + uTime * 1.5) * 0.5 + 0.5) * 2.2;
        vec3 deep = vec3(0.10, 0.05, 0.42), crimson = vec3(0.55, 0.04, 0.17);
        vec3 c = mix(crimson, deep, clamp(smoothstep(0.05, 0.8, vEdge) + 0.25 * sin(vU * 3.0 + uTime * 0.6), 0.0, 1.0));
        float wisp = pow(abs(sin(vU * 13.0 + vEdge * 5.0 + sin(vU * 4.0 - uTime * 0.8) * 2.2)), 16.0);
        c += vec3(0.85, 0.45, 0.75) * wisp * 0.45 * (1.0 - rim);
        gl_FragColor = vec4(mix(c, lip, rim), uShow);
      }` });
  const tear = () => {             // the slit along x in -1..1: a jagged centre line with ragged top and bottom lips
    const N = 40, pos = [], w = [], idx = []; let yc = 0;
    for (let i = 0; i < N; i++) {
      const x = -1 + 2 * i / (N - 1), body = Math.pow(1 - x * x, 0.7) * 0.2;
      yc += (rng() - 0.5) * 0.07;
      pos.push(x, yc, 0, x, yc, 0, x, yc, 0);
      w.push(body * (0.6 + rng() * 0.7), 0, -body * (0.6 + rng() * 0.7));
      if (i) { const a = (i - 1) * 3, b = i * 3; idx.push(a, a + 1, b, b, a + 1, b + 1, a + 1, a + 2, b + 1, b + 1, a + 2, b + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aW', new THREE.Float32BufferAttribute(w, 1)); g.setIndex(idx);
    return g;
  };
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
    // the rift: a tear across the break, turned diagonally
    const rift = new THREE.Mesh(tear(), riftMat);
    rift.position.z = 0.0005; rift.scale.setScalar(R * 1.15); rift.rotation.z = (rng() < 0.5 ? -1 : 1) * (0.45 + rng() * 0.45);
    pane.add(rift); rifts.push(rift);
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
      // each tear shows as a glowing crack with the others, tears open while time is caught, then closes
      const open = active ? smooth(p, 0.47, 0.53) * (1 - smooth(p, 0.58, 0.63)) : 0;
      riftU.uOpen.value = open; riftU.uShow.value = spread * seal; riftU.uTime.value = active ? p * VESPER_SECONDS : 0;
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

// Forgeheart: raise the black ceramic; a dull red glow creeps under the plates and the heat front
// traces the orange seam from the handguard into the receiver (shader, artPhase). At the peak the
// plates lift just enough to show the molten channel under smoked glass, with sparks off the split
// and a shimmer of embers on the seam; then the plates settle and the orange cools to deep red.
const FORGE_CLIP = { root: [
  [0, 0, 0, 0, 0, 0, 0],
  [0.2, -0.07, 0.09, -0.1, 0.14, 0.86, 0.1],
  [0.42, -0.084, 0.1, -0.128, 0.16, 1.1, 0.04],
  [0.62, -0.088, 0.102, -0.138, 0.13, 1.14, -0.04],
  [0.8, -0.066, 0.08, -0.098, 0.12, 0.72, -0.1],
  [1, 0, 0, 0, 0, 0, 0],
] };
export function forgeInspect(gun, { reliefs, channels, seam, shards }, quality) {
  const trail = emitterTrail(gun), tier = particleTier[quality] ?? 1;
  const from = seam.length ? seam : [{ point: new THREE.Vector3(), normal: new THREE.Vector3(1, 0, 0) }];
  const sparks = particles('spark', tier, from, new THREE.Color(0xffc060), trail, mulberry32(205011));
  const embers = particles('ember', tier, from, new THREE.Color(0xff6a20), trail, mulberry32(205029));
  const flames = particles('flame', tier, from, new THREE.Color(0xff8020), trail, mulberry32(205047));
  flames.material.blending = THREE.AdditiveBlending;
  const smoke = particles('smoke', tier, from, new THREE.Color(0x222222), trail, mulberry32(205063));
  sparks.visible = embers.visible = flames.visible = smoke.visible = false;
  gun.add(smoke, sparks, embers, flames);
  // The peak, as in the owner's concept: the painting fades to the peak painting (artMix) while the
  // traced shards rise out of the sides, from the split outwards, and a starburst flares at the split.
  const [Z0, Z1, Y0, Y1] = [-0.59933, 0.37984, -0.39229, 0.26025];   // the AK-12's art rectangle (1536 x 1024 px concept)
  const split = new THREE.Vector2(Z0 + (Z1 - Z0) * 705 / 1536, Y1 - (Y1 - Y0) * 398 / 1024), half = 0.025;
  const mixes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artMix && !mixes.includes(u.artMix)) mixes.push(u.artMix); });
  // floating obsidian: a few glossy black chunks break off around the split at the peak, hang in the
  // air turning and bobbing (a lighter Vesper Glass), then are drawn back into the gun as it cools
  const frng = mulberry32(205103), nChunks = [10, 16, 22, 28][tier];
  // an irregular faceted rock: an icosahedron with its corners pushed in and out (flat shaded, so every
  // facet catches the light at its own angle)
  const chunkGeo = new THREE.IcosahedronGeometry(1, 1);
  { const pos = chunkGeo.attributes.position, v = new THREE.Vector3(), seen = new Map();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i); const key = v.toArray().map(n => n.toFixed(3)).join();
      if (!seen.has(key)) seen.set(key, 0.7 + frng() * 0.55);
      v.multiplyScalar(seen.get(key)); pos.setXYZ(i, v.x, v.y, v.z);
    }
    chunkGeo.computeVertexNormals(); }
  const chunkMat = new THREE.MeshPhysicalMaterial({ color: 0x060505, roughness: 0.12, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0xff2800, emissiveIntensity: 0.015, flatShading: true });
  const chunks = new THREE.InstancedMesh(chunkGeo, chunkMat, nChunks);
  chunks.name = 'Inspect floating obsidian'; chunks.frustumCulled = false; chunks.visible = false; gun.add(chunks);
  const chunk = Array.from({ length: nChunks }, () => {
    const side = frng() < 0.5 ? -1 : 1;
    const at = new THREE.Vector3(side * half, split.y + (frng() - 0.5) * 0.04, split.x + (frng() - 0.5) * 0.36);
    const dir = new THREE.Vector3(side * (0.6 + frng() * 0.6), frng() * 0.9 - 0.2, (frng() - 0.5) * 0.8).normalize();
    return { at, dir, dist: 0.05 + frng() * 0.12, size: new THREE.Vector3(0.005 + frng() * 0.005, 0.007 + frng() * 0.009, 0.004 + frng() * 0.004),
      axis: new THREE.Vector3(frng() - 0.5, frng() - 0.5, frng() - 0.5).normalize(), spin: 0.6 + frng() * 1.4, bob: frng() * 6.28, delay: frng() * 0.05 };
  });
  const cm = new THREE.Matrix4(), cq = new THREE.Quaternion(), cp = new THREE.Vector3(), cs = new THREE.Vector3();
  const bursts = [-1, 1].map(side => {
    const g = new THREE.Group(); g.position.set(side * (half + 0.006), split.y, split.x);
    const core = flare(new THREE.Color(0xffc060)), rayA = flare(new THREE.Color(0xff9a30)), rayB = flare(new THREE.Color(0xff9a30));
    rayA.material.rotation = 0.5; rayB.material.rotation = -0.5;
    g.add(core, rayA, rayB); g.visible = false; gun.add(g);
    return { g, core, rayA, rayB };
  });
  const order = [...new Set(reliefs.map(r => Math.round(r.base.z * 1000)))].sort((a, b) => a - b);
  const glazes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artPhase && !glazes.includes(u.artPhase)) glazes.push(u.artPhase); });
  const smoked = channels[0]?.material, hot = new THREE.Color(), deep = new THREE.Color(0xa01204), yellow = new THREE.Color(0xffc040);
  let phase = -1;
  return {
    clip: FORGE_CLIP, seconds: FORGE_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const g of glazes) g.value = active ? p : -1;
      sparks.visible = embers.visible = flames.visible = smoke.visible = active && p > 0.15;
      trail.update(active ? p * FORGE_SECONDS : -1);
      // the plates lift in turn from the handguard back, a few millimetres out and up, then settle
      reliefs.forEach((r) => {
        const k = order.indexOf(Math.round(r.base.z * 1000)), start = FORGE_PEAK - 0.14 + k * 0.03;
        const lift = active ? smooth(p, start, start + 0.08) * (1 - smooth(p, 0.7, 0.86)) : 0;
        r.group.position.copy(r.base).addScaledVector(r.normal, lift * 0.0045);
        r.group.position.y = r.base.y + lift * 0.0025;
      });
      // the floating obsidian: out from the split, hanging and bobbing, then back in
      const t = active ? p * FORGE_SECONDS : 0;
      chunks.visible = active && p > 0.4 && p < 0.88;
      if (chunks.visible) {
        chunk.forEach((c, i) => {
          const out = smooth(p, 0.42 + c.delay, 0.52 + c.delay) * (1 - smooth(p, 0.74, 0.86));
          cp.copy(c.at).addScaledVector(c.dir, c.dist * out); cp.y += Math.sin(t * 1.6 + c.bob) * 0.006 * out;
          cq.setFromAxisAngle(c.axis, c.bob + t * c.spin);
          cs.copy(c.size).multiplyScalar(Math.max(out, 0.001));
          chunks.setMatrixAt(i, cm.compose(cp, cq, cs));
        });
        chunks.instanceMatrix.needsUpdate = true;
      }
      for (const m of mixes) m.value = active ? smooth(p, 0.3, 0.46) * (1 - smooth(p, 0.76, 0.9)) : 0;
      // the shards rise out of the sides from the split outwards, hold through the peak, then sink back
      for (const sh of shards) {
        const k = active ? smooth(p, sh.start, sh.start + 0.07) * (1 - smooth(p, 0.74, 0.86)) : 0;
        sh.group.visible = k > 0.01;
        sh.group.scale.x = Math.max(k, 0.01);
        sh.group.position.copy(sh.base); sh.group.position.x = sh.side * (half + (sh.base.x * sh.side - half) * k + 0.004 * k);
      }
      const burst = active ? smooth(p, 0.4, 0.5) * (1 - smooth(p, 0.72, 0.84)) : 0, flick = 0.85 + 0.15 * Math.sin(p * 220);
      for (const b of bursts) {
        b.g.visible = burst > 0.01;
        b.core.scale.setScalar(0.1 * burst * flick);
        b.rayA.scale.set(0.34 * burst * flick, 0.018 * burst, 1); b.rayB.scale.set(0.26 * burst * flick, 0.015 * burst, 1);
      }
      if (smoked) {
        const glow = active ? smooth(p, FORGE_PEAK - 0.16, FORGE_PEAK - 0.04) * (1 - smooth(p, 0.72, 0.9)) : 0;
        const cool = active ? smooth(p, FORGE_PEAK + 0.04, 0.85) : 0;          // yellow at the peak, deep red as it lowers
        smoked.emissive.copy(hot.copy(yellow).lerp(deep, cool));
        smoked.emissiveIntensity = glow * 4;
      }
    },
    dispose() { for (const m of [sparks, embers, flames, smoke]) { m.geometry.dispose(); m.material.dispose(); } for (const b of bursts) b.g.traverse(o => o.material?.dispose()); chunkGeo.dispose(); chunkMat.dispose(); },
  };
}

// Midnight Orrery: a portal opens behind the gun, bigger than it, onto deep space; planets and stars
// fly out of it and orbit the gun, the orbit travelling from the stock to the barrel, then they are
// drawn back in and the portal closes.
const PORTAL_VERTEX = 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const PORTAL_FRAGMENT = `uniform float uTime, uOpen, uR; varying vec2 vP;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f *= f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1)), f.x), f.y); }
  void main() {
    float o = max(uOpen, 0.001), r = length(vP) / (uR * o), a = atan(vP.y, vP.x);
    // the edge wavers like a flame front
    vec2 dir = vec2(cos(a), sin(a));                      // (noise on the direction: no seam where the angle wraps)
    float e = 1.0 + 0.035 * (n(dir * 3.0 + uTime * 0.6) - 0.5) + 0.02 * sin(a * 9.0 + uTime * 2.0);
    vec3 c = vec3(0.0); float alpha = 0.0;
    if (r < e) {
      // inside: the nebula turns, faster towards the eye of the portal
      float tw = a + uTime * 0.35 + (1.0 - r) * 2.5;
      vec2 q = vec2(cos(tw), sin(tw)) * r * 3.0;
      float neb = n(q * 2.0 + uTime * 0.1) * 0.6 + n(q * 4.5 - uTime * 0.07) * 0.4;
      c = mix(vec3(0.01, 0.01, 0.05), vec3(0.08, 0.05, 0.3), neb);
      c += vec3(0.45, 0.12, 0.55) * pow(neb, 3.0) * (1.0 - r) * 1.4;
      c += vec3(0.1, 0.35, 0.7) * pow(n(q * 3.0 + 7.0), 4.0) * 0.8;
      vec2 sp = vP * 90.0 / o; vec2 cell = floor(sp);
      float st = h(cell); vec2 off = fract(sp) - 0.5 - (vec2(h(cell + 3.1), h(cell + 7.7)) - 0.5) * 0.6;
      c += vec3(1.0, 0.95, 0.85) * step(0.93, st) * smoothstep(0.12, 0.0, length(off)) * (0.6 + 0.4 * sin(uTime * 4.0 + st * 50.0));
      c += vec3(0.6, 0.45, 0.9) * smoothstep(0.7, 1.0, r / e) * 0.35;
      alpha = 0.96;
    }
    // the burning rim: white-gold at the edge, gold, then violet wisps streaming off it
    float d = r - e;
    float rim = exp(-abs(d) * 60.0);
    float wisps = n(dir * 6.0 + vec2(uTime * 0.6, r * 9.0 - uTime * 1.8)) * n(dir * 11.0 + vec2(r * 5.0, -uTime * 0.4));
    float halo = d > 0.0 ? exp(-d * 9.0) * (0.35 + 1.4 * wisps) : 0.0;
    c += vec3(1.0, 0.92, 0.7) * rim * 2.2 + vec3(1.0, 0.65, 0.2) * exp(-abs(d) * 18.0) * 0.8;
    c += mix(vec3(0.95, 0.6, 0.2), vec3(0.55, 0.25, 0.95), smoothstep(0.0, 0.2, d)) * halo;
    // an astrolabe ring around it: a fine gold circle with ticks, and twelve stars, turning slowly
    float ra = abs(r - 1.2), aa = a + uTime * 0.15;
    float ring = exp(-ra * 400.0) + step(0.82, fract(aa * 72.0 / 6.2832)) * step(ra, 0.025) * step(r, 1.2);
    float signs = smoothstep(0.03, 0.0, length(vec2(fract((a - uTime * 0.1) * 12.0 / 6.2832) - 0.5, (r - 1.3) * 6.0))) ;
    c += vec3(1.0, 0.8, 0.4) * (ring * 0.9 + signs * 2.0);
    alpha = max(alpha, clamp(rim + halo * 0.8 + ring * 0.8 + signs + exp(-abs(d) * 18.0) * 0.6, 0.0, 1.0));
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(c, alpha);
  }`;
const STAR_VERTEX = `attribute float size; varying float vTw; uniform float uTime;
  void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vTw = 0.6 + 0.4 * sin(uTime * 6.0 + size * 900.0);
    gl_PointSize = size * 900.0 / -mv.z; gl_Position = projectionMatrix * mv; }`;
const STAR_FRAGMENT = `uniform float uOpacity; varying float vTw;
  void main() { vec2 p = gl_PointCoord * 2.0 - 1.0;
    float core = exp(-dot(p, p) * 9.0), rays = exp(-abs(p.x) * 14.0) * exp(-abs(p.y) * 2.5) + exp(-abs(p.y) * 14.0) * exp(-abs(p.x) * 2.5);
    gl_FragColor = vec4(vec3(1.0, 0.92, 0.75) * (core + rays * 0.7) * vTw, uOpacity * (core + rays * 0.7)); }`;
export function orreryInspect(gun, { surface, under }, quality) {
  const trail = emitterTrail(gun);
  const pts = [...surface, ...under].map(a => a.point);
  const zs = pts.map(v => v.z), ys = pts.map(v => v.y);
  const zMin = pts.length ? Math.min(...zs) : -0.3, zMax = pts.length ? Math.max(...zs) : 0.3;
  const yMid = pts.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  const centre = new THREE.Vector3(0, yMid, (zMin + zMax) / 2), length = zMax - zMin;
  // the portal: a disc that always sits behind the gun as you look at it, facing you
  const R = length * 0.75, portalU = { uTime: { value: 0 }, uOpen: { value: 0 }, uR: { value: R } };
  const portal = new THREE.Mesh(new THREE.CircleGeometry(R * 1.45, 96), new THREE.ShaderMaterial({ uniforms: portalU, vertexShader: PORTAL_VERTEX, fragmentShader: PORTAL_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  portal.name = 'Inspect portal'; portal.frustumCulled = false; portal.visible = false; portal.renderOrder = -1;
  const portalAt = centre.clone(), cam = new THREE.Vector3();
  portal.onBeforeRender = (renderer, scene, camera) => {
    gun.updateMatrixWorld();
    cam.setFromMatrixPosition(camera.matrixWorld);
    const local = gun.worldToLocal(cam.clone());
    portalAt.copy(centre).addScaledVector(local.sub(centre).normalize(), -0.22);
    portal.position.copy(portalAt);
    portal.lookAt(cam);
    portal.updateMatrixWorld();
  };
  gun.add(portal);
  // the planets: each its own colour, one ringed; and a swarm of stars
  const rng = mulberry32(206017), tier = particleTier[quality] ?? 1;
  const planetCols = [0xe8c070, 0x7fb6ff, 0xd0603a, 0x9a6ad8, 0x5fd0c0, 0xf0e6d0];
  const planets = planetCols.map((col, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.01 + rng() * 0.009, 24, 16), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.6, metalness: 0.1 }));
    if (i === 0) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.032, 48), new THREE.MeshBasicMaterial({ color: 0xf2d9a0, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
      ring.rotation.x = 1.2; m.add(ring);
    }
    m.visible = false; gun.add(m);
    return { m, r: 0.07 + rng() * 0.07, a0: rng() * Math.PI * 2, speed: 2.2 + rng() * 2.2, dz: (rng() - 0.5) * 0.12, tilt: 0.6 + rng() * 0.4, delay: i * 0.012 };
  });
  const nStars = [50, 90, 130, 170][tier];
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nStars * 3), 3));
  starGeo.setAttribute('size', new THREE.BufferAttribute(Float32Array.from({ length: nStars }, () => 0.006 + rng() * 0.008), 1));
  const starU = { uTime: { value: 0 }, uOpacity: { value: 0 } };
  const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({ uniforms: starU, vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  stars.name = 'Inspect stars'; stars.frustumCulled = false; stars.visible = false; gun.add(stars);
  // stardust: gold glints drifting off the gun's skin
  const dust = particles('glint', tier, surface.length ? surface : [{ point: centre.clone(), normal: new THREE.Vector3(1, 0, 0) }], new THREE.Color(0xffd890), trail, mulberry32(206041));
  dust.visible = false; gun.add(dust);
  const star = Array.from({ length: nStars }, () => ({ r: 0.05 + rng() * 0.12, a0: rng() * Math.PI * 2, speed: 1.5 + rng() * 3, dz: (rng() - 0.5) * length * 0.5, tilt: 0.5 + rng() * 0.5, delay: rng() * 0.06 }));
  const glazes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artPhase && !glazes.includes(u.artPhase)) glazes.push(u.artPhase); });
  const at = new THREE.Vector3(), orbit = new THREE.Vector3();
  // where a body is: out of the portal, into its orbit (the orbit's centre travelling stock to barrel), back in
  const place = (b, p, t, out) => {
    const zc = zMax + (zMin - zMax) * smooth(p, 0.3, 0.8) + b.dz;
    const a = b.a0 + b.speed * t;
    orbit.set(Math.cos(a) * b.r, yMid + Math.sin(a) * b.r * b.tilt, zc);
    const go = smooth(p, 0.2 + b.delay, 0.32 + b.delay), back = smooth(p, 0.82 + b.delay * 0.5, 0.93);
    return out.copy(portalAt).lerp(orbit, go * (1 - back));
  };
  let phase = -1;
  return {
    clip: KILN_CLIP, seconds: ORRERY_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const g of glazes) g.value = active ? p : -1;
      const t = active ? p * ORRERY_SECONDS : 0;
      const open = active ? smooth(p, 0.1, 0.24) * (1 - smooth(p, 0.9, 0.98)) : 0;
      portal.visible = open > 0.005; portalU.uOpen.value = Math.max(open, 0.001); portalU.uTime.value = t;
      const out = active ? smooth(p, 0.2, 0.3) * (1 - smooth(p, 0.9, 0.96)) : 0;
      for (const b of planets) {
        b.m.visible = out > 0.01;
        if (!b.m.visible) continue;
        place(b, p, t, b.m.position);
        b.m.scale.setScalar(Math.max(0.001, out));
        b.m.rotation.y = t * 1.5;
      }
      stars.visible = out > 0.01; starU.uOpacity.value = out; starU.uTime.value = t;
      dust.visible = active && p > 0.15; trail.update(active ? t : -1);
      if (stars.visible) {
        const pos = starGeo.attributes.position;
        star.forEach((b, i) => { place(b, p, t, at); pos.setXYZ(i, at.x, at.y, at.z); });
        pos.needsUpdate = true;
      }
    },
    dispose() {
      portal.geometry.dispose(); portal.material.dispose(); starGeo.dispose(); stars.material.dispose(); dust.geometry.dispose(); dust.material.dispose();
      for (const b of planets) { b.m.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
    },
  };
}

// Amber Reliquary: the resin sloshes in its window (shader); silver fern fronds grow and unfurl from the
// painted fern on the handguard; and a prehistoric fly buzzes round the gun, then crashes into it and
// tumbles away. The fern paths are in concept pixels (06-amber-reliquary.png, 1536 x 1024).
const AMBER_SECONDS = 8.4;
export function amberInspect(gun, art, quality) {
  const [Z0, Z1, Y0, Y1] = [-0.32516, 0.28071, -0.26153, 0.14224];      // the MP5K's art rectangle
  const P = ([x, y]) => new THREE.Vector3(0, Y1 - (Y1 - Y0) * y / 1024, Z0 + (Z1 - Z0) * x / 1536);
  const half = 0.023, rng = mulberry32(207011);
  const silver = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, metalness: 1, roughness: 0.28 });
  const leafGeo = new THREE.SphereGeometry(1, 8, 6);
  const FRONDS = [
    [[310, 470], [298, 420], [325, 360], [385, 305], [470, 278]],
    [[335, 385], [430, 372], [530, 392], [630, 420], [705, 442]],
    [[720, 455], [790, 440], [880, 470]],
    // ... and on over the whole gun: above and below the amber, onto the stock, down the magazine and grip
    [[560, 268], [700, 256], [850, 262], [1000, 252], [1120, 264]],
    [[700, 445], [820, 456], [950, 444], [1080, 432]],
    [[1180, 300], [1260, 330], [1330, 380], [1400, 450]],
    [[560, 520], [545, 620], [525, 720], [505, 800]],
    [[950, 525], [985, 610], [1025, 700], [1060, 770]],
  ];
  const fronds = [];
  for (const side of [-1, 1]) for (const f of FRONDS) {
    const pts = f.map(P).map(v => { v.x = side * (half + 0.0015); return v; });
    const curve = new THREE.CatmullRomCurve3(pts), len = curve.getLength(), segs = Math.ceil(len / 0.003);
    const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, 0.0015, 5, false), silver);
    stem.geometry.setDrawRange(0, 0); stem.visible = false; gun.add(stem);
    const leaves = [];
    const n = Math.floor(len / 0.0055);
    for (let i = 1; i < n; i++) {
      const t = i / n, at = curve.getPointAt(t), tan = curve.getTangentAt(t), size = 0.0068 * (1 - t * 0.6);
      for (const k of [-1, 1]) {
        // a leaflet off each side of the stem, angled towards the tip, lying on the gun's side
        const out = new THREE.Vector3(0, -tan.z, tan.y).multiplyScalar(k).addScaledVector(tan, 0.6).normalize();
        const leaf = new THREE.Mesh(leafGeo, silver);
        leaf.position.copy(at).addScaledVector(out, size * 0.9); leaf.position.x = side * (half + 0.0018);
        leaf.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
        leaf.userData.base = new THREE.Vector3(size * 0.32, size, size * 0.12);
        leaf.scale.setScalar(0.0001); leaf.visible = false; gun.add(leaf);
        leaves.push({ leaf, t });
      }
    }
    fronds.push({ stem, leaves, count: stem.geometry.index.count, start: 0.1 + rng() * 0.16 });
  }
  // the fly: a big prehistoric one, amber-brown, with long veined wings
  const fly = new THREE.Group(), body = new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.45, metalness: 0.2 });
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 14, 10), body);
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), body); abdomen.scale.set(0.0045, 0.004, 0.011); abdomen.position.z = -0.012;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.0038, 12, 8), body); head.position.z = 0.0075;
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x8a1c0c, roughness: 0.2, metalness: 0.3 });
  for (const k of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 10, 8), eyeMat); e.position.set(k * 0.0025, 0.001, 0.009); fly.add(e); }
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.bezierCurveTo(0.006, 0.004, 0.022, 0.006, 0.026, 0.001); wingShape.bezierCurveTo(0.02, -0.004, 0.006, -0.003, 0, 0);
  const wingMat = new THREE.MeshPhysicalMaterial({ color: 0xe8dcc0, transparent: true, opacity: 0.4, roughness: 0.1, iridescence: 0.8, side: THREE.DoubleSide, depthWrite: false });
  const wings = [-1, 1].map(k => {
    const pivot = new THREE.Group(); pivot.position.set(k * 0.004, 0.003, 0);
    const w = new THREE.Mesh(new THREE.ShapeGeometry(wingShape), wingMat); w.rotation.set(Math.PI / 2, 0, k < 0 ? Math.PI : 0); w.rotation.y = k * -0.5;
    pivot.add(w); fly.add(pivot); return { pivot, k };
  });
  fly.add(thorax, abdomen, head); fly.visible = false; gun.add(fly);
  // which side of the gun faces the camera (it crashes into that one)
  let viewSide = 1; const camAt = new THREE.Vector3();
  thorax.onBeforeRender = (renderer, scene, camera) => { camAt.setFromMatrixPosition(camera.matrixWorld); gun.worldToLocal(camAt); viewSide = Math.sign(camAt.x) || 1; };
  fly.scale.setScalar(2.2);                                          // a giant, as prehistoric flies were
  const impactFlash = flare(new THREE.Color(0xffd890)); impactFlash.visible = false; gun.add(impactFlash);
  // the hit: a shockwave ring spreading over the surface, and a puff of amber dust off it (one per side)
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40), ringMat); ring.visible = false; gun.add(ring);
  const trail = emitterTrail(gun), tier = particleTier[quality] ?? 1;
  const pts = [...(art.surface || [])].map(a => a.point);
  const yMid = pts.length ? pts.reduce((a, v) => a + v.y, 0) / pts.length : 0, zMid = (Z0 + Z1) / 2;
  const target = P([600, 330]);                                       // it hits the amber window
  const flyAt = (t) => new THREE.Vector3(Math.cos(t * 2.3) * 0.11 + 0.006 * Math.sin(t * 19), yMid + 0.06 + 0.035 * Math.sin(t * 3.1) + 0.005 * Math.sin(t * 27), zMid + Math.sin(t * 2.3) * 0.22 + 0.008 * Math.sin(t * 23));
  const glazes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artPhase && !glazes.includes(u.artPhase)) glazes.push(u.artPhase); });
  const puffs = [-1, 1].map(k => {
    const at = target.clone(); at.x = k * (half + 0.004);
    const m = particles('burst', tier, [{ point: at, normal: new THREE.Vector3(k, 0.2, 0).normalize() }], new THREE.Color(0xe8b060), trail, mulberry32(207031 + k));
    m.visible = false; gun.add(m); return m;
  });
  const fwd = new THREE.Vector3(0, 0, 1), dir = new THREE.Vector3(), hit = new THREE.Vector3();
  const b0 = new THREE.Vector3(), b1 = new THREE.Vector3(), b2 = new THREE.Vector3(), b3 = new THREE.Vector3(), q = new THREE.Vector3();
  // a cubic Bezier: from where it was buzzing, out away from the gun, round in a turn, and straight in
  const bez = (u, out) => { const v = 1 - u; return out.copy(b0).multiplyScalar(v * v * v).addScaledVector(b1, 3 * v * v * u).addScaledVector(b2, 3 * v * u * u).addScaledVector(b3, u * u * u); };
  const DIVE = 0.55, IMPACT = 0.69;                                   // (the dust puff is timed to the impact)
  let phase = -1, side = 1;
  return {
    clip: KILN_CLIP, seconds: AMBER_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const g of glazes) g.value = active ? p : -1;
      const t = active ? p * AMBER_SECONDS : 0;
      // the fronds grow from their roots and their leaflets unfurl as the stem reaches them
      for (const f of fronds) {
        const grow = active ? smooth(p, f.start, f.start + 0.3) * (1 - smooth(p, 0.86, 0.97)) : 0;
        f.stem.visible = grow > 0.005;
        f.stem.geometry.setDrawRange(0, Math.floor(f.count * grow / 6) * 6);
        for (const l of f.leaves) {
          const k = smooth(grow, l.t - 0.02, l.t + 0.12);
          l.leaf.visible = k > 0.01; l.leaf.scale.copy(l.leaf.userData.base).multiplyScalar(Math.max(k, 0.0001));
        }
      }
      // the fly
      fly.visible = active && p > 0.1 && p < 0.92;
      impactFlash.visible = false;
      if (fly.visible) {
        let flap = 1;
        if (p < DIVE) {
          fly.position.copy(flyAt(t)); dir.copy(flyAt(t + 0.03)).sub(fly.position).normalize();
          fly.quaternion.setFromUnitVectors(fwd, dir);
          side = viewSide;
        } else if (p < IMPACT) {
          // it flies off away from the gun, banks round, and comes back fast into the amber window
          hit.copy(target); hit.x = side * (half + 0.006);
          b0.copy(flyAt(DIVE * AMBER_SECONDS));
          b1.copy(b0).add(new THREE.Vector3(side * 0.2, 0.06, (b0.z > hit.z ? 1 : -1) * 0.08));
          b2.copy(hit).add(new THREE.Vector3(side * 0.28, 0.05, (b0.z > hit.z ? 1 : -1) * 0.12));
          b3.copy(hit);
          const u = Math.pow((p - DIVE) / (IMPACT - DIVE), 1.5);          // slow out, fast in
          bez(u, fly.position); bez(Math.min(1, u + 0.02), q);
          dir.copy(q).sub(fly.position).normalize();
          fly.quaternion.setFromUnitVectors(fwd, dir);
          fly.rotateZ(Math.sin(u * Math.PI) * side * 0.9);                  // banking through the turn
          fly.scale.setScalar(2.2);
        } else {
          // the hit: it squashes flat against the window, then bounces back stunned, tumbling down
          const s = (p - IMPACT) * AMBER_SECONDS;
          hit.copy(target); hit.x = side * (half + 0.006);
          const squash = s < 0.08 ? 1 - Math.sin(s / 0.08 * Math.PI) * 0.45 : 1;
          const b = Math.max(0, s - 0.08);
          fly.position.copy(hit).add(new THREE.Vector3(side * (0.003 + 0.09 * b), 0.03 * b - 0.8 * b * b, 0.015 * b));
          fly.rotation.set(b * 7, b * 4, b * 13);
          fly.scale.set(2.2, 2.2, 2.2 * squash);
          flap = 0;
          impactFlash.visible = s < 0.2; impactFlash.position.copy(hit); impactFlash.scale.setScalar(0.07 * (1 - s / 0.2));
        }
        for (const w of wings) w.pivot.rotation.z = w.k * (flap ? 0.2 + 0.9 * Math.sin(t * 140) : 1.2);
      }
      // the shockwave and the dust, on the side it hit
      const hs = active ? (p - IMPACT) * AMBER_SECONDS : -1;
      ring.visible = hs >= 0 && hs < 0.35;
      if (ring.visible) {
        ring.position.copy(target); ring.position.x = side * (half + 0.0025); ring.rotation.set(0, side * Math.PI / 2, 0);
        ring.scale.setScalar(0.006 + 0.05 * Math.sqrt(hs / 0.35)); ringMat.opacity = 0.8 * (1 - hs / 0.35);
      }
      puffs[0].visible = active && side < 0; puffs[1].visible = active && side > 0;
      trail.update(active ? t : -1);
    },
    dispose() {
      silver.dispose(); leafGeo.dispose(); body.dispose(); eyeMat.dispose(); wingMat.dispose(); impactFlash.material.dispose(); ring.geometry.dispose(); ringMat.dispose();
      for (const m of puffs) { m.geometry.dispose(); m.material.dispose(); }
      for (const f of fronds) f.stem.geometry.dispose();
      fly.traverse(o => o.geometry?.dispose());
    },
  };
}

// Jade Coil: the dragon painted on the gun comes alive. It peels off the side head first (the painting
// sweeps to the bare gun behind it), coils round the gun and swims round and round it, its body
// rippling side to side, then lies back down into its painting tail first. Its body is a tube rebuilt
// each frame along its spine (carved scales, a bronze crest), with a horned head.
// The painted dragon's spine, in concept pixels (07-jade-coil.png, 1536 x 1024), head first (tools/jade-bare.py).
const JADE_SPINE = [[230, 378], [280, 360], [320, 330], [370, 330], [420, 370], [470, 430], [530, 445], [590, 410], [640, 360], [700, 330], [760, 345],
  [830, 390], [900, 440], [960, 460], [1020, 430], [1080, 380], [1140, 350], [1220, 345], [1300, 335], [1370, 320], [1430, 302]];
const JADE_SECONDS = 8.4;
let scaleTex = null;
function jadeScales() {
  if (scaleTex) return scaleTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2f4f14'; g.fillRect(0, 0, 64, 64);
  for (let row = -1; row < 5; row++) for (let col = -1; col < 5; col++) {
    const x = col * 16 + (row % 2 ? 8 : 0), y = row * 14;
    const r = g.createRadialGradient(x + 8, y + 4, 1, x + 8, y + 8, 11);
    r.addColorStop(0, '#d8ea7a'); r.addColorStop(0.55, '#6f9a2c'); r.addColorStop(1, '#1d340b');
    g.fillStyle = r; g.beginPath(); g.arc(x + 8, y + 2, 10, 0, Math.PI); g.fill();
  }
  scaleTex = new THREE.CanvasTexture(c); scaleTex.colorSpace = THREE.SRGBColorSpace;
  scaleTex.wrapS = scaleTex.wrapT = THREE.RepeatWrapping; scaleTex.repeat.set(24, 2);
  return scaleTex;
}
export function jadeInspect(gun, { surface }, quality) {
  const [Z0, Z1, Y0, Y1] = [-0.25133, 0.36905, -0.23606, 0.17739];     // the T-5's art rectangle
  const half = 0.023;
  const painted = new THREE.CatmullRomCurve3(JADE_SPINE.map(([x, y]) => new THREE.Vector3(0, Y1 - (Y1 - Y0) * y / 1024, Z0 + (Z1 - Z0) * x / 1536)));
  const top = surface.length ? Math.max(...surface.map(a => a.point.y)) : 0.06;
  const yc = top - 0.04, RX = 0.058, RY = 0.07;
  const N = 96, M = 12, rMax = 0.016;                                // as thick as the painted dragon
  const pos = new Float32Array(N * M * 3), uv = new Float32Array(N * M * 2), idx = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    uv[(i * M + j) * 2] = i / (N - 1); uv[(i * M + j) * 2 + 1] = j / M;
    if (i < N - 1) { const a = i * M + j, b = i * M + (j + 1) % M, c2 = a + M, d = b + M; idx.push(a, c2, b, b, c2, d); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
  const jade = new THREE.MeshPhysicalMaterial({ color: 0xb8d49c, map: jadeScales(), bumpMap: jadeScales(), bumpScale: 1.5, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.6, sheenColor: 0xd8f070, emissive: 0x1c3008, emissiveIntensity: 0.6 });
  const body = new THREE.Mesh(geo, jade); body.frustumCulled = false; body.visible = false; gun.add(body);
  // the head, built at full size facing +z with +y up: cranium, a long snout and nose, a jaw that
  // opens, brows over gold eyes, two long horns swept back, a jade mane, and trailing whiskers
  const head = new THREE.Group(), bronze = new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.28 });
  const blob = (sx, sy, sz, x, y, z, mat = jade) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); return m; };
  const tube = (pts, r0, r1, mat) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), g = new THREE.TubeGeometry(curve, 16, 1, 6, false);
    const pa = g.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= 16; i++) { curve.getPointAt(i / 16, c); const r = r0 + (r1 - r0) * i / 16; for (let j = 0; j <= 6; j++) { const n = i * 7 + j; v.fromBufferAttribute(pa, n).sub(c).multiplyScalar(r).add(c); pa.setXYZ(n, v.x, v.y, v.z); } }
    g.computeVertexNormals(); return new THREE.Mesh(g, mat);
  };
  head.add(blob(0.013, 0.011, 0.015, 0, 0.002, 0), blob(0.0095, 0.0068, 0.02, 0, -0.001, 0.02), blob(0.0068, 0.0058, 0.007, 0, 0.0015, 0.037));
  const jawPivot = new THREE.Group(); jawPivot.position.set(0, -0.006, 0.004);
  jawPivot.add(blob(0.0078, 0.0036, 0.017, 0, -0.002, 0.016)); head.add(jawPivot);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd040, emissive: 0xffb000, emissiveIntensity: 1.5 });
  for (const k of [-1, 1]) {
    head.add(blob(0.0055, 0.0032, 0.01, k * 0.008, 0.008, 0.011));                                    // brow
    head.add(blob(0.0034, 0.0034, 0.0034, k * 0.0102, 0.0045, 0.013, eyeMat));                         // eye
    head.add(blob(0.0016, 0.0012, 0.0016, k * 0.004, 0.004, 0.043, bronze));                            // nostril
    head.add(tube([[k * 0.006, 0.01, -0.002], [k * 0.011, 0.02, -0.02], [k * 0.014, 0.024, -0.04], [k * 0.012, 0.022, -0.058]], 0.0026, 0.0006, bronze));   // horn
    head.add(tube([[k * 0.007, -0.003, 0.038], [k * 0.02, -0.006, 0.03], [k * 0.03, -0.012, 0.005], [k * 0.034, -0.02, -0.02]], 0.0009, 0.0003, bronze));  // whisker
  }
  for (let m = 0; m < 5; m++) {                                                                       // the mane
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.022, 4), jade);
    fin.scale.z = 0.35; fin.position.set(0, 0.01 - m * 0.001, -0.006 - m * 0.008); fin.rotation.x = -1.9 + m * 0.08; head.add(fin);
  }
  const jaw = jawPivot;
  head.visible = false; gun.add(head);
  // glowing gold: glints and rising motes off the dragon's painted path, both sides
  const trail = emitterTrail(gun), tier = particleTier[quality] ?? 1;
  const goldFrom = [];
  for (let i = 0; i <= 40; i++) for (const k of [-1, 1]) { const v = painted.getPointAt(i / 40); v.x = k * (half + 0.004); goldFrom.push({ point: v, normal: new THREE.Vector3(k, 0.3, 0).normalize() }); }
  const gold = [
    ...[0xffc840, 0xffe080, 0xffb020, 0xfff0a0].map((c, i) => particles('glint', tier, goldFrom, new THREE.Color(c).multiplyScalar(4), trail, mulberry32(208041 + i * 8))),
    ...[0xffd860, 0xffc030].map((c, i) => particles('ember', tier, goldFrom, new THREE.Color(c).multiplyScalar(4.5), trail, mulberry32(208091 + i * 8))),
  ];
  for (const m of gold) { m.material.blending = THREE.AdditiveBlending; m.visible = false; gun.add(m); }
  // which side faces the camera: the dragon that comes alive is the one you can see
  let viewSide = 1, side = 1; const camAt = new THREE.Vector3();
  // (read off a tiny, invisible marker drawn every frame: the dragon itself is not drawn until it comes out)
  const probe = new THREE.Mesh(new THREE.PlaneGeometry(0.0001, 0.0001), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  probe.frustumCulled = false; gun.add(probe);
  probe.onBeforeRender = (renderer, scene, camera) => { camAt.setFromMatrixPosition(camera.matrixWorld); gun.worldToLocal(camAt); viewSide = Math.sign(camAt.x) || 1; };
  // the crest along its back
  const nSpikes = 28, spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.0016, 0.006, 6), bronze, nSpikes);
  spikes.frustumCulled = false; spikes.visible = false; gun.add(spikes);
  const C = new THREE.Vector3(), Pp = new THREE.Vector3(), R0 = new THREE.Vector3();
  const spine = Array.from({ length: N }, () => ({ c: new THREE.Vector3(), n: new THREE.Vector3(), b: new THREE.Vector3(), t: new THREE.Vector3(), r: 0, w: 0 }));
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const glazes = [], mixes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artPhase && !glazes.includes(u.artPhase)) { glazes.push(u.artPhase); mixes.push(u); } });
  let phase = -1;
  return {
    clip: KILN_CLIP, seconds: JADE_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const g of glazes) g.value = active ? p : -1;
      // the painting sweeps to the bare gun as the dragon peels off head first, and back as it lies down
      // the painting sweeps away muzzle to stock (the shader's wipe front, in gun z); the dragon comes off
      // where it has gone, and lies back down just before it returns
      const mixAt = (q) => active ? smooth(q, 0.0, 0.25) * (1 - smooth(q, 0.76, 0.95)) : 0;   // (from the start, while the gun is still coming up)
      const frontAt = (q) => Z0 - 0.05 + (Z1 - Z0 + 0.1) * mixAt(q);
      const front = frontAt(p), soon = frontAt(Math.min(1, p + 0.06));
      for (const u of mixes) if (u.artMix) { u.artMix.value = mixAt(p); u.artMixSide.value = side; }
      const t = active ? p * JADE_SECONDS : 0;
      if (p < 0.1) side = viewSide;
      for (const m of gold) m.visible = active; trail.update(active ? t : -1);
      let any = false;
      // the coil: a corkscrew round the gun, head towards the muzzle, swimming round and drifting along
      const spin = t * 2.6, zc = (Z0 + Z1) / 2 - 0.08 + 0.07 * Math.sin(t * 0.7);
      for (let i = 0; i < N; i++) {
        const f = i / (N - 1), s = spine[i];
        const taper = (0.75 + 0.25 * Math.sin(Math.min(1, f * 4) * Math.PI / 2)) * (1 - 0.85 * f * f);
        // where it lies in the painting, half sunk into the side
        painted.getPointAt(f, Pp);
        const shown = smooth((front - Pp.z) / 0.03, 0, 1);              // the painting has gone here: it is solid
        // it lies still in its place until it is all out, then lifts off head first (and lies back down
        // just before the paint returns)
        s.w = Math.min(active ? smooth(p, 0.15 + f * 0.1, 0.27 + f * 0.1) : 0, smooth((soon - Pp.z) / 0.09, 0, 1));
        s.r = rMax * taper * shown;
        if (shown > 0.001) any = true;
        Pp.x = side * (half + s.r * 0.55);                              // standing out of the side
        // where it is in the coil
        const a = side * (Math.PI * 0.5 - spin + f * 1.3 * Math.PI * 2) + (side < 0 ? Math.PI : 0);
        C.set(Math.cos(a) * RX, yc + Math.sin(a) * RY, zc - 0.1 + f * 0.3);
        s.c.copy(Pp).lerp(C, s.w * s.w * (3 - 2 * s.w));
      }
      body.visible = head.visible = spikes.visible = any;
      if (!any) return;
      for (let i = 0; i < N; i++) {
        const s = spine[i], prev = spine[Math.max(0, i - 1)].c, next = spine[Math.min(N - 1, i + 1)].c;
        s.t.copy(prev).sub(next).normalize();                        // towards the head
        R0.set(s.c.x, s.c.y - yc, 0).normalize();                    // outward from the gun
        s.b.crossVectors(s.t, R0).normalize(); s.n.crossVectors(s.b, s.t).normalize();
      }
      // the slither: a wave running down the body, side to side, while it is off the gun
      for (let i = 0; i < N; i++) { const s = spine[i], f = i / (N - 1); s.c.addScaledVector(s.b, 0.01 * s.w * Math.sin(f * 16 - t * 8) * Math.min(1, f * 6)); }
      for (let i = 0; i < N; i++) {
        const s = spine[i];
        for (let j = 0; j < M; j++) {
          const a = j / M * Math.PI * 2;
          C.copy(s.c).addScaledVector(s.n, Math.cos(a) * s.r).addScaledVector(s.b, Math.sin(a) * s.r);
          pos.set([C.x, C.y, C.z], (i * M + j) * 3);
        }
      }
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
      const h = spine[0];
      mtx.makeBasis(R0.copy(h.b).negate(), h.n, h.t); head.quaternion.setFromRotationMatrix(mtx); head.position.copy(h.c).addScaledVector(h.t, 0.006);   // (x = n × t: a true rotation)
      head.scale.setScalar(h.r / (rMax * 0.75));
      jaw.rotation.x = 0.1 + 0.3 * h.w * (0.5 + 0.5 * Math.sin(t * 6));
      for (let k = 0; k < nSpikes; k++) {
        const s = spine[2 + k * 3];
        q.setFromUnitVectors(up, R0.copy(s.n).addScaledVector(s.t, -0.6).normalize());
        C.copy(s.c).addScaledVector(s.n, s.r * 0.85);
        sc.setScalar(Math.max(0.001, s.r / rMax));
        spikes.setMatrixAt(k, mtx.compose(C, q, sc));
      }
      spikes.instanceMatrix.needsUpdate = true;
    },
    dispose() { probe.geometry.dispose(); probe.material.dispose(); geo.dispose(); jade.dispose(); bronze.dispose(); eyeMat.dispose(); spikes.geometry.dispose(); head.traverse(o => o.geometry?.dispose()); for (const m of gold) { m.geometry.dispose(); m.material.dispose(); } },
  };
}

// Velvet Ante: playing cards, charged with a pink glow, fly in from all round and spin about the gun,
// then sweep into a ring in front of you, facing you, charge up, and drop one by one, fluttering down.
const VELVET_SECONDS = 8.4;
let cardTex = null;
function cardTextures() {
  if (cardTex) return cardTex;
  const make = (draw) => { const c = document.createElement('canvas'); c.width = 128; c.height = 180; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const round = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const back = make((g) => {
    g.fillStyle = '#4a0c18'; round(g, 0, 0, 128, 180, 10); g.fill();
    g.strokeStyle = '#d8b25a'; g.lineWidth = 3; round(g, 7, 7, 114, 166, 7); g.stroke();
    g.lineWidth = 1.5; round(g, 13, 13, 102, 154, 5); g.stroke();
    for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(64, 118, 12 + i * 7, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }   // an Art Deco fan
    g.fillStyle = '#d8b25a'; g.beginPath(); g.moveTo(64, 112); g.lineTo(70, 124); g.lineTo(64, 136); g.lineTo(58, 124); g.closePath(); g.fill();
  });
  const fronts = [['A', '\u2660', '#111'], ['K', '\u2665', '#b0182a'], ['Q', '\u2666', '#b0182a'], ['J', '\u2663', '#111'], ['10', '\u2665', '#b0182a']].map(([rank, suit, col]) => make((g) => {
    g.fillStyle = '#f3ecdb'; round(g, 0, 0, 128, 180, 10); g.fill();
    g.strokeStyle = '#c8a64e'; g.lineWidth = 2; round(g, 5, 5, 118, 170, 7); g.stroke();
    g.fillStyle = col; g.font = 'bold 26px Georgia, serif'; g.textAlign = 'center';
    g.fillText(rank, 20, 32); g.font = '22px serif'; g.fillText(suit, 20, 54);
    g.save(); g.translate(108, 148); g.rotate(Math.PI); g.font = 'bold 26px Georgia, serif'; g.fillText(rank, 0, 0); g.font = '22px serif'; g.fillText(suit, 0, 22); g.restore();
    g.font = '72px serif'; g.fillText(suit, 64, 116);
  }));
  const glow = make((g) => {
    const r = g.createRadialGradient(64, 90, 10, 64, 90, 92);
    r.addColorStop(0, 'rgba(255,90,200,0.9)'); r.addColorStop(0.55, 'rgba(255,60,170,0.45)'); r.addColorStop(1, 'rgba(255,40,160,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 180);
  });
  cardTex = { back, fronts, glow };
  return cardTex;
}
export function velvetInspect(gun, { surface }, quality) {
  const tier = particleTier[quality] ?? 1, n = [10, 14, 18, 22][tier], rng = mulberry32(209013);
  const pts = surface.map(a => a.point);
  const G = pts.length ? pts.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / pts.length) : new THREE.Vector3();
  const tex = cardTextures(), W = 0.036, H = 0.05;
  const plane = new THREE.PlaneGeometry(W, H), glowPlane = new THREE.PlaneGeometry(W * 1.7, H * 1.6);
  const backMat = new THREE.MeshStandardMaterial({ map: tex.back, roughness: 0.4, metalness: 0.1, transparent: true });
  const frontMats = tex.fronts.map(map => new THREE.MeshStandardMaterial({ map, roughness: 0.35, transparent: true }));
  const glowMat = new THREE.MeshBasicMaterial({ map: tex.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0 });
  const cards = Array.from({ length: n }, (_, i) => {
    const g = new THREE.Group();
    const front = new THREE.Mesh(plane, frontMats[i % frontMats.length]);
    const back = new THREE.Mesh(plane, backMat); back.rotation.y = Math.PI; back.position.z = -0.0003;
    const glow = new THREE.Mesh(glowPlane, glowMat); glow.position.z = -0.0006;
    g.add(glow, front, back); g.visible = false; gun.add(g);
    const from = new THREE.Vector3(rng() - 0.5, rng() * 0.8 - 0.2, rng() - 0.5).normalize().multiplyScalar(0.9).add(G);
    return { g, from, a0: i / n * Math.PI * 2, r: 0.1 + rng() * 0.05, h: (rng() - 0.5) * 0.06, dz: (rng() - 0.5) * 0.3,
      axis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), spin: 5 + rng() * 6, delay: rng() * 0.08, drop: rng() * 0.12,
      sway: rng() * 6.28, fall: new THREE.Vector3((rng() - 0.5) * 0.1, 0, (rng() - 0.5) * 0.1) };
  });
  // where the camera is (gun space): the ring forms between it and the gun, facing it
  const cam = new THREE.Vector3(1, 0, 0), camAt = new THREE.Vector3();
  const probe = new THREE.Mesh(new THREE.PlaneGeometry(0.0001, 0.0001), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  probe.frustumCulled = false; gun.add(probe);
  probe.onBeforeRender = (renderer, scene, camera) => { camAt.setFromMatrixPosition(camera.matrixWorld); gun.worldToLocal(camAt); cam.copy(camAt); };
  // the poker chip on the receiver rises out, spins and flips while the ring holds; pink arcs of charge
  // run from it to every card. Its place in concept pixels (08-velvet-ante.png, 1536 x 1024).
  const [Z0, Z1, Y0, Y1] = [-0.21361, 0.41797, -0.2903, 0.1306], half = 0.021;
  const chipAt = new THREE.Vector3(0, Y1 - (Y1 - Y0) * 290 / 1024, Z0 + (Z1 - Z0) * 790 / 1536), chipR = (Z1 - Z0) * 48 / 1536;
  const chipFace = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#8a1424'; g.beginPath(); g.arc(64, 64, 63, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f3ecdb'; for (let i = 0; i < 8; i++) { g.save(); g.translate(64, 64); g.rotate(i * Math.PI / 4); g.fillRect(-7, -63, 14, 20); g.restore(); }
    g.strokeStyle = '#d8b25a'; g.lineWidth = 3; g.beginPath(); g.arc(64, 64, 40, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f3ecdb'; g.beginPath(); g.arc(64, 64, 37, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.font = '48px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('\u2660', 64, 66);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const chipFaceMat = new THREE.MeshStandardMaterial({ map: chipFace, roughness: 0.35, metalness: 0.1, emissive: 0xff40b0, emissiveIntensity: 0 });
  const chipEdgeMat = new THREE.MeshStandardMaterial({ color: 0x8a1424, roughness: 0.4, emissive: 0xff40b0, emissiveIntensity: 0 });
  const chip = new THREE.Mesh(new THREE.CylinderGeometry(chipR, chipR, 0.004, 40), [chipEdgeMat, chipFaceMat, chipFaceMat]);
  chip.visible = false; gun.add(chip);
  const arcPos = new Float32Array(n * 2 * 3), arcs = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(arcPos, 3)),
    new THREE.LineBasicMaterial({ color: 0xff60c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  arcs.frustumCulled = false; arcs.visible = false; gun.add(arcs);
  const P1 = new THREE.Vector3(), P2 = new THREE.Vector3(), dir = new THREE.Vector3(), right = new THREE.Vector3(), upV = new THREE.Vector3(), radial = new THREE.Vector3();
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), mtx = new THREE.Matrix4(), zero = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
  const glazes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artPhase && !glazes.includes(u.artPhase)) glazes.push(u.artPhase); });
  let phase = -1;
  return {
    clip: KILN_CLIP, seconds: VELVET_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const g of glazes) g.value = active ? p : -1;
      const t = active ? p * VELVET_SECONDS : 0;
      // the ring in front of you: between the camera and the gun, facing the camera
      dir.copy(cam).sub(G); const dist = dir.length(); dir.normalize();
      const ringC = G.clone().addScaledVector(dir, Math.min(0.16, dist * 0.45));
      right.crossVectors(Y, dir).normalize(); upV.crossVectors(dir, right).normalize();
      const charge = active ? smooth(p, 0.58, 0.7) * (1 - smooth(p, 0.76, 0.84)) : 0;
      glowMat.opacity = active ? (0.35 + 0.25 * Math.sin(t * 9) + charge * 0.8) * (1 - smooth(p, 0.86, 0.97)) : 0;
      for (const m of [backMat, ...frontMats]) m.opacity = 1 - smooth(p, 0.9, 0.98);
      // the chip: out of its place on your side of the gun, spinning and flipping, then back
      const side = Math.sign(cam.x) || 1, out = active ? smooth(p, 0.54, 0.6) * (1 - smooth(p, 0.8, 0.86)) : 0;
      chip.visible = out > 0.01;
      if (chip.visible) {
        chip.position.copy(chipAt); chip.position.x = side * (half + 0.002 + 0.03 * out);
        chip.rotation.set(0, 0, side * Math.PI / 2);                       // its faces towards you
        chip.rotateY(t * 14 * out); chip.rotateX(Math.sin(smooth(p, 0.62, 0.72) * Math.PI) * Math.PI);
        chipFaceMat.emissiveIntensity = chipEdgeMat.emissiveIntensity = charge * (0.6 + 0.4 * Math.sin(t * 14));
      }
      arcs.visible = charge > 0.01; arcs.material.opacity = charge * (0.5 + 0.5 * Math.abs(Math.sin(t * 23)));
      cards.forEach((c, i) => {
        c.g.visible = active && p > 0.06 + c.delay && p < 0.99;
        if (!c.g.visible) return;
        // spinning round the gun (its long axis), each card turning end over end
        const a = c.a0 + t * 2.4;
        P1.set(Math.cos(a) * c.r, G.y + c.h + Math.sin(a) * c.r * 0.8, G.z + c.dz);
        q1.setFromAxisAngle(c.axis, t * c.spin);
        // flying in from far off along a curve
        const inK = smooth(p, 0.06 + c.delay, 0.22 + c.delay);
        if (inK < 1) { P2.copy(c.from).lerp(P1, inK); P2.y += Math.sin(inK * Math.PI) * 0.08; P1.copy(P2); }
        // into the ring in front of you, card faces to you, the ring turning slowly
        const ra = i / n * Math.PI * 2 + t * 0.6, R = 0.14;
        P2.copy(ringC).addScaledVector(right, Math.cos(ra) * R).addScaledVector(upV, Math.sin(ra) * R);
        radial.copy(right).multiplyScalar(Math.cos(ra)).addScaledVector(upV, Math.sin(ra));
        mtx.lookAt(dir, zero, radial); q2.setFromRotationMatrix(mtx);
        const ringK = smooth(p, 0.5 + i / n * 0.06, 0.6 + i / n * 0.06);
        // ... then dropped one by one, fluttering down
        const dropAt = 0.76 + c.drop, fallK = active ? Math.max(0, p - dropAt) * VELVET_SECONDS : 0;
        c.g.position.copy(P1).lerp(P2, ringK);
        if (arcs.visible) { arcPos.set([chip.position.x, chip.position.y, chip.position.z, c.g.position.x + (Math.random() - 0.5) * 0.004, c.g.position.y + (Math.random() - 0.5) * 0.004, c.g.position.z], i * 6); }
        c.g.quaternion.copy(q1).slerp(q2, ringK);
        if (fallK > 0) {
          c.g.position.addScaledVector(c.fall, fallK).add(new THREE.Vector3(Math.sin(fallK * 5 + c.sway) * 0.012, -0.35 * fallK * fallK - 0.02 * fallK, 0));
          c.g.quaternion.multiply(q1.setFromAxisAngle(X, Math.sin(fallK * 6 + c.sway) * 0.9)).multiply(q2.setFromAxisAngle(Y, fallK * 3));
        }
      });
      if (arcs.visible) arcs.geometry.attributes.position.needsUpdate = true;
    },
    dispose() {
      plane.dispose(); glowPlane.dispose(); backMat.dispose(); glowMat.dispose(); for (const m of frontMats) m.dispose();
      chip.geometry.dispose(); chipFace.dispose(); chipFaceMat.dispose(); chipEdgeMat.dispose(); arcs.geometry.dispose(); arcs.material.dispose();
      probe.geometry.dispose(); probe.material.dispose();
    },
  };
}
