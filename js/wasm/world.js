// A map inside the Rust core (rust/core): its solid boxes, and every geometric question the
// game asks about them. Battle's arena and the match modes' maps both keep one of these, so
// collision, stairs, falling, vaulting, raycasts and pathfinding are the same code everywhere.
//
// Heights: y is the height of the feet. Paths are lists of [x, z, y].
import { core } from './core.js?v=099f307-mwdirh82';

export const BODY_R = 0.32;      // a body's collision radius
export const STEP = 0.45;        // highest ledge you walk up without vaulting
export const BODY_H = 1.75;      // standing height
export const VAULT_MAX = 1.5;    // highest ledge you can vault or climb onto
export const DOOR_GAP = 0.3;     // the gap under a boarded door (drones roll through)
export const KIND = { solid: 0, door: 1, panel: 2, nostand: 3 };
// path() flags: only through the zone (setZone); standing doors closed (a defender's path).
export const PATH = { zone: 1, doors: 2 };

export class CoreWorld {
  // o: { hx, hz, wallH (nothing is stood on within 1.6 m of it; Infinity outdoors),
  //      ceil (ceiling height, 0 for open sky), solids: [{ minX, maxX, minY, maxY, minZ, maxZ,
  //      code (KIND), alive }], hazards: [{ minX, maxX, minZ, maxZ }], bodyR, nav (build
  //      the path nodes, default true), careful (see rc_nav_careful, default true),
  //      vaults (vault links in paths, default true) }
  constructor(o) {
    const c = this._c = core(), e = this.e = c.e;
    this.r = o.bodyR ?? BODY_R;
    this.id = e.rc_world_new(o.hx, o.hz, Number.isFinite(o.wallH) ? o.wallH : 1e9, o.ceil || 0);
    if (c.reg) c.reg.register(this, this.id, this);
    const chunk = (list, per, write, send) => {
      const max = Math.floor(c.len / per);
      for (let at = 0; at < list.length; at += max) {
        const n = Math.min(max, list.length - at), f = c.f;
        for (let k = 0; k < n; k++) write(f, k * per, list[at + k]);
        send(n);
      }
    };
    chunk(o.solids, 8, (f, i, b) => { f[i] = b.minX; f[i + 1] = b.maxX; f[i + 2] = b.minY; f[i + 3] = b.maxY; f[i + 4] = b.minZ; f[i + 5] = b.maxZ; f[i + 6] = b.code || 0; f[i + 7] = b.alive === false ? 0 : 1; }, (n) => e.rc_world_add_solids(this.id, n));
    chunk(o.hazards || [], 4, (f, i, h) => { f[i] = h.minX; f[i + 1] = h.maxX; f[i + 2] = h.minZ; f[i + 3] = h.maxZ; }, (n) => e.rc_world_add_hazards(this.id, n));
    e.rc_world_build(this.id);
    if (o.careful === false) e.rc_nav_careful(this.id, 0);
    if (o.vaults === false) e.rc_nav_vaults(this.id, 0);
    this.nodeCount = 0;
    if (o.nav !== false) this.buildNavigation();
    this.hit = -1; this.axis = 1;
  }
  // Free the core's copy (otherwise it is freed when this object is garbage collected).
  dispose() {
    if (this.id < 0) return;
    if (this._c.reg) this._c.reg.unregister(this);
    this.e.rc_world_free(this.id);
    this.id = -1;
  }
  get f() { return this._c.f; }

  /* ---------- standing and collision ---------- */
  // Indices of the live solids in the grid cells within r of a point.
  near(x, z, r, out = []) {
    out.length = 0;
    const n = this.e.rc_near(this.id, x, z, r), f = this._c.f;
    for (let k = 0; k < n; k++) out.push(f[k]);
    return out;
  }
  // Height of what you stand on at (x, z) with feet near y: the floor or a top you can step to.
  groundAt(x, z, y = 0, flyer = false) { return this.e.rc_ground(this.id, x, z, y, flyer ? 1 : 0); }
  // Push a circle (p.x, p.z; feet at p.y) out of everything that blocks it.
  resolve(p, r = this.r, flyer = false) {
    this.e.rc_resolve(this.id, p.x, p.y || 0, p.z, r, flyer ? 1 : 0);
    const f = this._c.f;
    p.x = f[0]; p.z = f[1];
    return p;
  }
  // Move p by (dx, dz) without passing through anything, stepping up stairs (p.y rises).
  move(p, dx, dz, r = this.r, flyer = false) {
    this.e.rc_move(this.id, p.x, p.y || 0, p.z, dx, dz, r, flyer ? 1 : 0);
    const f = this._c.f;
    p.x = f[0]; p.y = f[1]; p.z = f[2];
    return p;
  }
  // One step of a body p { x, y, z, vy }: move by (dx, dz), step up, then stand or fall.
  // Returns true while it is on the ground.
  stepBody(p, dx, dz, dt, r = this.r, flyer = false) {
    this.e.rc_step_body(this.id, p.x, p.y || 0, p.z, p.vy || 0, dx, dz, r, dt, flyer ? 1 : 0);
    const f = this._c.f;
    p.x = f[0]; p.y = f[1]; p.z = f[2]; p.vy = f[3];
    return f[4] === 1;
  }
  free(x, z, r = this.r, y = 0) { return this.e.rc_free(this.id, x, y, z, r) === 1; }
  // Nothing in the way of a circle of radius r sliding straight from a to b at height y?
  walkClear(ax, az, bx, bz, r = this.r + 0.08, y = 0) { return this.e.rc_walk_clear(this.id, ax, az, bx, bz, r, y) === 1; }
  // Vault or climb from feet (x, y, z) facing (dx, dz): { x, y, z, top } to land on, or null.
  vaultTarget(x, y, z, dx, dz, r = this.r) {
    if (!this.e.rc_vault(this.id, x, y, z, dx, dz, r)) return null;
    const f = this._c.f;
    return { x: f[0], y: f[1], z: f[2], top: f[3] };
  }

  /* ---------- rays ---------- */
  // Distance to the nearest thing along a ray within maxT, or -1. this.hit says what: a solid
  // index, -2 the floor, -3 the ceiling; this.axis is the axis of the face (0 x, 1 y, 2 z).
  raycast(o, d, maxT = 200) {
    const t = this.e.rc_raycast(this.id, o[0], o[1], o[2], d[0], d[1], d[2], maxT);
    this.hit = this.e.rc_hit(); this.axis = this.e.rc_hit_axis();
    return t;
  }
  sight(a, b) { return this.e.rc_sight(this.id, a[0], a[1], a[2], b[0], b[1], b[2]) === 1; }
  doorOn(ax, az, bx, bz, r, y = 0) { return this.e.rc_door_on(this.id, ax, az, bx, bz, r, y); }
  setAlive(i, alive) { this.e.rc_set_alive(this.id, i, alive ? 1 : 0); }

  /* ---------- navigation ---------- */
  buildNavigation() { this.nodeCount = this.e.rc_nav_build(this.id, this.r); }

  // Every node as { x, z, y (Float32Array), open (Uint8Array) }.
  navNodes() {
    const n = this.nodeCount, x = new Float32Array(n), z = new Float32Array(n), y = new Float32Array(n), open = new Uint8Array(n);
    const per = Math.floor(this._c.len / 4);
    for (let at = 0; at < n; at += per) {
      const got = this.e.rc_nav_nodes(this.id, at, per), f = this._c.f;
      for (let k = 0; k < got; k++) { x[at + k] = f[k * 4]; z[at + k] = f[k * 4 + 1]; y[at + k] = f[k * 4 + 2]; open[at + k] = f[k * 4 + 3]; }
    }
    return { x, z, y, open };
  }
  // The zone: rectangles [x0, z0, x1, z1] (the building Bomb's defenders stay in).
  setZone(rects) {
    const f = this._c.f, n = Math.min(rects.length, Math.floor(this._c.len / 4));
    for (let k = 0; k < n; k++) { f[k * 4] = rects[k][0]; f[k * 4 + 1] = rects[k][1]; f[k * 4 + 2] = rects[k][2]; f[k * 4 + 3] = rects[k][3]; }
    this.e.rc_nav_zone(this.id, n);
  }
  nodeAt(x, z, y = 0) { return this.e.rc_node_at(this.id, x, z, y); }
  nearestNode(x, z, y = 0) { return this.e.rc_nearest_node(this.id, x, z, y); }
  // Can a body walk straight from a to b (each [x, z, y]), stepping and dropping as it goes?
  clearWalk(a, b) { return this.e.rc_clear_walk(this.id, a[0], a[1], a[2] || 0, b[0], b[1], b[2] || 0) === 1; }
  // Waypoints [[x, z, y, vault], ...] from a to b ending at b, or [] if there is no way.
  // vault 1: vault over what is between this point and the next. flags: PATH.
  path(ax, az, ay, bx, bz, by, flags = 0) {
    const n = this.e.rc_path(this.id, ax, az, ay, bx, bz, by, flags === true ? 1 : flags || 0), f = this._c.f, out = new Array(n);
    for (let k = 0; k < n; k++) out[k] = [f[k * 4], f[k * 4 + 1], f[k * 4 + 2], f[k * 4 + 3]];
    return out;
  }
  vaultLinks() { return this.e.rc_nav_vault_count(this.id); }
}
