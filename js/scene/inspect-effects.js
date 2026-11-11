import * as THREE from '../../vendor/three/three.module.min.js?v=a37f22c-mwcnqhgi';
import { mulberry32 } from '../core/prng.js?v=a37f22c-mwcnqhgi';
import { mergeStatic } from './sight-model.js?v=a37f22c-mwcnqhgi';

const FROST_SECONDS = 4.35, FROST_PEAK = 0.59;
const SAKURA_SECONDS = 4.2, SAKURA_PEAK = 0.54;
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
      #endif
      spin += age * (seed.x - 0.5) * 12.0;
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

const particleBudget = { mist: [22, 38, 54, 70], chip: [20, 34, 48, 62], petal: [28, 46, 64, 84] };
const particleTier = { low: 0, standard: 1, high: 2, ultra: 3 };

function particles(kind, tier, anchors, tint, trail, rng) {
  const mist = kind === 'mist', petals = kind === 'petal';
  const seconds = petals ? SAKURA_SECONDS : FROST_SECONDS;
  const peak = (petals ? SAKURA_PEAK : FROST_PEAK) * seconds;
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
    } else if (petals) {
      start = burst ? peak - 0.15 + rng() * 0.29 : peak - 0.55 + rng() * 1.25;
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
  const defines = mist ? { MIST: 1 } : petals ? { PETAL: 1 } : {};
  if (mist && tier === 0) defines.LOW_INSPECT = 1;
  const material = new THREE.ShaderMaterial({
    defines,
    uniforms: { ...trail.uniforms, endTime: { value: seconds * 0.78 }, tint: { value: tint } },
    vertexShader: particleVertex, fragmentShader: particleFragment, transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = mist ? 'Inspect vapour' : petals ? 'Inspect petals' : 'Inspect ice flecks';
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

export function sakuraInspect(gun, blossoms, quality) {
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
