// Set dressing for the match maps: the small things that make a place feel lived in. None of it
// collides (players walk through papers and past fixtures as before); everything is instanced,
// one draw per kind. Built once per map from its rooms (callouts with a floor) and its building.
//   inside: ceiling light panels, outlets and switches, posters and frames, wall vents, conduit
//   along the walls, papers and litter on the floors
//   outside: drainpipes on the building's corners, wall lamps and AC units on its walls,
//   puddles, utility poles with sagging wires beyond the fence, a tree line and far hills that
//   fade into the fog
import * as THREE from '../../vendor/three/three.module.min.js?v=3884a5c-mwdhrmgv';

const H = 3.2;
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

class Batch {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.m = []; this.c = []; }
  add(p, q, s, color) { this.m.push(new THREE.Matrix4().compose(p, q, s)); this.c.push(color); }
  build(group, shadow = false) {
    if (!this.m.length) return null;
    const im = new THREE.InstancedMesh(this.geo, this.mat, this.m.length);
    this.m.forEach((m, i) => im.setMatrixAt(i, m));
    if (this.c.some((c) => c !== undefined)) this.c.forEach((c, i) => im.setColorAt(i, new THREE.Color(c ?? 0xffffff)));
    im.castShadow = shadow; im.receiveShadow = true;
    im.userData.ownMaterial = true; im.userData.dressing = true;
    group.add(im);
    return im;
  }
}
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0, ...o });

function posterTex(r) {
  // one poster (pale ground, a block, a disc, lines of type); each copy is tinted its own colour
  const c = document.createElement('canvas'); c.width = 96; c.height = 132;
  const g = c.getContext('2d');
  g.fillStyle = '#f2eee6'; g.fillRect(0, 0, 96, 132);
  g.fillStyle = '#9a9a9a'; g.fillRect(8, 10, 80, 56);
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(48, 38, 18, 0, 7); g.fill();
  g.fillStyle = '#404040'; g.font = 'bold 15px sans-serif'; g.fillText('NOTICE', 18, 86);
  for (let l = 0; l < 4; l++) g.fillRect(10, 96 + l * 8, 40 + ((l * 29) % 34), 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function paperTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#9a968e'; for (let l = 0; l < 9; l++) g.fillRect(8, 8 + l * 5, 30 + (l * 37 % 18), 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function dressMap(group, map, quality) {
  if (quality === 'low') return 0;
  const data = map.data, r = rng(data.id.length * 977 + data.hx * 13);
  const P = (x, y, z) => new THREE.Vector3(x, y, z), Q = (yaw = 0, pitch = 0, roll = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), S = (x, y = x, z = x) => new THREE.Vector3(x, y, z);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const B = {
    panel: new Batch(box(0.62, 0.03, 0.62), std({ color: 0xfff4e0, emissive: 0xffe2b0, emissiveIntensity: 1.6, roughness: 0.4 })),
    panelFrame: new Batch(box(0.68, 0.04, 0.68), std({ color: 0xd8d8d4, metalness: 0.4, roughness: 0.4 })),
    outlet: new Batch(box(0.07, 0.11, 0.015), std({ color: 0xece8e0, roughness: 0.35 })),
    vent: new Batch(box(0.4, 0.22, 0.02), std({ color: 0xbfc3c6, metalness: 0.6, roughness: 0.45 })),
    poster: new Batch(new THREE.PlaneGeometry(0.6, 0.82), std({ map: posterTex(r), roughness: 0.6 })),
    frame: new Batch(box(0.66, 0.88, 0.025), std({ color: 0x3a2a1e, roughness: 0.5 })),
    conduit: new Batch(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), std({ color: 0x9aa0a4, metalness: 0.7, roughness: 0.4 })),
    paper: new Batch(new THREE.PlaneGeometry(0.21, 0.297).rotateX(-Math.PI / 2), std({ map: paperTex(), roughness: 0.85 })),
    litter: new Batch(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 10), std({ color: 0xffffff, metalness: 0.8, roughness: 0.35 })),
    pipe: new Batch(new THREE.CylinderGeometry(0.05, 0.05, 1, 10), std({ color: 0x6d7378, metalness: 0.6, roughness: 0.5 })),
    lamp: new Batch(box(0.22, 0.14, 0.16), std({ color: 0x2a2c2e, emissive: 0xffd08a, emissiveIntensity: 0.0, roughness: 0.5 })),
    bulb: new Batch(new THREE.SphereGeometry(0.06, 12, 8), std({ color: 0xfff2d0, emissive: 0xffc870, emissiveIntensity: 2.4 })),
    ac: new Batch(box(0.8, 0.55, 0.32), std({ color: 0xd9dcd8, metalness: 0.3, roughness: 0.55 })),
    puddle: new Batch(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), std({ color: 0x2a3036, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.55, depthWrite: false })),
    pole: new Batch(new THREE.CylinderGeometry(0.11, 0.15, 1, 10), std({ color: 0x5a4636, roughness: 0.9 })),
    arm: new Batch(box(1.6, 0.1, 0.1), std({ color: 0x4a3a2c, roughness: 0.9 })),
    tree: new Batch(new THREE.ConeGeometry(1, 1, 9), std({ color: 0x4e6e3a, roughness: 0.95 })),
  };
  // where a ray from (x, y, z) along d meets a wall: { p, n } or null
  const wallAt = (x, y, z, dx, dz, max = 30) => {
    const h = map.raycast([x, y, z], [dx, 0, dz], max);
    if (!h || !h.box || h.box.kind === 'edge' || h.t < 0.3) return null;
    return { p: P(x + dx * h.t, y, z + dz * h.t), n: P(-dx, 0, -dz), yaw: Math.atan2(-dx, -dz) };
  };
  const onWall = (w, up, off) => w.p.clone().addScaledVector(w.n, off).setY(up);
  const fixtures = group.userData.fixtures = [];   // light from objects (js/render/light-pool.js)
  const rooms = (data.callouts || []).filter((c) => c.floor);
  for (const c of rooms) {
    const y0 = c.y || 0, w = c.x1 - c.x0, d = c.z1 - c.z0, cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
    // ceiling light panels on a grid (under a roof or an upper floor only)
    const nx = Math.max(1, Math.round(w / 4.5)), nz = Math.max(1, Math.round(d / 4.5));
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const x = c.x0 + (i + 0.5) * w / nx, z = c.z0 + (k + 0.5) * d / nz, up = map.raycast([x, y0 + 1.2, z], [0, 1, 0], 4);
      if (!up || !up.box || up.box.kind === 'edge' || up.t > 3) continue;
      const cy = y0 + 1.2 + up.t;
      B.panelFrame.add(P(x, cy - 0.02, z), Q(), S(1)); B.panel.add(P(x, cy - 0.045, z), Q(), S(1));
      fixtures.push({ p: P(x, cy - 0.08, z), dir: P(0, -1, 0), color: 0xffdcae, intensity: 9, distance: 7.5, angle: 1.15 });
    }
    // the walls round the room's middle: outlets, a poster or frame, a vent, conduit
    const ws = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => wallAt(cx + (r() - 0.5) * w * 0.4, y0 + 1.2, cz + (r() - 0.5) * d * 0.4, dx, dz, Math.max(w, d))).filter(Boolean);
    ws.forEach((wl, j) => {
      B.outlet.add(onWall(wl, y0 + 0.32, 0.008), Q(wl.yaw), S(1));
      if (j === 0) B.outlet.add(onWall(wl, y0 + 1.2, 0.008).addScaledVector(P(Math.cos(wl.yaw), 0, -Math.sin(wl.yaw)), 0.4), Q(wl.yaw), S(1));
      if (j === 1 || (j === 2 && r() < 0.5)) {
        const at = onWall(wl, y0 + 1.6, 0.012);
        if (r() < 0.5) B.frame.add(at, Q(wl.yaw), S(1), [0x3a2a1e, 0xb08a52, 0x202224][j % 3]);
        B.poster.add(at.clone().addScaledVector(wl.n, 0.014), Q(wl.yaw), S(1), [0xe07a5f, 0x81b29a, 0xf2cc8f, 0x7aa6d6, 0xc9a0dc][Math.floor(r() * 5)]);
      }
      if (j === 3 || (ws.length < 4 && j === ws.length - 1)) B.vent.add(onWall(wl, y0 + H - 0.4, 0.01), Q(wl.yaw), S(1));
      if (j === 0) {                                                      // a conduit run along the top of the wall
        const along = P(Math.cos(wl.yaw), 0, -Math.sin(wl.yaw)), L = 2.5 + r() * 2;
        B.conduit.add(onWall(wl, y0 + H - 0.18, 0.03), new THREE.Quaternion().setFromUnitVectors(P(0, 1, 0), along), S(1, L, 1));
      }
    });
    // papers and litter on the floor
    const n = Math.round(w * d / 9);
    for (let i = 0; i < n; i++) {
      const x = c.x0 + 0.4 + r() * (w - 0.8), z = c.z0 + 0.4 + r() * (d - 0.8);
      if (!map.free || map.free(x, z, 0.2)) B.paper.add(P(x, y0 + 0.006 + i * 0.0003, z), Q(r() * 6.28), S(1));
      if (r() < 0.3) { const lx = c.x0 + 0.3 + r() * (w - 0.6), lz = c.z0 + 0.3 + r() * (d - 0.6); B.litter.add(P(lx, y0 + 0.034, lz), Q(r() * 6.28, 0, Math.PI / 2), S(1), [0xc0392b, 0x2e86c1, 0xd4ac0d, 0x7f8c8d][i % 4]); }
    }
  }
  // outside the building
  if (data.building) {
    const [bx0, bz0, bx1, bz1] = data.building;
    for (const [x, z] of [[bx0 - 0.25, bz0 - 0.25], [bx1 + 0.25, bz0 - 0.25], [bx0 - 0.25, bz1 + 0.25], [bx1 + 0.25, bz1 + 0.25]]) {
      const top = map.raycast([x, 0.5, z], [0, 1, 0], 12), h = top && top.box && top.box.kind !== 'edge' ? 0.5 + top.t : H;
      B.pipe.add(P(x, h / 2, z), Q(), S(1, h, 1));
    }
    // lamps and AC units along the outer walls, every ~7 m
    for (const [ax, az, dx, dz, len] of [[bx0, bz0 - 2, 0, 1, bx1 - bx0], [bx0, bz1 + 2, 0, -1, bx1 - bx0], [bx0 - 2, bz0, 1, 0, bz1 - bz0], [bx1 + 2, bz0, -1, 0, bz1 - bz0]]) {
      for (let s = 3; s < len - 2; s += 6 + r() * 3) {
        const x = dz ? ax + s : ax, z = dz ? az : az + s, wl = wallAt(x, 1.5, z, dx, dz, 4);
        if (!wl) continue;
        if (r() < 0.6) { B.lamp.add(onWall(wl, 2.6, 0.08), Q(wl.yaw), S(1)); B.bulb.add(onWall(wl, 2.52, 0.13), Q(), S(1)); fixtures.push({ p: onWall(wl, 2.45, 0.2), dir: wl.n.clone().multiplyScalar(0.6).add(P(0, -1, 0)), color: 0xffc070, intensity: 7, distance: 9, angle: 0.95 }); }
        else B.ac.add(onWall(wl, 2.1, 0.17), Q(wl.yaw), S(1));
      }
    }
    // puddles on the ground round the building
    for (let i = 0; i < 14; i++) {
      const x = (r() * 2 - 1) * (data.hx - 2), z = (r() * 2 - 1) * (data.hz - 2);
      if (x > bx0 - 1 && x < bx1 + 1 && z > bz0 - 1 && z < bz1 + 1) continue;
      B.puddle.add(P(x, 0.008, z), Q(r() * 6.28), S(0.6 + r() * 1.4, 1, 0.4 + r() * 0.9));
    }
  }
  // beyond the fence: utility poles with wires, a tree line, far hills
  const hx = data.hx, hz = data.hz, wires = [];
  const poleAt = (x, z) => { B.pole.add(P(x, 4.5, z), Q(), S(1, 9, 1)); B.arm.add(P(x, 8.3, z), Q(Math.abs(x) > hx ? 0 : Math.PI / 2), S(1)); };
  const side = (fixed, from, to, alongX) => {
    let prev = null;
    for (let s = from; s <= to + 0.01; s += 14) {
      const x = alongX ? s : fixed, z = alongX ? fixed : s; poleAt(x, z);
      if (prev) for (const o of [-0.7, 0, 0.7]) {
        const a = alongX ? P(prev[0], 8.3, prev[1] + o) : P(prev[0] + o, 8.3, prev[1]), b = alongX ? P(x, 8.3, z + o) : P(x + o, 8.3, z);
        for (let k = 0; k < 12; k++) {
          const t0 = k / 12, t1 = (k + 1) / 12, sag = (t) => -0.9 * 4 * t * (1 - t);
          wires.push(a.clone().lerp(b, t0).add(P(0, sag(t0), 0)), a.clone().lerp(b, t1).add(P(0, sag(t1), 0)));
        }
      }
      prev = [x, z];
    }
  };
  side(-hz - 4, -hx - 4, hx + 4, true);
  side(hx + 4, -hz - 4, hz + 4, false);
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, rad = Math.max(hx, hz) + 8 + r() * 26, x = Math.cos(a) * rad * (hx / Math.max(hx, hz)) * 1.15, z = Math.sin(a) * rad;
    if (Math.abs(x) < hx + 5 && Math.abs(z) < hz + 5) continue;
    const s = 3 + r() * 4;
    B.tree.add(P(x, s * 1.1, z), Q(r() * 6), S(s * 0.55, s * 2.4, s * 0.55), [0x3e5a2e, 0x4a6634, 0x35502a][i % 3]);
  }
  let n = 0;
  for (const [k, b] of Object.entries(B)) if (b.build(group, k === 'pole' || k === 'tree' || k === 'ac' || k === 'pipe')) n++;
  if (wires.length) {
    const g = new THREE.BufferGeometry().setFromPoints(wires);
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
    l.userData.ownMaterial = true; l.userData.dressing = true; group.add(l); n++;
  }
  // far hills: a ring of low rises that the fog turns into silhouettes
  const ring = new THREE.CylinderGeometry(150, 150, 1, 96, 1, true), pos = ring.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) { const a = Math.atan2(pos.getZ(i), pos.getX(i)); pos.setY(i, 8 + 7 * Math.sin(a * 3 + 1) + 4 * Math.sin(a * 7.3) + 2.5 * Math.sin(a * 17.1)); }
    else pos.setY(i, -2);
  }
  ring.computeVertexNormals();
  const hills = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x8a9478, side: THREE.BackSide, fog: false }));   // (tinted towards the fog by the lighting)
  hills.userData.ownMaterial = true; hills.userData.dressing = true; hills.userData.followCam = true;
  hills.onBeforeRender = (rr, sc, cam) => { hills.position.set(cam.position.x, 0, cam.position.z); hills.updateMatrixWorld(); };
  hills.frustumCulled = false; hills.renderOrder = -0.5;
  group.add(hills); group.userData.hills = hills; n++;
  return n;
}
