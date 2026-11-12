// What the gadgets look like, and their effects (gas, beams, rings). Each gadget is a small
// model with its own shape and colour so you can tell them apart at a glance:
//   Jolt mine    yellow and black disc, three electrodes, blue sparks crackling between them
//   Dread mine   dark spiked orb with a red eye that pulses; leaves purple gas when it goes off
//   Jammer       box with three antennas and a spinning dish; a cyan ring shows its reach
//   Catcher      tripod with a green dome and a turning ring; a green beam when it zaps
//   Drone        small wheeled box;  Wall charge: red slab;  Breach round: orange glow
import * as THREE from '../../vendor/three/three.module.min.js?v=22ac50c-mwd93u7a';

const mat = (o) => new THREE.MeshLambertMaterial(o);
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false });
let hazardTex = null;
function hazard() {
  if (hazardTex) return hazardTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#e8c020'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#1a1a1a'; for (let x = -64; x < 64; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 8, 0); g.lineTo(x + 72, 64); g.lineTo(x + 64, 64); g.fill(); }
  hazardTex = new THREE.CanvasTexture(cv); hazardTex.colorSpace = THREE.SRGBColorSpace;
  return hazardTex;
}
let puffTex = null;
function puff() {
  if (puffTex) return puffTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(cv);
  return puffTex;
}

export function makeGadget(g, cfg = {}) {
  const grp = new THREE.Group(), parts = [];
  const add = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); grp.add(o); parts.push(o); return o; };
  const u = { parts, lamp: null, color: 0xffffff, spin: null, arcs: null, ring: null, eye: null, dome: null };
  if (g.type === 'mine' && g.kind === 'jolt') {
    add(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 16), [mat({ color: 0x333333 }), mat({ map: hazard() }), mat({ color: 0x333333 })], 0, 0.025, 0);
    for (let i = 0; i < 3; i++) { const a = i * 2.094; add(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 6), mat({ color: 0xb0c8e0 }), Math.cos(a) * 0.12, 0.1, Math.sin(a) * 0.12); }
    u.lamp = add(new THREE.SphereGeometry(0.03, 8, 6), glow(0x60b0ff), 0, 0.07, 0); u.color = 0x60b0ff;
    const pos = new Float32Array(18 * 3);
    const arcs = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)), new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, blending: THREE.AdditiveBlending, toneMapped: false }));
    arcs.frustumCulled = false; grp.add(arcs); u.arcs = arcs;
  } else if (g.type === 'mine') {
    add(new THREE.OctahedronGeometry(0.13, 0), mat({ color: 0x2a1a34, flatShading: true }), 0, 0.14, 0);
    for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
      const c = add(new THREE.ConeGeometry(0.03, 0.12, 5), mat({ color: 0x4a2a5a }), x * 0.14, 0.14 + y * 0.14, z * 0.14);
      c.lookAt(x * 2, 0.14 + y * 2, z * 2); c.rotateX(Math.PI / 2);
    }
    u.eye = u.lamp = add(new THREE.SphereGeometry(0.045, 10, 8), glow(0xff2040), 0, 0.14, 0.11); u.color = 0xff2040;
    u.spin = grp;
  } else if (g.type === 'jammer') {
    add(new THREE.BoxGeometry(0.3, 0.12, 0.22), mat({ color: 0x2c3036 }), 0, 0.06, 0);
    for (const x of [-0.1, 0, 0.1]) { add(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 5), mat({ color: 0x8090a0 }), x, 0.3, -0.07); add(new THREE.SphereGeometry(0.018, 6, 5), glow(0x40e0ff), x, 0.48, -0.07); }
    const dish = new THREE.Group(); dish.position.set(0, 0.16, 0.05);
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat({ color: 0xc0c8d0, side: THREE.DoubleSide }));
    d.rotation.x = Math.PI / 2.4; dish.add(d); parts.push(d); grp.add(dish); u.spin = dish;
    u.lamp = add(new THREE.SphereGeometry(0.025, 8, 6), glow(0x40e0ff), 0.12, 0.13, 0.09); u.color = 0x40e0ff;
    const R = cfg.static_jammer ? cfg.static_jammer.radius || 8 : 8;
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.12, R, 64), new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03 - (g.y || 0.05); grp.add(ring); u.ring = ring;
  } else if (g.type === 'catcher') {
    for (let i = 0; i < 3; i++) { const a = i * 2.094; const l = add(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 5), mat({ color: 0x505860 }), Math.cos(a) * 0.1, -0.2, Math.sin(a) * 0.1); l.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); }
    add(new THREE.CylinderGeometry(0.08, 0.09, 0.14, 12), mat({ color: 0x3a4248 }), 0, 0.05, 0);
    u.dome = u.lamp = add(new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), glow(0x70ff70), 0, 0.12, 0); u.color = 0x70ff70;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 6, 24), glow(0x70ff70, 0.8));
    ring.position.y = 0.12; grp.add(ring); parts.push(ring); u.spin = ring;
  } else if (g.type === 'drone') {
    add(new THREE.BoxGeometry(0.26, 0.1, 0.3), mat({ color: g.basic ? 0x6a7078 : 0x30343a }), 0, 0, 0);
    for (const x of [-0.16, 0.16]) { const w = add(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 12), mat({ color: 0x151515 }), x, 0, 0); w.rotation.z = Math.PI / 2; }
    u.lamp = add(new THREE.SphereGeometry(0.025, 8, 6), glow(0xffffff), 0, 0.03, -0.16); u.color = g.basic ? 0xffffff : 0xffc040;
  } else if (g.type === 'wire') {
    // a 2.4 m roll of barbed wire on the floor across the way it was laid, with two stakes
    const wm = mat({ color: 0x9aa0a6 });
    for (let i = 0; i < 8; i++) { const c = add(new THREE.TorusGeometry(0.2, 0.012, 4, 14), wm, -1.05 + i * 0.3, -0.05, 0); c.rotation.y = Math.PI / 2 + (i % 2 ? 0.35 : -0.35); }
    const spine = add(new THREE.CylinderGeometry(0.01, 0.01, 2.3, 4), wm, 0, -0.05, 0); spine.rotation.z = Math.PI / 2;
    for (const x of [-1.15, 1.15]) add(new THREE.BoxGeometry(0.04, 0.5, 0.04), mat({ color: 0x4a3a28 }), x, -0.05, 0);
    u.color = 0x9aa0a6;
  } else if (g.type === 'charge') {
    add(new THREE.BoxGeometry(0.5, 0.7, 0.08), mat({ color: 0x7a2018 }), 0, 0, 0);
    u.lamp = add(new THREE.SphereGeometry(0.035, 8, 6), glow(0xff5030), 0, 0.22, 0.05); u.color = 0xff5030;
  } else {
    u.lamp = add(new THREE.SphereGeometry(0.08, 8, 6), glow(0xffa040), 0, 0, 0); u.color = 0xffa040;
  }
  grp.userData = u;
  return grp;
}

// Every frame: spin, spark, pulse; 'off' = zapped or jammed; 'armed' = a mine about to go off;
// 'ready' = a catcher that can catch now; showRing = draw the jammer's reach.
export function animateGadget(o, g, t, { off, armed, ready = true, showRing = true }) {
  const u = o.userData;
  if (u.lamp) u.lamp.material.color.setHex(off ? 0x303030 : armed ? (Math.floor(t * 10) % 2 ? 0xff2020 : 0x401010) : u.color);
  if (u.spin && !off) { if (g.type === 'mine') u.spin.rotation.y = t * 0.6; else u.spin.rotation.y = t * (g.type === 'catcher' ? 2.5 : 3); }
  if (u.eye && !off) { const s = 1 + 0.35 * Math.sin(t * 5); u.eye.scale.setScalar(s); }
  if (u.dome) u.dome.material.color.setHex(off ? 0x303030 : ready ? 0x70ff70 : 0x2a5a2a);
  if (u.ring) { u.ring.visible = showRing && !off; u.ring.material.opacity = 0.15 + 0.12 * Math.sin(t * 3); }
  if (u.arcs) {
    u.arcs.visible = !off && (armed || Math.sin(t * 23 + g.id) > -0.2);
    if (u.arcs.visible) {
      const p = u.arcs.geometry.attributes.position.array;
      let k = 0;
      for (let i = 0; i < 3; i++) {
        const a0 = i * 2.094, a1 = a0 + 2.094;
        let x = Math.cos(a0) * 0.12, z = Math.sin(a0) * 0.12, y = 0.15;
        for (let s = 1; s <= 3; s++) {
          const f = s / 3, nx = Math.cos(a0) * 0.12 * (1 - f) + Math.cos(a1) * 0.12 * f + (s < 3 ? (Math.random() - 0.5) * 0.06 : 0);
          const nz = Math.sin(a0) * 0.12 * (1 - f) + Math.sin(a1) * 0.12 * f + (s < 3 ? (Math.random() - 0.5) * 0.06 : 0), ny = 0.15 + (s < 3 ? (Math.random() - 0.5) * 0.05 : 0);
          p[k++] = x; p[k++] = y; p[k++] = z; p[k++] = nx; p[k++] = ny; p[k++] = nz;
          x = nx; y = ny; z = nz;
        }
      }
      u.arcs.geometry.attributes.position.needsUpdate = true;
      u.arcs.material.opacity = armed ? 1 : 0.6;
    }
  }
}

/* ---------- effects ---------- */
// Purple dread gas: soft puffs that drift and fade over dur seconds.
export function gasCloud(x, z, r, color = 0x8040c0) {
  const grp = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff(), color, transparent: true, opacity: 0.5, depthWrite: false }));
    const a = Math.random() * 6.28, d = Math.random() * r * 0.8;
    s.position.set(Math.cos(a) * d, 0.3 + Math.random() * 1.2, Math.sin(a) * d);
    const sc = 1.2 + Math.random() * 1.4; s.scale.set(sc, sc, sc);
    s.userData.v = [(Math.random() - 0.5) * 0.3, 0.05 + Math.random() * 0.1, (Math.random() - 0.5) * 0.3];
    grp.add(s);
  }
  grp.position.set(x, 0, z);
  return grp;
}
export function updateCloud(grp, k, dt) {
  for (const s of grp.children) { s.position.x += s.userData.v[0] * dt; s.position.y += s.userData.v[1] * dt; s.position.z += s.userData.v[2] * dt; s.material.opacity = 0.5 * (k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4)); }
}
// A straight beam (catcher zaps, sparks).
export function beam(a, b, color) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, toneMapped: false }));
}
// Little stars circling a stunned head.
export function stunStars() {
  const grp = new THREE.Group();
  for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), glow(0xffe060)); s.position.set(Math.cos(i * 1.57) * 0.25, 0, Math.sin(i * 1.57) * 0.25); grp.add(s); }
  return grp;
}
// A streak behind a charging Onyx.
export function dashTrail() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.5, 1), new THREE.MeshBasicMaterial({ color: 0x60a0ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  m.geometry.translate(0, 0.9, 0.5);
  return m;
}
