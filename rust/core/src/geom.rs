//! Geometry: rays, boxes and circles. Boxes are axis aligned; x and z are the floor plane,
//! y is up. The arithmetic follows the JavaScript reference operation for operation, so both
//! give bit-identical answers (tools/check-core.mjs checks that).

pub const INF: f64 = f64::INFINITY;

/// One solid box of a map.
#[derive(Clone, Copy, Debug)]
pub struct Solid {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
    pub min_z: f64,
    pub max_z: f64,
    /// 1 = a boarded door, 2 = a breakable wall panel, 0 = anything else.
    pub kind: u8,
    /// Broken panels and doors are not alive: nothing collides with them.
    pub alive: bool,
}

/// Ray (origin `o`, unit direction `d`) against a box: the entry distance, or infinity.
/// A ray that starts inside the box does not hit it.
pub fn ray_box(o: &[f64; 3], d: &[f64; 3], b: &Solid, max_t: f64) -> f64 {
    ray_box_axis(o, d, b, max_t).0
}
/// The same, with the axis (0 x, 1 y, 2 z) of the face the ray enters by.
pub fn ray_box_axis(o: &[f64; 3], d: &[f64; 3], b: &Solid, max_t: f64) -> (f64, i32) {
    let mut t0 = 0.0_f64;
    let mut t1 = max_t;
    let mut ax: i32 = -1;
    for a in 0..3 {
        let oo = o[a];
        let dd = d[a];
        let (lo, hi) = match a {
            0 => (b.min_x, b.max_x),
            1 => (b.min_y, b.max_y),
            _ => (b.min_z, b.max_z),
        };
        if dd.abs() < 1e-12 {
            if oo < lo || oo > hi {
                return (INF, -1);
            }
            continue;
        }
        let mut ta = (lo - oo) / dd;
        let mut tb = (hi - oo) / dd;
        if ta > tb {
            core::mem::swap(&mut ta, &mut tb);
        }
        if ta > t0 {
            t0 = ta;
            ax = a as i32;
        }
        if tb < t1 {
            t1 = tb;
        }
        if t0 > t1 {
            return (INF, -1);
        }
    }
    if ax < 0 || t0 <= 1e-6 {
        return (INF, -1);
    }
    (t0, ax)
}

/// Push a circle (centre `x`, `z`, radius `r`) out of a box in the floor plane.
/// Returns true if it moved.
pub fn push_circle_box(x: &mut f64, z: &mut f64, r: f64, b: &Solid) -> bool {
    let cx = b.min_x.max(x.min(b.max_x));
    let cz = b.min_z.max(z.min(b.max_z));
    let dx = *x - cx;
    let dz = *z - cz;
    let d2 = dx * dx + dz * dz;
    if d2 >= r * r {
        return false;
    }
    if d2 > 1e-12 {
        let d = d2.sqrt();
        *x = cx + dx / d * r;
        *z = cz + dz / d * r;
        return true;
    }
    // The centre is inside the box: leave by the nearest face (first of equals wins).
    let opts = [(*x - b.min_x, -1, 0), (b.max_x - *x, 1, 0), (*z - b.min_z, 0, -1), (b.max_z - *z, 0, 1)];
    let mut best = opts[0];
    for q in opts.iter() {
        if q.0 < best.0 {
            best = *q;
        }
    }
    if best.1 != 0 {
        *x = if best.1 < 0 { b.min_x - r } else { b.max_x + r };
    } else {
        *z = if best.2 < 0 { b.min_z - r } else { b.max_z + r };
    }
    true
}

/// Does a circle overlap the box (floor plane)?
pub fn circle_hits_box(x: f64, z: f64, r: f64, b: &Solid) -> bool {
    let cx = b.min_x.max(x.min(b.max_x));
    let cz = b.min_z.max(z.min(b.max_z));
    (x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r
}

/// Segment a-b (floor plane) against the box grown by `r`: true if it crosses.
pub fn seg_hits_box(ax: f64, az: f64, bx: f64, bz: f64, b: &Solid, r: f64) -> bool {
    let mut t0 = 0.0_f64;
    let mut t1 = 1.0_f64;
    let axes = [(ax, bx - ax, b.min_x - r, b.max_x + r), (az, bz - az, b.min_z - r, b.max_z + r)];
    for &(o, d, lo, hi) in axes.iter() {
        if d.abs() < 1e-12 {
            if o < lo || o > hi {
                return false;
            }
            continue;
        }
        let mut ta = (lo - o) / d;
        let mut tb = (hi - o) / d;
        if ta > tb {
            core::mem::swap(&mut ta, &mut tb);
        }
        if ta > t0 {
            t0 = ta;
        }
        if tb < t1 {
            t1 = tb;
        }
        if t0 > t1 {
            return false;
        }
    }
    true
}

/// Length of (x, z). Plain square root of the sum of squares, the same in the reference.
#[inline]
pub fn len2(x: f64, z: f64) -> f64 {
    (x * x + z * z).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bx(min_x: f64, max_x: f64, min_y: f64, max_y: f64, min_z: f64, max_z: f64) -> Solid {
        Solid { min_x, max_x, min_y, max_y, min_z, max_z, kind: 0, alive: true }
    }

    #[test]
    fn ray_hits_box_face_at_the_right_distance() {
        let b = bx(-1.0, 1.0, 0.0, 2.0, 4.0, 6.0);
        assert!((ray_box(&[0.0, 1.0, 0.0], &[0.0, 0.0, 1.0], &b, INF) - 4.0).abs() < 1e-12);
        assert_eq!(ray_box(&[1.5, 1.0, 0.0], &[0.0, 0.0, 1.0], &b, INF), INF); // beside
        assert_eq!(ray_box(&[0.0, 2.5, 0.0], &[0.0, 0.0, 1.0], &b, INF), INF); // over
        assert_eq!(ray_box(&[0.0, 1.0, 5.0], &[0.0, 0.0, 1.0], &b, INF), INF); // from inside
    }

    #[test]
    fn circle_is_pushed_out_to_the_side_it_is_on() {
        let b = bx(0.0, 0.4, 0.0, 3.0, -5.0, 5.0);
        let (mut x, mut z) = (-0.1, 0.0);
        assert!(push_circle_box(&mut x, &mut z, 0.32, &b));
        assert!((x + 0.32).abs() < 1e-12 && z == 0.0);
        // centre inside: out by the nearest face
        let (mut x, mut z) = (0.3, 0.0);
        push_circle_box(&mut x, &mut z, 0.32, &b);
        assert!((x - 0.72).abs() < 1e-12);
    }

    #[test]
    fn segment_and_circle_tests() {
        let b = bx(0.0, 1.0, 0.0, 3.0, 0.0, 1.0);
        assert!(seg_hits_box(-1.0, 0.5, 2.0, 0.5, &b, 0.0));
        assert!(!seg_hits_box(-1.0, 1.5, 2.0, 1.5, &b, 0.0));
        assert!(seg_hits_box(-1.0, 1.2, 2.0, 1.2, &b, 0.3));
        assert!(circle_hits_box(1.2, 0.5, 0.3, &b));
        assert!(!circle_hits_box(1.4, 0.5, 0.3, &b));
    }
}
