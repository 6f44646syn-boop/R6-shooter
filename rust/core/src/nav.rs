//! Navigation on every level of a map.
//!
//! The floor plan is cut into 0.5 m cells. Each cell has one node per level a body can stand
//! on there (the floor, a stair tread, a ramp, a box top, an upper floor) with room for the
//! body and no hazard. Neighbouring nodes link when you can step up (`STEP`) or drop down
//! (`DROP`) between them. A* runs over the nodes, then the path is smoothed.
//!
//! Boarded doors count as open (bots break them on the way). A breakable wall panel closes
//! the nodes it covers while it stands, and opens them the moment it is destroyed.
//!
//! The arithmetic follows the JavaScript it replaced (js/battle/arena.js, kept under
//! tools/ref-js) operation for operation: node positions and path costs are 32-bit floats
//! there, so they are here.

use crate::geom::len2;
use crate::world::{blocks, World, KIND_DOOR, KIND_PANEL, STEP};
use std::collections::HashMap;

/// Nav cell size in metres.
pub const CELL: f64 = 0.5;
/// Bots may drop down this far.
pub const DROP: f64 = 4.2;

pub struct CellNav {
    pub nx: i64,
    pub nz: i64,
    /// Clearance from walls the nodes were built with (body radius + 0.1).
    pub r: f64,
    pub x: Vec<f32>,
    pub z: Vec<f32>,
    pub y: Vec<f32>,
    cell: Vec<u32>,
    first: Vec<u32>,
    count: Vec<u8>,
    /// How many standing panels cover each node (0 = open).
    blocked: Vec<u16>,
    /// (panel solid, node) pairs, sorted by solid.
    covers: Vec<(u32, u32)>,
    /// Prefer a node on the same side of a wall when a point is not on a node (see nearest_node).
    pub careful: bool,
    /// 1 for nodes inside the "zone" (a set of rectangles: the building Bomb's defenders
    /// stay in). While `zone_on`, every other node is closed.
    zone: Vec<u8>,
    pub zone_on: bool,
    drop_ok: HashMap<i64, bool>,
    g: Vec<f32>,
    from: Vec<i32>,
    closed: Vec<u8>,
    heap: Vec<(f64, u32)>,
    ids: Vec<u32>,
    pts: Vec<[f64; 3]>,
}

impl CellNav {
    pub fn new() -> CellNav {
        CellNav {
            nx: 0,
            nz: 0,
            r: 0.42,
            x: Vec::new(),
            z: Vec::new(),
            y: Vec::new(),
            cell: Vec::new(),
            first: Vec::new(),
            count: Vec::new(),
            blocked: Vec::new(),
            covers: Vec::new(),
            careful: true,
            zone: Vec::new(),
            zone_on: false,
            drop_ok: HashMap::new(),
            g: Vec::new(),
            from: Vec::new(),
            closed: Vec::new(),
            heap: Vec::new(),
            ids: Vec::new(),
            pts: Vec::new(),
        }
    }
    pub fn len(&self) -> usize {
        self.x.len()
    }
    #[inline]
    pub fn open(&self, k: usize) -> bool {
        self.blocked[k] == 0 && (!self.zone_on || self.zone[k] != 0)
    }
    /// Mark the nodes inside any of the rectangles [x0, z0, x1, z1] as the zone.
    pub fn set_zone(&mut self, rects: &[[f64; 4]]) {
        self.zone = (0..self.x.len())
            .map(|k| {
                let (x, z) = (self.x[k] as f64, self.z[k] as f64);
                rects.iter().any(|r| x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) as u8
            })
            .collect();
    }

    // A binary heap ordered by the first field, written out so equal costs come off in the
    // same order as in the reference.
    fn push(&mut self, f: f64, c: u32) {
        self.heap.push((f, c));
        let mut i = self.heap.len() - 1;
        while i > 0 {
            let p = (i - 1) >> 1;
            if self.heap[p].0 <= self.heap[i].0 {
                break;
            }
            self.heap.swap(p, i);
            i = p;
        }
    }
    fn pop(&mut self) -> (f64, u32) {
        let top = self.heap[0];
        let last = self.heap.pop().unwrap();
        if !self.heap.is_empty() {
            self.heap[0] = last;
            let mut i = 0;
            loop {
                let l = i * 2 + 1;
                let r = l + 1;
                let mut m = i;
                if l < self.heap.len() && self.heap[l].0 < self.heap[m].0 {
                    m = l;
                }
                if r < self.heap.len() && self.heap[r].0 < self.heap[m].0 {
                    m = r;
                }
                if m == i {
                    break;
                }
                self.heap.swap(m, i);
                i = m;
            }
        }
        top
    }
}

impl World {
    /// Build the nodes for a body of radius `body_r`. Call after `build`, with every panel whole.
    pub fn nav_build(&mut self, body_r: f64) {
        let nx = (self.hx * 2.0 / CELL).round() as i64;
        let nz = (self.hz * 2.0 / CELL).round() as i64;
        let r = body_r + 0.1;
        let mut nav = CellNav::new();
        nav.careful = self.nav.careful;
        nav.nx = nx;
        nav.nz = nz;
        nav.r = r;
        nav.first = vec![0; (nx * nz) as usize];
        nav.count = vec![0; (nx * nz) as usize];
        let mut raw: Vec<f64> = Vec::new();
        let mut levels: Vec<f64> = Vec::new();
        let mut panels: Vec<u32> = Vec::new();
        for j in 0..nz {
            for i in 0..nx {
                let c = (j * nx + i) as usize;
                nav.first[c] = nav.x.len() as u32;
                let x = -self.hx + (i as f64 + 0.5) * CELL;
                let z = -self.hz + (j as f64 + 0.5) * CELL;
                if x < -self.hx + r || x > self.hx - r || z < -self.hz + r || z > self.hz - r {
                    continue;
                }
                let near = self.near(x, z, r + 0.05);
                raw.clear();
                raw.push(0.0);
                for &k in near.iter() {
                    let b = &self.solids[k as usize];
                    if b.kind == 0 && x >= b.min_x && x <= b.max_x && z >= b.min_z && z <= b.max_z && b.max_y < self.wall_h - 1.6 {
                        raw.push(b.max_y);
                    }
                }
                raw.sort_by(|a, b| a.partial_cmp(b).unwrap());
                levels.clear();
                for &y in raw.iter() {
                    let n = levels.len();
                    if n > 0 && y - levels[n - 1] < 0.12 {
                        levels[n - 1] = y;
                    } else {
                        levels.push(y);
                    }
                }
                for &y in levels.iter() {
                    if self.hazard_at(x, y, z) {
                        continue;
                    }
                    // something higher that you would step onto is in the way
                    let mut g = 0.0_f64;
                    for &k in near.iter() {
                        let b = &self.solids[k as usize];
                        if x < b.min_x || x > b.max_x || z < b.min_z || z > b.max_z {
                            continue;
                        }
                        if b.max_y <= y + STEP + 1e-4 && b.max_y > g {
                            g = b.max_y;
                        }
                    }
                    if (g - y).abs() > 1e-3 {
                        continue;
                    }
                    let mut ok = true;
                    panels.clear();
                    for &k in near.iter() {
                        let b = &self.solids[k as usize];
                        if !blocks(b, y) || b.kind == KIND_DOOR {
                            continue;
                        }
                        if x > b.min_x - r && x < b.max_x + r && z > b.min_z - r && z < b.max_z + r {
                            if b.kind == KIND_PANEL {
                                panels.push(k);
                            } else {
                                ok = false;
                                break;
                            }
                        }
                    }
                    if !ok {
                        continue;
                    }
                    let id = nav.x.len() as u32;
                    for &p in panels.iter() {
                        nav.covers.push((p, id));
                    }
                    nav.blocked.push(panels.len() as u16);
                    nav.x.push(x as f32);
                    nav.z.push(z as f32);
                    nav.y.push(y as f32);
                    nav.cell.push(c as u32);
                    nav.count[c] += 1;
                }
                self.recycle(near);
            }
        }
        nav.covers.sort();
        let n = nav.x.len();
        nav.zone = vec![1; n];
        nav.g = vec![0.0; n];
        nav.from = vec![-1; n];
        nav.closed = vec![0; n];
        self.nav = nav;
    }

    /// A panel broke or was rebuilt: open or close the nodes it covers.
    pub fn nav_set_alive(&mut self, solid: u32, was: bool, alive: bool) {
        self.nav.drop_ok.clear();
        if was == alive {
            return;
        }
        let nav = &mut self.nav;
        let start = nav.covers.partition_point(|p| p.0 < solid);
        let mut k = start;
        while k < nav.covers.len() && nav.covers[k].0 == solid {
            let node = nav.covers[k].1 as usize;
            if alive {
                nav.blocked[node] += 1;
            } else if nav.blocked[node] > 0 {
                nav.blocked[node] -= 1;
            }
            k += 1;
        }
    }

    #[inline]
    pub fn nav_cell_of(&self, x: f64, z: f64) -> usize {
        let nav = &self.nav;
        let mut i = ((x + self.hx) / CELL).floor();
        let mut j = ((z + self.hz) / CELL).floor();
        if i > (nav.nx - 1) as f64 {
            i = (nav.nx - 1) as f64;
        }
        if i < 0.0 {
            i = 0.0;
        }
        if j > (nav.nz - 1) as f64 {
            j = (nav.nz - 1) as f64;
        }
        if j < 0.0 {
            j = 0.0;
        }
        (j as i64 * nav.nx + i as i64) as usize
    }
    #[inline]
    fn cell_centre(&self, c: usize) -> (f64, f64) {
        let nx = self.nav.nx as usize;
        (-self.hx + ((c % nx) as f64 + 0.5) * CELL, -self.hz + ((c / nx) as f64 + 0.5) * CELL)
    }

    /// The node at (x, z) you would stand on with feet near y, or -1.
    pub fn node_at(&self, x: f64, z: f64, y: f64) -> i32 {
        let nav = &self.nav;
        if nav.nx == 0 {
            return -1;
        }
        let c = self.nav_cell_of(x, z);
        let mut best = -1_i32;
        let mut bd = 0.6_f64;
        let f = nav.first[c] as usize;
        for k in f..f + nav.count[c] as usize {
            if !nav.open(k) {
                continue;
            }
            let d = (nav.y[k] as f64 - y).abs();
            if d < bd {
                bd = d;
                best = k as i32;
            }
        }
        best
    }

    /// The node to start or end a path at for a point that may not be on one (hugging a
    /// wall, on a ledge): the node at the point, else the nearest. With `careful`, a node
    /// within 2 m that can be reached in a straight line is preferred, so the answer is
    /// never on the far side of a thin wall when there is one on the near side.
    pub fn nearest_node(&mut self, x: f64, z: f64, y: f64) -> i32 {
        let k0 = self.node_at(x, z, y);
        if k0 >= 0 {
            return k0;
        }
        // a point inside something solid can reach nothing in a straight line: skip the
        // straight-line passes
        let buried = !self.free(x, y, z, 0.05);
        if self.nav.careful && self.nav.nx > 0 {
            // within 6 m, on a level you could step or hop down to, with nothing between
            let c = self.nav_cell_of(x, z) as i64;
            let (ci, cj) = (c % self.nav.nx, c / self.nav.nx);
            let mut best = -1_i32;
            let mut bd = f64::INFINITY;
            for j in (cj - 12).max(0)..=(cj + 12).min(self.nav.nz - 1) {
                for i in (ci - 12).max(0)..=(ci + 12).min(self.nav.nx - 1) {
                    let cc = (j * self.nav.nx + i) as usize;
                    let f = self.nav.first[cc] as usize;
                    for k in f..f + self.nav.count[cc] as usize {
                        if !self.nav.open(k) {
                            continue;
                        }
                        let (nx, nz, ny) = (self.nav.x[k] as f64, self.nav.z[k] as f64, self.nav.y[k] as f64);
                        if ny > y + STEP + 1e-3 || ny < y - 1.0 {
                            continue;
                        }
                        let d = (nx - x) * (nx - x) + (nz - z) * (nz - z) + 4.0 * (ny - y) * (ny - y);
                        if d < bd && !buried && self.walk_clear(x, z, nx, nz, 0.1, if ny < y { ny } else { y }) {
                            bd = d;
                            best = k as i32;
                        }
                    }
                }
            }
            if best >= 0 {
                return best;
            }
            // farther away (a long dead-end gap): the same, over the whole map; then the
            // nearest on a level you could step or hop down to, whatever is in between
            for pass in (if buried { 1 } else { 0 })..2 {
                for k in 0..self.nav.len() {
                    if !self.nav.open(k) {
                        continue;
                    }
                    let (nx, nz, ny) = (self.nav.x[k] as f64, self.nav.z[k] as f64, self.nav.y[k] as f64);
                    if ny > y + STEP + 1e-3 || ny < y - 1.0 {
                        continue;
                    }
                    let d = (nx - x) * (nx - x) + (nz - z) * (nz - z) + 4.0 * (ny - y) * (ny - y);
                    if d < bd && (pass == 1 || self.walk_clear(x, z, nx, nz, 0.1, if ny < y { ny } else { y })) {
                        bd = d;
                        best = k as i32;
                    }
                }
                if best >= 0 {
                    return best;
                }
            }
        }
        let nav = &self.nav;
        let mut best = -1_i32;
        let mut bd = f64::INFINITY;
        for k in 0..nav.len() {
            if !nav.open(k) {
                continue;
            }
            let (dx, dz, dy) = (nav.x[k] as f64 - x, nav.z[k] as f64 - z, nav.y[k] as f64 - y);
            let d = dx * dx + dz * dz + 4.0 * (dy * dy);
            if d < bd {
                bd = d;
                best = k as i32;
            }
        }
        best
    }

    /// Room for a body at (x, z) with feet at y?
    pub fn free_at(&mut self, x: f64, z: f64, y: f64, r: f64) -> bool {
        let near = self.near(x, z, r + 0.05);
        let mut ok = true;
        for &k in near.iter() {
            let b = &self.solids[k as usize];
            if !blocks(b, y) {
                continue;
            }
            if x > b.min_x - r && x < b.max_x + r && z > b.min_z - r && z < b.max_z + r {
                ok = false;
                break;
            }
        }
        self.recycle(near);
        ok
    }

    /// The node a body moving from height y would stand on in this cell (step up or fall),
    /// or -1. A drop needs open space at the starting height (no rail or wall in the way).
    pub fn step_into(&mut self, cell: usize, y: f64) -> i32 {
        let mut best = -1_i32;
        let mut by = f64::NEG_INFINITY;
        {
            let nav = &self.nav;
            let f = nav.first[cell] as usize;
            for k in f..f + nav.count[cell] as usize {
                if !nav.open(k) {
                    continue;
                }
                let ny = nav.y[k] as f64;
                if ny <= y + STEP + 1e-3 && ny > by {
                    by = ny;
                    best = k as i32;
                }
            }
        }
        if best < 0 {
            return -1;
        }
        if y - by > STEP + 1e-3 {
            if y - by > DROP {
                return -1;
            }
            let key = cell as i64 * 64 + (y * 4.0 + 0.5).floor() as i64;
            let ok = match self.nav.drop_ok.get(&key) {
                Some(&v) => v,
                None => {
                    let (x, z) = self.cell_centre(cell);
                    let r = self.nav.r - 0.05;
                    let v = self.free_at(x, z, y, r);
                    self.nav.drop_ok.insert(key, v);
                    v
                }
            };
            if !ok {
                return -1;
            }
        }
        best
    }

    /// Can a body walk straight from a to b (each x, z, y), stepping and dropping as it goes?
    pub fn clear_walk(&mut self, a: &[f64; 3], b: &[f64; 3]) -> bool {
        if self.nav.nx == 0 {
            return false;
        }
        let l = len2(b[0] - a[0], b[1] - a[1]);
        let n = (l / (CELL * 0.25)).ceil();
        let n = if n < 1.0 { 1.0 } else { n };
        let mut y = a[2];
        let mut k = 1.0_f64;
        while k <= n {
            let f = k / n;
            let x = a[0] + (b[0] - a[0]) * f;
            let z = a[1] + (b[1] - a[1]) * f;
            let c = self.nav_cell_of(x, z);
            let nd = self.step_into(c, y);
            if nd < 0 {
                return false;
            }
            y = self.nav.y[nd as usize] as f64;
            k += 1.0;
        }
        (y - b[2]).abs() < 0.3
    }

    fn reach(&self, cell: usize, y: f64) -> bool {
        let nav = &self.nav;
        let f = nav.first[cell] as usize;
        for k in f..f + nav.count[cell] as usize {
            if !nav.open(k) {
                continue;
            }
            let d = nav.y[k] as f64 - y;
            if d <= STEP + 1e-3 && d >= -DROP {
                return true;
            }
        }
        false
    }

    /// A* over the nodes (8 neighbours, no corner cutting), then smoothed. The points to
    /// walk through (x, z, y), ending at the goal, are written to `out` (empty if there is
    /// no way).
    pub fn find_path(&mut self, ax: f64, az: f64, ay: f64, bx: f64, bz: f64, by: f64, out: &mut Vec<[f64; 3]>) {
        self.find_path_in(ax, az, ay, bx, bz, by, false, out)
    }
    /// The same; with `zone`, only through nodes inside the zone (see CellNav::set_zone).
    pub fn find_path_in(&mut self, ax: f64, az: f64, ay: f64, bx: f64, bz: f64, by: f64, zone: bool, out: &mut Vec<[f64; 3]>) {
        let was = self.nav.zone_on;
        if zone != was {
            self.nav.zone_on = zone;
            self.nav.drop_ok.clear();
        }
        self.path_now(ax, az, ay, bx, bz, by, out);
        if zone != was {
            self.nav.zone_on = was;
            self.nav.drop_ok.clear();
        }
    }
    fn path_now(&mut self, ax: f64, az: f64, ay: f64, bx: f64, bz: f64, by: f64, out: &mut Vec<[f64; 3]>) {
        out.clear();
        if self.nav.nx == 0 {
            return;
        }
        let start = self.nearest_node(ax, az, ay);
        let goal = self.nearest_node(bx, bz, by);
        if start < 0 || goal < 0 {
            return;
        }
        let (start, goal) = (start as usize, goal as usize);
        let nx = self.nav.nx;
        let nz = self.nav.nz;
        for v in self.nav.g.iter_mut() {
            *v = f32::INFINITY;
        }
        for v in self.nav.from.iter_mut() {
            *v = -1;
        }
        for v in self.nav.closed.iter_mut() {
            *v = 0;
        }
        self.nav.heap.clear();
        let (gx, gz, gy) = (self.nav.x[goal] as f64, self.nav.z[goal] as f64, self.nav.y[goal] as f64);
        let h = |nav: &CellNav, k: usize| -> f64 {
            let dx = (nav.x[k] as f64 - gx).abs();
            let dz = (nav.z[k] as f64 - gz).abs();
            let (hi, lo) = if dx > dz { (dx, dz) } else { (dz, dx) };
            hi + 0.414 * lo + (nav.y[k] as f64 - gy).abs()
        };
        self.nav.g[start] = 0.0;
        let h0 = h(&self.nav, start);
        self.nav.push(h0, start as u32);
        let mut found = false;
        while !self.nav.heap.is_empty() {
            let (_, c) = self.nav.pop();
            let c = c as usize;
            if self.nav.closed[c] != 0 {
                continue;
            }
            if c == goal {
                found = true;
                break;
            }
            self.nav.closed[c] = 1;
            let cell = self.nav.cell[c] as i64;
            let (ci, cj) = (cell % nx, cell / nx);
            let cy = self.nav.y[c] as f64;
            for dj in -1..=1_i64 {
                for di in -1..=1_i64 {
                    if di == 0 && dj == 0 {
                        continue;
                    }
                    let (i, j) = (ci + di, cj + dj);
                    if i < 0 || j < 0 || i >= nx || j >= nz {
                        continue;
                    }
                    let k = self.step_into((j * nx + i) as usize, cy);
                    if k < 0 || self.nav.closed[k as usize] != 0 {
                        continue;
                    }
                    let k = k as usize;
                    if di != 0 && dj != 0 && (!self.reach((cj * nx + i) as usize, cy) || !self.reach((j * nx + ci) as usize, cy)) {
                        continue; // no corner cutting
                    }
                    let up = self.nav.y[k] as f64 - cy;
                    let ng = self.nav.g[c] as f64 + (if di != 0 && dj != 0 { 1.414 } else { 1.0 }) * CELL + (if up > 0.0 { up } else { 0.0 }) * 0.5;
                    if ng < self.nav.g[k] as f64 {
                        self.nav.g[k] = ng as f32;
                        self.nav.from[k] = c as i32;
                        let hk = h(&self.nav, k);
                        self.nav.push(ng + hk, k as u32);
                    }
                }
            }
        }
        if !found {
            return;
        }
        let mut ids = core::mem::take(&mut self.nav.ids);
        ids.clear();
        let mut c = goal as i32;
        while c != -1 {
            ids.push(c as u32);
            c = self.nav.from[c as usize];
        }
        ids.reverse();
        let mut pts = core::mem::take(&mut self.nav.pts);
        pts.clear();
        for &k in ids.iter() {
            let k = k as usize;
            pts.push([self.nav.x[k] as f64, self.nav.z[k] as f64, self.nav.y[k] as f64]);
        }
        self.nav.ids = ids;
        if self.node_at(bx, bz, by) == goal as i32 {
            let n = pts.len();
            pts[n - 1] = [bx, bz, self.nav.y[goal] as f64];
        }
        // string pulling: skip waypoints while the straight line stays walkable
        let mut cur = [ax, az, self.nav.y[start] as f64];
        let mut k = 0usize;
        while k < pts.len() {
            let mut far = k;
            let mut m = if pts.len() - 1 < k + 40 { pts.len() - 1 } else { k + 40 };
            while m > k {
                if self.clear_walk(&cur, &pts[m]) {
                    far = m;
                    break;
                }
                m -= 1;
            }
            out.push(pts[far]);
            cur = pts[far];
            k = far + 1;
        }
        self.nav.pts = pts;
    }
}

#[cfg(test)]
mod tests {
    use crate::geom::Solid;
    use crate::world::{World, BODY_R, KIND_PANEL};

    fn bx(min_x: f64, max_x: f64, min_y: f64, max_y: f64, min_z: f64, max_z: f64, kind: u8) -> Solid {
        Solid { min_x, max_x, min_y, max_y, min_z, max_z, kind, alive: true }
    }
    fn edges(w: &mut World) {
        let (hx, hz) = (w.hx, w.hz);
        w.solids.push(bx(-hx - 1.0, hx + 1.0, 0.0, 60.0, -hz - 1.0, -hz, 0));
        w.solids.push(bx(-hx - 1.0, hx + 1.0, 0.0, 60.0, hz, hz + 1.0, 0));
        w.solids.push(bx(-hx - 1.0, -hx, 0.0, 60.0, -hz, hz, 0));
        w.solids.push(bx(hx, hx + 1.0, 0.0, 60.0, -hz, hz, 0));
    }
    /// A 20 x 20 m yard with a 3 m high platform (x 4..10, z -3..3) and stairs up to it
    /// from the west (ten 0.3 m steps, each 0.6 m long, x -2..4, z -1..1).
    fn yard() -> World {
        let mut w = World::new(10.0, 10.0, 6.0, 0.0);
        edges(&mut w);
        w.solids.push(bx(4.0, 10.0, 0.0, 3.0, -3.0, 3.0, 0));
        for i in 0..10 {
            let x0 = -2.0 + 0.6 * i as f64;
            w.solids.push(bx(x0, x0 + 0.6, 0.0, 0.3 * (i + 1) as f64, -1.0, 1.0, 0));
        }
        w.build();
        w.nav_build(BODY_R);
        w
    }

    #[test]
    fn a_path_climbs_the_stairs_and_every_leg_is_walkable() {
        let mut w = yard();
        let mut out = Vec::new();
        w.find_path(-8.0, 0.0, 0.0, 8.0, 0.0, 3.0, &mut out);
        assert!(!out.is_empty(), "there is a way up");
        let last = out[out.len() - 1];
        assert!((last[0] - 8.0).abs() < 1e-9 && (last[2] - 3.0).abs() < 1e-6, "ends on the platform: {last:?}");
        let mut cur = [-8.0, 0.0, 0.0];
        for p in out.iter() {
            assert!(w.clear_walk(&cur, p), "leg {cur:?} -> {p:?}");
            cur = *p;
        }
    }

    #[test]
    fn down_from_the_platform_and_back_up_by_the_stairs() {
        let mut w = yard();
        let mut out = Vec::new();
        w.find_path(7.0, 2.5, 3.0, 7.0, 6.0, 0.0, &mut out);
        assert!(!out.is_empty(), "a way down");
        assert!((out[out.len() - 1][2]).abs() < 1e-6);
        w.find_path(7.0, 6.0, 0.0, 7.0, 2.5, 3.0, &mut out);
        assert!(!out.is_empty(), "a way up");
        assert!(out.iter().any(|p| p[0] < 0.0), "round by the foot of the stairs");
        // no walking straight up a 3 m wall
        assert!(!w.clear_walk(&[7.0, 6.0, 0.0], &[7.0, 2.5, 3.0]));
        // every node is somewhere a body fits
        for k in 0..w.nav.len() {
            let (x, z, y) = (w.nav.x[k] as f64, w.nav.z[k] as f64, w.nav.y[k] as f64);
            assert!(w.free(x, y, z, BODY_R), "node {k} at {x} {y} {z}");
        }
    }

    #[test]
    fn a_standing_panel_closes_the_way_and_a_broken_one_opens_it() {
        // a wall across x = 0 with one breakable panel (z -0.75..0.75)
        let mut w = World::new(10.0, 10.0, 3.2, 0.0);
        edges(&mut w);
        w.solids.push(bx(-0.125, 0.125, 0.0, 3.2, -10.0, -0.75, 0));
        w.solids.push(bx(-0.125, 0.125, 0.0, 3.2, 0.75, 10.0, 0));
        let panel = w.solids.len() as u32;
        w.solids.push(bx(-0.125, 0.125, 0.0, 2.2, -0.75, 0.75, KIND_PANEL));
        w.build();
        w.nav_build(BODY_R);
        let mut out = Vec::new();
        w.find_path(-5.0, 0.0, 0.0, 5.0, 0.0, 0.0, &mut out);
        assert!(out.is_empty(), "sealed while the panel stands");
        w.solids[panel as usize].alive = false;
        w.nav_set_alive(panel, true, false);
        w.find_path(-5.0, 0.0, 0.0, 5.0, 0.0, 0.0, &mut out);
        assert!(!out.is_empty(), "open once it is broken");
        w.solids[panel as usize].alive = true;
        w.nav_set_alive(panel, false, true);
        w.find_path(-5.0, 0.0, 0.0, 5.0, 0.0, 0.0, &mut out);
        assert!(out.is_empty(), "sealed again when rebuilt");
    }

    #[test]
    fn a_zone_keeps_paths_inside_it() {
        // a house (x -6..6, z -4..4, walls 0.4 thick) with a door in the west and east walls
        // and a wall across the middle (x = 0) with no door: the short way from the west
        // room to the east room is out one door and in the other
        let mut w = World::new(12.0, 10.0, 3.2, 0.0);
        edges(&mut w);
        for &(x0, x1, z0, z1) in [(-6.2, 6.2, -4.2, -3.8), (-6.2, 6.2, 3.8, 4.2), (-6.2, -5.8, -4.2, -1.0), (-6.2, -5.8, 1.0, 4.2), (5.8, 6.2, -4.2, -1.0), (5.8, 6.2, 1.0, 4.2), (-0.2, 0.2, -4.2, 2.0)].iter() {
            w.solids.push(bx(x0, x1, 0.0, 3.2, z0, z1, 0));
        }
        w.build();
        w.nav_build(BODY_R);
        w.nav.set_zone(&[[-6.0, -4.0, 6.0, 4.0]]);
        let mut out = Vec::new();
        w.find_path(-3.0, -3.0, 0.0, 3.0, -3.0, 0.0, &mut out);
        assert!(!out.is_empty());
        w.find_path_in(-3.0, -3.0, 0.0, 3.0, -3.0, 0.0, true, &mut out);
        assert!(!out.is_empty(), "there is a way inside (round the end of the middle wall)");
        assert!(out.iter().all(|p| p[0].abs() <= 6.0 && p[1].abs() <= 4.0), "and it stays inside: {out:?}");
        assert!(out.iter().any(|p| p[1] > 2.0));
        // seal the inside way: no path with the zone, still one without it (round the outside)
        w.solids.push(bx(-0.2, 0.2, 0.0, 3.2, 2.0, 4.0, 0));
        w.build();
        w.nav_build(BODY_R);
        w.nav.set_zone(&[[-6.0, -4.0, 6.0, 4.0]]);
        w.find_path_in(-3.0, -3.0, 0.0, 3.0, -3.0, 0.0, true, &mut out);
        assert!(out.is_empty(), "no way inside: {out:?}");
        w.find_path(-3.0, -3.0, 0.0, 3.0, -3.0, 0.0, &mut out);
        assert!(!out.is_empty() && out.iter().any(|p| p[0].abs() > 6.5));
    }

    #[test]
    fn in_a_gap_too_narrow_for_nodes_the_nearest_node_is_at_its_end_not_on_the_roof() {
        // a 1 m gap between the map edge (z = -10) and a 2 m high block (z -9..-2, x -6..6)
        let mut w = World::new(10.0, 10.0, 6.0, 0.0);
        edges(&mut w);
        w.solids.push(bx(-6.0, 6.0, 0.0, 2.0, -9.0, -2.0, 0));
        w.build();
        w.nav_build(BODY_R);
        let k = w.nearest_node(-2.0, -9.5, 0.0);
        assert!(k >= 0);
        assert!((w.nav.y[k as usize] as f64) < 0.01 && (w.nav.x[k as usize] as f64) < -6.0, "on the ground at the west end");
        let mut out = Vec::new();
        w.find_path(-2.0, -9.5, 0.0, 0.0, 5.0, 0.0, &mut out);
        assert!(!out.is_empty() && out[0][2] < 0.01);
    }

    #[test]
    fn the_nearest_node_is_on_your_side_of_a_thin_wall() {
        // hugging a thin wall (x = 0..0.2): the cell you are in has no node
        let mut w = World::new(10.0, 10.0, 3.2, 0.0);
        edges(&mut w);
        w.solids.push(bx(0.0, 0.2, 0.0, 3.2, -10.0, 10.0, 0));
        w.build();
        w.nav_build(BODY_R);
        for z in [-7.3, -2.1, 0.0, 3.3, 8.8] {
            let k = w.nearest_node(-0.33, z, 0.0);
            assert!(k >= 0 && w.nav.x[k as usize] < 0.0, "west side at z {z}");
            let k = w.nearest_node(0.53, z, 0.0);
            assert!(k >= 0 && w.nav.x[k as usize] > 0.2, "east side at z {z}");
        }
    }
}
