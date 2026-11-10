//! A map: its solid boxes on a grid, and the questions the game asks about them (what is
//! under your feet, push a body out of walls, move without tunnelling, step up stairs, fall,
//! vault, raycast, line of sight). Every question takes the height of the feet, so floors,
//! stairs, ramps and upper levels work the same on every map and in every mode.

use crate::geom::{circle_hits_box, len2, push_circle_box, ray_box_axis, seg_hits_box, Solid, INF};

/// Grid cell size in metres (broad phase).
pub const GRID: f64 = 2.0;
/// A standing body's collision radius.
pub const BODY_R: f64 = 0.32;
/// Ledges up to this height are stepped onto without vaulting (stairs, ramp slices).
pub const STEP: f64 = 0.45;
/// A standing body's height: a box that starts higher than this above the feet is overhead.
pub const BODY_H: f64 = 1.75;
/// The highest ledge you can vault or climb onto.
pub const VAULT_MAX: f64 = 1.5;
/// Falling speed gained per second.
pub const GRAVITY: f64 = 22.0;
/// The gap under a boarded door: drones roll through, people do not.
pub const DOOR_GAP: f64 = 0.3;
/// What a drone rolls up onto (ramps; not stairs).
pub const FLY_STEP: f64 = 0.12;
pub const KIND_DOOR: u8 = 1;
/// A breakable wall panel (soft or reinforced): paths avoid it while it stands.
pub const KIND_PANEL: u8 = 2;
/// A solid you cannot stand on (the top of a wall, a sill, a rail): you slide off it. Only
/// kind 0 is a floor (the ground, a slab, a stair, furniture).
pub const KIND_NOSTAND: u8 = 3;
/// `raycast` hit index for the floor, the ceiling (indoor maps) and nothing.
pub const HIT_GROUND: i32 = -2;
pub const HIT_CEIL: i32 = -3;
pub const HIT_NONE: i32 = -1;

/// Blocks a body whose feet are at height y (not a box overhead, not a ledge to step on).
#[inline]
pub fn blocks(b: &Solid, y: f64) -> bool {
    b.max_y > y + STEP + 1e-4 && b.min_y < y + BODY_H
}
/// Blocks a drone on a floor at height y: anything that reaches down to it (it passes under
/// a door's boards).
#[inline]
pub fn blocks_flyer(b: &Solid, y: f64) -> bool {
    b.min_y < y + DOOR_GAP - 0.05 && b.max_y > y + FLY_STEP + 1e-4
}

pub struct World {
    pub hx: f64,
    pub hz: f64,
    /// Height of the ceiling (indoor maps), or 0 for open sky.
    pub ceil: f64,
    /// Height of the map's walls: nothing is stood on within 1.6 m of it.
    pub wall_h: f64,
    gx: i64,
    gz: i64,
    pub solids: Vec<Solid>,
    /// Floor areas that hurt (acid): [min_x, max_x, min_z, max_z]. Paths avoid them.
    pub hazards: Vec<[f64; 4]>,
    cells: Vec<Vec<u32>>,
    seen: Vec<u32>,
    stamp: u32,
    list: Vec<u32>,
    /// The axis (0 x, 1 y, 2 z) of the face the last raycast hit.
    pub hit_axis: i32,
    pub nav: crate::nav::CellNav,
}

impl World {
    pub fn new(hx: f64, hz: f64, wall_h: f64, ceil: f64) -> World {
        World { hx, hz, ceil, wall_h, gx: 0, gz: 0, solids: Vec::new(), hazards: Vec::new(), cells: Vec::new(), seen: Vec::new(), stamp: 0, list: Vec::new(), hit_axis: 1, nav: crate::nav::CellNav::new() }
    }

    /// Put every solid into the grid cells it touches. Call once, after adding the solids.
    pub fn build(&mut self) {
        self.gx = ((self.hx * 2.0 + 4.0) / GRID).ceil() as i64;
        self.gz = ((self.hz * 2.0 + 4.0) / GRID).ceil() as i64;
        self.cells = vec![Vec::new(); (self.gx * self.gz) as usize];
        for k in 0..self.solids.len() {
            let b = self.solids[k];
            for j in self.cj(b.min_z)..=self.cj(b.max_z) {
                for i in self.ci(b.min_x)..=self.ci(b.max_x) {
                    self.cells[(j * self.gx + i) as usize].push(k as u32);
                }
            }
        }
        self.seen = vec![0; self.solids.len()];
        self.stamp = 0;
    }

    #[inline]
    fn ci(&self, x: f64) -> i64 {
        let v = ((x + self.hx + 2.0) / GRID).floor();
        let v = if v > (self.gx - 1) as f64 { (self.gx - 1) as f64 } else { v };
        if v < 0.0 { 0 } else { v as i64 }
    }
    #[inline]
    fn cj(&self, z: f64) -> i64 {
        let v = ((z + self.hz + 2.0) / GRID).floor();
        let v = if v > (self.gz - 1) as f64 { (self.gz - 1) as f64 } else { v };
        if v < 0.0 { 0 } else { v as i64 }
    }
    #[inline]
    fn next_stamp(&mut self) -> u32 {
        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            for s in self.seen.iter_mut() {
                *s = 0;
            }
            self.stamp = 1;
        }
        self.stamp
    }

    /// The live solids in the grid cells within `r` of a point, each once, in grid order.
    pub fn near(&mut self, x: f64, z: f64, r: f64) -> Vec<u32> {
        let mut out = core::mem::take(&mut self.list);
        out.clear();
        let st = self.next_stamp();
        let (j0, j1, i0, i1) = (self.cj(z - r), self.cj(z + r), self.ci(x - r), self.ci(x + r));
        for j in j0..=j1 {
            for i in i0..=i1 {
                for &k in self.cells[(j * self.gx + i) as usize].iter() {
                    let ku = k as usize;
                    if self.solids[ku].alive && self.seen[ku] != st {
                        self.seen[ku] = st;
                        out.push(k);
                    }
                }
            }
        }
        out
    }
    /// Hand a list from `near` back for reuse (no allocation per query).
    #[inline]
    pub fn recycle(&mut self, list: Vec<u32>) {
        self.list = list;
    }

    /// The height of what you stand on at (x, z) with feet near y: the floor (0) or the
    /// highest top you can step onto from there.
    pub fn ground_at(&mut self, x: f64, z: f64, y: f64) -> f64 {
        self.ground_step(x, z, y, STEP)
    }
    pub fn ground_step(&mut self, x: f64, z: f64, y: f64, step: f64) -> f64 {
        let list = self.near(x, z, 0.0);
        let mut g = 0.0_f64;
        for &k in list.iter() {
            let b = &self.solids[k as usize];
            if b.kind != 0 || x < b.min_x || x > b.max_x || z < b.min_z || z > b.max_z {
                continue;
            }
            if b.max_y <= y + step + 1e-4 && b.max_y > g {
                g = b.max_y;
            }
        }
        self.recycle(list);
        g
    }
    /// Damage per second of the floor at a spot (acid), or 0. Only at floor level.
    pub fn hazard_at(&self, x: f64, y: f64, z: f64) -> bool {
        if y > 0.2 {
            return false;
        }
        self.hazards.iter().any(|h| x > h[0] && x < h[1] && z > h[2] && z < h[3])
    }

    /// Keep a circle with its feet at height y out of the solids: push it out of each one it
    /// overlaps (two passes).
    pub fn resolve(&mut self, x: f64, y: f64, z: f64, r: f64, flyer: bool) -> (f64, f64) {
        let (px, pz, _) = self.resolve_ok(x, y, z, r, flyer);
        (px, pz)
    }
    /// The same, and whether the result is clear of everything (false: still overlapping,
    /// a squeeze or a pile of boxes the push-out could not settle).
    pub fn resolve_ok(&mut self, x: f64, y: f64, z: f64, r: f64, flyer: bool) -> (f64, f64, bool) {
        let list = self.near(x, z, r + 0.1);
        let (mut px, mut pz) = (x, z);
        for _ in 0..2 {
            for &k in list.iter() {
                let b = &self.solids[k as usize];
                if if flyer { blocks_flyer(b, y) } else { blocks(b, y) } {
                    push_circle_box(&mut px, &mut pz, r, b);
                }
            }
        }
        let mut ok = true;
        for &k in list.iter() {
            let b = &self.solids[k as usize];
            if (if flyer { blocks_flyer(b, y) } else { blocks(b, y) }) && circle_hits_box(px, pz, r - 1e-6, b) {
                ok = false;
                break;
            }
        }
        self.recycle(list);
        (px, pz, ok)
    }

    /// Move a circle by (dx, dz) without ever passing through anything: the move is cut into
    /// steps shorter than half the radius, each followed by the push-out, so the centre can
    /// never cross a face however long the frame was. After each step the feet rise onto
    /// whatever is underneath (stairs, ramps). Returns (x, y, z); it never lowers y.
    pub fn move_circle(&mut self, x: f64, y: f64, z: f64, dx: f64, dz: f64, r: f64, flyer: bool) -> (f64, f64, f64) {
        let steps = (len2(dx, dz) / (r * 0.5)).ceil();
        let n = if steps < 1.0 { 1.0 } else if steps > 400.0 { 400.0 } else { steps };
        let (sx, sz) = (dx / n, dz / n);
        let (mut px, mut py, mut pz) = (x, y, z);
        let step = if flyer { FLY_STEP } else { STEP };
        // starting clear, a step that ends overlapping something stops the move there (the
        // push-out bouncing between stacked boxes must never walk a body through a wall)
        let mut guard = self.resolve_ok(px, py, pz, r, flyer).2;
        for _ in 0..(n as u32) {
            let p = self.resolve_ok(px + sx, py, pz + sz, r, flyer);
            if guard && !p.2 {
                break;
            }
            if !guard && p.2 {
                guard = true;
            }
            px = p.0;
            pz = p.1;
            let g = self.ground_step(px, pz, py, step);
            if g > py {
                py = g;
            }
        }
        (px, py, pz)
    }

    /// One step of a body: move by (dx, dz) with collision and stair-stepping, then stand on
    /// what is underneath or fall. Returns (x, y, z, vertical speed, on the ground).
    pub fn step_body(&mut self, x: f64, y: f64, z: f64, vy: f64, dx: f64, dz: f64, r: f64, dt: f64, flyer: bool) -> (f64, f64, f64, f64, bool) {
        let (px, mut py, pz) = self.move_circle(x, y, z, dx, dz, r, flyer);
        let g = self.ground_step(px, pz, py, if flyer { FLY_STEP } else { STEP });
        let mut v = vy;
        let mut on = true;
        if g >= py - 1e-4 {
            py = g;
            v = 0.0;
        } else if dt > 0.0 {
            v -= GRAVITY * dt;
            let ny = py + v * dt;
            if ny <= g {
                py = g;
                v = 0.0;
            } else {
                py = ny;
                on = false;
            }
        } else {
            on = false;
        }
        (px, py, pz, v, on)
    }

    /// Can a body stand here with its feet at y (inside the map, touching nothing)?
    pub fn free(&mut self, x: f64, y: f64, z: f64, r: f64) -> bool {
        let list = self.near(x, z, r + 0.1);
        let mut hit = false;
        for &k in list.iter() {
            let b = &self.solids[k as usize];
            if blocks(b, y) && circle_hits_box(x, z, r, b) {
                hit = true;
                break;
            }
        }
        self.recycle(list);
        if hit {
            return false;
        }
        x.abs() < self.hx - r && z.abs() < self.hz - r
    }

    /// Can a body of radius `r` slide straight from a to b at height y (nothing in the way)?
    pub fn walk_clear(&mut self, ax: f64, az: f64, bx: f64, bz: f64, r: f64, y: f64) -> bool {
        let min_x = ax.min(bx) - r;
        let max_x = ax.max(bx) + r;
        let min_z = az.min(bz) - r;
        let max_z = az.max(bz) + r;
        let ext = if max_x - min_x > max_z - min_z { max_x - min_x } else { max_z - min_z };
        let list = self.near((min_x + max_x) / 2.0, (min_z + max_z) / 2.0, ext / 2.0 + 0.1);
        let mut clear = true;
        for &k in list.iter() {
            let b = &self.solids[k as usize];
            if blocks(b, y) && seg_hits_box(ax, az, bx, bz, b, r - 0.02) {
                clear = false;
                break;
            }
        }
        self.recycle(list);
        clear
    }

    /// Vault or climb: from feet (x, y, z) facing (dx, dz) (unit). Returns the landing spot
    /// (x, y, z) and the height of the top crossed, or None if there is nothing low enough
    /// right in front, no room to land, or something overhead in the way. Thin cover is
    /// crossed to the far side; a deep top is climbed onto.
    pub fn vault_target(&mut self, x: f64, y: f64, z: f64, dx: f64, dz: f64, r: f64) -> Option<(f64, f64, f64, f64)> {
        let list = self.near(x + dx * 0.8, z + dz * 0.8, 1.2);
        let mut best: Option<(u32, f64, f64)> = None;
        for &k in list.iter() {
            let b = &self.solids[k as usize];
            if !blocks(b, y) {
                continue;
            }
            if b.max_y - y > VAULT_MAX || b.min_y > y + 0.6 {
                continue;
            }
            // ray from the body centre along the facing direction against the grown footprint
            let mut t0 = -INF;
            let mut t1 = INF;
            for &(o, d, lo, hi) in [(x, dx, b.min_x - r, b.max_x + r), (z, dz, b.min_z - r, b.max_z + r)].iter() {
                if d.abs() < 1e-9 {
                    if o < lo || o > hi {
                        t0 = INF;
                        break;
                    }
                    continue;
                }
                let mut a = (lo - o) / d;
                let mut c = (hi - o) / d;
                if a > c {
                    core::mem::swap(&mut a, &mut c);
                }
                if a > t0 {
                    t0 = a;
                }
                if c < t1 {
                    t1 = c;
                }
            }
            if !(t0 <= t1) || t0 > 0.75 || t1 < 0.0 {
                continue;
            }
            // the nearest thing in front; of several with the same face (the slices of a ramp,
            // a rail on the edge of a platform), the tallest: that is what has to be cleared
            let better = match best {
                None => true,
                Some(q) => t0 < q.1 - 1e-9 || ((t0 - q.1).abs() <= 1e-9 && b.max_y > self.solids[q.0 as usize].max_y),
            };
            if better {
                best = Some((k, t0, t1));
            }
        }
        self.recycle(list);
        let (bk, bt0, t1) = best?;
        let top = self.solids[bk as usize].max_y;
        let tin = if bt0 > 0.0 { bt0 } else { 0.0 };
        let thick = t1 - tin - r * 2.0;
        let onto = (tin + r + 0.45, true);
        let tries: [(f64, bool); 2] = [(t1 + 0.1, false), onto];
        let first = if thick < 1.3 { 0 } else { 1 };
        for &(t, on_top) in tries[first..].iter() {
            let px = x + dx * t;
            let pz = z + dz * t;
            if px.abs() > self.hx - r || pz.abs() > self.hz - r {
                continue;
            }
            let gy = self.ground_at(px, pz, top);
            if on_top {
                // onto the top, or the tread next to it (climbing onto stairs or a ramp from
                // the side): within a step of the top, and no higher than you can climb
                if (gy - top).abs() > STEP || gy - y > VAULT_MAX {
                    continue;
                }
            } else if gy > top - 0.3 {
                continue;
            }
            // land where the body fits: at most a nudge (8 cm) from the spot, same footing
            let p = self.resolve(px, gy, pz, r, false);
            if len2(p.0 - px, p.1 - pz) > 0.08 {
                continue;
            }
            let (px, pz) = p;
            if (self.ground_at(px, pz, top) - gy).abs() > 1e-9 || !self.free(px, gy, pz, r - 1e-6) {
                continue;
            }
            // headroom over the obstacle while crossing
            let near = self.near((x + px) / 2.0, (z + pz) / 2.0, 1.4);
            let mut clear = true;
            for &c in near.iter() {
                if c == bk {
                    continue;
                }
                let s = &self.solids[c as usize];
                if s.max_y <= top + 0.05 || s.min_y > top + 1.2 {
                    continue;
                }
                if seg_crosses(x, z, px, pz, s) {
                    clear = false;
                    break;
                }
            }
            self.recycle(near);
            if clear {
                return Some((px, gy, pz, if gy > top { gy } else { top }));
            }
        }
        None
    }

    /// The nearest solid hit along a ray within `max_t`: (distance, solid index), with
    /// `HIT_GROUND` for the floor, `HIT_CEIL` for the ceiling and `HIT_NONE` (distance =
    /// max_t) for nothing. Walks only the grid cells the ray crosses. `hit_axis` is set to
    /// the axis of the face hit.
    pub fn raycast(&mut self, o: &[f64; 3], d: &[f64; 3], max_t: f64) -> (f64, i32) {
        let mut best = max_t;
        let mut hit = HIT_NONE;
        let mut axis = 1;
        let st = self.next_stamp();
        let mut i = self.ci(o[0]);
        let mut j = self.cj(o[2]);
        let sx: i64 = if d[0] > 0.0 { 1 } else { -1 };
        let sz: i64 = if d[2] > 0.0 { 1 } else { -1 };
        let ox0 = -self.hx - 2.0;
        let oz0 = -self.hz - 2.0;
        let mut tx = if d[0].abs() < 1e-12 { INF } else { ((ox0 + (i + if sx > 0 { 1 } else { 0 }) as f64 * GRID) - o[0]) / d[0] };
        let mut tz = if d[2].abs() < 1e-12 { INF } else { ((oz0 + (j + if sz > 0 { 1 } else { 0 }) as f64 * GRID) - o[2]) / d[2] };
        let dx = if d[0].abs() < 1e-12 { INF } else { GRID / d[0].abs() };
        let dz = if d[2].abs() < 1e-12 { INF } else { GRID / d[2].abs() };
        let mut enter = 0.0_f64;
        while enter < best {
            let cell = &self.cells[(j * self.gx + i) as usize];
            for &k in cell.iter() {
                let ku = k as usize;
                let b = &self.solids[ku];
                if !b.alive || self.seen[ku] == st {
                    continue;
                }
                self.seen[ku] = st;
                let (t, ax) = ray_box_axis(o, d, b, best);
                if t < best {
                    best = t;
                    hit = k as i32;
                    axis = ax;
                }
            }
            if tx < tz {
                enter = tx;
                tx += dx;
                i += sx;
                if i < 0 || i >= self.gx {
                    break;
                }
            } else {
                enter = tz;
                tz += dz;
                j += sz;
                if j < 0 || j >= self.gz {
                    break;
                }
            }
        }
        // the floor
        if d[1] < -1e-9 {
            let t = -o[1] / d[1];
            if t > 0.0 && t < best {
                best = t;
                hit = HIT_GROUND;
                axis = 1;
            }
        }
        // the ceiling of an indoor map
        if self.ceil > 0.0 && d[1] > 1e-9 {
            let t = (self.ceil - o[1]) / d[1];
            if t > 0.0 && t < best {
                best = t;
                hit = HIT_CEIL;
                axis = 1;
            }
        }
        self.hit_axis = axis;
        (best, hit)
    }

    /// Is there a clear line between two points? (The floor does not count as in the way.)
    pub fn sight(&mut self, a: &[f64; 3], b: &[f64; 3]) -> bool {
        let mut d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let l = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if l < 1e-6 {
            return true;
        }
        d[0] /= l;
        d[1] /= l;
        d[2] /= l;
        let (_, hit) = self.raycast(a, &d, l);
        hit == HIT_NONE || hit == HIT_GROUND
    }

    /// The first whole door a body walking from a to b (feet at y) would bump into (solid
    /// index or -1).
    pub fn door_on(&self, ax: f64, az: f64, bx: f64, bz: f64, r: f64, y: f64) -> i32 {
        let mut best = -1_i32;
        let mut bd = INF;
        for (k, b) in self.solids.iter().enumerate() {
            if b.kind != KIND_DOOR || !b.alive || !blocks(b, y) {
                continue;
            }
            if !seg_hits_box(ax, az, bx, bz, b, r) {
                continue;
            }
            let d = len2((b.min_x + b.max_x) / 2.0 - ax, (b.min_z + b.max_z) / 2.0 - az);
            if d < bd {
                bd = d;
                best = k as i32;
            }
        }
        best
    }
}

/// Segment a-b against a box's footprint (floor plane): true if it crosses.
fn seg_crosses(ax: f64, az: f64, bx: f64, bz: f64, b: &Solid) -> bool {
    let mut t0 = 0.0_f64;
    let mut t1 = 1.0_f64;
    for &(o, d, lo, hi) in [(ax, bx - ax, b.min_x, b.max_x), (az, bz - az, b.min_z, b.max_z)].iter() {
        if d.abs() < 1e-9 {
            if o < lo || o > hi {
                return false;
            }
            continue;
        }
        let mut a = (lo - o) / d;
        let mut c = (hi - o) / d;
        if a > c {
            core::mem::swap(&mut a, &mut c);
        }
        if a > t0 {
            t0 = a;
        }
        if c < t1 {
            t1 = c;
        }
        if t0 > t1 {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wall(min_x: f64, max_x: f64, min_z: f64, max_z: f64, min_y: f64, max_y: f64, kind: u8) -> Solid {
        Solid { min_x, max_x, min_y, max_y, min_z, max_z, kind, alive: true }
    }
    /// A 20 x 20 m room with a thin wall across the middle (x = 0), a door in it and a soft panel.
    fn room() -> World {
        let mut w = World::new(10.0, 10.0, 3.2, 0.0);
        w.solids.push(wall(-0.125, 0.125, -10.0, -1.0, 0.0, 3.2, 0)); // wall
        w.solids.push(wall(-0.125, 0.125, 1.0, 10.0, 0.0, 3.2, 0)); // wall
        w.solids.push(wall(-0.08, 0.08, -1.0, 1.0, DOOR_GAP, 2.2, KIND_DOOR)); // boarded door
        w.build();
        w
    }
    /// Stairs (ten 0.3 m steps, x 0..6, z -1..1) up to a 3 m platform (x 6..10, z -4..4) with
    /// a 1.1 m crate on the ground (x -6..-5, z -0.5..0.5) and a thin 1 m rail (x -3..-2.8).
    fn stairs() -> World {
        let mut w = World::new(10.0, 10.0, 6.0, 0.0);
        for i in 0..10 {
            let x0 = 0.6 * i as f64;
            w.solids.push(wall(x0, x0 + 0.6, -1.0, 1.0, 0.0, 0.3 * (i + 1) as f64, 0));
        }
        w.solids.push(wall(6.0, 10.0, -4.0, 4.0, 0.0, 3.0, 0));
        w.solids.push(wall(-6.0, -5.0, -0.5, 0.5, 0.0, 1.1, 0));
        w.solids.push(wall(-3.0, -2.8, -4.0, 4.0, 0.0, 1.0, 0));
        w.build();
        w
    }

    #[test]
    fn a_fast_drone_never_tunnels_through_a_thin_wall() {
        let mut w = room();
        // 30 m/s at 10 FPS: 3 m per frame at a 0.25 m wall
        for z in [-6.0, -3.0, 4.0, 8.0] {
            let (mut x, mut pz) = (-2.0, z);
            for _ in 0..20 {
                let p = w.move_circle(x, 0.0, pz, 3.0, 0.0, 0.15, true);
                x = p.0;
                pz = p.2;
            }
            assert!(x < -0.125, "crossed at z {z}: x {x}");
        }
    }

    #[test]
    fn a_single_big_step_would_have_tunnelled() {
        // the old way: one step, one push-out
        let mut w = room();
        let p = w.resolve(-0.275 + 0.6, 0.0, -5.0, 0.15, true);
        assert!(p.0 > 0.125, "the reference bug: ends on the far side");
    }

    #[test]
    fn drones_go_under_doors_and_bodies_do_not() {
        let mut w = room();
        let d = w.move_circle(-1.0, 0.0, 0.0, 2.0, 0.0, 0.15, true);
        assert!(d.0 > 0.9);
        let b = w.move_circle(-1.0, 0.0, 0.0, 2.0, 0.0, BODY_R, false);
        assert!(b.0 < -0.08);
        assert_eq!(w.door_on(-1.0, 0.0, 1.0, 0.0, 0.2, 0.0), 2);
        w.solids[2].alive = false;
        let b = w.move_circle(-1.0, 0.0, 0.0, 2.0, 0.0, BODY_R, false);
        assert!(b.0 > 0.9);
        assert_eq!(w.door_on(-1.0, 0.0, 1.0, 0.0, 0.2, 0.0), -1);
    }

    #[test]
    fn raycast_and_sight() {
        let mut w = room();
        let (t, hit) = w.raycast(&[-5.0, 1.6, -5.0], &[1.0, 0.0, 0.0], 200.0);
        assert!((t - 4.875).abs() < 1e-9 && hit == 0 && w.hit_axis == 0);
        assert!(!w.sight(&[-5.0, 1.6, -5.0], &[5.0, 1.2, -5.0]));
        assert!(w.sight(&[-5.0, 1.6, -5.0], &[-5.0, 1.2, 5.0]));
        // through the doorway above the boards? no: under the boards only (0.3 m)
        assert!(!w.sight(&[-5.0, 1.6, 0.0], &[5.0, 1.6, 0.0]));
        assert!(w.sight(&[-5.0, 0.15, 0.0], &[5.0, 0.15, 0.0]));
        // straight down in the open: the floor
        let (t, hit) = w.raycast(&[-5.0, 1.6, 5.0], &[0.0, -1.0, 0.0], 200.0);
        assert!((t - 1.6).abs() < 1e-12 && hit == HIT_GROUND);
        // a ceiling stops what the sky does not
        let (_, hit) = w.raycast(&[-5.0, 1.6, 5.0], &[0.0, 1.0, 0.0], 200.0);
        assert_eq!(hit, HIT_NONE);
        w.ceil = 3.2;
        let (t, hit) = w.raycast(&[-5.0, 1.6, 5.0], &[0.0, 1.0, 0.0], 200.0);
        assert!((t - 1.6).abs() < 1e-12 && hit == HIT_CEIL);
    }

    #[test]
    fn free_and_walk_clear() {
        let mut w = room();
        assert!(w.free(-5.0, 0.0, 0.0, BODY_R));
        assert!(!w.free(0.0, 0.0, 5.0, BODY_R));
        assert!(!w.free(9.9, 0.0, 0.0, BODY_R));
        assert!(w.walk_clear(-5.0, -5.0, -5.0, 5.0, 0.4, 0.0));
        assert!(!w.walk_clear(-5.0, 0.0, 5.0, 0.0, 0.4, 0.0)); // the door is whole
    }

    #[test]
    fn a_drone_at_the_foot_of_stairs_never_ends_up_through_the_wall_beside_them() {
        // ten 0.45 m slices of stairs (x 4.6..5.8) against a wall (x 5.8..6.2)
        let mut w = World::new(10.0, 10.0, 6.0, 0.0);
        for i in 0..10 {
            let z0 = 1.2 + 0.45 * i as f64;
            w.solids.push(wall(4.6, 5.8, z0, z0 + 0.45, 0.0, 0.32 * (i + 1) as f64, 0));
        }
        w.solids.push(wall(5.8, 6.2, -10.0, 10.0, 0.0, 3.2, 0));
        w.build();
        for z in [1.5, 2.3, 3.1, 3.9, 4.7, 5.1, 5.6, 6.0] {
            for x in [4.7, 4.95, 5.3] {
                let mut p = (x, 0.0, z);
                for _ in 0..45 {
                    p = w.move_circle(p.0, p.1, p.2, 0.2, 0.0, 0.15, true);
                }
                assert!(p.0 < 5.8, "started at {x} {z}: ended at {p:?}");
            }
        }
    }

    #[test]
    fn walking_up_stairs_and_down_again() {
        let mut w = stairs();
        // sprint (5.6 m/s) at 60, 30 and 10 FPS: up onto the platform, feet on every tread
        for fps in [60.0, 30.0, 10.0] {
            let dt = 1.0 / fps;
            let (mut x, mut y, mut z, mut vy) = (-1.0, 0.0, 0.0, 0.0);
            let mut top = 0.0_f64;
            for _ in 0..(1.6 * fps) as u32 {
                let p = w.step_body(x, y, z, vy, 5.6 * dt, 0.0, BODY_R, dt, false);
                assert!(p.1 >= y - 1e-9 || p.1 >= 0.0, "never below the floor");
                x = p.0;
                y = p.1;
                z = p.2;
                vy = p.3;
                if y > top {
                    top = y;
                }
            }
            assert!((y - 3.0).abs() < 1e-9 && x > 6.0, "on the platform at {fps} FPS: x {x} y {y}");
            // and back down: the feet follow the treads, never more than a short fall behind
            for _ in 0..(1.8 * fps) as u32 {
                let p = w.step_body(x, y, z, vy, -5.6 * dt, 0.0, BODY_R, dt, false);
                x = p.0;
                y = p.1;
                z = p.2;
                vy = p.3;
            }
            assert!(y.abs() < 1e-9 && x < 0.0, "back on the ground at {fps} FPS: x {x} y {y}");
        }
    }

    #[test]
    fn walking_off_a_ledge_falls_and_lands() {
        let mut w = stairs();
        let dt = 1.0 / 60.0;
        let (mut x, mut y, mut z, mut vy) = (8.0, 3.0, 2.0, 0.0);
        let mut fell = false;
        for _ in 0..240 {
            let p = w.step_body(x, y, z, vy, 0.0, 3.4 * dt, BODY_R, dt, false);
            if !p.4 {
                fell = true;
            }
            assert!(p.1 >= -1e-9, "never through the floor");
            x = p.0;
            y = p.1;
            z = p.2;
            vy = p.3;
        }
        assert!(fell && y.abs() < 1e-9 && vy == 0.0 && z > 4.0, "landed on the ground: y {y} z {z}");
        // the platform's side is a wall from the ground
        let p = w.move_circle(8.0, 0.0, 6.0, 0.0, -4.0, BODY_R, false);
        assert!(p.2 > 4.0 + BODY_R - 1e-9 && p.1 == 0.0);
    }

    #[test]
    fn vaulting() {
        let mut w = stairs();
        // over the thin rail to the far side
        let v = w.vault_target(-2.3, 0.0, 0.0, -1.0, 0.0, BODY_R).expect("the rail is vaultable");
        assert!(v.0 < -3.0 - BODY_R && v.1 == 0.0 && (v.3 - 1.0).abs() < 1e-12, "{v:?}");
        // onto the crate? it is 1 m deep: over it
        let v = w.vault_target(-4.4, 0.0, 0.0, -1.0, 0.0, BODY_R).expect("the crate is vaultable");
        assert!(v.0 < -6.0 && v.1 == 0.0, "{v:?}");
        // the 3 m platform is too high; open ground has nothing to vault
        assert!(w.vault_target(8.0, 0.0, 4.6, 0.0, -1.0, BODY_R).is_none());
        assert!(w.vault_target(-8.0, 0.0, 6.0, 0.0, 1.0, BODY_R).is_none());
        // a full-height wall is never vaulted
        let mut r = room();
        assert!(r.vault_target(-0.6, 0.0, -5.0, 1.0, 0.0, BODY_R).is_none());
        assert!(r.vault_target(-0.6, 0.0, 0.0, 1.0, 0.0, BODY_R).is_none(), "nor a boarded door");
    }

    #[test]
    fn a_drone_rolls_up_a_ramp_but_not_up_stairs() {
        let mut w = World::new(10.0, 10.0, 6.0, 0.0);
        // a ramp of 0.25 m slices rising 0.08 m each (x 0..5), and stairs at z 4..6
        for i in 0..20 {
            let x0 = 0.25 * i as f64;
            w.solids.push(wall(x0, x0 + 0.25, -1.0, 1.0, 0.0, 0.08 * (i as f64 + 0.5), 0));
            if i < 8 {
                w.solids.push(wall(0.6 * i as f64, 0.6 * (i + 1) as f64, 4.0, 6.0, 0.0, 0.3 * (i + 1) as f64, 0));
            }
        }
        w.build();
        let p = w.move_circle(-1.0, 0.0, 0.0, 4.0, 0.0, 0.15, true);
        assert!(p.0 > 2.9 && p.1 > 0.9, "up the ramp: {p:?}");
        let p = w.move_circle(-1.0, 0.0, 5.0, 4.0, 0.0, 0.15, true);
        assert!(p.0 < 0.0 && p.1 == 0.0, "stopped by the first stair: {p:?}");
    }
}
