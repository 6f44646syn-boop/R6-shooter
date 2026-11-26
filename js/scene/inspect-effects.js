import * as THREE from '../../vendor/three/three.module.min.js?v=7141ab8-mwx5zl37';
import { mulberry32 } from '../core/prng.js?v=7141ab8-mwx5zl37';
import { mergeStatic } from './sight-model.js?v=7141ab8-mwx5zl37';
import { rankIconSvg } from '../ui/rank-icon.js?v=7141ab8-mwx5zl37';

const FROST_SECONDS = 4.35, FROST_PEAK = 0.59;
// The Legendaries' inspects run twice as long as an ordinary one (8.4 s); Forgeheart, Abyssal Crown, Jade
// Coil and Opal Overture run longer still, for their finales (9.0 to 10.2 s).
const SAKURA_SECONDS = 8.4, SAKURA_PEAK = 0.54;
const KILN_SECONDS = 8.4, KILN_PEAK = 0.57;
const ABYSS_SECONDS = 8.4, ABYSS_PEAK = 0.57;      // (also the default clock of the shared deep-water particles)
const CROWN_SECONDS = 9.0, CROWN_INK = 0.76;       // Abyssal Crown's own length, and when the kraken lets go
const VESPER_SECONDS = 8.4, VESPER_PEAK = 0.57;
const FORGE_SECONDS = 11.2;
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

// Abyssal Crown: roll the receiver towards you so the depth dial faces the camera; the blast kicks the
// muzzle up; the gun stays raised while the ink clears.
const ABYSS_CLIP = { root: [
  [0, 0, 0, 0, 0, 0, 0],
  [0.18, -0.07, 0.085, -0.1, 0.1, 0.9, 0.3],
  [0.42, -0.082, 0.098, -0.13, 0.12, 1.12, 0.42],
  [0.66, -0.085, 0.1, -0.14, 0.1, 1.15, 0.36],
  [0.72, -0.078, 0.1, -0.15, 0.2, 1.12, 0.36],
  [0.8, -0.082, 0.098, -0.135, 0.12, 1.08, 0.3],
  [0.91, -0.06, 0.075, -0.095, 0.1, 0.68, 0.12],
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
        #ifdef RAIN
          // rain: falling fast, a little slant
          origin = (emitted * vec4(emitter, 1.0)).xyz + vec3(0.0, -2.4 * age, -0.25 * age);
          radius = vec2(0.0005, mix(0.009, 0.016, seed.z));
          spin = 0.0;
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
          #ifdef BREATH
            // a stream of fire breathed along the emitter's direction, widening and lifting as it goes
            vec3 aim = normalize(outward + (seed.xyz - 0.5) * 0.3);
            origin = (emitted * vec4(emitter, 1.0)).xyz + aim * mix(0.32, 0.5, seed.w) * age + vec3(sin(s + age * 17.0) * 0.004, 0.08 * age * age, 0.0);
            radius = vec2(0.8, 1.2) * mix(0.006, 0.012, seed.z) * (0.5 + p * 2.6) * (1.0 - 0.5 * p);
          #endif
        #endif
        #ifdef SMOKE
          origin = (emitted * vec4(emitter, 1.0)).xyz + vec3(sin(s + age * 3.0) * 0.006, 0.03 + age * 0.09, 0.0);
          radius = vec2(1.0) * mix(0.012, 0.02, seed.z) * (0.5 + p * 1.6);
          spin = s + age * 0.8;
          #ifdef STEAM
            // quench steam: a fast white plume hissing up off the seam
            origin = (emitted * vec4(emitter, 1.0)).xyz + outward * 0.03 * (1.0 - exp(-4.0 * age)) + vec3(sin(s + age * 4.0) * 0.008, 0.01 + age * mix(0.16, 0.26, seed.w), 0.0);
            radius = vec2(1.0) * mix(0.01, 0.02, seed.z) * (0.6 + p * 2.4);
          #endif
          #ifdef INK
            // an ink cloud: billowing out fast, then hanging and spreading as it thins
            origin = (emitted * vec4(emitter, 1.0)).xyz + normalize(outward + (seed.xyz - 0.5) * 1.2) * mix(0.04, 0.09, seed.w) * (1.0 - exp(-2.5 * age)) + vec3(0.0, age * 0.01, 0.0);
            radius = vec2(1.0) * mix(0.026, 0.045, seed.z) * (0.5 + p * 1.6);
          #endif
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
      #ifdef BREATH
        c = mix(tint * 0.55, mix(tint, vec3(1.0), 0.6), smoothstep(0.3, 0.9, temp));   // its own colour, white-hot at the core
      #endif
    #elif defined(SMOKE)
      float r = dot(p, p);
      if (r >= 1.0) discard;
      c = vec3(0.09, 0.08, 0.08);
      a = vAlpha * 0.28 * exp(-2.5 * r) * (1.0 - vAge) * smoothstep(0.0, 0.2, vAge);
      #ifdef STEAM
        c = tint; a = vAlpha * 0.4 * exp(-2.2 * r) * (1.0 - vAge) * smoothstep(0.0, 0.12, vAge);
      #endif
      #ifdef INK
        // a dark cloud with a faint glowing (tint) fringe, so it still reads against a dark room
        c = mix(vec3(0.004, 0.006, 0.012), tint, smoothstep(0.3, 1.0, r) * 0.35);
        a = vAlpha * 0.8 * exp(-2.0 * r) * (1.0 - smoothstep(0.7, 1.0, r)) * (1.0 - smoothstep(0.5, 1.0, vAge)) * smoothstep(0.0, 0.1, vAge);
      #endif
    #elif defined(RAIN)
      a = vAlpha * 0.55 * (1.0 - smoothstep(0.0, 1.0, abs(p.x))) * (1.0 - smoothstep(0.4, 1.0, abs(p.y)));
      c = vec3(0.78, 0.86, 1.0);
    #elif defined(WIND)
      a = vAlpha * 0.3 * (1.0 - smoothstep(0.0, 1.0, abs(p.x))) * (1.0 - smoothstep(0.3, 1.0, abs(p.y)));
      c = vec3(0.9, 0.95, 1.0);
    #elif defined(MOLTEN)
      // a glowing drop: hot core, the tint at its rim
      float r = dot(p, p);
      if (r >= 1.0) discard;
      c = mix(vec3(1.0, 0.92, 0.6), tint, smoothstep(0.0, 0.8, r)) * 1.6;
      a = vAlpha * (1.0 - smoothstep(0.6, 1.0, r));
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

const particleBudget = { mist: [22, 38, 54, 70], chip: [20, 34, 48, 62], petal: [28, 46, 64, 84], drop: [14, 22, 30, 40], drip: [80, 140, 200, 260], rain: [80, 140, 200, 260], seaspray: [60, 100, 150, 200], seamist: [14, 24, 34, 44], splash: [120, 200, 300, 400], jet: [160, 280, 400, 520], wind: [15, 25, 35, 45], gather: [40, 70, 100, 130], burst: [40, 70, 100, 140], spark: [16, 26, 36, 48], molten: [24, 40, 56, 72], zap: [70, 112, 168, 224], prism: [60, 100, 150, 200], flame: [140, 240, 340, 460], smoke: [16, 26, 36, 48], ember: [20, 34, 48, 64], bubble: [120, 200, 300, 400], speck: [10, 16, 22, 30], glint: [60, 100, 150, 200],
  steam: [40, 70, 110, 160], shower: [40, 70, 100, 140], ink: [24, 40, 56, 72], breath: [120, 200, 300, 400], shimmer: [60, 100, 150, 200], roar: [80, 140, 200, 260] };
const particleTier = { low: 0, standard: 1, high: 2, ultra: 3 };
// Storm Kiln's lightning: when each strike lands (inspect fraction); each hits the gun at its own point
const KILN_STRIKES = [0.26, 0.31, 0.35, 0.4, 0.43, 0.47, 0.5, 0.53, 0.57, 0.6, 0.63, 0.67, 0.71, 0.76];

// opt.seconds: the inspect's own length (the timings below scale with it); opt.window [from, to] and
// opt.life [min, max]: emit once, at a random time in that stretch of the inspect (fractions), instead.
function particles(kind, tier, anchors, tint, trail, rng, opt = {}) {
  const mist = kind === 'mist', petals = kind === 'petal', drops = ['drop', 'drip', 'splash', 'jet', 'wind', 'seaspray', 'seamist', 'rain'].includes(kind), deep = ['bubble', 'speck', 'glint', 'gather', 'burst', 'spark', 'ember', 'flame', 'smoke', 'prism', 'zap', 'molten', 'steam', 'shower', 'ink', 'breath', 'shimmer', 'roar'].includes(kind);
  const seconds = opt.seconds ?? (petals ? SAKURA_SECONDS : drops ? KILN_SECONDS : deep ? ABYSS_SECONDS : FROST_SECONDS);
  const peak = (petals ? SAKURA_PEAK : drops ? KILN_PEAK : deep ? ABYSS_PEAK : FROST_PEAK) * seconds;
  const k = seconds / 4.2;                              // timings below were set for a 4.2 s inspect
  const count = particleBudget[kind][tier], positions = [], directions = [], seeds = [], timing = [];
  for (let i = 0; i < count; i++) {
    const anchor = kind === 'zap' ? anchors[i % anchors.length] : anchors[Math.floor(rng() * anchors.length)];
    positions.push(...anchor.point.toArray());
    directions.push(...anchor.normal.toArray());
    seeds.push(rng(), rng(), rng(), rng());
    const burst = mist ? i % 4 === 0 : i % 5 !== 1 && i % 5 !== 3;
    let start, life, period = 10;
    if (opt.window) {
      start = seconds * (opt.window[0] + (opt.window[1] - opt.window[0]) * rng());
      life = opt.life[0] + (opt.life[1] - opt.life[0]) * rng();
    } else if (mist && !burst) {
      start = 0.24 + rng() * 0.88;
      period = 0.65 + rng() * 0.42;
      life = 0.61 + rng() * 0.29;
    } else if (mist) {
      start = peak - 0.08 + rng() * 0.16;
      life = 0.64 + rng() * 0.23;
    } else if (kind === 'rain') {                         // rain on the glaze, all through the storm
      start = seconds * (0.16 + 0.68 * rng());
      life = 0.22 + rng() * 0.16;
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
    } else if (kind === 'prism') {                        // Opal Overture: pouring out of the open jaw, a burst on the bite
      start = seconds * (i % 3 === 0 ? 0.61 + 0.02 * rng() : 0.4 + 0.42 * rng());
      life = 0.5 + rng() * 0.5;
    } else if (kind === 'molten') {                       // drops swelling on an edge and falling, while it is hot (or oozing)
      start = seconds * (0.3 + 0.52 * rng());
      life = 0.7 + rng() * 0.5;
    } else if (kind === 'zap') {                          // sparks off the gun where each lightning strike lands
      start = seconds * KILN_STRIKES[i % anchors.length] + rng() * 0.04;
      life = 0.25 + rng() * 0.3;
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
  const defines = kind === 'rain' ? { RAIN: 1 } : kind === 'seamist' ? { MIST: 1 } : kind === 'seaspray' ? { DROP: 1, SPRAY: 1 } : kind === 'jet' ? { DROP: 1, JET: 1 } : kind === 'wind' ? { WIND: 1 } : kind === 'gather' ? { SPECK: 1, GATHER: 1 } : kind === 'burst' ? { SPECK: 1, BURST: 1 } : kind === 'spark' || kind === 'zap' ? { SPECK: 1, SPARK: 1 } : kind === 'molten' ? { DROP: 1, DRIP: 1, MOLTEN: 1 } : kind === 'prism' ? { SPECK: 1, BURST: 1 } : kind === 'ember' ? { SPECK: 1, EMBER: 1 } : kind === 'flame' ? { FLAME: 1 } : kind === 'smoke' ? { SMOKE: 1 } :
    kind === 'steam' ? { SMOKE: 1, STEAM: 1 } : kind === 'ink' ? { SMOKE: 1, INK: 1 } : kind === 'breath' ? { FLAME: 1, BREATH: 1 } : kind === 'shower' ? { SPECK: 1, SPARK: 1 } : kind === 'shimmer' ? { SPECK: 1, GLINT: 1 } : kind === 'roar' ? { SPECK: 1, BURST: 1 } :
    mist ? { MIST: 1 } : petals ? { PETAL: 1 } : kind === 'drip' ? { DROP: 1, DRIP: 1 } : kind === 'splash' ? { DROP: 1, SPLASH: 1 } : kind === 'glint' ? { SPECK: 1, GLINT: 1 } : drops ? { DROP: 1 } : kind === 'bubble' ? { BUBBLE: 1 } : kind === 'speck' ? { SPECK: 1 } : {};
  if (mist && tier === 0) defines.LOW_INSPECT = 1;
  const material = new THREE.ShaderMaterial({
    defines,
    uniforms: { ...trail.uniforms, endTime: { value: seconds * (opt.window ? 1 : 0.78) }, tint: { value: tint } },
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
// Storm Kiln's wave: the painted wave comes alive, a curling breaker of clear water with white foam on
// its crest and lip. A ribbon swept along its profile (travelling towards -z), across a short width.
const WAVE_VERTEX = `uniform float uTime; varying vec2 vUv; varying vec3 vN, vV;
  void main() {
    vUv = uv; vec3 p = position;
    p += normal * 0.0015 * sin(uv.x * 26.0 + uv.y * 9.0 - uTime * 7.0);
    vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const WAVE_FRAGMENT = `uniform float uTime, uFade; varying vec2 vUv; varying vec3 vN, vV;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f *= f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1)), f.x), f.y); }
  void main() {
    vec3 N = normalize(vN), V = normalize(vV); if (!gl_FrontFacing) N = -N;
    float fres = pow(1.0 - abs(dot(N, V)), 2.5);
    vec3 deep = vec3(0.04, 0.16, 0.42), light = vec3(0.32, 0.66, 0.88);
    vec3 c = mix(deep, light, smoothstep(0.0, 0.7, vUv.x)) + fres * vec3(0.5, 0.75, 0.95);
    // foam: on the crest and down the curling lip, streaked, churning
    float foamN = n(vec2(vUv.x * 30.0 - uTime * 2.0, vUv.y * 12.0)) * 0.6 + n(vec2(vUv.x * 70.0, vUv.y * 30.0 + uTime)) * 0.4;
    float foam = smoothstep(0.6, 0.8, vUv.x) * smoothstep(0.35, 0.65, foamN + vUv.x * 0.4 - 0.2) + smoothstep(0.92, 1.0, vUv.x);
    c = mix(c, vec3(0.97, 0.98, 1.0), clamp(foam, 0.0, 1.0));
    c += vec3(1.0) * pow(max(dot(reflect(-V, N), normalize(vec3(0.3, 0.9, 0.3))), 0.0), 50.0) * 0.8;
    gl_FragColor = vec4(c, (0.72 + 0.28 * clamp(foam, 0.0, 1.0) + fres * 0.2) * uFade);
  }`;
function waveGeometry() {
  const prof = new THREE.CatmullRomCurve3([[0.13, 0], [0.07, 0.012], [0.035, 0.036], [0.012, 0.066], [-0.006, 0.086], [-0.032, 0.089], [-0.052, 0.076], [-0.06, 0.056], [-0.052, 0.04], [-0.039, 0.037]].map(([z, y]) => new THREE.Vector3(0, y, z)));
  const U = 48, C = 8, W = 0.09, pos = [], uv = [], idx = [];
  for (let i = 0; i <= U; i++) { const pt = prof.getPointAt(i / U); for (let j = 0; j <= C; j++) { pos.push(j / C * W, pt.y, pt.z); uv.push(i / U, j / C); } }
  for (let i = 0; i < U; i++) for (let j = 0; j < C; j++) { const a = i * (C + 1) + j, b = a + C + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
let cloudTex = null;
function stormCloud() {
  if (cloudTex) return cloudTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 26 + Math.random() * 76, y = 44 + Math.random() * 40, r = 18 + Math.random() * 22, gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(120,124,138,1)'); gr.addColorStop(0.6, 'rgba(70,72,84,0.85)'); gr.addColorStop(1, 'rgba(40,42,50,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  cloudTex = new THREE.CanvasTexture(c); return cloudTex;
}
export function kilnInspect(gun, { reliefs, under, surface, muzzle, charm }, quality) {
  const trail = emitterTrail(gun), tier = particleTier[quality] ?? 1;
  // water runs off the porcelain: beads form all along the underside and drip
  const drops = particles('drip', tier, under.length ? under : [{ point: new THREE.Vector3(), normal: new THREE.Vector3(0, -1, 0) }], new THREE.Color(0xbfdcff), trail, mulberry32(202077));
  const spray = [...surface, ...reliefs.map(r => ({ point: r.base.clone(), normal: r.normal.clone() }))];
  const splash = particles('splash', tier, spray.length ? spray : [{ point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) }], new THREE.Color(0xbfdcff), trail, mulberry32(202093));
  const [my, mz] = muzzle || [0, -0.5], tip = new THREE.Vector3(0, my, mz);
  const pts = (surface.length ? surface : [{ point: new THREE.Vector3() }]).map(a => a.point);
  const zMax = Math.max(...pts.map(v => v.z)), yTop = Math.max(...pts.map(v => v.y)), yBot = Math.min(...pts.map(v => v.y));
  const half = Math.max(...pts.map(v => Math.abs(v.x)));
  // the storm: clouds gathering above, lightning striking the silver seams, rain
  const clouds = Array.from({ length: 14 }, (_, i) => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: stormCloud(), color: 0x3a3e4c, transparent: true, opacity: 0, depthWrite: false }));
    m.userData = { z: tip.z - 0.04 + (zMax - tip.z + 0.08) * ((i * 0.37) % 1), y: yTop + 0.1 + (i % 3) * 0.03, s: 0.2 + (i % 4) * 0.05, ph: i * 1.7 };
    m.material.rotation = i * 1.3;
    gun.add(m); return m;
  });
  // lightning: a forked bolt, a white-hot core in a wide violet-blue glow
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0, depthWrite: false });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x7aa8ff, toneMapped: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const bolt = new THREE.Group(); gun.add(bolt);
  const boltFlash = flare(new THREE.Color(0xbfe0ff)); boltFlash.visible = false; gun.add(boltFlash);
  const STRIKES = KILN_STRIKES, brng = mulberry32(202171);
  // where each strike hits: a point on the gun's side or top, just off the surface
  const hits = STRIKES.map(() => { const a = (surface.length ? surface : [{ point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) }])[Math.floor(brng() * Math.max(1, surface.length))]; return { point: a.point.clone().addScaledVector(a.normal, 0.002), normal: a.normal.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize() }; });
  const zaps = particles('zap', tier, hits, new THREE.Color(0xd8ecff).multiplyScalar(3), trail, mulberry32(202191));
  zaps.material.blending = THREE.AdditiveBlending; zaps.visible = false; gun.add(zaps);
  let lastStrike = -1;
  const rainFrom = Array.from({ length: 60 }, (_, i) => ({ point: new THREE.Vector3((brng() - 0.5) * 0.2, yTop + 0.16, tip.z + (zMax - tip.z + 0.08) * brng()), normal: new THREE.Vector3(0, -1, 0) }));
  const rain = particles('rain', tier, rainFrom, new THREE.Color(0xd8e8ff), trail, mulberry32(202181));
  rain.visible = false; gun.add(rain);
  const blasts = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artBlast && !blasts.includes(u.artBlast)) blasts.push(u.artBlast); });
  // sea spray and a fine mist rising off the blue crests painted along the barrel (the front half)
  const crests = surface.filter(a => a.point.z < -0.15);
  const crestFrom = crests.length ? crests : spray.length ? spray : [{ point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) }];
  const seaSpray = particles('seaspray', tier, crestFrom, new THREE.Color(0xdcecff), trail, mulberry32(202131));
  const seaMist = particles('seamist', tier, crestFrom, new THREE.Color(0xe6f0ff), trail, mulberry32(202143));
  drops.visible = splash.visible = seaSpray.visible = seaMist.visible = false;
  gun.add(seaMist, drops, splash, seaSpray);
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
      drops.visible = splash.visible = seaSpray.visible = seaMist.visible = active && p > 0.12;
      rain.visible = active && p > 0.14; zaps.visible = active;
      trail.update(active ? p * KILN_SECONDS : -1);
      const t = active ? p * KILN_SECONDS : 0;
      // the storm
      const gather = active ? smooth(p, 0.1, 0.26) * (1 - smooth(p, 0.82, 0.95)) : 0;
      let flash = 0;
      for (const st of STRIKES) { const d = p - st; if (d >= 0 && d < 0.016) flash = Math.max(flash, (1 - d / 0.018) * (0.6 + 0.4 * Math.sin(d * 900))); }
      clouds.forEach((c, i) => {
        const u = c.userData; c.visible = gather > 0.01;
        c.position.set(Math.sin(t * 0.3 + u.ph) * 0.02, u.y, u.z + Math.sin(t * 0.2 + u.ph) * 0.02);
        c.scale.setScalar(u.s * (0.7 + 0.3 * gather)); c.material.opacity = gather;
        c.material.color.setHex(0x3a3e4c).lerp(new THREE.Color(0xc8d8ff), flash * 0.8);   // lit from inside by the strikes
      });
      const strike = STRIKES.findIndex(st => p >= st && p < st + 0.016);
      if (strike >= 0 && strike !== lastStrike) {
        // a new bolt: jagged, from a cloud down to a point on the gun's top
        lastStrike = strike;
        const c = clouds[(strike * 5) % clouds.length].position, hit = hits[strike].point;
        const jag = (a, b, n, amp) => { const out = []; for (let k = 0; k <= n; k++) { const v = a.clone().lerp(b, k / n); if (k && k < n) v.add(new THREE.Vector3((brng() - 0.5) * amp, (brng() - 0.5) * amp * 0.3, (brng() - 0.5) * amp)); out.push(v); } return out; };
        const main = jag(c, hit, 14, 0.035), forks = [main];
        for (let f = 0; f < 3; f++) {                                       // forks off the main channel
          const from = main[3 + Math.floor(brng() * 8)], to = from.clone().add(new THREE.Vector3((brng() - 0.5) * 0.12, -0.04 - brng() * 0.06, (brng() - 0.5) * 0.12));
          forks.push(jag(from, to, 6, 0.02));
        }
        for (let f = 0; f < 4; f++) {                                       // crackling over the gun where it lands
          const to = hit.clone().add(new THREE.Vector3((brng() - 0.5) * 0.02, (brng() - 0.5) * 0.03, (brng() - 0.5) * 0.08));
          forks.push(jag(hit, to, 5, 0.01));
        }
        for (const ch of [...bolt.children]) { ch.geometry.dispose(); bolt.remove(ch); }
        forks.forEach((path, k) => {
          const curve = new THREE.CatmullRomCurve3(path, false, 'catmullrom', 0), w = k ? 0.5 : 1;
          const core = new THREE.Mesh(new THREE.TubeGeometry(curve, path.length * 4, 0.0016 * w, 5, false), boltMat);
          const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, path.length * 4, 0.009 * w, 6, false), glowMat);
          core.frustumCulled = glow.frustumCulled = false; bolt.add(glow, core);
        });
        boltFlash.position.copy(hit);
      }
      bolt.visible = boltFlash.visible = flash > 0.01; boltMat.opacity = Math.min(1, flash * 1.5); glowMat.opacity = flash * 0.45; boltFlash.scale.setScalar(0.18 * flash);
      for (const b of blasts) b.value = flash > 0.01 ? flash : -9;          // the silver seams flash (shader)
      reliefs.forEach((r) => {
        const k = order.indexOf(Math.round(r.base.z * 1000)), start = 0.17 + k * 0.045;
        const lift = active ? smooth(p, start, start + 0.12) * (1 - smooth(p, 0.72, 0.93)) : 0;
        // the crest surges once at the peak, above the rest
        const surge = r.crest && active ? Math.sin(smooth(p, KILN_PEAK - 0.08, KILN_PEAK + 0.06) * Math.PI) * 0.007 : 0;
        r.group.position.copy(r.base).addScaledVector(r.normal, lift * (r.crest ? 0.012 : 0.008) + surge);
      });
      // the charm thrashes in the wind, blown towards the muzzle
      if (charm) {
        const gust = active ? smooth(p, 0.15, 0.3) * (1 - smooth(p, 0.82, 0.95)) : 0;   // swinging in the storm
        charm.rotation.x = gust * (0.75 + 0.3 * Math.sin(t * 23) + 0.18 * Math.sin(t * 41));
        charm.rotation.z = gust * 0.35 * Math.sin(t * 17 + 1.3) + (active ? 0 : 0);
      }
    },
    dispose() { for (const m of [drops, splash, seaSpray, seaMist, rain, zaps]) { m.geometry.dispose(); m.material.dispose(); } bolt.children.forEach(c => c.geometry.dispose()); boltMat.dispose(); glowMat.dispose(); boltFlash.material.dispose(); for (const c of clouds) c.material.dispose(); },
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
// A kraken takes the gun (Abyssal Crown): tentacles reach up from below, coil round the gun base to tip,
// squeeze in pulses while the shell fires, then uncoil and sink away. Each is a tube rebuilt along its
// spine every frame, with pale suckers on the side against the gun and glowing teal spots.
function kraken(gun, pts, quality) {
  const zs = pts.map(v => v.z), ys = pts.map(v => v.y);
  const zMin = Math.min(...zs), zMax = Math.max(...zs), yTop = Math.max(...ys), yBot = Math.min(...ys);
  // the coil stands clear of the gun: wider than it (plus the tentacle's own thickness) and centred high
  const yc = (yTop + yBot) / 2 + 0.014, RX = 0.066, RY = (yTop - yBot) / 2 + 0.036;
  const N = 70, M = 10, rng = mulberry32(203101);
  const skin = new THREE.MeshPhysicalMaterial({ color: 0x3a1022, roughness: 0.3, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.15, sheen: 0.5, sheenColor: 0xc06090, emissive: 0x0a2a2a, emissiveIntensity: 0.4 });
  const suckerMat = new THREE.MeshStandardMaterial({ color: 0xe8b8b0, roughness: 0.5 });
  const spotMat = new THREE.MeshBasicMaterial({ color: 0x40ffe0, toneMapped: false });
  const suckerGeo = new THREE.TorusGeometry(1, 0.45, 6, 12), spotGeo = new THREE.SphereGeometry(1, 6, 4);
  const tents = [-0.32, -0.12, 0.08, 0.28].map((f, i) => {
    const z = zMin + (zMax - zMin) * (0.5 + f), side = i % 2 ? 1 : -1;
    const pos = new Float32Array(N * M * 3), idx = [];
    for (let a = 0; a < N - 1; a++) for (let b = 0; b < M; b++) { const p0 = a * M + b, p1 = a * M + (b + 1) % M; idx.push(p0, p0 + M, p1, p1, p0 + M, p1 + M); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
    const body = new THREE.Mesh(geo, skin); body.frustumCulled = false; body.visible = false; gun.add(body);
    const nS = 14, suckers = new THREE.InstancedMesh(suckerGeo, suckerMat, nS), spots = new THREE.InstancedMesh(spotGeo, spotMat, nS);
    for (const m of [suckers, spots]) { m.frustumCulled = false; m.visible = false; gun.add(m); }
    return { z, side, pos, geo, body, suckers, spots, nS, th0: rng() * Math.PI * 2, turns: 1.4 + rng() * 0.5, delay: i * 0.03, ph: rng() * 6.28,
      spine: Array.from({ length: N }, () => ({ c: new THREE.Vector3(), n: new THREE.Vector3(), b: new THREE.Vector3(), t: new THREE.Vector3(), r: 0 })) };
  });
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), O = new THREE.Vector3(), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), Y = new THREE.Vector3(0, 0, 1);
  return {
    update(p, t) {
      const active = p >= 0 && p < 1;
      for (const k of tents) {
        const rise = active ? smooth(p, 0.08 + k.delay, 0.26 + k.delay) * (1 - smooth(p, CROWN_INK + 0.01, CROWN_INK + 0.08)) : 0;
        const vis = rise > 0.01;
        k.body.visible = k.suckers.visible = k.spots.visible = vis;
        if (!vis) continue;
        const squeeze = active ? 1 - 0.06 * smooth(p, 0.42, 0.5) * (1 - smooth(p, 0.7, 0.76)) * (0.5 + 0.5 * Math.sin(t * 7 + k.ph)) : 1;
        const base = new THREE.Vector3(k.side * 0.13, yBot - 0.32, k.z + 0.06);
        for (let i = 0; i < N; i++) {
          const s = i / (N - 1), sp = k.spine[i];                         // s: 0 at the tip, 1 at the base
          // coiled: the first 60% wraps round the gun, the rest runs down to the base below
          const wrap = active ? smooth(p, 0.2 + k.delay + (1 - s) * 0.12, 0.34 + k.delay + (1 - s) * 0.12) * (1 - smooth(p, CROWN_INK, CROWN_INK + 0.03)) : 0;
          let coil;
          if (s < 0.6) {
            const th = k.th0 + k.side * (0.6 - s) / 0.6 * k.turns * Math.PI * 2;
            coil = O.set(Math.cos(th) * RX * squeeze, yc + Math.sin(th) * RY * squeeze, k.z + (s - 0.3) * 0.12);
          } else {
            const th = k.th0, start = A.set(Math.cos(th) * RX, yc + Math.sin(th) * RY, k.z + 0.036);
            coil = O.copy(start).lerp(base, (s - 0.6) / 0.4);
          }
          // reaching: hanging up from the base in a loose curl, swaying
          const reach = Bv.copy(base).lerp(new THREE.Vector3(k.side * 0.08, yc + 0.02, k.z - 0.03), 1 - s);
          reach.x += Math.sin(t * 2.2 + s * 6 + k.ph) * 0.03 * (1 - s); reach.z += Math.cos(t * 1.7 + s * 5 + k.ph) * 0.03 * (1 - s);
          sp.c.copy(reach).lerp(coil, wrap * wrap * (3 - 2 * wrap));
          sp.c.y -= (1 - rise) * 0.35;                                     // rising from below
          sp.r = (0.006 + 0.028 * Math.pow(s, 0.75)) * (0.85 + 0.15 * Math.sin(t * 5 + s * 9 + k.ph));
        }
        for (let i = 0; i < N; i++) {
          const sp = k.spine[i], a = k.spine[Math.max(0, i - 1)].c, b = k.spine[Math.min(N - 1, i + 1)].c;
          sp.t.copy(b).sub(a).normalize();
          A.set(sp.c.x, sp.c.y - yc, 0).normalize();                       // outward from the gun
          sp.b.crossVectors(sp.t, A).normalize(); sp.n.crossVectors(sp.b, sp.t).normalize();
          for (let j = 0; j < M; j++) {
            const an = j / M * Math.PI * 2;
            O.copy(sp.c).addScaledVector(sp.n, Math.cos(an) * sp.r).addScaledVector(sp.b, Math.sin(an) * sp.r);
            k.pos.set([O.x, O.y, O.z], (i * M + j) * 3);
          }
        }
        k.geo.attributes.position.needsUpdate = true; k.geo.computeVertexNormals();
        // suckers on the inner side (against the gun), glowing spots on the outer
        for (let j = 0; j < k.nS; j++) {
          const sp = k.spine[3 + j * 3];
          q.setFromUnitVectors(Y, O.copy(sp.n).negate());
          A.copy(sp.c).addScaledVector(sp.n, -sp.r * 0.95); sc.setScalar(sp.r * 0.45);
          k.suckers.setMatrixAt(j, mtx.compose(A, q, sc));
          A.copy(sp.c).addScaledVector(sp.n, sp.r * 0.9).addScaledVector(sp.b, sp.r * 0.4 * (j % 2 ? 1 : -1)); sc.setScalar(sp.r * 0.18);
          k.spots.setMatrixAt(j, mtx.compose(A, q, sc));
        }
        k.suckers.instanceMatrix.needsUpdate = k.spots.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() { skin.dispose(); suckerMat.dispose(); spotMat.dispose(); suckerGeo.dispose(); spotGeo.dispose(); for (const k of tents) k.geo.dispose(); },
  };
}
export function abyssInspect(gun, { reliefs, dials, muzzle, surface, under }, quality) {
  const trail = emitterTrail(gun), tier = particleTier[quality] ?? 1, S = { seconds: CROWN_SECONDS };
  const anchors = reliefs.map(r => ({ point: r.base.clone().add(new THREE.Vector3(0, ...(r.ring ? [r.ring[1], r.ring[0]] : [0, 0]))), normal: r.normal.clone() }));
  const fallback = [{ point: new THREE.Vector3(), normal: new THREE.Vector3(1, 0, 0) }];
  const allOver = [...anchors, ...surface, ...under];
  const bubbles = particles('bubble', tier, allOver.length ? allOver : fallback, new THREE.Color(0x9ff5e6), trail, mulberry32(203011), S);
  const specks = particles('speck', tier, anchors.length ? anchors : fallback, new THREE.Color(0x8dffb0), trail, mulberry32(203029), S);
  // the kraken lets go: it squirts a cloud of ink round the gun as it whips away, which thins and clears
  const ink = particles('ink', tier, allOver.length ? allOver : fallback, new THREE.Color(0x2fb8b0), trail, mulberry32(203077), { ...S, window: [CROWN_INK, CROWN_INK + 0.03], life: [1.1, 1.8] });
  for (const m of [bubbles, specks, ink]) { m.visible = false; gun.add(m); }
  const squid = kraken(gun, (surface.length ? [...surface, ...under] : allOver).map(a => a.point), quality);
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
  const gather = particles('gather', tier, pull.length ? pull : fallback, new THREE.Color(0x9ffff0), trail, mulberry32(203041), S);
  const cores = centres.map(c => { const f = flare(new THREE.Color(0x7dffe6)); f.position.copy(c); f.visible = false; gun.add(f); return f; });
  // the blast: sparks out of the muzzle and a shockwave ring
  const sparks = particles('burst', tier, [{ point: new THREE.Vector3(0, my, mz), normal: new THREE.Vector3(0, 0, -1) }], new THREE.Color(0x8dfff0), trail, mulberry32(203057), S);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40), new THREE.MeshBasicMaterial({ color: 0x8dfff0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  ring.position.set(0, my, mz - 0.02); ring.visible = false;
  for (const m of [gather, sparks]) { m.visible = false; gun.add(m); }
  gun.add(ring);
  const M = new THREE.Matrix4(), R = new THREE.Matrix4(), T = new THREE.Matrix4();
  let phase = -1;
  return {
    clip: ABYSS_CLIP, seconds: CROWN_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const g of glazes) g.value = active ? p : -1;
      bubbles.visible = active; specks.visible = active && p > 0.3; ink.visible = active && p > CROWN_INK - 0.01;
      trail.update(active ? p * CROWN_SECONDS : -1);
      squid.update(p, active ? p * CROWN_SECONDS : 0);
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
    dispose() { squid.dispose(); for (const m of [bubbles, specks, ink, gather, sparks, ring]) { m.geometry.dispose(); m.material.dispose(); } for (const f of [glow, ...cores]) f.material.dispose(); },
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

// Forgeheart: the gun is taken back to the forge. A heat front runs along the orange seam (shader,
// artPhase). A glowing hammer swings in from your side and strikes three times: the first blow splits the
// gun open along its length from where it lands (a jagged crack, branching; real cuts with bevelled,
// charred walls and lava at the bottom, in the shader), the plates jump, shards rise out of the sides and
// obsidian chips fly off; each blow throws a shower of sparks, flashes the metal hot and drives the cracks
// further. Then it steams, a thick plume hissing off the hot metal, the chips and shards drawn back in; the
// quench: more steam, a last shower of sparks, the glow snapped dark. The plates are forged gunmetal (hammer dimples,
// fire scale and temper colours, in the shader), not the painting's flat shading.
// (the shader in gpu-tex.js keeps its own copy of these times)
const FORGE_HEAT = 0.2, FORGE_HITS = [0.32, 0.4, 0.48], FORGE_STEAM = 0.635, FORGE_QUENCH = 0.84;
const FORGE_BASE = [-0.086, 0.102, -0.132, 0.145, 1.12, 0];                // the pose while it is worked on
const FORGE_CLIP = { root: [
  [0, 0, 0, 0, 0, 0, 0],
  [0.15, -0.07, 0.09, -0.1, 0.14, 0.86, 0.1],
  [0.36, ...FORGE_BASE],
  // each blow knocks the gun down and away a little, and it rocks back
  ...FORGE_HITS.flatMap(h => [[h - 0.004, ...FORGE_BASE], [h + 0.005, FORGE_BASE[0] - 0.004, FORGE_BASE[1] - 0.009, FORGE_BASE[2], FORGE_BASE[3] + 0.02, FORGE_BASE[4] + 0.04, FORGE_BASE[5] - 0.045], [h + 0.035, ...FORGE_BASE]]),
  [0.7, -0.084, 0.1, -0.128, 0.16, 1.06, -0.04],
  [0.86, -0.08, 0.095, -0.12, 0.15, 1.0, -0.08],
  [0.93, -0.06, 0.075, -0.09, 0.12, 0.66, -0.08],
  [1, 0, 0, 0, 0, 0, 0],
] };
export function forgeInspect(gun, { reliefs, channels, seam, shards }, quality) {
  // always the full particle budget (as Ultra), whatever the graphics setting: it only draws while you inspect
  const trail = emitterTrail(gun), tier = 3, S = { seconds: FORGE_SECONDS };
  const from = seam.length ? seam : [{ point: new THREE.Vector3(), normal: new THREE.Vector3(1, 0, 0) }];
  const sparks = particles('spark', tier, from, new THREE.Color(0xffc060), trail, mulberry32(205011), S);
  const embers = particles('ember', tier, from, new THREE.Color(0xff6a20), trail, mulberry32(205029), S);
  const smoke = particles('smoke', tier, from, new THREE.Color(0x222222), trail, mulberry32(205063), S);
  const drip = from.map(a => ({ point: a.point.clone(), normal: new THREE.Vector3(0, -1, 0) }));
  const molten = particles('molten', tier, drip, new THREE.Color(0xff5a08), trail, mulberry32(205121), S);
  molten.material.blending = THREE.AdditiveBlending;
  // the quench: a burst of steam off the seam and a last shower of sparks
  const steam = particles('steam', tier, from, new THREE.Color(0xc8ccd0), trail, mulberry32(205141), { ...S, window: [FORGE_QUENCH, FORGE_QUENCH + 0.08], life: [1.3, 2.4] });
  const shower = particles('shower', tier, from, new THREE.Color(0xffd080), trail, mulberry32(205163), { ...S, window: [FORGE_QUENCH, FORGE_QUENCH + 0.04], life: [0.4, 0.8] });
  shower.material.blending = THREE.AdditiveBlending;
  const fx = [sparks, embers, smoke, molten, steam, shower];
  for (const m of fx) { m.visible = false; gun.add(m); }
  const [Z0, Z1, Y0, Y1] = [-0.59933, 0.37984, -0.39229, 0.26025];   // the AK-12's art rectangle (1536 x 1024 px concept)
  const split = new THREE.Vector2(Z0 + (Z1 - Z0) * 705 / 1536, Y1 - (Y1 - Y0) * 398 / 1024), half = 0.025;
  // the hammer's blows land on the split, on your side: a shower of sparks off each
  const blows = FORGE_HITS.map((h, i) => {
    const at = [-1, 1].map(k => ({ point: new THREE.Vector3(k * (half + 0.003), split.y, split.x), normal: new THREE.Vector3(k, 0.35, 0).normalize() }));
    const m = particles('shower', tier, at, new THREE.Color(0xffc870), trail, mulberry32(205201 + i * 13), { ...S, window: [h, h + 0.006], life: [0.3, 0.75] });
    m.material.blending = THREE.AdditiveBlending; m.visible = false; gun.add(m); fx.push(m); return m;
  });
  const mixes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artMix && !mixes.includes(u.artMix)) mixes.push(u.artMix); });
  // obsidian chips: glossy black chunks break off round the split as it cracks, hang turning in the air,
  // and are drawn back in by the hammer
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
      axis: new THREE.Vector3(frng() - 0.5, frng() - 0.5, frng() - 0.5).normalize(), spin: 0.6 + frng() * 1.4, bob: frng() * 6.28, delay: frng() * 0.05, back: frng() * 2 | 0 };
  });
  const cm = new THREE.Matrix4(), cq = new THREE.Quaternion(), cp = new THREE.Vector3(), cs = new THREE.Vector3();
  const bursts = [-1, 1].map(side => {
    const g = new THREE.Group(); g.position.set(side * (half + 0.006), split.y, split.x);
    const core = flare(new THREE.Color(0xffc060)), rayA = flare(new THREE.Color(0xff9a30)), rayB = flare(new THREE.Color(0xff9a30));
    rayA.material.rotation = 0.5; rayB.material.rotation = -0.5;
    g.add(core, rayA, rayB); g.visible = false; gun.add(g);
    return { g, core, rayA, rayB };
  });
  // the hammer: a forge hammer with a glowing hot head on an ash handle; it swings about the end of the
  // handle (above the gun on your side), its striking face meeting the side of the gun at the split
  const LH = 0.15;
  const hammer = new THREE.Group(), steelMat = new THREE.MeshStandardMaterial({ color: 0x2a2624, metalness: 0.9, roughness: 0.35, emissive: 0xff4a08, emissiveIntensity: 0.1 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.7 });
  const headGeo = new THREE.BoxGeometry(0.05, 0.03, 0.032), faceGeo = new THREE.CylinderGeometry(0.0155, 0.0155, 0.058, 16), handleGeo = new THREE.CylinderGeometry(0.005, 0.006, LH, 10);
  const hHead = new THREE.Mesh(headGeo, steelMat); hHead.position.y = -LH;
  const hFace = new THREE.Mesh(faceGeo, steelMat); hFace.rotation.z = Math.PI / 2; hFace.position.set(0, -LH, 0); hammer.add(hFace);   // (round striking faces at both ends)
  const hHandle = new THREE.Mesh(handleGeo, woodMat); hHandle.position.y = -LH / 2 + 0.008;
  hammer.add(hHead, hHandle); hammer.visible = false; gun.add(hammer);
  const hammerGlow = flare(new THREE.Color(0xffa040)); hammerGlow.visible = false; gun.add(hammerGlow);
  // the steam: a plume hissing up off the hot gun after the blows (where the metal was once poured), and
  // more at the quench
  const steamUp = particles('steam', tier, from, new THREE.Color(0xd4d8dc), trail, mulberry32(205251), { ...S, window: [FORGE_STEAM, FORGE_STEAM + 0.12], life: [1.3, 2.4] });
  steamUp.visible = false; gun.add(steamUp); fx.push(steamUp);
  // which side faces the camera: the hammer strikes that one
  let viewSide = 1, side = 1; const camAt = new THREE.Vector3();
  const probe = new THREE.Mesh(new THREE.PlaneGeometry(0.0001, 0.0001), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  probe.frustumCulled = false; gun.add(probe);
  probe.onBeforeRender = (renderer, scene, camera) => { camAt.setFromMatrixPosition(camera.matrixWorld); gun.worldToLocal(camAt); viewSide = Math.sign(camAt.x) || 1; };
  const order = [...new Set(reliefs.map(r => Math.round(r.base.z * 1000)))].sort((a, b) => a - b);
  const glazes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artPhase && !glazes.includes(u.artPhase)) glazes.push(u.artPhase); });
  const smoked = channels[0]?.material, hot = new THREE.Color(), deep = new THREE.Color(0xa01204), yellow = new THREE.Color(0xffc040);
  const W = 1.25;                                                    // the hammer's swing (radians up from the blow)
  // the hammer's angle at inspect time p: in from out of shot raised, then for each blow a rebound and
  // wind-up and a fast fall onto the gun; after the last it lifts away
  const swing = (p) => {
    const [h0, h1, h2] = FORGE_HITS;
    if (p >= h2) return W * smooth(p, h2, h2 + 0.05);
    const i = p < h0 ? 0 : p < h1 ? 1 : 2, prev = i ? FORGE_HITS[i - 1] : h0 - 0.07, c = Math.max(0, (p - prev) / (FORGE_HITS[i] - prev));
    const up = i ? W * smooth(c, 0, 0.68) : W;
    return c < 0.72 ? up : W * (1 - ((c - 0.72) / 0.28) ** 2);
  };
  let phase = -1;
  return {
    clip: FORGE_CLIP, seconds: FORGE_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const g of glazes) g.value = active ? p : -1;
      if (active && p < 0.3) side = viewSide;
      sparks.visible = embers.visible = smoke.visible = molten.visible = active && p > 0.15;
      steam.visible = shower.visible = active && p > FORGE_QUENCH - 0.01;
      for (const m of blows) m.visible = active && p > FORGE_HITS[0] - 0.01;
      steamUp.visible = active && p > FORGE_STEAM - 0.01;
      trail.update(active ? p * FORGE_SECONDS : -1);
      // the blows: an impulse at each, and how many have landed
      const blow = active ? FORGE_HITS.reduce((sum, h, i) => sum + (0.7 + 0.15 * i) * Math.exp(-(((p - h) / 0.007) ** 2)) * (p > h - 0.002 ? 1 : 0.3), 0) : 0;
      const landed = active ? FORGE_HITS.reduce((n, h) => n + smooth(p, h, h + 0.012), 0) : 0;
      const sealed = active ? smooth(p, FORGE_STEAM + 0.02, 0.8) : 0;
      const open = (landed / 3) * (1 - sealed);                          // the cracks: opened by the blows, sealed by the pour
      // the plates jump up on each blow, from the blow outwards, and settle as the pour seals them
      reliefs.forEach((r) => {
        const k = order.indexOf(Math.round(r.base.z * 1000)), start = FORGE_HITS[0] + k * 0.006;
        const lift = active ? smooth(p, start, start + 0.02) * (0.5 + 0.5 * landed / 3) * (1 - sealed) : 0;
        r.group.position.copy(r.base).addScaledVector(r.normal, lift * (0.0045 + 0.002 * blow));
        r.group.position.y = r.base.y + lift * 0.0025;
      });
      // the obsidian chips: out as it cracks, hanging and bobbing, back in on the blows
      const t = active ? p * FORGE_SECONDS : 0;
      chunks.visible = active && p > FORGE_HITS[0] && p < FORGE_STEAM + 0.08;
      if (chunks.visible) {
        chunk.forEach((c, i) => {
          const hit = FORGE_HITS[c.back], home = FORGE_STEAM + 0.01 + c.delay;   // knocked out by the first or second blow; drawn back in by the pour
          const out = smooth(p, hit, hit + 0.025 + c.delay * 0.3) * (1 - smooth(p, home, home + 0.03)) * (1 + 0.15 * blow);
          cp.copy(c.at).addScaledVector(c.dir, c.dist * out); cp.y += Math.sin(t * 1.6 + c.bob) * 0.006 * out;
          cq.setFromAxisAngle(c.axis, c.bob + t * c.spin);
          cs.copy(c.size).multiplyScalar(Math.max(out, 0.001));
          chunks.setMatrixAt(i, cm.compose(cp, cq, cs));
        });
        chunks.instanceMatrix.needsUpdate = true;
      }
      for (const m of mixes) m.value = 0;                               // (no peak painting: the cracks are cut by the shader, on the steel)
      // the shards rise out of the sides as it cracks, and are beaten back in, a third a blow
      for (const sh of shards) {
        const k = active ? smooth(p, FORGE_HITS[0] + (sh.start - 0.38) * 0.15, FORGE_HITS[0] + 0.03 + (sh.start - 0.38) * 0.15) * (1 - sealed) : 0;   // (out from the blow outwards)
        sh.group.visible = k > 0.01;
        sh.group.scale.x = Math.max(k, 0.01);
        sh.group.position.copy(sh.base); sh.group.position.x = sh.side * (half + (sh.base.x * sh.side - half) * k + 0.004 * k);
      }
      // a starburst at the split: glowing while it is open, flaring on each blow
      const burst = active ? (0.15 * open + 0.7 * blow) : 0, flick = 0.85 + 0.15 * Math.sin(p * 220);
      for (const b of bursts) {
        b.g.visible = burst > 0.01;
        b.core.scale.setScalar(0.1 * burst * flick);
        b.rayA.scale.set(0.34 * burst * flick, 0.018 * burst, 1); b.rayB.scale.set(0.26 * burst * flick, 0.015 * burst, 1);
      }
      // the hammer
      const [h0, , h2] = FORGE_HITS, inK = active ? smooth(p, h0 - 0.11, h0 - 0.07) * (1 - smooth(p, h2 + 0.03, h2 + 0.07)) : 0;
      hammer.visible = inK > 0.01;
      if (hammer.visible) {
        hammer.position.set(side * (half + 0.004 + 0.029 + 0.25 * (1 - inK)), split.y + LH + 0.12 * (1 - inK), split.x);
        hammer.rotation.set(0, side < 0 ? Math.PI : 0, swing(p));       // (turned round on the other side, so it swings outward from the gun)
        steelMat.emissiveIntensity = 0.12 + 0.9 * blow;
      }
      hammerGlow.visible = hammer.visible;
      if (hammerGlow.visible) { hHead.getWorldPosition(cp); gun.worldToLocal(cp); hammerGlow.position.copy(cp); hammerGlow.scale.setScalar(0.03 + 0.07 * blow); hammerGlow.material.opacity = 0.15 + 0.85 * Math.min(1, blow); }
      if (smoked) {
        // the seam: yellow while it is worked, flashing on the blows, cooling to deep red, then quenched dark
        const glow = active ? smooth(p, FORGE_HEAT, FORGE_HEAT + 0.12) * (1 - 0.5 * smooth(p, 0.66, 0.78)) * (1 - smooth(p, FORGE_QUENCH, FORGE_QUENCH + 0.025)) : 0;
        const cool = active ? smooth(p, FORGE_HITS[2] + 0.04, 0.8) : 0;
        smoked.emissive.copy(hot.copy(yellow).lerp(deep, cool));
        smoked.emissiveIntensity = glow * 4 * (1 + 1.5 * blow);
      }
    },
    dispose() {
      for (const m of fx) { m.geometry.dispose(); m.material.dispose(); }
      for (const b of bursts) b.g.traverse(o => o.material?.dispose());
      chunkGeo.dispose(); chunkMat.dispose(); steelMat.dispose(); woodMat.dispose(); headGeo.dispose(); faceGeo.dispose(); handleGeo.dispose(); hammerGlow.material.dispose();
      probe.geometry.dispose(); probe.material.dispose();
    },
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
// painted fern on the handguard; and a swarm of prehistoric flies circles the gun, then dives one after
// another into the amber window and sinks in, trapped. The fern paths are in concept pixels (06-amber-reliquary.png, 1536 x 1024).
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
  // the swarm: prehistoric flies, amber-brown with long veined wings, one giant and six smaller; they
  // circle the gun, then dive one after another into the amber window and sink in, trapped
  const body = new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.45, metalness: 0.2 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x8a1c0c, roughness: 0.2, metalness: 0.3 });
  const trapped = new THREE.MeshStandardMaterial({ color: 0x2a1404, roughness: 0.3, emissive: 0x3a1a00, emissiveIntensity: 0.4, transparent: true, opacity: 0.8 });   // a fly sealed in the resin
  const wingMat = new THREE.MeshPhysicalMaterial({ color: 0xe8dcc0, transparent: true, opacity: 0.4, roughness: 0.1, iridescence: 0.8, side: THREE.DoubleSide, depthWrite: false });
  const thoraxGeo = new THREE.SphereGeometry(0.0055, 14, 10), unitGeo = new THREE.SphereGeometry(1, 14, 10), headGeo = new THREE.SphereGeometry(0.0038, 12, 8), eyeGeo = new THREE.SphereGeometry(0.0022, 10, 8);
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.bezierCurveTo(0.006, 0.004, 0.022, 0.006, 0.026, 0.001); wingShape.bezierCurveTo(0.02, -0.004, 0.006, -0.003, 0, 0);
  const wingGeo = new THREE.ShapeGeometry(wingShape);
  const makeFly = () => {
    const g = new THREE.Group(), parts = [];
    const thorax = new THREE.Mesh(thoraxGeo, body), abdomen = new THREE.Mesh(unitGeo, body), head = new THREE.Mesh(headGeo, body);
    abdomen.scale.set(0.0045, 0.004, 0.011); abdomen.position.z = -0.012; head.position.z = 0.0075;
    parts.push(thorax, abdomen, head);
    for (const k of [-1, 1]) { const e = new THREE.Mesh(eyeGeo, eyeMat); e.position.set(k * 0.0025, 0.001, 0.009); g.add(e); parts.push(e); }
    const wings = [-1, 1].map(k => {
      const pivot = new THREE.Group(); pivot.position.set(k * 0.004, 0.003, 0);
      const w = new THREE.Mesh(wingGeo, wingMat); w.rotation.set(Math.PI / 2, 0, k < 0 ? Math.PI : 0); w.rotation.y = k * -0.5;
      pivot.add(w); g.add(pivot); return { pivot, k };
    });
    g.add(thorax, abdomen, head); g.visible = false; gun.add(g);
    for (const m of parts) m.userData.mat = m.material;
    return { g, wings, parts, thorax };
  };
  // where each lands in the amber window (concept pixels), when it hits, and how it circles
  const SWARM = [[700, 300, 0.585], [880, 345, 0.605], [1010, 310, 0.625], [790, 375, 0.645], [1090, 350, 0.66], [960, 285, 0.675], [600, 330, 0.69]];
  const flies = SWARM.map(([x, y, impact], i) => {
    const big = i === SWARM.length - 1;
    return { ...makeFly(), target: P([x, y]), impact, dive: impact - (big ? 0.14 : 0.1), size: big ? 2.2 : 1.05 + 0.12 * (i % 4), big,
      ph: i * 0.9, rx: 0.08 + 0.012 * (i % 4), rz: 0.17 + 0.02 * (i % 3), w: 2.0 + 0.25 * (i % 3), dy: -0.02 + 0.012 * (i % 4), dir: i % 2 ? 1 : -1 };
  });
  // which side of the gun faces the camera (they dive into that one)
  let viewSide = 1; const camAt = new THREE.Vector3();
  flies[0].thorax.onBeforeRender = (renderer, scene, camera) => { camAt.setFromMatrixPosition(camera.matrixWorld); gun.worldToLocal(camAt); viewSide = Math.sign(camAt.x) || 1; };
  // each hit: a flash, and a ripple spreading over the resin
  const ringGeo = new THREE.RingGeometry(0.7, 1, 40);
  for (const f of flies) {
    f.flash = flare(new THREE.Color(0xffd890)); f.flash.visible = false; gun.add(f.flash);
    f.ringMat = new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    f.ring = new THREE.Mesh(ringGeo, f.ringMat); f.ring.visible = false; gun.add(f.ring);
  }
  const trail = emitterTrail(gun), tier = particleTier[quality] ?? 1;
  // golden resin oozing from the bottom of the amber window and dripping; glowing pollen off the ferns
  const ooze = [], pollenFrom = [];
  for (let x = 520; x <= 1140; x += 30) for (const k of [-1, 1]) { const v = P([x, 405 - Math.abs(x - 830) * 0.04]); v.x = k * (half + 0.002); ooze.push({ point: v, normal: new THREE.Vector3(0, -1, 0) }); }
  for (const f of FRONDS) for (const pt of f) for (const k of [-1, 1]) { const v = P(pt); v.x = k * (half + 0.004); pollenFrom.push({ point: v, normal: new THREE.Vector3(k, 0.4, 0).normalize() }); }
  const resin = particles('molten', tier, ooze, new THREE.Color(0xd88a10), trail, mulberry32(207051));
  const pollen = particles('ember', tier, pollenFrom, new THREE.Color(0xffe070).multiplyScalar(2.5), trail, mulberry32(207067));
  pollen.material.blending = THREE.AdditiveBlending;
  for (const m of [resin, pollen]) { m.visible = false; gun.add(m); }
  const pts = [...(art.surface || [])].map(a => a.point);
  const yMid = pts.length ? pts.reduce((a, v) => a + v.y, 0) / pts.length : 0, zMid = (Z0 + Z1) / 2;
  const flyAt = (f, t, out) => out.set(Math.cos(t * f.w * f.dir + f.ph) * f.rx + 0.006 * Math.sin(t * 19 + f.ph), yMid + 0.06 + f.dy + 0.035 * Math.sin(t * 3.1 + f.ph) + 0.005 * Math.sin(t * 27), zMid + Math.sin(t * f.w * f.dir + f.ph) * f.rz + 0.008 * Math.sin(t * 23 + f.ph));
  const glazes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artPhase && !glazes.includes(u.artPhase)) glazes.push(u.artPhase); });
  const puffs = [-1, 1].map(k => {
    const at = flies[SWARM.length - 1].target.clone(); at.x = k * (half + 0.004);
    const m = particles('burst', tier, [{ point: at, normal: new THREE.Vector3(k, 0.2, 0).normalize() }], new THREE.Color(0xe8b060), trail, mulberry32(207031 + k));
    m.visible = false; gun.add(m); return m;
  });
  const fwd = new THREE.Vector3(0, 0, 1), dir = new THREE.Vector3(), hit = new THREE.Vector3(), out = new THREE.Vector3(), nx = new THREE.Vector3(), mtx = new THREE.Matrix4();
  const b0 = new THREE.Vector3(), b1 = new THREE.Vector3(), b2 = new THREE.Vector3(), b3 = new THREE.Vector3(), q = new THREE.Vector3();
  // a cubic Bezier: from where it was buzzing, out away from the gun, round in a turn, and straight in
  const bez = (u, o) => { const v = 1 - u; return o.copy(b0).multiplyScalar(v * v * v).addScaledVector(b1, 3 * v * v * u).addScaledVector(b2, 3 * v * u * u).addScaledVector(b3, u * u * u); };
  const SINK = 0.4;                                                    // seconds to sink into the resin
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
      if (active && p < 0.5) side = viewSide;
      // the swarm (each joins a little after the last, buzzing in from out of shot)
      flies.forEach((f, i) => {
        const g = f.g, join = 0.1 + i * 0.025;
        g.visible = active && p > join && p < 0.93;
        f.flash.visible = f.ring.visible = false;
        if (!g.visible) return;
        let flap = 1;
        const sealed = p >= f.impact;
        const inResin = sealed && (p - f.impact) * AMBER_SECONDS > SINK * 0.6;
        for (const m of f.parts) m.material = inResin ? trapped : m.userData.mat;
        hit.copy(f.target); hit.x = side * (half + 0.006);
        if (p < f.dive) {
          flyAt(f, t, g.position); flyAt(f, t + 0.03, dir).sub(g.position).normalize();
          const come = smooth(p, join, join + 0.04); g.position.x += Math.sign(g.position.x || 1) * 0.3 * (1 - come); g.position.y += 0.1 * (1 - come);
          g.quaternion.setFromUnitVectors(fwd, dir);
          g.scale.setScalar(f.size);
        } else if (!sealed) {
          // it flies off away from the gun, banks round, and comes back fast into the amber window
          flyAt(f, f.dive * AMBER_SECONDS, b0);
          const zs = b0.z > hit.z ? 1 : -1;
          b1.copy(b0).add(out.set(side * 0.2, 0.06, zs * 0.08));
          b2.copy(hit).add(out.set(side * 0.28, 0.05, zs * 0.12));
          b3.copy(hit);
          const u = Math.pow((p - f.dive) / (f.impact - f.dive), 1.5);    // slow out, fast in
          bez(u, g.position); bez(Math.min(1, u + 0.02), q);
          dir.copy(q).sub(g.position).normalize();
          g.quaternion.setFromUnitVectors(fwd, dir);
          g.rotateZ(Math.sin(u * Math.PI) * side * 0.9);                   // banking through the turn
          g.scale.setScalar(f.size);
        } else {
          // the hit: it splats into the resin, wings spread, and sinks in, sealed, lying flat under the surface
          const s = (p - f.impact) * AMBER_SECONDS, sink = smooth(s, 0.05, SINK);
          g.position.copy(hit); g.position.x = side * (half + 0.006 - 0.0052 * sink);
          dir.set(0, Math.sin(f.ph), Math.cos(f.ph));                        // head pointing its own way along the window
          nx.set(side, 0, 0); mtx.makeBasis(out.crossVectors(nx, dir).normalize(), nx, dir);
          g.quaternion.setFromRotationMatrix(mtx);
          const squash = s < 0.08 ? 1 - Math.sin(s / 0.08 * Math.PI) * 0.4 : 1;
          g.scale.set(f.size, f.size * squash * (1 - 0.55 * sink), f.size);
          flap = 0;
          f.flash.visible = s < 0.22; f.flash.position.copy(hit); f.flash.scale.setScalar((f.big ? 0.07 : 0.045) * (1 - s / 0.22));
          f.ring.visible = s < 0.4;
          if (f.ring.visible) {
            f.ring.position.copy(f.target); f.ring.position.x = side * (half + 0.0025); f.ring.rotation.set(0, side * Math.PI / 2, 0);
            f.ring.scale.setScalar(0.006 + (f.big ? 0.05 : 0.03) * Math.sqrt(s / 0.4)); f.ringMat.opacity = 0.8 * (1 - s / 0.4);
          }
        }
        for (const w of f.wings) w.pivot.rotation.z = w.k * (flap ? 0.2 + 0.9 * Math.sin(t * (130 + i * 7) + i) : 1.35);
      });
      puffs[0].visible = active && side < 0; puffs[1].visible = active && side > 0;
      resin.visible = pollen.visible = active;
      trail.update(active ? t : -1);
    },
    dispose() {
      silver.dispose(); leafGeo.dispose(); body.dispose(); eyeMat.dispose(); trapped.dispose(); wingMat.dispose(); ringGeo.dispose();
      thoraxGeo.dispose(); unitGeo.dispose(); headGeo.dispose(); eyeGeo.dispose(); wingGeo.dispose();
      for (const f of flies) { f.flash.material.dispose(); f.ringMat.dispose(); }
      for (const m of [...puffs, resin, pollen]) { m.geometry.dispose(); m.material.dispose(); }
      for (const f of fronds) f.stem.geometry.dispose();
    },
  };
}

// Jade Coil: the dragon painted on the gun comes alive. It peels off the side head first (the painting
// sweeps to the bare gun behind it) and swims in the air beside the gun on your side, looping, its body
// rippling side to side, chasing a flaming pearl. It lunges and snaps the pearl up (a gold flash), then
// turns wide and swims to the end of the gun (the body following the head along one path) and settles
// there: down onto the top of the handguard, forward, coiled round the barrel's front, its head resting
// out past the muzzle. It stays there while the gun is put away and settles, then lies back into its painting. As it settles, carved jade scales spread over
// the gun from the muzzle back (shader); and as the gun is put away it breathes jade fire out ahead. Its body is a tube rebuilt each frame along its spine (carved scales, a
// bronze crest), with a horned head.
// The painted dragon's spine, in concept pixels (07-jade-coil.png, 1536 x 1024), head first (tools/jade-bare.py).
const JADE_SPINE = [[230, 378], [280, 360], [320, 330], [370, 330], [420, 370], [470, 430], [530, 445], [590, 410], [640, 360], [700, 330], [760, 345],
  [830, 390], [900, 440], [960, 460], [1020, 430], [1080, 380], [1140, 350], [1220, 345], [1300, 335], [1370, 320], [1430, 302]];
// (the shader in gpu-tex.js keeps its own copy of the settle time)
const JADE_SECONDS = 10.4, JADE_CATCH = 0.5, JADE_PERCH = 0.54, JADE_LANDED = 0.7, JADE_BREATH = 0.86;
const JADE_W = 1.96, JADE_SPAN = 3.5;     // the air loop: radians a second, and the body's length along it (radians)
const JADE_CLIP = { root: [
  [0, 0, 0, 0, 0, 0, 0],
  [0.17, -0.074, 0.08, -0.09, 0.13, 0.82, 0.12],
  [0.4, -0.086, 0.094, -0.122, 0.17, 1.10, 0.02],
  [0.64, -0.09, 0.1, -0.14, 0.12, 1.16, -0.07],
  [0.84, -0.086, 0.096, -0.13, 0.14, 1.1, -0.1],
  [0.9, -0.066, 0.075, -0.094, 0.12, 0.7, -0.12],
  [0.965, 0, 0, 0, 0, 0, 0],                               // settled before the end, the dragon still on the muzzle
  [1, 0, 0, 0, 0, 0, 0],
] };
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
export function jadeInspect(gun, { surface, muzzle }, quality) {
  const [Z0, Z1, Y0, Y1] = [-0.25133, 0.36905, -0.23606, 0.17739];     // the T-5's art rectangle
  const half = 0.023;
  const painted = new THREE.CatmullRomCurve3(JADE_SPINE.map(([x, y]) => new THREE.Vector3(0, Y1 - (Y1 - Y0) * y / 1024, Z0 + (Z1 - Z0) * x / 1536)));
  const top = surface.length ? Math.max(...surface.map(a => a.point.y)) : 0.06;
  const yc = top - 0.04, yAir = top + 0.025, zAir = (Z0 + Z1) / 2 - 0.04;
  const [my, mz] = muzzle || [top - 0.02, Z0 - 0.06];
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
  // the dragon's pearl: a flaming pearl it chases just out of reach of its jaws
  const pearl = new THREE.Group();
  const pearlCore = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0xfff6e0, emissive: 0xffe0a0, emissiveIntensity: 0.9, roughness: 0.08, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.5 }));
  const pearlGlow = flare(new THREE.Color(0xffd070)); pearlGlow.scale.setScalar(0.07);
  const pearlFlame = flare(new THREE.Color(0xff8a20)); pearlFlame.scale.set(0.035, 0.06, 1);
  pearl.add(pearlGlow, pearlFlame, pearlCore); pearl.visible = false; gun.add(pearl);
  // glowing gold: glints and rising motes off the dragon's painted path, both sides
  const trail = emitterTrail(gun), tier = particleTier[quality] ?? 1, S = { seconds: JADE_SECONDS };
  const goldFrom = [];
  for (let i = 0; i <= 40; i++) for (const k of [-1, 1]) { const v = painted.getPointAt(i / 40); v.x = k * (half + 0.004); goldFrom.push({ point: v, normal: new THREE.Vector3(k, 0.3, 0).normalize() }); }
  const gold = [
    ...[0xffc840, 0xffe080, 0xffb020, 0xfff0a0].map((c, i) => particles('glint', tier, goldFrom, new THREE.Color(c).multiplyScalar(4), trail, mulberry32(208041 + i * 8), S)),
    ...[0xffd860, 0xffc030].map((c, i) => particles('ember', tier, goldFrom, new THREE.Color(c).multiplyScalar(4.5), trail, mulberry32(208091 + i * 8), S)),
  ];
  for (const m of gold) { m.material.blending = THREE.AdditiveBlending; m.visible = false; gun.add(m); }
  // where it settles: the head resting out past the muzzle, the body coiled round the barrel's thin front
  // behind it, the tail along the top of the gun. It gets there by swimming one path, the body following the
  // head along it: out of its loop, wide round to the back of the handguard, forward along the top, round
  // and round the barrel, head out ahead.
  const LN = new THREE.Vector3(), CR = 0.036, HEAD_Y = my + CR + 0.004, HEAD_Z = mz - 0.03, COIL_Z = HEAD_Z + 0.1;
  // the top of the gun behind the coils, where the tail lies (the highest surface point there)
  const tops = surface.filter(a => a.point.z > HEAD_Z + 0.15 && a.point.z < HEAD_Z + 0.5).map(a => a.point.y).sort((a, b) => a - b);
  const tailY = Math.max(my + CR, tops.length ? tops[Math.floor(tops.length * 0.8)] : my + CR) + 0.006;   // (not the sight posts: the top of the handguard)
  const loopAt = (k, tau, out) => out.set(k * (0.08 + 0.02 * Math.sin(2 * tau)), yAir + 0.06 * Math.sin(tau) + 0.015 * Math.sin(3 * tau), zAir + 0.17 * Math.cos(tau));
  // the body's length along its loop (metres), so it is the same length on the path
  let loopLen = 0; { const a = new THREE.Vector3(), b = new THREE.Vector3(); for (let i = 0; i < 64; i++) { loopAt(1, i / 64 * 2 * Math.PI, a); loopAt(1, (i + 1) / 64 * 2 * Math.PI, b); loopLen += a.distanceTo(b); } }
  const bodyLen = loopLen * JADE_SPAN / (2 * Math.PI);
  let path = null, pathLen = 0, Tx = 0;
  const makePath = (k, T) => {
    const V = (x, y, z) => new THREE.Vector3(x, y, z), turns = 1.5, helixLen = turns * Math.hypot(2 * Math.PI * CR, 0.06 / turns), run = Math.max(0.03, bodyLen - helixLen - 0.06);
    const rear = COIL_Z + run, pts = [loopAt(k, T, V()), loopAt(k, T + 0.3, V()), V(k * 0.26, tailY + 0.07, rear + 0.3), V(k * 0.16, tailY + 0.045, rear + 0.14), V(k * 0.05, tailY + 0.02, rear + 0.035)];   // (wide out to your side and round behind, then in from the back)
    for (let i = 0; i <= 3; i++) pts.push(V(0.004 * Math.sin(i * 2), tailY + 0.012, rear - (rear - COIL_Z - 0.01) * i / 3));   // along the top (its own thickness above it)
    for (let i = 1; i <= 18; i++) { const u = i / 18, a = u * turns * 2 * Math.PI; pts.push(V(k * CR * Math.sin(a), my + CR * Math.cos(a), COIL_Z - 0.06 * u)); }
    pts.push(V(0, HEAD_Y + 0.004, COIL_Z - 0.08), V(0, HEAD_Y, HEAD_Z));
    path = new THREE.CatmullRomCurve3(pts, false, 'centripetal'); path.arcLengthDivisions = 400; pathLen = path.getLength(); Tx = T;
  };
  // the jade fire it breathes out ahead of the muzzle as the gun is put away
  const breath = particles('breath', tier, [{ point: new THREE.Vector3(0, HEAD_Y, HEAD_Z - 0.045), normal: new THREE.Vector3(0, 0.12, -1).normalize() }], new THREE.Color(0x3dff8a), trail, mulberry32(208131), { ...S, window: [JADE_BREATH + 0.005, JADE_BREATH + 0.11], life: [0.35, 0.6] });
  breath.material.blending = THREE.AdditiveBlending; breath.visible = false; gun.add(breath);
  // the flash as its jaws close on the pearl
  const catchFlash = flare(new THREE.Color(0xffd060)); catchFlash.visible = false; gun.add(catchFlash);
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
  const spine = Array.from({ length: N }, () => ({ c: new THREE.Vector3(), n: new THREE.Vector3(), b: new THREE.Vector3(), t: new THREE.Vector3(), r: 0, w: 0, pw: 0 }));
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const glazes = [], mixes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artPhase && !glazes.includes(u.artPhase)) { glazes.push(u.artPhase); mixes.push(u); } });
  let phase = -1;
  return {
    clip: JADE_CLIP, seconds: JADE_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const g of glazes) g.value = active ? p : -1;
      // the painting sweeps to the bare gun as the dragon peels off head first, and back as it lies down
      // the painting sweeps away muzzle to stock (the shader's wipe front, in gun z); the dragon comes off
      // where it has gone, and lies back down just before it returns
      const mixAt = (q) => active ? smooth(q, 0.0, 0.25) * (1 - smooth(q, 0.988, 0.999)) : 0;   // (from the start, while the gun is still coming up)
      const frontAt = (q) => Z0 - 0.05 + (Z1 - Z0 + 0.1) * mixAt(q);
      const front = frontAt(p), soon = frontAt(Math.min(1, p + 0.006));   // (it lies back into the painting only at the very end)
      for (const u of mixes) if (u.artMix) { u.artMix.value = mixAt(p); u.artMixSide.value = side; }
      const t = active ? p * JADE_SECONDS : 0;
      if (p < 0.1) side = viewSide;
      for (const m of gold) m.visible = active; trail.update(active ? t : -1);
      breath.visible = active && p > JADE_BREATH - 0.01;
      let any = false;
      // in the air: a tall loop beside the gun on your side, the body following the head's path; it lunges at
      // the pearl, then swims to the muzzle head first and settles there, and opens its jaws wide to breathe
      // it drifts gently beside the gun, then makes one full turn of its loop towards the end (catching the
      // pearl as it comes round), then swings out wide and in to the muzzle
      const T = 1.2 + 0.35 * t + 2 * Math.PI * smooth(p, JADE_CATCH - 0.16, JADE_CATCH);
      const rear = active ? smooth(p, JADE_BREATH - 0.02, JADE_BREATH) * (1 - smooth(p, JADE_BREATH + 0.1, JADE_BREATH + 0.12)) : 0;
      const lunge = active ? smooth(p, JADE_CATCH - 0.035, JADE_CATCH) * (1 - smooth(p, JADE_CATCH, JADE_CATCH + 0.04)) : 0;
      // the swim to the muzzle: the head's distance along its path (easing in and out)
      const travel = active && p >= JADE_PERCH;
      if (!travel) path = null; else if (!path) makePath(side, T);
      const sHead = travel ? pathLen * smooth(p, JADE_PERCH, JADE_LANDED) : 0;
      for (let i = 0; i < N; i++) {
        const f = i / (N - 1), s = spine[i];
        const taper = (0.75 + 0.25 * Math.sin(Math.min(1, f * 4) * Math.PI / 2)) * (1 - 0.85 * f * f);
        // where it lies in the painting, half sunk into the side
        painted.getPointAt(f, Pp);
        const shown = smooth((front - Pp.z) / 0.03, 0, 1);              // the painting has gone here: it is solid
        // it lies still in its place until it is all out, then lifts off head first (and lies back down
        // just before the paint returns)
        s.w = Math.min(active ? smooth(p, 0.15 + f * 0.1, 0.27 + f * 0.1) : 0, smooth((soon - Pp.z) / 0.09, 0, 1));
        s.r = rMax * taper * shown * (1 - 0.3 * (s.pw || 0));      // (a little slimmer once it has settled, so it clears the gun)
        if (shown > 0.001) any = true;
        Pp.x = side * (half + s.r * 0.55);                              // standing out of the side
        // where it is in the air
        // in its loop, or (once it sets off for the muzzle) where the head was along its path
        const sAt = travel ? sHead - f * bodyLen : -1;
        if (sAt > 0) path.getPointAt(Math.min(1, sAt / pathLen), C);
        else loopAt(side, travel ? Tx + sAt * 2 * Math.PI / loopLen : T - f * JADE_SPAN, C);
        s.pw = travel ? smooth(sAt, 0, 0.05) : 0;
        s.c.copy(Pp).lerp(C, s.w * s.w * (3 - 2 * s.w));
      }
      if (lunge > 0) { LN.copy(spine[0].c).sub(spine[4].c).normalize(); for (let i = 0; i < 14; i++) spine[i].c.addScaledVector(LN, lunge * 0.03 * (1 - i / 14)); }
      body.visible = head.visible = spikes.visible = any;
      if (!any) { catchFlash.visible = false; return; }
      for (let i = 0; i < N; i++) {
        const s = spine[i], prev = spine[Math.max(0, i - 1)].c, next = spine[Math.min(N - 1, i + 1)].c;
        s.t.copy(prev).sub(next).normalize();                        // towards the head
        R0.set(s.c.x, s.c.y - yc, 0).normalize();                    // outward from the gun
        s.b.crossVectors(s.t, R0).normalize(); s.n.crossVectors(s.b, s.t).normalize();
      }
      // the slither: a wave running down the body, side to side, while it is off the gun
      for (let i = 0; i < N; i++) { const s = spine[i], f = i / (N - 1); s.c.addScaledVector(s.b, 0.01 * s.w * (1 - 0.85 * s.pw) * Math.sin(f * 16 - t * 8) * Math.min(1, f * 6)); }   // (barely, once it has settled)
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
      // the jaw: working as it swims, gaping as it lunges and snapping shut on the pearl, wide to breathe
      const gapeL = active ? smooth(p, JADE_CATCH - 0.04, JADE_CATCH - 0.012) * (1 - smooth(p, JADE_CATCH - 0.006, JADE_CATCH)) : 0;
      jaw.rotation.x = 0.1 + 0.3 * h.w * (0.5 + 0.5 * Math.sin(t * 6)) * (1 - gapeL) * (1 - rear) + 0.65 * gapeL + 0.55 * rear;
      const flash = active ? Math.max(0, 1 - Math.abs(p - JADE_CATCH) / 0.02) : 0;
      catchFlash.visible = flash > 0.01;
      if (catchFlash.visible) { catchFlash.position.copy(h.c).addScaledVector(h.t, 0.03); catchFlash.scale.setScalar(0.02 + 0.12 * flash); catchFlash.material.opacity = flash; }
      // the pearl hangs just ahead of the head, bobbing, pulsing and turning, until it is caught
      const reach = active ? smooth(p, JADE_CATCH - 0.035, JADE_CATCH) : 0;
      pearl.visible = h.w > 0.2 && p < JADE_CATCH;
      if (pearl.visible) {
        pearl.position.copy(h.c).addScaledVector(h.t, (0.045 + 0.008 * Math.sin(t * 2.3)) * (1 - reach) + 0.03 * reach).addScaledVector(h.n, (0.012 + 0.006 * Math.sin(t * 3.1)) * (1 - reach));
        pearl.scale.setScalar(Math.min(1, (h.w - 0.2) * 3));
        pearlCore.rotation.y = t * 2; pearlGlow.material.opacity = 0.7 + 0.3 * Math.sin(t * 8);
        pearlFlame.position.y = 0.012 + 0.003 * Math.sin(t * 13); pearlFlame.material.rotation = Math.sin(t * 5) * 0.3;
      }
      for (let k = 0; k < nSpikes; k++) {
        const s = spine[2 + k * 3];
        q.setFromUnitVectors(up, R0.copy(s.n).addScaledVector(s.t, -0.6).normalize());
        C.copy(s.c).addScaledVector(s.n, s.r * 0.85);
        sc.setScalar(Math.max(0.001, s.r / rMax));
        spikes.setMatrixAt(k, mtx.compose(C, q, sc));
      }
      spikes.instanceMatrix.needsUpdate = true;
    },
    dispose() { breath.geometry.dispose(); breath.material.dispose(); catchFlash.material.dispose(); pearlCore.geometry.dispose(); pearlCore.material.dispose(); pearlGlow.material.dispose(); pearlFlame.material.dispose(); probe.geometry.dispose(); probe.material.dispose(); geo.dispose(); jade.dispose(); bronze.dispose(); eyeMat.dispose(); spikes.geometry.dispose(); head.traverse(o => o.geometry?.dispose()); for (const m of gold) { m.geometry.dispose(); m.material.dispose(); } },
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

// Opal Overture: the opal is an eye. Black-chrome lids close over it, then open; inside, black opal
// with its play of colour shifting as you move, and a slit pupil that follows you. The front of the gun
// opens as a jaw; a fly buzzes in and the gun lunges forward and bites it. It swallows (a bulge runs back
// along the gun, the eye narrows, content, and a prismatic shimmer drifts off it), then roars, jaw wide,
// prismatic light streaming out, while a wave of colour runs back along the gun from the jaw to the stock
// (shader), the opal flashing through every colour; it snaps shut, and the lids close again at the end.
const OPAL_SECONDS = 10.2, OPAL_GULP = 0.64, OPAL_ROAR = 0.8;
const OPAL_CLIP = { root: [
  [0, 0, 0, 0, 0, 0, 0],
  [0.16, -0.074, 0.08, -0.09, 0.13, 0.82, 0.12],
  [0.38, -0.086, 0.094, -0.122, 0.17, 1.10, 0.02],
  [0.54, -0.088, 0.1, -0.13, 0.14, 1.14, -0.04],
  [0.575, -0.088, 0.104, -0.115, 0.12, 1.18, -0.04],     // drawing back ...
  [0.6, -0.082, 0.1, -0.185, 0.2, 1.0, -0.06],           // ... and the lunge forward, on the bite
  [0.66, -0.088, 0.1, -0.14, 0.14, 1.12, -0.06],
  [0.8, -0.09, 0.1, -0.14, 0.13, 1.14, -0.07],
  [0.84, -0.088, 0.106, -0.15, 0.08, 1.12, -0.07],       // rearing a little for the roar
  [0.93, -0.068, 0.078, -0.098, 0.13, 0.74, -0.12],
  [1, 0, 0, 0, 0, 0, 0],
] };
const EYE_VERTEX = `varying vec3 vP, vN, vV; void main(){ vP = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const EYE_FRAGMENT = `uniform float uTime, uWake; uniform vec2 uLook; varying vec3 vP, vN, vV;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 hue(float t) { return 0.5 + 0.5 * cos(6.2832 * (t + vec3(0.0, 0.33, 0.67))); }
  void main() {
    vec3 N = normalize(vN), V = normalize(vV);
    float facing = dot(N, V);
    vec2 f2 = vP.xz;                                   // the dome rises on +y: its face is x, z
    float d = length(f2), ang = atan(f2.y, f2.x);
    // the white: pearly, a faint opal sheen, thin red veins towards the edge
    // the sclera: black opal, a faint fire drifting in it, darkening to the rim
    vec2 sq = f2 * 4.0 + vec2(uTime * 0.05, 0.0); vec2 sc = floor(sq);
    vec3 c = vec3(0.025, 0.02, 0.04) + hue(h(sc) + facing * 1.2) * 0.12 * smoothstep(0.5, 0.0, length(fract(sq) - 0.5)) * (1.0 - d);
    // the iris, looking your way: black opal fire in fibres round the pupil, a dark ring at its edge
    vec2 e = f2 - uLook; float di = length(e), ai = atan(e.y, e.x);
    float irisM = smoothstep(0.5, 0.46, di);
    c += vec3(0.85, 0.65, 0.3) * smoothstep(0.03, 0.0, abs(di - 0.5)) * 0.8;      // a fine gold ring round the iris
    vec2 q = e * 6.0 + vec2(sin(ai * 5.0 + uTime * 0.4), cos(ai * 4.0 - uTime * 0.3)) * 0.4;
    vec2 cell = floor(q); float r = h(cell);
    vec3 fire = hue(r + facing * 1.4 + uTime * 0.06) * (0.6 + 0.9 * pow(h(cell + 2.3), 2.0));
    vec3 iris = mix(vec3(0.03, 0.02, 0.06), fire, 0.75) * (0.75 + 0.25 * sin(ai * 40.0));
    iris *= 1.0 - smoothstep(0.34, 0.48, di) * 0.75;                       // the dark limbal ring
    c = mix(c, iris, irisM);
    // the pupil: a slit, upright, widening as it wakes
    float pupil = smoothstep(0.24, 0.2, length(e * vec2(1.0, mix(5.0, 2.6, uWake))));
    c = mix(c, vec3(0.0), pupil);
    // wet glass: a catchlight and a sharp highlight
    c += vec3(1.0) * smoothstep(0.1, 0.05, length(f2 - vec2(0.22, -0.2))) * 0.9;
    c += vec3(1.0) * pow(max(dot(reflect(-V, N), normalize(vec3(0.3, 0.8, 0.5))), 0.0), 80.0);
    gl_FragColor = vec4(c, 1.0);
  }`;;
// Cut a geometry along the plane y = y0 so no triangle spans it, tagging every vertex with the side
// its triangle lies on (attribute jawSide: +1 above, -1 below). (For Opal Overture's jaw.)
function splitAtY(geo, y0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const names = Object.keys(g.attributes).filter(nm => nm !== 'jawSide'), src = names.map(nm => g.attributes[nm]);
  const out = names.map(() => []), sides = [], P = g.attributes.position, pi = names.indexOf('position');
  const vtx = (i) => src.map(a => { const v = []; for (let c = 0; c < a.itemSize; c++) v.push(a.getComponent(i, c)); return v; });
  const lerpV = (A, B, t) => A.map((arr, k) => arr.map((v, c) => v + (B[k][c] - v) * t));
  const tri = (a, b, c) => { const side = (a[pi][1] + b[pi][1] + c[pi][1]) / 3 > y0 ? 1 : -1; for (const v of [a, b, c]) { v.forEach((arr, k) => out[k].push(...arr)); sides.push(side); } };
  for (let i = 0; i < P.count; i += 3) {
    const vs = [vtx(i), vtx(i + 1), vtx(i + 2)], ys = vs.map(v => v[pi][1] - y0), up = ys.map(y => y > 0);
    if (up[0] === up[1] && up[1] === up[2]) { tri(...vs); continue; }
    const lone = up.filter(Boolean).length === 1 ? up.indexOf(true) : up.indexOf(false);
    const a = vs[lone], b = vs[(lone + 1) % 3], c = vs[(lone + 2) % 3], ya = ys[lone], yb = ys[(lone + 1) % 3], yc = ys[(lone + 2) % 3];
    const ab = lerpV(a, b, ya / (ya - yb)), ac = lerpV(a, c, ya / (ya - yc));
    tri(a, ab, ac); tri(ab, b, c); tri(ab, c, ac);
  }
  const res = new THREE.BufferGeometry();
  names.forEach((nm, k) => res.setAttribute(nm, new THREE.Float32BufferAttribute(out[k], src[k].itemSize, src[k].normalized)));
  res.setAttribute('jawSide', new THREE.Float32BufferAttribute(sides, 1));
  return res;
}
export function opalInspect(gun, { surface }, quality) {
  const [Z0, Z1, Y0, Y1] = [-0.30471, 0.35412, -0.27329, 0.16576];   // the MP7's art rectangle
  const half = 0.022, tier = particleTier[quality] ?? 1, S = { seconds: OPAL_SECONDS };
  // The jaw: the gun splits along a line just above the barrel and opens about a hinge behind the grip,
  // the top half up, the bottom half down. Every material on the gun gets a vertex twist for it (copies,
  // swapped in for the inspect); faces stretched across the split are the dark throat. The same twist
  // folds the support hand and forearm away for this inspect (hand materials, ahead of the grip or out
  // on the left; the firing hand on the grip stays).
  const JAW_Y = 0.016, JAW_HINGE = -0.082;    // split along the barrel line; hinged at the front of the trigger guard, so only the front of the gun opens (the trigger, grip and hand stay whole)
  const jawU = { uJawAngle: { value: 0 }, uJawY: { value: JAW_Y }, uJawHinge: { value: JAW_HINGE }, uHideSup: { value: 0 }, uGulpZ: { value: 0 }, uGulpK: { value: 0 } };
  const wrapped = new Map(), swapped = [];
  const wrap = (mat) => {
    if (!wrapped.has(mat)) {
      const ud = mat.userData; mat.userData = {};                      // (userData holds textures: not cloned)
      const m = mat.clone(); mat.userData = ud; m.userData = ud;
      const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey.bind(mat), hand = !!ud.hand;
      m.onBeforeCompile = (sh, r) => {
        prev.call(mat, sh, r);
        Object.assign(sh.uniforms, jawU);
        sh.vertexShader = 'uniform float uJawAngle, uJawY, uJawHinge, uHideSup, uGulpZ, uGulpK;\nattribute float jawSide;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          ${hand ? '' : 'float gk = uGulpK * exp(-pow((position.z - uGulpZ) / 0.03, 2.0)); transformed.x *= 1.0 + gk; transformed.y = uJawY + (transformed.y - uJawY) * (1.0 + 1.4 * gk);'}
          {
            float ja = uJawAngle * min(jawSide, 0.0) * smoothstep(uJawHinge, uJawHinge - 0.02, position.z);
            vec2 jd = vec2(transformed.y - uJawY, transformed.z - uJawHinge);
            transformed.y = uJawY + jd.x * cos(ja) - jd.y * sin(ja);
            transformed.z = uJawHinge + jd.x * sin(ja) + jd.y * cos(ja);
          }
          ${hand ? 'if (uHideSup > 0.5 && (position.z < -0.07 || position.x < -0.06)) transformed = vec3(0.0, -2.0, 0.0);' : ''}`);
      };
      m.customProgramCacheKey = () => prevKey() + '|jaw' + (hand ? 'h' : '');
      wrapped.set(mat, m);
    }
    return wrapped.get(mat);
  };
  gun.traverse(o => {
    if (!o.isMesh || o.material.isShaderMaterial) return;
    swapped.push([o, o.material, o.geometry]);
    o.material = Array.isArray(o.material) ? o.material.map(wrap) : wrap(o.material);
    o.geometry = splitAtY(o.geometry, JAW_Y - o.position.y);
  });
  // the throat: a dark red wedge down the middle of the gun between the jaws (it stretches as they open)
  const gumMat = new THREE.MeshPhysicalMaterial({ color: 0x0c0814, emissive: 0x2a1450, emissiveIntensity: 0.7, roughness: 0.2, iridescence: 1, iridescenceIOR: 1.8, side: THREE.DoubleSide });
  const throatPos = new Float32Array(9), gumGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(throatPos, 3));
  const throat = new THREE.Mesh(gumGeo, gumMat); throat.frustumCulled = false; throat.visible = false; gun.add(throat);
  const gumC = new THREE.Vector3(), gumD = new THREE.Vector3();
  const packSup = gun.children.find(c => c.userData.arm);             // (pack guns: a separate support hand and arm)
  // the teeth: two rows each side, riding the jaws (inside the gun while it is shut), fangs near the front
  const toothMat = new THREE.MeshPhysicalMaterial({ color: 0xe8e4ec, metalness: 0.6, roughness: 0.12, clearcoat: 1, iridescence: 0.9, iridescenceIOR: 1.6 });   // pearl-silver
  const toothGeo = new THREE.ConeGeometry(1, 1, 8);
  const teeth = [], NT = 13, tz0 = -0.215, tz1 = JAW_HINGE - 0.04;
  for (const side of [-1, 1]) for (const k of [1, -1]) for (let j = 0; j < NT; j++) {
    const u = j / (NT - 1), fang = j === 1, t = new THREE.Mesh(toothGeo, toothMat);
    t.userData = { x: side * (half - 0.004), z: tz0 + (tz1 - tz0) * u, k, h: fang ? 0.026 : 0.009 + 0.003 * Math.sin(Math.PI * u), r: fang ? 0.0028 : 0.0017 };
    t.visible = false; gun.add(t); teeth.push(t);
  }
  const jawRot = (y, z, a, out) => { const dy = y - JAW_Y, dz = z - JAW_HINGE; return out.set(0, JAW_Y + dy * Math.cos(a) - dz * Math.sin(a), JAW_HINGE + dy * Math.sin(a) + dz * Math.cos(a)); };
  const tq = new THREE.Vector3();
  const at = new THREE.Vector3(0, Y1 - (Y1 - Y0) * 318 / 1024, Z0 + (Z1 - Z0) * 945 / 1536);
  const rz = (Z1 - Z0) * 44 / 1536, ry = (Y1 - Y0) * 38 / 1024, depth = 0.008;
  const eyeU = { uTime: { value: 0 }, uWake: { value: 0 }, uLook: { value: new THREE.Vector2() } };
  const eyeMat = new THREE.ShaderMaterial({ uniforms: eyeU, vertexShader: EYE_VERTEX, fragmentShader: EYE_FRAGMENT });
  const lidMat = new THREE.MeshStandardMaterial({ color: 0x18161c, metalness: 1, roughness: 0.18 });
  const eyeGeo = new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2);          // a dome on +y; turned to face out
  // the lids: the upper and lower halves of a slightly bigger dome, hinged on the eye's middle
  const upperGeo = new THREE.SphereGeometry(1.12, 32, 12, Math.PI / 2, Math.PI, 0, Math.PI / 2);
  const lowerGeo = new THREE.SphereGeometry(1.12, 32, 12, -Math.PI / 2, Math.PI, 0, Math.PI / 2);
  const eyes = [-1, 1].map(side => {
    const g = new THREE.Group(); g.position.copy(at); g.position.x = side * (half - 0.001);
    g.rotation.z = -side * Math.PI / 2;                                // local +y points out of the gun's side
    g.scale.set(ry, depth, rz);                                         // (local x is the gun's y, local z its z)
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    const upper = new THREE.Mesh(upperGeo, lidMat), lower = new THREE.Mesh(lowerGeo, lidMat);
    g.add(eye, upper, lower); g.visible = false; gun.add(g);
    return { g, upper, lower, side };
  });
  const trail = emitterTrail(gun);
  const mouthFrom = [];
  for (let j = 0; j < 12; j++) for (const side of [-1, 1]) mouthFrom.push({ point: new THREE.Vector3(side * 0.01, JAW_Y + 0.002, tz0 + (tz1 - tz0) * j / 11), normal: new THREE.Vector3(side * 0.6, 0.5, -0.8).normalize() });
  const prisms = [0xff7ab0, 0x7affe0, 0xb08aff, 0xffe08a].map((c, k) => { const m = particles('prism', tier, mouthFrom, new THREE.Color(c).multiplyScalar(3), trail, mulberry32(210101 + k * 9), S); m.material.blending = THREE.AdditiveBlending; m.visible = false; gun.add(m); return m; });
  // the fly: a proper housefly (red eyes, striped abdomen, veined wings, legs) that buzzes in loops in
  // front of the jaw on your side, then darts in and is snapped up by the bite
  const flyBody = new THREE.MeshStandardMaterial({ color: 0x24201a, roughness: 0.5, metalness: 0.25 });
  const flyWing = new THREE.MeshPhysicalMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.38, roughness: 0.1, iridescence: 1, side: THREE.DoubleSide, depthWrite: false });
  const flyEye = new THREE.MeshStandardMaterial({ color: 0x8a1408, roughness: 0.25, metalness: 0.3 });
  const fly = new THREE.Group(), flyWings = [], flyGeos = [];
  const ball = (sx, sy, sz, x, y, z, mat) => { const g = new THREE.SphereGeometry(1, 12, 8); flyGeos.push(g); const m = new THREE.Mesh(g, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); fly.add(m); return m; };
  ball(0.0026, 0.0024, 0.003, 0, 0, 0.0005, flyBody);                       // thorax
  ball(0.0024, 0.0021, 0.0042, 0, -0.0004, -0.0055, flyBody);               // abdomen
  ball(0.0021, 0.0019, 0.0017, 0, 0.0003, 0.0042, flyBody);                 // head
  for (const k of [-1, 1]) {
    ball(0.0014, 0.0016, 0.0013, k * 0.0015, 0.0006, 0.0047, flyEye);     // big red eyes
    for (let j = 0; j < 3; j++) {                                          // legs
      const lg = new THREE.CylinderGeometry(0.00018, 0.00012, 0.0055, 4); flyGeos.push(lg);
      const leg = new THREE.Mesh(lg, flyBody); leg.position.set(k * 0.0028, -0.002, 0.002 - j * 0.0022); leg.rotation.set(0.2 * (j - 1), 0, k * 0.9); fly.add(leg);
    }
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.bezierCurveTo(0.002, 0.0026, 0.0085, 0.0022, 0.0095, 0); shape.bezierCurveTo(0.0075, -0.0016, 0.0025, -0.0012, 0, 0);
    const wg = new THREE.ShapeGeometry(shape); flyGeos.push(wg);
    const piv = new THREE.Group(); piv.position.set(k * 0.0012, 0.0022, 0.0005);
    const w = new THREE.Mesh(wg, flyWing); w.rotation.set(-Math.PI / 2, 0, k > 0 ? -2.6 : -0.54); w.scale.x = k;
    piv.add(w); fly.add(piv); flyWings.push({ piv, k });
  }
  fly.visible = false; gun.add(fly);
  const flyCam = new THREE.Vector3(1, 0, 0), flyProbe = new THREE.Mesh(new THREE.PlaneGeometry(0.0001, 0.0001), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  flyProbe.frustumCulled = false; gun.add(flyProbe);
  flyProbe.onBeforeRender = (r, sc, camera) => { flyCam.setFromMatrixPosition(camera.matrixWorld); gun.worldToLocal(flyCam); };
  const fq = new THREE.Vector3(), fx = new THREE.Vector3(), fyv = new THREE.Vector3(), fm = new THREE.Matrix4(), UPV = new THREE.Vector3(0, 1, 0);
  const FLY0 = 0.42, DART = 0.55, SNAP = 0.6;
  // where the fly is at inspect time p: lazy figure-eights in front of the jaw, jittering like a fly, then a dart in
  const flyPos = (p, side, out) => {
    const mouth = fq.set(side * 0.004, JAW_Y - 0.008, tz0 + 0.03).clone(), tt = p * OPAL_SECONDS;
    const cx = side * 0.085, cy = JAW_Y + 0.05, cz = tz0 + 0.0;
    const a = tt * 2.6;
    out.set(cx + side * 0.03 * Math.sin(a * 0.5), cy + 0.022 * Math.sin(a), cz + 0.05 * Math.sin(a * 0.5 + 1.2) * Math.cos(a * 0.5))
      .add(fx.set(Math.sin(tt * 17) * 0.004 + Math.sin(tt * 29) * 0.002, Math.sin(tt * 23) * 0.003, Math.cos(tt * 19) * 0.004));
    const comeIn = smooth(p, FLY0, FLY0 + 0.04);                            // arriving from out of shot
    out.x += side * 0.25 * (1 - comeIn); out.y += 0.08 * (1 - comeIn);
    const dart = smooth(p, DART, SNAP);
    return out.lerp(mouth, dart * dart);
  };
  const rainbow = [0xff6a8a, 0x6affd8, 0xa070ff, 0xffd06a].map((c, i) => {
    const m = particles('glint', tier, surface.length ? surface : [{ point: at.clone(), normal: new THREE.Vector3(1, 0, 0) }], new THREE.Color(c).multiplyScalar(2.5), trail, mulberry32(210011 + i * 7), S);
    m.material.blending = THREE.AdditiveBlending; m.visible = false; gun.add(m); return m;
  });
  // after the gulp, a prismatic shimmer drifting off the whole gun
  const shimmer = [0xff6a8a, 0x6affd8, 0xa070ff, 0xffd06a].map((c, i) => {
    const m = particles('shimmer', tier, surface.length ? surface : [{ point: at.clone(), normal: new THREE.Vector3(1, 0, 0) }], new THREE.Color(c).multiplyScalar(3), trail, mulberry32(210151 + i * 7), { ...S, window: [OPAL_GULP + 0.06, OPAL_GULP + 0.14], life: [0.5, 1.0] });
    m.material.blending = THREE.AdditiveBlending; m.visible = false; gun.add(m); return m;
  });
  // the roar: prismatic light streaming forward out of the wide jaw, and a glow in the throat
  const roarFrom = [];
  for (let j = 0; j < 6; j++) for (const side of [-1, 1]) roarFrom.push({ point: new THREE.Vector3(side * 0.006, JAW_Y, tz0 + 0.01 + 0.08 * j / 5), normal: new THREE.Vector3(side * 0.25, 0.25, -1).normalize() });
  const roars = [0xff7ab0, 0x7affe0, 0xb08aff, 0xffe08a].map((c, k) => {
    const m = particles('roar', tier, roarFrom, new THREE.Color(c).multiplyScalar(3), trail, mulberry32(210171 + k * 9), { ...S, window: [OPAL_ROAR + 0.01, OPAL_ROAR + 0.075], life: [0.5, 0.9] });
    m.material.blending = THREE.AdditiveBlending; m.visible = false; gun.add(m); return m;
  });
  const roarGlow = flare(new THREE.Color(0xc8a8ff)); roarGlow.position.set(0, JAW_Y, tz0 + 0.05); roarGlow.visible = false; gun.add(roarGlow);
  const camAt = new THREE.Vector3(), probe = new THREE.Mesh(new THREE.PlaneGeometry(0.0001, 0.0001), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  probe.frustumCulled = false; gun.add(probe);
  probe.onBeforeRender = (renderer, scene, camera) => { camAt.setFromMatrixPosition(camera.matrixWorld); gun.worldToLocal(camAt); };
  const glazes = [];
  gun.traverse(o => { const u = o.material?.userData?.tri; if (u?.artPhase && !glazes.includes(u.artPhase)) glazes.push(u.artPhase); });
  let phase = -1;
  return {
    clip: OPAL_CLIP, seconds: OPAL_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      for (const g of glazes) g.value = active ? p : -1;
      const t = active ? p * OPAL_SECONDS : 0;
      // closed as the gun comes up, opening slowly, one blink after the bite, narrowed (content) while it
      // swallows, closing at the end
      const blink = active ? Math.max(0, 1 - Math.abs(p - 0.62) / 0.025) : 0;
      const content = active ? smooth(p, OPAL_GULP + 0.02, OPAL_GULP + 0.06) * (1 - smooth(p, OPAL_ROAR - 0.03, OPAL_ROAR)) : 0;
      const open = active ? smooth(p, 0.16, 0.32) * (1 - smooth(p, 0.91, 0.97)) * (1 - blink) * (1 - 0.45 * content) : 0;
      eyeU.uTime.value = t; eyeU.uWake.value = smooth(open, 0.3, 1);
      for (const e of eyes) {
        e.g.visible = active;
        e.upper.rotation.z = -open * 1.6; e.lower.rotation.z = open * 1.6;     // hinged along the eye's middle, rolling back into the gun
        if (e.g.visible && Math.sign(camAt.x) === e.side) {
          // the pupil looks at you: the camera's direction in the eye's plane (gun y, gun z)
          const dy = camAt.y - at.y, dz = camAt.z - at.z, dx = Math.abs(camAt.x - e.g.position.x) + 0.05;
          eyeU.uLook.value.set(THREE.MathUtils.clamp(dy / dx * 0.5, -0.35, 0.35), THREE.MathUtils.clamp(dz / dx * 0.5, -0.35, 0.35));
        }
      }
      // no support hand in this inspect
      jawU.uHideSup.value = active ? 1 : 0;
      if (packSup) { packSup.visible = !active; packSup.userData.arm.visible = !active; if (packSup.userData.arm.userData.upper) packSup.userData.arm.userData.upper.visible = !active; }
      // the jaw: opens after the eye, snaps shut on the fly, stays shut while it swallows, then opens wide
      // for the roar and snaps shut before the lids close
      const gape = active ? smooth(p, 0.32, 0.5) * (1 - smooth(p, 0.575, 0.6)) : 0;
      const roar = active ? smooth(p, OPAL_ROAR, OPAL_ROAR + 0.04) * (1 - smooth(p, OPAL_ROAR + 0.075, OPAL_ROAR + 0.09)) : 0;
      const A = 0.25 * gape + 0.46 * roar * (1 + 0.05 * Math.sin(t * 40));   // (a modest gape, wider to roar)
      // the gulp: a bulge running back from the mouth to the hinge
      const g = active ? (p - OPAL_GULP) / 0.08 : -1;
      jawU.uGulpK.value = g > 0 && g < 1 ? 0.22 * Math.sin(g * Math.PI) : 0;
      jawU.uGulpZ.value = tz0 + (-0.05 - tz0) * THREE.MathUtils.clamp(g, 0, 1);
      roarGlow.visible = roar > 0.01; roarGlow.scale.setScalar(0.05 + 0.1 * roar); roarGlow.material.opacity = roar * 0.8;
      jawU.uJawAngle.value = A;
      throat.visible = A > 0.01;
      if (throat.visible) {
        jawRot(JAW_Y, -0.225, 0, gumC); jawRot(JAW_Y, -0.225, -A, gumD);
        throatPos.set([0, JAW_Y, JAW_HINGE - 0.03, 0, gumC.y, gumC.z, 0, gumD.y, gumD.z]);
        gumGeo.attributes.position.needsUpdate = true; gumGeo.computeVertexNormals();
      }
      for (const t of teeth) {
        const { x, z, k, h, r } = t.userData;
        t.visible = A > 0.01;
        if (!t.visible) continue;
        const a = k < 0 ? -A * (1 - smooth(z, JAW_HINGE - 0.02, JAW_HINGE)) : 0;   // the lower jaw's teeth ride it
        jawRot(JAW_Y - k * h * 0.45, z, a, tq); t.position.set(x, tq.y, tq.z);
        t.rotation.set(a + (k > 0 ? Math.PI : 0), 0, 0);                       // upper teeth point down, lower up
        t.scale.set(r, h, r);
      }
      for (const m of rainbow) m.visible = active && p > 0.25;
      for (const m of prisms) m.visible = active && (p < OPAL_GULP + 0.02 || p > OPAL_ROAR - 0.01);
      for (const m of shimmer) m.visible = active && p > OPAL_GULP;
      for (const m of roars) m.visible = active && p > OPAL_ROAR - 0.01;
      // the fly: on your side, from out wide and above, in a buzzing curve to the jaw's front; gone at the bite
      fly.visible = active && p > FLY0 && p < SNAP;
      if (fly.visible) {
        const side = Math.sign(flyCam.x) || 1, tt = p * OPAL_SECONDS;
        flyPos(p, side, fly.position); flyPos(p + 0.004, side, fyv);
        const fwd = fyv.sub(fly.position).normalize(), right = fx.crossVectors(UPV, fwd).normalize(), up = fq.crossVectors(fwd, right);
        fm.makeBasis(right, up, fwd); fly.quaternion.setFromRotationMatrix(fm);
        fly.rotateZ(Math.sin(tt * 3) * 0.35);                               // banking through the loops
        fly.scale.setScalar(2.4);
        for (const w of flyWings) w.piv.rotation.z = w.k * (0.15 + 0.75 * Math.sin(tt * 160));
      }
      trail.update(active ? t : -1);
    },
    dispose() {
      for (const [o, m, g] of swapped) { o.geometry.dispose(); o.material = m; o.geometry = g; } for (const m of wrapped.values()) m.dispose(); toothMat.dispose(); toothGeo.dispose(); gumGeo.dispose(); gumMat.dispose();
      eyeGeo.dispose(); upperGeo.dispose(); lowerGeo.dispose(); eyeMat.dispose(); lidMat.dispose(); probe.geometry.dispose(); probe.material.dispose();
      for (const m of [...rainbow, ...prisms, ...shimmer, ...roars]) { m.geometry.dispose(); m.material.dispose(); } roarGlow.material.dispose();
      for (const g of flyGeos) g.dispose(); flyBody.dispose(); flyWing.dispose(); flyEye.dispose(); flyProbe.geometry.dispose(); flyProbe.material.dispose();
    },
  };
}

// Epics: glowing motes float up off the gun in the skin's accent colour (rising, swaying, fading, then
// rising again from another spot). Same length as the plain inspect (the usual hand pose).
const EPIC_SECONDS = 3.2;
let sparkTex = null;
function sparkTexture() {
  if (sparkTex) return sparkTex;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return (sparkTex = new THREE.CanvasTexture(c));
}
export function epicInspect(gun, skin, quality) {
  gun.updateMatrixWorld(true);
  const toGun = gun.matrixWorld.clone().invert();
  const size = new THREE.Box3().setFromObject(gun).applyMatrix4(toGun).getSize(new THREE.Vector3());
  const col = new THREE.Color(...(skin.c?.[1] || [1, 0.8, 0.3])), white = new THREE.Color(1, 1, 1), c = new THREE.Color();
  // where motes start: points on the gun's own surface (its meshes' vertices, in the gun's space)
  const pool = [], rng = mulberry32(7310), mv = new THREE.Matrix4();
  gun.traverse((o) => {
    const pa = o.isMesh && o.geometry?.attributes.position;
    if (!pa) return;
    mv.multiplyMatrices(toGun, o.matrixWorld);
    for (let k = 0; k < 32; k++) pool.push(new THREE.Vector3().fromBufferAttribute(pa, Math.floor(rng() * pa.count)).applyMatrix4(mv));
  });
  if (!pool.length) pool.push(new THREE.Vector3());
  const n = [60, 120, 200, 300][particleTier[quality] ?? 1];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const motes = new THREE.Points(geo, new THREE.PointsMaterial({ size: size.z * 0.028, map: sparkTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  motes.visible = false; motes.frustumCulled = false; motes.name = 'Inspect motes'; gun.add(motes);
  const mote = Array.from({ length: n }, () => ({ off: rng(), period: 0.9 + rng() * 1.1, sway: rng() * 6.28, rise: 0.35 + rng() * 0.5, pick: Math.floor(rng() * 9973) }));
  let phase = -1;
  return {
    seconds: EPIC_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      if (!active) { motes.visible = false; return; }
      const sec = p * EPIC_SECONDS, on = smooth(p, 0.02, 0.12) * (1 - smooth(p, 0.9, 0.99)), pos = geo.attributes.position, cl = geo.attributes.color;
      motes.visible = on > 0.01;
      mote.forEach((m, i) => {
        const cyc = sec / m.period + m.off, age = cyc - Math.floor(cyc), o = pool[(m.pick + Math.floor(cyc) * 131) % pool.length];
        pos.setXYZ(i, o.x + Math.sin(m.sway + sec * 2.1) * size.z * 0.025 * age, o.y + age * size.y * m.rise, o.z + Math.cos(m.sway + sec * 1.7) * size.z * 0.025 * age);
        c.copy(col).lerp(white, 0.3 * (1 - age)).multiplyScalar(Math.sin(Math.PI * age) * on * 2.0);   // brightest mid-rise
        cl.setXYZ(i, c.r, c.g, c.b);
      });
      pos.needsUpdate = true; cl.needsUpdate = true;
    },
    dispose() { geo.dispose(); motes.material.dispose(); },
  };
}

// Rank skins (Foundry ... Totality): each inspect is a short scene of a few glowing props, the rank's
// crest among them, placed on whichever side of the gun faces the camera (the gun is turned by its clip).
// 8.4 s like the Legendaries. kind: the skin's `inspect` (core/skins.js RANK_SKINS).
const RANK_SECONDS = 8.4;
const RANK_OF = { foundry: 'Bronze', quickmirror: 'Silver', mintmark: 'Gold', whiteout: 'Platinum', verdant: 'Emerald', splitlight: 'Diamond', totality: 'Champion' };
const RANK_RATING = { Bronze: 1040, Silver: 1190, Gold: 1340, Platinum: 1490, Emerald: 1640, Diamond: 1790, Champion: 1800 };
const crestTex = new Map();
// Champion's red nuke: a sky round the camera (in the weapon view: only you see it). Everything on it is painted by
// direction, so it reads as far away however small the sphere: a flash on the horizon ahead, a fireball rising into a
// mushroom cloud, a shockwave ring sweeping across the whole sky and over you, then the world bathed in red.
const NUKE_VERTEX = `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const NUKE_FRAGMENT = `uniform float uTime, uFlash, uRise, uBlast, uFade; varying vec3 vDir;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f *= f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1)), f.x), f.y); }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
  void main() {
    vec3 D = normalize(vec3(-0.32, 0.02, -1.0));                    // ground zero: on the horizon, ahead and to the left (clear of the gun and badge)
    vec3 d = normalize(vDir);
    float ang = acos(clamp(dot(d, D), -1.0, 1.0));
    vec3 right = normalize(cross(D, vec3(0.0, 1.0, 0.0)));
    float lx = dot(d, right), ly = d.y - D.y;
    // the mushroom: a churning stem, a wide cap that rises and spreads, a white-hot core
    float r = uRise, capY = 0.08 + 0.42 * r, t = uTime;
    float churn = fbm(vec2(lx * 9.0, ly * 9.0 - t * 0.8));
    float stem = smoothstep(0.045 + 0.045 * r, 0.0, abs(lx) + (churn - 0.5) * 0.03) * step(0.0, ly) * step(ly, capY) * step(0.01, r);
    vec2 c = vec2(lx / (0.1 + 0.3 * r), (ly - capY) / (0.05 + 0.15 * r));
    float cap = smoothstep(1.05, 0.7, length(c) + (fbm(c * 2.5 + vec2(0.0, -t * 0.6)) - 0.5) * 0.5) * step(0.01, r);
    float ball = smoothstep(0.22 * (1.0 - r * 0.6), 0.0, length(vec2(lx, ly - capY))) ;
    float cloud = max(stem, cap);
    vec3 fire = mix(vec3(0.55, 0.03, 0.02), vec3(1.0, 0.25, 0.08), churn) + vec3(1.0, 0.85, 0.6) * ball * 1.5;
    // the shockwave: a red-white ring at angle uBlast from ground zero; behind it the sky burns red with heat haze
    float ring = exp(-pow((ang - uBlast) / 0.06, 2.0)), inside = smoothstep(uBlast + 0.02, uBlast - 0.15, ang);
    float haze = fbm(vec2(atan(d.z, d.x) * 3.0, d.y * 6.0 - t * 0.4));
    vec3 sky = mix(vec3(0.25, 0.01, 0.015), vec3(0.6, 0.06, 0.03), haze) * (d.y < 0.0 ? 0.55 : 1.0) + vec3(0.9, 0.12, 0.05) * exp(-abs(d.y) * 12.0) * 0.6;
    vec3 col = sky * inside + vec3(1.0, 0.45, 0.3) * ring * 1.6;
    float a = inside * 0.62 + ring * 0.9;
    col = mix(col, fire, cloud); a = max(a, cloud * 0.97);
    // the flash: blinding at ground zero, washing the whole view
    float glow = exp(-ang * 2.5);
    col += vec3(1.0, 0.75, 0.65) * uFlash * (0.6 + 1.6 * glow); a = max(a, uFlash * (0.55 + 0.45 * glow));
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uFade);
  }`;
// the shine's colour: the skin's own metal (Frostline silver, Meridian gold, Sovereign red-gold ...)
const RANK_SHINE = { Bronze: 0xffb878, Silver: 0xf2f7ff, Gold: 0xffdc8c, Platinum: 0xe6d8ff, Emerald: 0x7affb0, Diamond: 0xd8ecff, Champion: 0xff7a5a };
const SHINE_VERTEX = `uniform mat4 uRel; varying vec3 vG; varying vec3 vN; varying vec3 vV;
  void main() { vG = (uRel * vec4(position, 1.0)).xyz; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv; }`;
const SHINE_FRAGMENT = `uniform float uAt, uWidth, uAmt; uniform vec3 uColor; varying vec3 vG; varying vec3 vN; varying vec3 vV;
  void main() {
    float d = (vG.z - uAt + vG.y * 0.6) / uWidth;                     // slanted band, leaning back at the top
    float band = exp(-d * d) + 0.35 * exp(-d * d * 0.08);              // a sharp core and a soft glow round it
    float face = 0.55 + 0.45 * pow(max(dot(normalize(vN), normalize(vV)), 0.0), 0.5);
    float a = band * face * uAmt;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }`;
const RANK_LIGHT = { Bronze: 0xf0b47a, Silver: 0xdfe8f4, Gold: 0xffd36b, Platinum: 0xb48cff, Emerald: 0x3fd17f, Diamond: 0x7aa6ff, Champion: 0xff4a4a };
function crestTexture(rank, px = 128) {      // the rank's badge (ui/rank-icon.js) without its division number
  const key = rank + px;
  if (crestTex.has(key)) return crestTex.get(key);
  const c = document.createElement('canvas'); c.width = c.height = px;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => { c.getContext('2d').drawImage(img, 0, 0, px, px); tex.needsUpdate = true; };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(rankIconSvg(RANK_RATING[rank]).replace(/<text[\s\S]*?<\/text>/, '')
    .replace('width="100%" height="100%"', `width="${px}" height="${px}" xmlns="http://www.w3.org/2000/svg"`));
  crestTex.set(key, tex);
  return tex;
}
let ringTex = null;
function goldRing() {
  if (ringTex) return ringTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.shadowColor = '#ffcc55'; g.shadowBlur = 14; g.strokeStyle = '#ffd36b'; g.lineWidth = 9;
  g.beginPath(); g.arc(64, 64, 42, 0, Math.PI * 2); g.stroke();
  ringTex = new THREE.CanvasTexture(c); ringTex.colorSpace = THREE.SRGBColorSpace;
  return ringTex;
}
let shaftTex = null;
function shaftTexture() {    // a beam of light: bright at its start (u 0), fading along it, soft across it (v)
  if (shaftTex) return shaftTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const g = c.getContext('2d'), img = g.createImageData(128, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++) {
    const u = x / 127, v = (y - 15.5) / 16, a = Math.pow(1 - u, 1.6) * Math.exp(-v * v * 5) * (0.7 + 0.3 * Math.exp(-v * v * 40)), i = (y * 128 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(255 * a);
  }
  g.putImageData(img, 0, 0);
  shaftTex = new THREE.CanvasTexture(c);
  return shaftTex;
}
let rayTex = null;
function rayTexture() {      // a corona: soft uneven streamers round a dark middle
  if (rayTex) return rayTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), rng = mulberry32(1800);
  g.translate(128, 128); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2, len = 60 + rng() * 66, w = 0.01 + rng() * 0.04;
    const gr = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    gr.addColorStop(0.3, 'rgba(255,240,210,0.35)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, len, a - w, a + w); g.closePath(); g.fill();
  }
  rayTex = new THREE.CanvasTexture(c); rayTex.colorSpace = THREE.SRGBColorSpace;
  return rayTex;
}
// A pose held while the scene plays: side towards you (yaw), rolled and pitched; extra keys replace the ones near their time.
function rankClip(yaw, roll, pitch, extra = [], events = []) {
  const keys = [
    [0, 0, 0, 0, 0, 0, 0],
    [0.18, -0.072, 0.082, -0.1, pitch * 0.7, yaw * 0.75, roll * 0.5],
    [0.4, -0.085, 0.095, -0.125, pitch, yaw, roll],
    [0.66, -0.088, 0.098, -0.135, pitch, yaw, roll],
    [0.84, -0.065, 0.075, -0.095, pitch * 0.6, yaw * 0.65, roll * 0.4],
    [1, 0, 0, 0, 0, 0, 0],
  ].filter(([t]) => !extra.some(([u]) => Math.abs(u - t) < 0.05));
  return { root: [...keys, ...extra].sort((a, b) => a[0] - b[0]), events };
}
const RANK_CLIPS = {
  foundry: rankClip(1.0, 0.42, 0.1),                                               // rolled inward: the stamp above the magazine faces you
  quickmirror: rankClip(0.95, 0.05, -0.2, [[0.74, -0.086, 0.096, -0.13, 0.06, 0.95, 0.05]]),   // tipped forward, then levelled
  mintmark: rankClip(1.05, 0.1, 0.08, [[0.5, -0.085, 0.1, -0.125, 0.16, 1.05, 0.1]], [[0.55, 'charge']]),
  whiteout: rankClip(1.0, 0.12, 0.06, [], [[0.22, 'slap']]),
  verdant: rankClip(1.1, 0.2, 0.08),
  splitlight: rankClip(1.0, 0, 0.08, [[0.3, -0.085, 0.095, -0.125, 0.08, 1.0, -0.28], [0.66, -0.088, 0.098, -0.135, 0.08, 1.0, 0.38]]),   // a slow roll
  totality: rankClip(1.05, 0.15, 0.1, [], [[0.36, 'slap'], [0.61, 'charge']]),      // the shockwave hits; the chime answers the diamond ring
};
const CHAMP_CROWN = [[16, 42], [14, 22], [24, 30], [32, 16], [40, 30], [50, 22], [48, 42]];
const bump = (p, a, b, c, d) => smooth(p, a, b) * (1 - smooth(p, c, d));
export function rankInspect(gun, mag, kind, quality) {
  gun.updateMatrixWorld(true);
  const toGun = gun.matrixWorld.clone().invert();
  const box = new THREE.Box3().setFromObject(gun).applyMatrix4(toGun);
  const mb = mag ? new THREE.Box3().setFromObject(mag).applyMatrix4(toGun) : new THREE.Box3();
  const size = box.getSize(new THREE.Vector3()), L = size.z, H = size.y, K = 0.55;   // K: props' size against the gun's height
  const magZ = Math.min(box.min.z + L * 0.48, mb.isEmpty() ? Infinity : (mb.min.z + mb.max.z) / 2), magTop = mb.isEmpty() ? box.min.y + H * 0.45 : Math.min(mb.max.y, box.min.y + H * 0.55);
  const rank = RANK_OF[kind], tier = particleTier[quality] ?? 1, rng = mulberry32(kind.length * 7919 + 31);
  // the shine: a band of light in the skin's colour sweeping over the painted surfaces, stock to barrel. Each painted
  // mesh gets an additive twin on the same geometry that lights only the band (z in gun space, slanted a little).
  const shineU = { uAt: { value: 1e3 }, uWidth: { value: L * 0.07 }, uColor: { value: new THREE.Color(RANK_SHINE[rank]) }, uAmt: { value: 0 } };
  const shines = [];
  gun.traverse((o) => {
    if (!o.isMesh || !o.material?.userData?.skinKey) return;
    const mat = new THREE.ShaderMaterial({ uniforms: { ...shineU, uRel: { value: toGun.clone().multiply(o.matrixWorld) } }, vertexShader: SHINE_VERTEX, fragmentShader: SHINE_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const twin = new THREE.Mesh(o.geometry, mat); twin.visible = false; twin.frustumCulled = false; twin.renderOrder = 1; twin.name = 'Inspect shine';
    shines.push([o, twin]);
  });
  for (const [o, twin] of shines) o.add(twin);       // (a child at no offset: drawn exactly over its mesh)
  const fx = new THREE.Group(); fx.name = 'Rank inspect'; fx.visible = false; gun.add(fx);
  const own = [];      // materials and geometries to free
  const sprite = (map, color, scale, additive = true) => {
    const mat = new THREE.SpriteMaterial({ map, color, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const s = new THREE.Sprite(mat); s.scale.setScalar(scale * K); s.renderOrder = 20; fx.add(s); own.push(mat); return s;
  };
  const cloud = (n, color, px) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new THREE.PointsMaterial({ size: px * K, map: sparkTexture(), color, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 21; fx.add(pts); own.push(geo, mat);
    return pts;
  };
  // a shaft of light from a to b (gun space), width w: one quad turned to face the camera, bright at a, fading out
  const shaft = (color) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), 2));
    geo.setIndex([0, 2, 1, 2, 3, 1]);
    const mat = new THREE.MeshBasicMaterial({ map: shaftTexture(), color, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 21; fx.add(m); own.push(geo, mat);
    const d = new THREE.Vector3(), v = new THREE.Vector3(), s = new THREE.Vector3();
    return { set(a, b, w, opacity) {
      d.subVectors(b, a); v.subVectors(cam, a); s.crossVectors(d, v).normalize().multiplyScalar(w / 2);
      const pos = geo.attributes.position;
      pos.setXYZ(0, a.x - s.x, a.y - s.y, a.z - s.z); pos.setXYZ(1, a.x + s.x, a.y + s.y, a.z + s.z);
      pos.setXYZ(2, b.x - s.x * 2.5, b.y - s.y * 2.5, b.z - s.z * 2.5); pos.setXYZ(3, b.x + s.x * 2.5, b.y + s.y * 2.5, b.z + s.z * 2.5);   // (widening as it goes)
      pos.needsUpdate = true; mat.opacity = opacity; m.visible = opacity > 0.005;
    } };
  };
  const crest = sprite(crestTexture(rank), 0xffffff, H * 0.32, false);
  // the rank's badge, big, behind the gun as you look at it (as Midnight Orrery's portal), in a glow of the rank's colour
  const back = new THREE.Group(); back.name = 'Rank backdrop'; back.visible = false; gun.add(back);
  const plane = new THREE.PlaneGeometry(1, 1);
  const glowMat = new THREE.MeshBasicMaterial({ map: sparkTexture(), color: RANK_LIGHT[rank], transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const badgeMat = new THREE.MeshBasicMaterial({ map: crestTexture(rank, 512), transparent: true, depthWrite: false, toneMapped: false });
  const glow = new THREE.Mesh(plane, glowMat), badge = new THREE.Mesh(plane, badgeMat);
  glow.renderOrder = -2; badge.renderOrder = -1; glow.frustumCulled = badge.frustumCulled = false;
  back.add(glow, badge); own.push(plane, glowMat, badgeMat);
  // (centre: above the gun, so the badge shows over its top)
  const centre = box.getCenter(new THREE.Vector3()).add(new THREE.Vector3(0, H * 0.65, 0)), camWorld = new THREE.Vector3(), camLocal = new THREE.Vector3(), away = new THREE.Vector3();
  let haveCam = false;
  glow.onBeforeRender = (renderer, scene, camera) => {     // (drawn first: places the backdrop for this frame's camera)
    gun.updateMatrixWorld();
    camWorld.setFromMatrixPosition(camera.matrixWorld);
    camLocal.copy(camWorld); gun.worldToLocal(camLocal); haveCam = true;
    back.position.copy(centre).addScaledVector(away.copy(camLocal).sub(centre).normalize(), -L * 0.7);
    back.lookAt(camWorld);
    back.updateMatrixWorld();
  };
  // where things sit (gun space); x is set each frame to the side you see
  const yMid = box.min.y + H * 0.62, badgeY = magTop + (box.max.y - magTop) * 0.3;
  // (in first person the back of the gun is beside your cheek, out of view: everything stays between its front third and middle)
  const stockZ = box.min.z + L * 0.62, guardZ = box.min.z + L * 0.3;
  let side = 1, sx = 0;
  const cam = new THREE.Vector3(), inv = new THREE.Matrix4();
  const at = (o, z, y, out = 0) => o.position.set(sx + side * out, y, z);
  const N = (k) => [k, k * 2, k * 3, k * 4][tier];
  // the scene of each rank: props made here, posed by step(p)
  let step;
  if (kind === 'foundry') {
    const soot = sprite(sparkTexture(), 0x050302, H * 0.36, false), ember = sprite(sparkTexture(), 0xff752b, H * 0.6), embers = cloud(N(10), 0xff8a3a, H * 0.05);
    const seed = Array.from({ length: embers.geometry.attributes.position.count }, () => [rng() - 0.5, rng(), rng()]);
    step = (p) => {
      const wipe = smooth(p, 0.28, 0.42), heat = bump(p, 0.36, 0.46, 0.55, 0.8);
      at(crest, magZ, badgeY); crest.material.opacity = smooth(p, 0.2, 0.3) * (1 - smooth(p, 0.9, 0.98));
      crest.material.color.setRGB(1 + heat * 1.2, 1 + heat * 0.15, 1 - heat * 0.5);
      at(soot, magZ - wipe * 0.5 * H * K * 0.36, badgeY); soot.scale.x = H * K * 0.36 * (1 - wipe); soot.material.opacity = 0.9 * (1 - wipe) * smooth(p, 0.15, 0.25);
      at(ember, magZ, badgeY); ember.material.opacity = heat * 1.4;
      const pos = embers.geometry.attributes.position;
      seed.forEach(([dx, d, v], i) => { const age = Math.max(0, (p - 0.4 - d * 0.25) / 0.25); pos.setXYZ(i, sx + side * 0.004, badgeY + age * H * (0.3 + v * 0.4), magZ + dx * H * 0.3 + Math.sin(age * 6 + d * 9) * H * 0.03); });
      pos.needsUpdate = true; embers.material.opacity = bump(p, 0.4, 0.45, 0.7, 0.85);
    };
  } else if (kind === 'quickmirror') {
    const beads = [0, 1].map(() => Array.from({ length: 5 }, (_, k) => sprite(sparkTexture(), 0xdfe8ff, H * (0.11 - k * 0.016))));
    step = (p) => {
      at(crest, magZ, badgeY);
      const run = smooth(p, 0.24, 0.72), on = bump(p, 0.22, 0.26, 0.72, 0.78);
      let near = 0;
      beads.forEach((trail, j) => trail.forEach((b, k) => {
        const z = THREE.MathUtils.lerp(stockZ, guardZ, Math.max(0, run - k * 0.018));
        const split = Math.exp(-(((z - magZ) / (L * 0.07)) ** 2));
        if (k === 0) near = Math.max(near, split);
        at(b, z, yMid + H * 0.12 + (j ? -1 : 1) * split * H * 0.09);
        b.material.opacity = on * (1 - k * 0.17) * (j && split < 0.05 ? 0 : 1);     // one bead, two while it parts round the badge
      }));
      crest.material.opacity = (0.25 + 0.75 * near) * bump(p, 0.15, 0.25, 0.85, 0.95);
    };
  } else if (kind === 'mintmark') {
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xd8a634, metalness: 1, roughness: 0.22, emissive: 0x3a2600 });
    const coinGeo = new THREE.CylinderGeometry(H * K * 0.1, H * K * 0.1, H * K * 0.018, 28);
    const coin = new THREE.Group(), face = new THREE.Mesh(coinGeo, coinMat);
    face.rotation.z = Math.PI / 2; coin.add(face); fx.add(coin); own.push(coinMat, coinGeo);
    const glow = sprite(sparkTexture(), 0xffc23a, H * 0.5), lines = Array.from({ length: 12 }, () => sprite(sparkTexture(), 0xffd36b, H * 0.07));
    step = (p) => {
      const fly = smooth(p, 0.22, 0.55), up = Math.sin(Math.PI * fly) * H * 0.75, landed = smooth(p, 0.53, 0.56);
      at(coin, THREE.MathUtils.lerp(stockZ + L * 0.06, stockZ, fly), yMid - H * 0.2 * (1 - fly) + up, H * 0.25 * (1 - fly) + 0.003);
      coin.rotation.set(0, fly * Math.PI * 4, 0);           // two turns, landing face out
      coin.visible = p > 0.2 && p < 0.93;
      at(glow, stockZ, yMid); glow.material.opacity = landed * bump(p, 0.54, 0.6, 0.8, 0.92) * 1.2;
      at(crest, stockZ, yMid, 0.002); crest.material.opacity = landed * (1 - smooth(p, 0.88, 0.95)); crest.scale.setScalar(H * K * 0.17);
      lines.forEach((s, i) => { const k = i / (lines.length - 1); at(s, THREE.MathUtils.lerp(stockZ - L * 0.08, guardZ, k), yMid + H * 0.05); s.material.opacity = bump(p, 0.56 + k * 0.12, 0.6 + k * 0.12, 0.8, 0.92); });
    };
  } else if (kind === 'whiteout') {
    const frost = cloud(N(30), 0xcfe8ff, H * 0.045), dust = cloud(N(24), 0xe6f4ff, H * 0.04);
    const fs = Array.from({ length: frost.geometry.attributes.position.count }, () => [rng(), (rng() - 0.5) * H * 0.05]);
    const ds = Array.from({ length: dust.geometry.attributes.position.count }, () => [rng() - 0.5, rng() - 0.3, rng() * 0.5 + 0.5]);
    step = (p) => {
      const front = THREE.MathUtils.lerp(guardZ, stockZ, smooth(p, 0.24, 0.52)), formed = smooth(p, 0.5, 0.62), brushed = smooth(p, 0.74, 0.8);
      const fp = frost.geometry.attributes.position;
      fs.forEach(([k, dy], i) => { const z = THREE.MathUtils.lerp(guardZ, stockZ, k); fp.setXYZ(i, sx + side * 0.003, yMid + dy + Math.sin(k * 40) * H * 0.015, z > front ? guardZ : z); });
      fp.needsUpdate = true; frost.material.opacity = bump(p, 0.23, 0.27, 0.6, 0.75);
      at(crest, stockZ, yMid); crest.material.opacity = formed * (1 - brushed); crest.scale.setScalar(H * K * (0.16 + 0.16 * formed));
      crest.material.color.setRGB(0.85, 0.95, 1.2);
      const dp = dust.geometry.attributes.position, t = Math.max(0, p - 0.74) / 0.2;
      ds.forEach(([a, b, v], i) => dp.setXYZ(i, sx + side * (0.004 + t * v * H * 0.5), yMid + b * t * H * 0.6 - t * t * H * 0.15, stockZ + a * H * 0.2 + t * v * L * 0.12));
      dp.needsUpdate = true; dust.material.opacity = bump(p, 0.74, 0.76, 0.88, 0.97);
    };
  } else if (kind === 'verdant') {
    const vein = Array.from({ length: 9 }, (_, i) => { const k = i / 8; return [THREE.MathUtils.lerp(box.min.z + L * 0.68, box.min.z + L * 0.42, k), box.min.y + H * (0.5 + 0.15 * Math.sin(k * 5))]; });
    const lit = vein.map(() => sprite(sparkTexture(), 0x3dff7a, H * 0.06)), thumb = sprite(sparkTexture(), 0xb8ffd2, H * 0.16);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2bd96b, emissive: 0x0b6b2c, metalness: 0.2, roughness: 0.15 });
    const leafGeo = new THREE.OctahedronGeometry(H * 0.05); own.push(leafMat, leafGeo);
    const leaves = [0, 1].map(() => { const m = new THREE.Mesh(leafGeo, leafMat); fx.add(m); return m; });
    const strandMat = new THREE.MeshStandardMaterial({ color: 0x42ff88, emissive: 0x1aa850, roughness: 0.3 }); own.push(strandMat);
    const [az, ay] = vein[8];
    const strands = [1, -1].map((s) => {   // one per side (its x is fixed): from the vein's end, up and out, back into the stock crest
      const x = s > 0 ? box.max.x : box.min.x, pts = [[0, az, ay], [0.25, az + L * 0.02, ay + H * 0.35], [0.45, (az + stockZ) / 2, ay + H * 0.55], [0.3, stockZ - L * 0.04, yMid + H * 0.3], [0.02, stockZ, yMid]];
      const curve = new THREE.CatmullRomCurve3(pts.map(([o, z, y]) => new THREE.Vector3(x + s * (0.003 + o * H), y, z)));
      const geo = new THREE.TubeGeometry(curve, 48, H * 0.012, 5, false);
      const m = new THREE.Mesh(geo, strandMat); m.visible = false; fx.add(m); own.push(geo);
      return { m, curve, count: geo.index.count };
    });
    step = (p) => {
      const trace = smooth(p, 0.18, 0.42);
      lit.forEach((s, i) => { at(s, vein[i][0], vein[i][1]); s.material.opacity = (trace * 8 >= i ? 1 : 0) * bump(p, 0.18, 0.2, 0.45, 0.6); });
      const ti = Math.min(7, Math.floor(trace * 8)), f = trace * 8 - ti;
      at(thumb, THREE.MathUtils.lerp(vein[ti][0], vein[ti + 1][0], f), THREE.MathUtils.lerp(vein[ti][1], vein[ti + 1][1], f), 0.004); thumb.material.opacity = bump(p, 0.16, 0.2, 0.42, 0.46);
      const grow = smooth(p, 0.42, 0.7), drain = smooth(p, 0.74, 0.88), mine = strands[side > 0 ? 0 : 1];
      for (const st of strands) {
        st.m.visible = st === mine && grow > drain;
        const a = Math.floor(st.count * drain / 30) * 30, b = Math.floor(st.count * grow / 30) * 30;    // (whole tube segments: 5 sides x 6 indices)
        st.m.geometry.setDrawRange(a, Math.max(0, b - a));
      }
      const tip = mine.curve.getPointAt(0.45), sprout = smooth(p, 0.54, 0.62) * (1 - smooth(p, 0.78, 0.84));
      leaves.forEach((m, j) => { m.position.set(tip.x + side * H * 0.02, tip.y + H * 0.05, tip.z + (j ? 1 : -1) * H * 0.06); m.rotation.set(0, 0, (j ? 1 : -1) * 0.9); m.scale.set(0.5 * sprout, 1.6 * sprout, 0.35 * sprout); m.visible = sprout > 0.01; });
      at(crest, stockZ, yMid); crest.material.opacity = bump(p, 0.8, 0.88, 0.93, 0.99); crest.scale.setScalar(H * K * 0.26);
    };
  } else if (kind === 'splitlight') {
    const glint = sprite(sparkTexture(), 0xeaf6ff, H * 0.22);
    const RAINBOW = [0xff3b3b, 0xff9a2e, 0xffee3a, 0x47ff6a, 0x3ac8ff, 0x5a6bff, 0xc45aff];
    const beams = RAINBOW.map((c) => shaft(c));
    const crestAt = new THREE.Vector3(), glove = new THREE.Vector3(), from = new THREE.Vector3();
    step = (p) => {
      const roll = smooth(p, 0.25, 0.66), merge = smooth(p, 0.66, 0.78), on = bump(p, 0.24, 0.3, 0.86, 0.94);
      at(glint, magZ, badgeY, 0.003); glint.material.opacity = (0.4 + 0.6 * Math.abs(Math.sin(roll * 9))) * bump(p, 0.15, 0.22, 0.9, 0.97);
      crestAt.set(sx + side * H * 0.45, badgeY + H * 0.55, magZ);
      from.set(sx + side * 0.003, badgeY, magZ);
      beams.forEach((b, j) => {
        const spread = (j - 3) / 3;
        glove.set(sx + side * H * 0.7, box.min.y - H * 0.15, magZ + L * (0.12 + spread * 0.12 + (roll - 0.5) * 0.2)).lerp(crestAt, merge);
        b.set(from, glove, H * 0.05, on * (0.55 + 0.25 * Math.sin(p * 30 + j)));
      });
      crest.position.copy(crestAt); crest.material.opacity = smooth(p, 0.74, 0.84) * (1 - smooth(p, 0.92, 0.99)); crest.scale.setScalar(H * K * 0.3);
    };
  } else {   // totality: a corona blazes round the Champion badge behind the gun, then breaks into sparks that crown the gun
    // in the backdrop (unit plane, facing you): rays and a gold ring for the corona, the diamond-ring flash
    const layer = (map, color, order, add = true) => {
      const mat = new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, ...(add ? { blending: THREE.AdditiveBlending } : {}) });
      const m = new THREE.Mesh(plane, mat); m.renderOrder = order; m.frustumCulled = false; back.add(m); own.push(mat); return m;
    };
    const rays = layer(rayTexture(), 0xffc860, -0.9), halo = layer(goldRing(), 0xffe2a0, -0.8);
    const flash = layer(sparkTexture(), 0xfff4d8, -0.4);
    // the nuke's sky: a sphere kept on the camera (radius 2.5 m: the weapon view sees 3 m) and square to the world
    const domU = { uTime: { value: 0 }, uFlash: { value: 0 }, uRise: { value: 0 }, uBlast: { value: 0 }, uFade: { value: 0 } }, domGeo = new THREE.SphereGeometry(1, 64, 32);
    const domMat = new THREE.ShaderMaterial({ uniforms: domU, vertexShader: NUKE_VERTEX, fragmentShader: NUKE_FRAGMENT, transparent: true, depthWrite: false, side: THREE.BackSide });
    const dome = new THREE.Mesh(domGeo, domMat); dome.renderOrder = -5; dome.frustumCulled = false; dome.visible = false;
    dome.name = 'Champion domain'; gun.add(dome); own.push(domGeo, domMat);
    const camW = new THREE.Vector3(), gq = new THREE.Quaternion(), gs = new THREE.Vector3();
    dome.onBeforeRender = (renderer, scene, camera) => {
      camW.setFromMatrixPosition(camera.matrixWorld);
      gun.matrixWorld.decompose(camW.clone(), gq, gs);
      dome.position.copy(gun.worldToLocal(camW.clone()));
      dome.quaternion.copy(gq).invert();                    // undo the gun's turn: the sky stays square to the world
      dome.scale.setScalar(2.5 / gs.x);
      dome.updateMatrixWorld();
    };
    const sparks = cloud(N(20) + 12, 0xffd36b, H * 0.05), rain = cloud(N(10), 0xffb84a, H * 0.035), n = sparks.geometry.attributes.position.count;
    const fall = Array.from({ length: rain.geometry.attributes.position.count }, () => [rng() - 0.5, rng(), rng()]);
    const from = new THREE.Vector3();
    // points along the crown outline (the badge's 64 x 64 box onto the side, about the size of the ring)
    const per = CHAMP_CROWN.map((a, i) => { const b = CHAMP_CROWN[(i + 1) % CHAMP_CROWN.length]; return Math.hypot(b[0] - a[0], b[1] - a[1]); }), total = per.reduce((x, y) => x + y, 0);
    const crown = Array.from({ length: n }, (_, i) => {
      let d = (i / n) * total, k = 0;
      while (d > per[k]) d -= per[k++];
      const a = CHAMP_CROWN[k], b = CHAMP_CROWN[(k + 1) % CHAMP_CROWN.length], f = d / per[k];
      return [(a[0] + (b[0] - a[0]) * f - 32) / 64, (30 - (a[1] + (b[1] - a[1]) * f)) / 64];
    });
    step = (p) => {
      // the corona blazes round the badge (0.38-0.6), the diamond-ring flash and the chime (0.6), the corona breaks into
      // sparks that fly onto the gun and trace the crown (0.62-0.8)
      const total = bump(p, 0.38, 0.46, 0.6, 0.66);
      // the nuke: flash (0.14), the fireball rises into a mushroom (0.14-0.7), the shockwave crosses the sky and passes
      // over you (0.16-0.44: the gun jolts), the red sky holds, then everything fades (0.88-0.98)
      domU.uTime.value = p * RANK_SECONDS;
      domU.uFlash.value = bump(p, 0.13, 0.145, 0.16, 0.26);
      domU.uRise.value = smooth(p, 0.14, 0.7);
      domU.uBlast.value = Math.PI * 1.05 * Math.pow(smooth(p, 0.16, 0.44), 0.8);
      domU.uFade.value = smooth(p, 0.12, 0.14) * (1 - smooth(p, 0.88, 0.98));
      dome.visible = domU.uFade.value > 0.003;
      rays.material.opacity = total * 1.3; rays.scale.setScalar(1.25 + 0.15 * total); rays.rotation.z = p * 1.5; rays.position.z = 0.004;
      halo.material.opacity = total * 1.6 + bump(p, 0.3, 0.4, 0.62, 0.7) * 0.4; halo.scale.setScalar(0.78); halo.position.z = 0.005;
      const ding = bump(p, 0.58, 0.605, 0.615, 0.66);
      flash.material.opacity = ding * 2.2; flash.scale.setScalar(0.25 + ding * 0.5); flash.position.set(0.21, 0.23, 0.02);
      back.updateMatrix();
      const cy = yMid + H * 0.05, sp = sparks.geometry.attributes.position;
      crown.forEach(([u, v], i) => {
        const a = (i / n) * Math.PI * 2, e = smooth(p, 0.62 + (i / n) * 0.06, 0.76 + (i / n) * 0.06);
        from.set(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0.03).applyMatrix4(back.matrix);    // on the corona, in gun space
        const ty = cy + v * H * 0.5, tz = stockZ + u * H * 0.5;
        sp.setXYZ(i, THREE.MathUtils.lerp(from.x, sx + side * 0.005, e), THREE.MathUtils.lerp(from.y, ty, e) + Math.sin(Math.PI * e) * H * 0.35, THREE.MathUtils.lerp(from.z, tz, e));
      });
      sp.needsUpdate = true; sparks.material.opacity = bump(p, 0.6, 0.63, 0.9, 0.98) * (1.3 + 0.3 * Math.sin(p * 90));
      at(crest, stockZ, cy + H * 0.08); crest.scale.setScalar(H * K * 0.5); crest.material.opacity = smooth(p, 0.8, 0.86) * (1 - smooth(p, 0.93, 0.99));
      const rp = rain.geometry.attributes.position, t = Math.max(0, p - 0.8) / 0.18;   // gold embers drift down off the crown
      fall.forEach(([a, d, v], i) => { const k = (t + d) % 1; rp.setXYZ(i, sx + side * (0.004 + v * H * 0.05), cy + H * 0.3 - k * H * (0.6 + v * 0.3), stockZ + a * H * 0.5); });
      rp.needsUpdate = true; rain.material.opacity = bump(p, 0.8, 0.84, 0.94, 0.99);
    };
  }
  // every rank's light play, as Caustic's: a glint on the gun throwing a fan of beams (here in the rank's colours, up
  // towards the badge behind) while the gun turns in the light
  if (kind !== 'splitlight') {
    const flare = sprite(sparkTexture(), 0xffffff, H * 0.2), base = new THREE.Color(RANK_LIGHT[rank]), white = new THREE.Color(0xffffff);
    const fan = Array.from({ length: 5 }, (_, j) => shaft(base.clone().lerp(white, j / 6)));
    const end = new THREE.Vector3(), start = new THREE.Vector3(), own = step;
    step = (p) => {
      own(p);
      const sweep = smooth(p, 0.26, 0.74), on = bump(p, 0.26, 0.32, 0.68, 0.76), gz = (guardZ + stockZ) / 2, gy = yMid + H * 0.12;
      at(flare, gz, gy, 0.003); flare.material.opacity = on * (0.45 + 0.55 * Math.abs(Math.sin(sweep * 10)));
      start.set(sx + side * 0.003, gy, gz);
      fan.forEach((b, j) => {
        const spread = (j - 2) / 2;
        end.set(sx + side * H * 0.6, gy + H * (0.55 + spread * 0.2), gz + L * (spread * 0.14 + (sweep - 0.5) * 0.25));
        b.set(start, end, H * 0.045, on * (0.5 + 0.25 * Math.sin(p * 30 + j)));
      });
    };
  }
  let phase = -1;
  return {
    clip: RANK_CLIPS[kind], seconds: RANK_SECONDS,
    update(p) {
      const active = p >= 0 && p < 1;
      if (!active && phase < 0) return;
      phase = active ? p : -1;
      fx.visible = active;
      // the shine sweeps stock to barrel as the gun comes round (0.12-0.4), and once more, softer, before it goes back (0.74-0.9)
      const s1 = smooth(p, 0.12, 0.4), s2 = smooth(p, 0.74, 0.9), second = p > 0.6;
      const sweep = second ? s2 : s1, w = shineU.uWidth.value * 3;
      shineU.uAt.value = THREE.MathUtils.lerp(box.max.z + w, box.min.z - w, sweep);
      shineU.uAmt.value = active ? (second ? 0.8 * bump(p, 0.72, 0.75, 0.88, 0.91) : 1.3 * bump(p, 0.1, 0.13, 0.38, 0.42)) : 0;
      for (const [, twin] of shines) twin.visible = shineU.uAmt.value > 0.003;
      const open = active ? smooth(p, 0.06, 0.2) * (1 - smooth(p, 0.9, 0.98)) : 0;
      back.visible = open > 0.005;
      back.scale.setScalar(L * (0.3 + 0.22 * open));
      glowMat.opacity = open * 0.9; badgeMat.opacity = open * 0.85;
      glow.scale.setScalar(1.9 + 0.08 * Math.sin(p * 40)); badge.rotation.z = 0;
      if (!active) return;
      // the camera in gun space: the last one that drew the backdrop, else the scene's origin (the first-person rig's)
      if (haveCam) cam.copy(camLocal); else cam.set(0, 0, 0).applyMatrix4(inv.copy(gun.matrixWorld).invert());
      side = cam.x >= 0 ? 1 : -1; sx = side > 0 ? box.max.x + 0.004 : box.min.x - 0.004;
      step(p);
    },
    dispose() { fx.removeFromParent(); back.removeFromParent(); gun.getObjectByName('Champion domain')?.removeFromParent(); for (const o of own) o.dispose(); for (const [, twin] of shines) { twin.removeFromParent(); twin.material.dispose(); } },
  };
}
