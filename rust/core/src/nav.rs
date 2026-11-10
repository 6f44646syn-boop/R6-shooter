//! Navigation: a waypoint graph, A* over it, and path smoothing ("string pulling").

use crate::geom::len2;
use crate::world::{World, BODY_R};

pub struct Nav {
    pub nodes: Vec<[f64; 2]>,
    adj: Vec<Vec<u32>>,
    // Path costs are kept as 32-bit floats, as the reference does (a Float32Array).
    g: Vec<f32>,
    from: Vec<i32>,
    closed: Vec<u8>,
    heap: Vec<(f64, u32)>,
    pts: Vec<[f64; 2]>,
}

impl Nav {
    pub fn new() -> Nav {
        Nav { nodes: Vec::new(), adj: Vec::new(), g: Vec::new(), from: Vec::new(), closed: Vec::new(), heap: Vec::new(), pts: Vec::new() }
    }
    pub fn set_nodes(&mut self, nodes: Vec<[f64; 2]>) {
        let n = nodes.len();
        self.nodes = nodes;
        self.adj = vec![Vec::new(); n];
        self.g = vec![0.0; n];
        self.from = vec![-1; n];
        self.closed = vec![0; n];
    }
    pub fn add_link(&mut self, a: u32, b: u32) {
        if (a as usize) < self.adj.len() && (b as usize) < self.adj.len() {
            self.adj[a as usize].push(b);
            self.adj[b as usize].push(a);
        }
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
    /// The nearest waypoint. With `need_sight`: the nearest within 8 m that a body can walk
    /// straight to; if there is none, simply the nearest.
    pub fn nearest_node(&mut self, x: f64, z: f64, need_sight: bool) -> i32 {
        let mut best = -1_i32;
        let mut bd = f64::INFINITY;
        for k in 0..self.nav.nodes.len() {
            let n = self.nav.nodes[k];
            let d = (n[0] - x) * (n[0] - x) + (n[1] - z) * (n[1] - z);
            if d < bd && (!need_sight || (d <= 64.0 && self.walk_clear(x, z, n[0], n[1], BODY_R * 0.8))) {
                bd = d;
                best = k as i32;
            }
        }
        if best < 0 && need_sight {
            return self.nearest_node(x, z, false);
        }
        best
    }

    /// A* from a to b over the waypoints, then smoothed. The points to walk through, in
    /// order, are written to `out` (empty if there is no way).
    pub fn path(&mut self, ax: f64, az: f64, bx: f64, bz: f64, out: &mut Vec<[f64; 2]>) {
        out.clear();
        let s = self.nearest_node(ax, az, true);
        let g = self.nearest_node(bx, bz, true);
        if s < 0 || g < 0 {
            return;
        }
        let (s, g) = (s as usize, g as usize);
        {
            let nav = &mut self.nav;
            for v in nav.g.iter_mut() {
                *v = f32::INFINITY;
            }
            for v in nav.from.iter_mut() {
                *v = -1;
            }
            for v in nav.closed.iter_mut() {
                *v = 0;
            }
            nav.heap.clear();
            let goal = nav.nodes[g];
            nav.g[s] = 0.0;
            let h0 = len2(nav.nodes[s][0] - goal[0], nav.nodes[s][1] - goal[1]);
            nav.push(h0, s as u32);
            let mut found = false;
            while !nav.heap.is_empty() {
                let (_, c) = nav.pop();
                let c = c as usize;
                if nav.closed[c] != 0 {
                    continue;
                }
                if c == g {
                    found = true;
                    break;
                }
                nav.closed[c] = 1;
                for idx in 0..nav.adj[c].len() {
                    let k = nav.adj[c][idx] as usize;
                    if nav.closed[k] != 0 {
                        continue;
                    }
                    let ng = nav.g[c] as f64 + len2(nav.nodes[k][0] - nav.nodes[c][0], nav.nodes[k][1] - nav.nodes[c][1]);
                    if ng < nav.g[k] as f64 {
                        nav.g[k] = ng as f32;
                        nav.from[k] = c as i32;
                        let h = len2(nav.nodes[k][0] - goal[0], nav.nodes[k][1] - goal[1]);
                        nav.push(ng + h, k as u32);
                    }
                }
            }
            if !found {
                return;
            }
            nav.pts.clear();
            let mut c = g as i32;
            while c != -1 {
                nav.pts.push(nav.nodes[c as usize]);
                c = nav.from[c as usize];
            }
            nav.pts.reverse();
        }
        if self.free(bx, bz, BODY_R) {
            self.nav.pts.push([bx, bz]);
        }
        // string pulling: from where we are, skip to the farthest point we can walk straight to
        let pts = core::mem::take(&mut self.nav.pts);
        let mut cur = [ax, az];
        let mut k = 0usize;
        while k < pts.len() {
            let mut far = k;
            let mut m = if pts.len() - 1 < k + 12 { pts.len() - 1 } else { k + 12 };
            while m > k {
                if self.walk_clear(cur[0], cur[1], pts[m][0], pts[m][1], BODY_R + 0.08) {
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
    use crate::world::World;

    #[test]
    fn a_path_goes_round_a_wall() {
        // a wall across x = 0 from z = -10 to 2; waypoints on a 2 m grid
        let mut w = World::new(10.0, 10.0);
        w.solids.push(Solid { min_x: -0.2, max_x: 0.2, min_y: 0.0, max_y: 3.2, min_z: -10.0, max_z: 2.0, kind: 0, alive: true });
        w.build();
        let mut nodes = Vec::new();
        let mut x = -9.0;
        while x <= 9.0 {
            let mut z = -9.0;
            while z <= 9.0 {
                if w.free(x, z, 0.5) {
                    nodes.push([x, z]);
                }
                z += 2.0;
            }
            x += 2.0;
        }
        let n = nodes.len();
        w.nav.set_nodes(nodes.clone());
        for a in 0..n {
            for b in (a + 1)..n {
                let d = ((nodes[a][0] - nodes[b][0]).powi(2) + (nodes[a][1] - nodes[b][1]).powi(2)).sqrt();
                if d < 3.0 && w.walk_clear(nodes[a][0], nodes[a][1], nodes[b][0], nodes[b][1], 0.4) {
                    w.nav.add_link(a as u32, b as u32);
                }
            }
        }
        let mut out = Vec::new();
        w.path(-5.0, -5.0, 5.0, -5.0, &mut out);
        assert!(!out.is_empty(), "there is a way round");
        assert!(out.iter().any(|p| p[1] > 2.0), "it goes round the end of the wall");
        let last = out[out.len() - 1];
        assert!((last[0] - 5.0).abs() < 1e-9 && (last[1] + 5.0).abs() < 1e-9);
        // every leg is walkable
        let mut cur = [-5.0, -5.0];
        for p in out.iter() {
            assert!(w.walk_clear(cur[0], cur[1], p[0], p[1], 0.4));
            cur = *p;
        }
    }
}
