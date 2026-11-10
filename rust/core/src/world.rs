//! A match map: its solid boxes on a grid, and the questions the game asks about them
//! (push a body out of walls, move without tunnelling, raycast, line of sight).

use crate::geom::{circle_hits_box, len2, push_circle_box, ray_box, seg_hits_box, Solid, INF};

/// Grid cell size in metres (broad phase).
pub const GRID: f64 = 2.0;
/// A standing body's collision radius.
pub const BODY_R: f64 = 0.32;
/// Ledges up to this height are stepped over.
pub const STEP: f64 = 0.35;
/// The gap under a boarded door: drones roll through, people do not.
pub const DOOR_GAP: f64 = 0.3;
pub const KIND_DOOR: u8 = 1;
/// `raycast` hit index for the floor.
pub const HIT_GROUND: i32 = -2;
pub const HIT_NONE: i32 = -1;

/// Blocks a body at floor level (not a box overhead, not a small ledge).
#[inline]
fn blocks(b: &Solid) -> bool {
    b.min_y < 1.7 && b.max_y > STEP
}
/// Blocks a drone: anything that reaches the floor (it passes under a door's boards).
#[inline]
fn blocks_flyer(b: &Solid) -> bool {
    b.min_y < DOOR_GAP - 0.05 && b.max_y > 0.05
}

pub struct World {
    pub hx: f64,
    pub hz: f64,
    gx: i64,
    gz: i64,
    pub solids: Vec<Solid>,
    cells: Vec<Vec<u32>>,
    seen: Vec<u32>,
    stamp: u32,
    list: Vec<u32>,
    pub nav: crate::nav::Nav,
}

impl World {
    pub fn new(hx: f64, hz: f64) -> World {
        World { hx, hz, gx: 0, gz: 0, solids: Vec::new(), cells: Vec::new(), seen: Vec::new(), stamp: 0, list: Vec::new(), nav: crate::nav::Nav::new() }
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

    /// Keep a circle out of the solids: push it out of each one it overlaps (two passes).
    pub fn resolve(&mut self, x: f64, z: f64, r: f64, flyer: bool) -> (f64, f64) {
        let list = self.near(x, z, r + 0.1);
        let (mut px, mut pz) = (x, z);
        for _ in 0..2 {
            for &k in list.iter() {
                let b = &self.solids[k as usize];
                if if flyer { blocks_flyer(b) } else { blocks(b) } {
                    push_circle_box(&mut px, &mut pz, r, b);
                }
            }
        }
        self.recycle(list);
        (px, pz)
    }

    /// Move a circle by (dx, dz) without ever passing through anything: the move is cut into
    /// steps shorter than half the radius, each followed by the push-out, so the centre can
    /// never cross a face however long the frame was.
    pub fn move_circle(&mut self, x: f64, z: f64, dx: f64, dz: f64, r: f64, flyer: bool) -> (f64, f64) {
        let steps = (len2(dx, dz) / (r * 0.5)).ceil();
        let n = if steps < 1.0 { 1.0 } else if steps > 400.0 { 400.0 } else { steps };
        let (sx, sz) = (dx / n, dz / n);
        let (mut px, mut pz) = (x, z);
        for _ in 0..(n as u32) {
            let p = self.resolve(px + sx, pz + sz, r, flyer);
            px = p.0;
            pz = p.1;
        }
        (px, pz)
    }

    /// Can a body stand here (inside the map, touching nothing)?
    pub fn free(&mut self, x: f64, z: f64, r: f64) -> bool {
        let list = self.near(x, z, r + 0.1);
        let mut hit = false;
        for &k in list.iter() {
            let b = &self.solids[k as usize];
            if blocks(b) && circle_hits_box(x, z, r, b) {
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

    /// Can a body of radius `r` walk straight from a to b?
    pub fn walk_clear(&mut self, ax: f64, az: f64, bx: f64, bz: f64, r: f64) -> bool {
        let min_x = ax.min(bx) - r;
        let max_x = ax.max(bx) + r;
        let min_z = az.min(bz) - r;
        let max_z = az.max(bz) + r;
        let ext = if max_x - min_x > max_z - min_z { max_x - min_x } else { max_z - min_z };
        let list = self.near((min_x + max_x) / 2.0, (min_z + max_z) / 2.0, ext / 2.0 + 0.1);
        let mut clear = true;
        for &k in list.iter() {
            let b = &self.solids[k as usize];
            if blocks(b) && seg_hits_box(ax, az, bx, bz, b, r - 0.02) {
                clear = false;
                break;
            }
        }
        self.recycle(list);
        clear
    }

    /// The nearest solid hit along a ray within `max_t`: (distance, solid index), with
    /// `HIT_GROUND` for the floor and `HIT_NONE` (distance = max_t) for nothing.
    /// Walks only the grid cells the ray crosses.
    pub fn raycast(&mut self, o: &[f64; 3], d: &[f64; 3], max_t: f64) -> (f64, i32) {
        let mut best = max_t;
        let mut hit = HIT_NONE;
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
                let t = ray_box(o, d, b, best);
                if t < best {
                    best = t;
                    hit = k as i32;
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
            }
        }
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

    /// The first whole door a body walking from a to b would bump into (solid index or -1).
    pub fn door_on(&self, ax: f64, az: f64, bx: f64, bz: f64, r: f64) -> i32 {
        let mut best = -1_i32;
        let mut bd = INF;
        for (k, b) in self.solids.iter().enumerate() {
            if b.kind != KIND_DOOR || !b.alive {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn wall(min_x: f64, max_x: f64, min_z: f64, max_z: f64, min_y: f64, max_y: f64, kind: u8) -> Solid {
        Solid { min_x, max_x, min_y, max_y, min_z, max_z, kind, alive: true }
    }
    /// A 20 x 20 m room with a thin wall across the middle (x = 0), a door in it and a soft panel.
    fn room() -> World {
        let mut w = World::new(10.0, 10.0);
        w.solids.push(wall(-0.125, 0.125, -10.0, -1.0, 0.0, 3.2, 0)); // wall
        w.solids.push(wall(-0.125, 0.125, 1.0, 10.0, 0.0, 3.2, 0)); // wall
        w.solids.push(wall(-0.08, 0.08, -1.0, 1.0, DOOR_GAP, 2.2, KIND_DOOR)); // boarded door
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
                let p = w.move_circle(x, pz, 3.0, 0.0, 0.15, true);
                x = p.0;
                pz = p.1;
            }
            assert!(x < -0.125, "crossed at z {z}: x {x}");
        }
    }

    #[test]
    fn a_single_big_step_would_have_tunnelled() {
        // the old way: one step, one push-out
        let mut w = room();
        let p = w.resolve(-0.275 + 0.6, -5.0, 0.15, true);
        assert!(p.0 > 0.125, "the reference bug: ends on the far side");
    }

    #[test]
    fn drones_go_under_doors_and_bodies_do_not() {
        let mut w = room();
        let d = w.move_circle(-1.0, 0.0, 2.0, 0.0, 0.15, true);
        assert!(d.0 > 0.9);
        let b = w.move_circle(-1.0, 0.0, 2.0, 0.0, BODY_R, false);
        assert!(b.0 < -0.08);
        assert_eq!(w.door_on(-1.0, 0.0, 1.0, 0.0, 0.2), 2);
        w.solids[2].alive = false;
        let b = w.move_circle(-1.0, 0.0, 2.0, 0.0, BODY_R, false);
        assert!(b.0 > 0.9);
        assert_eq!(w.door_on(-1.0, 0.0, 1.0, 0.0, 0.2), -1);
    }

    #[test]
    fn raycast_and_sight() {
        let mut w = room();
        let (t, hit) = w.raycast(&[-5.0, 1.6, -5.0], &[1.0, 0.0, 0.0], 200.0);
        assert!((t - 4.875).abs() < 1e-9 && hit == 0);
        assert!(!w.sight(&[-5.0, 1.6, -5.0], &[5.0, 1.2, -5.0]));
        assert!(w.sight(&[-5.0, 1.6, -5.0], &[-5.0, 1.2, 5.0]));
        // through the doorway above the boards? no: under the boards only (0.3 m)
        assert!(!w.sight(&[-5.0, 1.6, 0.0], &[5.0, 1.6, 0.0]));
        assert!(w.sight(&[-5.0, 0.15, 0.0], &[5.0, 0.15, 0.0]));
        // straight down in the open: the floor
        let (t, hit) = w.raycast(&[-5.0, 1.6, 5.0], &[0.0, -1.0, 0.0], 200.0);
        assert!((t - 1.6).abs() < 1e-12 && hit == HIT_GROUND);
    }

    #[test]
    fn free_and_walk_clear() {
        let mut w = room();
        assert!(w.free(-5.0, 0.0, BODY_R));
        assert!(!w.free(0.0, 5.0, BODY_R));
        assert!(!w.free(9.9, 0.0, BODY_R));
        assert!(w.walk_clear(-5.0, -5.0, -5.0, 5.0, 0.4));
        assert!(!w.walk_clear(-5.0, 0.0, 5.0, 0.0, 0.4)); // the door is whole
    }
}
