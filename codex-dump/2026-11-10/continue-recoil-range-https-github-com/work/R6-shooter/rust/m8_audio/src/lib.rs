//! Audio policy only. Geometry queries remain in the engine; WebAudio remains in JS.
use std::cell::RefCell;
const LEN: usize = 16;
const MAX_ZONES: usize = 128;
const MAX_COORD: f64 = 1_000_000.;
// Materials: air, concrete, wood, metal, carpet, snow, soil, stone, tile.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Profile {
    hz: f64,
    q: f64,
    duration: f64,
    gain: f64,
    ring: f64,
}
const PROFILES: [Profile; 9] = [
    Profile {
        hz: 100.,
        q: 1.,
        duration: 0.1,
        gain: 0.,
        ring: 0.,
    },
    Profile {
        hz: 850.,
        q: 0.9,
        duration: 0.10,
        gain: 1.,
        ring: 95.,
    },
    Profile {
        hz: 430.,
        q: 1.8,
        duration: 0.13,
        gain: 0.90,
        ring: 145.,
    },
    Profile {
        hz: 1750.,
        q: 4.,
        duration: 0.18,
        gain: 1.05,
        ring: 620.,
    },
    Profile {
        hz: 290.,
        q: 0.6,
        duration: 0.08,
        gain: 0.45,
        ring: 0.,
    },
    Profile {
        hz: 2200.,
        q: 0.5,
        duration: 0.16,
        gain: 0.60,
        ring: 0.,
    },
    Profile {
        hz: 1150.,
        q: 0.7,
        duration: 0.12,
        gain: 0.70,
        ring: 0.,
    },
    Profile {
        hz: 1200.,
        q: 1.4,
        duration: 0.10,
        gain: 1.,
        ring: 185.,
    },
    Profile {
        hz: 1450.,
        q: 2.,
        duration: 0.11,
        gain: 0.95,
        ring: 250.,
    },
];
#[derive(Clone, Copy)]
struct Zone {
    rect: [f64; 4],
    material: u32,
}
#[derive(Clone, Copy)]
struct Step {
    id: u32,
    time: f64,
    x: f64,
    y: f64,
    z: f64,
    travel: f64,
}
thread_local! {
    static OUT: RefCell<[f64;LEN]> = const { RefCell::new([0.;LEN]) };
    static ZONES: RefCell<Vec<Zone>> = const { RefCell::new(Vec::new()) };
    static STEPS: RefCell<Vec<Step>> = const { RefCell::new(Vec::new()) };
}
fn write(values: &[f64]) {
    OUT.with(|o| {
        let mut o = o.borrow_mut();
        o.fill(0.);
        o[..values.len()].copy_from_slice(values);
    });
}
fn finite(v: f64) -> bool {
    v.is_finite() && v.abs() <= MAX_COORD
}
fn clamp(v: f64, lo: f64, hi: f64, default: f64) -> f64 {
    if v.is_finite() {
        v.clamp(lo, hi)
    } else {
        default
    }
}
fn texture(token: u32) -> u32 {
    match token {
        1 => 1,
        2 => 2,
        3 => 3,
        4 | 13 => 4,
        5 => 5,
        6..=8 => 6,
        9 | 10 => 7,
        11 | 12 => 8,
        _ => 1,
    }
}
// Ground/material identifiers are serialized by the browser adapter, not inferred from colours.
fn surface(map: u32, kind: i32, ground: u32, x: f64, y: f64, z: f64) -> u32 {
    if ![x, y, z].iter().all(|v| finite(*v)) || kind < 0 {
        return 0;
    }
    if kind == 0 && y.abs() < 0.15 {
        let material = ZONES.with(|zones| {
            zones
                .borrow()
                .iter()
                .rev()
                .find(|q| x >= q.rect[0] && x <= q.rect[2] && z >= q.rect[1] && z <= q.rect[3])
                .map(|q| q.material)
        });
        if let Some(m) = material {
            return m;
        }
    }
    match kind {
        2 => {
            if map == 3 {
                3
            } else {
                2
            }
        } // plank: school uses metal grating
        3 | 22 | 23 if map == 1 => 5, // snow-covered crates, shed and woodpile
        3 | 6 | 10 | 14 | 15 | 16 | 20 | 21 | 22 | 23 | 27 => 2,
        4 | 5 | 17 | 18 | 26 => 3,
        11 | 12 | 13 | 28 => 4,
        24 | 25 => 5,
        29 => 1,
        30 => 8,
        31 => 7,
        9 if map == 2 => 2,     // casino's wooden stairs
        7 | 8 if map == 2 => 4, // casino carpeted floor and ramp
        0 if ground != 0 => texture(ground),
        _ => match map {
            1 => 5,
            2 => 4,
            4..=6 => 6,
            _ => 1,
        },
    }
}
fn mix(
    kind: u32,
    source: [f64; 3],
    listener: [f64; 3],
    yaw: f64,
    pitch: f64,
    range: f64,
    blocked: f64,
    teammate: bool,
    material: u32,
) -> [f64; LEN] {
    let mut out = [0.; LEN];
    if !source
        .iter()
        .chain(listener.iter())
        .chain([yaw, pitch].iter())
        .all(|v| finite(*v))
    {
        return out;
    }
    let dx = source[0] - listener[0];
    let dy = source[1] - listener[1];
    let dz = source[2] - listener[2];
    let distance = (dx * dx + dy * dy + dz * dz).sqrt();
    // Existing engine noise range is the source's audibility budget; do not enlarge it by volume settings.
    let reach = if range.is_finite() && range > 0. {
        range.min(160.)
    } else {
        0.
    };
    let blocked = clamp(blocked, 0., 1., 1.);
    let reference = match kind {
        0 => 6.,
        1 => 2.,
        2 => 10.,
        _ => 3.,
    };
    let fade = if reach > 0. {
        (1. - distance / reach).clamp(0., 1.)
    } else {
        0.
    };
    let base = fade * fade * reference / (reference + distance);
    let profile = PROFILES
        .get(material as usize)
        .copied()
        .unwrap_or(PROFILES[1]);
    let mut gain = base * (1. - 0.72 * blocked);
    if kind == 1 {
        gain *= profile.gain;
        if teammate {
            gain *= 0.45;
        }
    }
    gain = gain.clamp(0., 1.);
    // 3D distance includes vertical separation. Back-facing sounds use HRTF, not an extra volume penalty.
    let yaw = yaw.to_radians();
    let pitch = pitch
        .to_radians()
        .clamp(-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2);
    let forward = [
        yaw.sin() * pitch.cos(),
        pitch.sin(),
        -yaw.cos() * pitch.cos(),
    ];
    let right = [yaw.cos(), 0., yaw.sin()];
    let horizontal = (dx * dx + dz * dz).sqrt();
    let pan = if horizontal > 1e-9 {
        (dx * right[0] + dz * right[2]) / horizontal
    } else {
        0.
    };
    out[..16].copy_from_slice(&[
        distance,
        gain,
        18000. * 0.055_f64.powf(blocked),
        pan.clamp(-1., 1.),
        source[0],
        source[1],
        source[2],
        forward[0],
        forward[1],
        forward[2],
        profile.hz,
        profile.q,
        profile.duration,
        profile.ring,
        blocked,
        match kind {
            2 => 4.,
            0 => 3.,
            4 => 2.,
            _ => 1.,
        },
    ]);
    out
}
#[no_mangle]
pub extern "C" fn ma_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn ma_len() -> u32 {
    LEN as u32
}
#[no_mangle]
pub extern "C" fn ma_buf() -> *const f64 {
    OUT.with(|o| o.as_ptr() as *const f64)
}
#[no_mangle]
pub extern "C" fn ma_zones_clear() {
    ZONES.with(|z| z.borrow_mut().clear());
}
#[no_mangle]
pub extern "C" fn ma_zone(x0: f64, z0: f64, x1: f64, z1: f64, token: u32) -> u32 {
    if ![x0, z0, x1, z1].iter().all(|v| finite(*v))
        || x0 > x1
        || z0 > z1
        || token == 0
        || token > 13
    {
        return 0;
    }
    ZONES.with(|z| {
        let mut z = z.borrow_mut();
        if z.len() >= MAX_ZONES {
            return 0;
        }
        z.push(Zone {
            rect: [x0, z0, x1, z1],
            material: texture(token),
        });
        1
    })
}
#[no_mangle]
pub extern "C" fn ma_surface(map: u32, kind: i32, ground: u32, x: f64, y: f64, z: f64) -> u32 {
    surface(map, kind, ground, x, y, z)
}
#[no_mangle]
pub extern "C" fn ma_mix(
    kind: u32,
    sx: f64,
    sy: f64,
    sz: f64,
    lx: f64,
    ly: f64,
    lz: f64,
    yaw: f64,
    pitch: f64,
    range: f64,
    blocked: f64,
    teammate: u32,
    material: u32,
) {
    OUT.with(|o| {
        *o.borrow_mut() = mix(
            kind,
            [sx, sy, sz],
            [lx, ly, lz],
            yaw,
            pitch,
            range,
            blocked,
            teammate != 0,
            material,
        )
    });
}
#[no_mangle]
pub extern "C" fn ma_probe(index: u32, sx: f64, sy: f64, sz: f64, lx: f64, ly: f64, lz: f64) {
    if index > 2 || ![sx, sy, sz, lx, ly, lz].iter().all(|v| finite(*v)) {
        write(&[]);
        return;
    }
    let dx = sx - lx;
    let dz = sz - lz;
    let horizontal = (dx * dx + dz * dz).sqrt();
    let side = match index {
        1 => 0.18,
        2 => -0.18,
        _ => 0.,
    };
    let (ox, oz) = if horizontal > 1e-9 {
        (-dz / horizontal * side, dx / horizontal * side)
    } else {
        (side, 0.)
    };
    write(&[lx, ly, lz, sx + ox, sy, sz + oz]);
}
#[no_mangle]
pub extern "C" fn ma_up(yaw: f64, pitch: f64, roll: f64) {
    if !finite(yaw) || !finite(pitch) || !finite(roll) {
        write(&[0., 1., 0.]);
        return;
    }
    let y = yaw.to_radians();
    let p = pitch.to_radians();
    let r = roll.to_radians();
    write(&[
        -y.sin() * p.sin() * r.cos() - y.cos() * r.sin(),
        p.cos() * r.cos(),
        y.cos() * p.sin() * r.cos() - y.sin() * r.sin(),
    ]);
}
#[no_mangle]
pub extern "C" fn ma_reach(noise_range: f64) -> f64 {
    if noise_range.is_finite() && noise_range > 0. {
        noise_range.min(80.) * 1.6 + 2.
    } else {
        0.
    }
}
#[no_mangle]
pub extern "C" fn ma_steps_clear() {
    STEPS.with(|s| s.borrow_mut().clear());
}
// Presentation cadence only: no AI hearing, game events, movement, or damage is changed.
#[no_mangle]
pub extern "C" fn ma_step(
    id: u32,
    time: f64,
    x: f64,
    y: f64,
    z: f64,
    alive: u32,
    crouch: f64,
) -> f64 {
    if ![time, x, y, z, crouch].iter().all(|v| finite(*v)) {
        return 0.;
    }
    STEPS.with(|s| {
        let mut states = s.borrow_mut();
        let index = if let Some(i) = states.iter().position(|s| s.id == id) {
            i
        } else {
            let new = Step {
                id,
                time,
                x,
                y,
                z,
                travel: 0.,
            };
            if states.len() < 64 {
                states.push(new);
            } else {
                let i = states
                    .iter()
                    .enumerate()
                    .min_by(|a, b| a.1.time.total_cmp(&b.1.time))
                    .map(|x| x.0)
                    .unwrap_or(0);
                states[i] = new;
            }
            return 0.;
        };
        let old = states[index];
        let dt = time - old.time;
        if dt == 0. {
            return 0.;
        }
        let dx = x - old.x;
        let dz = z - old.z;
        let distance = (dx * dx + dz * dz).sqrt();
        let speed = distance / dt;
        let mut next = Step {
            id,
            time,
            x,
            y,
            z,
            travel: old.travel + distance,
        };
        if alive == 0
            || dt < 0.
            || dt > 0.5
            || speed > 12.
            || (y - old.y).abs() > 0.5
            || speed < 0.8
        {
            next.travel = 0.;
            states[index] = next;
            return 0.;
        }
        let stride = if speed > 4.2 { 1.6 } else { 1.1 };
        let emit = next.travel >= stride;
        if emit {
            next.travel %= stride;
        }
        states[index] = next;
        if !emit {
            0.
        } else if crouch > 0.5 {
            3.
        } else if speed > 4.2 {
            16.
        } else if speed > 2.2 {
            8.
        } else {
            3.
        }
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn m(d: f64, b: f64) -> [f64; LEN] {
        mix(0, [d, 0., 0.], [0.; 3], 0., 0., 80., b, false, 1)
    }
    #[test]
    fn distance_attenuation_is_monotonic_and_silent_at_limit() {
        let mut previous = 1.1;
        for i in 0..100 {
            let o = m(i as f64, 0.);
            assert!(o[1] <= previous);
            previous = o[1];
        }
        assert_eq!(m(80., 0.)[1], 0.);
    }
    #[test]
    fn walls_reduce_gain_and_high_frequencies() {
        let clear = m(10., 0.);
        let partial = m(10., 1. / 3.);
        let wall = m(10., 1.);
        assert!(clear[1] > partial[1] && partial[1] > wall[1]);
        assert!(clear[2] > partial[2] && partial[2] > wall[2]);
    }
    #[test]
    fn orientation_and_elevation() {
        let right = m(10., 0.);
        assert_eq!(right[3], 1.);
        let above = mix(0, [0., 10., 0.], [0.; 3], 90., 30., 80., 0., false, 1);
        assert_eq!(above[0], 10.);
        assert_eq!(above[3], 0.);
        assert!((above[7] - 30_f64.to_radians().cos()).abs() < 1e-10);
        assert!((above[8] - 0.5).abs() < 1e-10);
    }
    #[test]
    fn equal_distance_front_rear_no_fake_volume_boost() {
        let a = mix(0, [0., 0., -10.], [0.; 3], 0., 0., 80., 0., false, 1);
        let b = mix(0, [0., 0., 10.], [0.; 3], 0., 0., 80., 0., false, 1);
        assert_eq!(a[1], b[1]);
    }
    #[test]
    fn invalid_input_is_finite_and_silent() {
        for v in [f64::NAN, f64::INFINITY, 1e100] {
            let o = m(v, 0.);
            assert!(o.iter().all(|x| x.is_finite()));
            assert_eq!(o[1], 0.);
        }
    }
    #[test]
    fn bad_ranges_do_not_create_sound() {
        for v in [f64::NAN, f64::INFINITY, -1., 0.] {
            assert_eq!(mix(0, [0.; 3], [0.; 3], 0., 0., v, 0., false, 1)[1], 0.);
        }
    }
    #[test]
    fn soft_materials_are_quieter_and_distinct() {
        let g = |s| mix(1, [1., 0., 0.], [0.; 3], 0., 0., 20., 0., false, s);
        assert!(g(4)[1] < g(1)[1]);
        assert!(g(5)[1] < g(3)[1]);
        assert_ne!(g(2)[10], g(3)[10]);
        assert_ne!(g(5)[10], g(4)[10]);
    }
    #[test]
    fn teammates_quieter_not_louder() {
        let a = mix(1, [2., 0., 0.], [0.; 3], 0., 0., 20., 0., false, 1);
        let b = mix(1, [2., 0., 0.], [0.; 3], 0., 0., 20., 0., true, 1);
        assert!((b[1] / a[1] - 0.45).abs() < 1e-10);
    }
    #[test]
    fn surface_rules_match_actual_map_materials() {
        ma_zones_clear();
        assert_eq!(surface(3, 2, 0, 0., 1.2, 0.), 3);
        assert_eq!(surface(0, 2, 0, 0., 1.2, 0.), 2);
        assert_eq!(surface(2, 8, 0, 0., 3.6, 0.), 4);
        assert_eq!(surface(2, 9, 0, 0., 2., 0.), 2);
        assert_eq!(surface(1, 3, 0, 0., 1., 0.), 5);
        assert_eq!(surface(1, -1, 0, 0., 1., 0.), 0);
    }
    #[test]
    fn floor_zones_are_ground_only_and_last_drawn_wins() {
        ma_zones_clear();
        assert_eq!(ma_zone(-2., -2., 2., 2., 2), 1);
        assert_eq!(ma_zone(-1., -1., 1., 1., 4), 1);
        assert_eq!(surface(4, 0, 6, 0., 0., 0.), 4);
        assert_eq!(surface(4, 0, 6, 1.5, 0., 0.), 2);
        assert_eq!(surface(4, 0, 6, 3., 0., 0.), 6);
        assert_ne!(surface(4, 0, 6, 0., 3., 0.), 4);
    }
    #[test]
    fn bounded_zone_input() {
        ma_zones_clear();
        assert_eq!(ma_zone(2., 0., 1., 1., 2), 0);
        assert_eq!(ma_zone(0., 0., 1., 1., 99), 0);
        for _ in 0..MAX_ZONES {
            assert_eq!(ma_zone(0., 0., 1., 1., 2), 1);
        }
        assert_eq!(ma_zone(0., 0., 1., 1., 2), 0);
    }
    #[test]
    fn probes_keep_real_heights() {
        ma_probe(0, 1., 5., 2., 0., 4., 0.);
        OUT.with(|o| assert_eq!(&o.borrow()[..6], &[0., 4., 0., 1., 5., 2.]));
        ma_probe(1, 0., 0., -10., 0., 1.6, 0.);
        OUT.with(|o| assert!((o.borrow()[3] - 0.18).abs() < 1e-10));
    }
    #[test]
    fn up_vector_is_unit_and_orthogonal() {
        for y in [0., 90., 180.] {
            for p in [-80., 0., 80.] {
                let v = mix(0, [0.; 3], [0.; 3], y, p, 1., 0., false, 1);
                ma_up(y, p, 0.);
                OUT.with(|o| {
                    let u = o.borrow();
                    assert!((u[0] * v[7] + u[1] * v[8] + u[2] * v[9]).abs() < 1e-10);
                    assert!((u[0] * u[0] + u[1] * u[1] + u[2] * u[2] - 1.).abs() < 1e-10);
                });
            }
        }
    }
    #[test]
    fn footsteps_require_real_travel_and_skip_teleports() {
        ma_steps_clear();
        assert_eq!(ma_step(1, 0., 0., 0., 0., 1, 0.), 0.);
        let mut count = 0;
        for i in 1..=60 {
            if ma_step(1, i as f64 / 60., i as f64 / 20., 0., 0., 1, 0.) > 0. {
                count += 1;
            }
        }
        assert_eq!(count, 2);
        assert_eq!(ma_step(1, 1.1, 99., 0., 0., 1, 0.), 0.);
        assert_eq!(ma_step(1, 1.2, 99., 0., 0., 0, 0.), 0.);
    }
    #[test]
    fn repeated_timestamps_do_not_create_footsteps() {
        ma_steps_clear();
        ma_step(2, 1., 0., 0., 0., 1, 0.);
        for _ in 0..20 {
            assert_eq!(ma_step(2, 1., 10., 0., 0., 1, 0.), 0.);
        }
    }
    #[test]
    fn silence_on_first_seen_actor_and_bounded_population() {
        ma_steps_clear();
        for i in 0..1000 {
            assert_eq!(ma_step(i, 1., 0., 0., 0., 1, 0.), 0.);
        }
        STEPS.with(|s| assert_eq!(s.borrow().len(), 64));
    }
    #[test]
    fn crouching_is_quiet_even_with_fast_network_motion() {
        ma_steps_clear();
        ma_step(3, 0., 0., 0., 0., 1, 1.);
        let mut emitted = 0.;
        for i in 1..20 {
            let r = ma_step(3, i as f64 / 30., i as f64 * 0.2, 0., 0., 1, 1.);
            if r > 0. {
                emitted = r;
            }
        }
        assert_eq!(emitted, 3.);
    }
    #[test]
    fn engine_silence_is_not_promoted_to_audible_steps() {
        assert_eq!(ma_reach(0.), 0.);
        assert_eq!(ma_reach(-1.), 0.);
        assert_eq!(ma_reach(f64::NAN), 0.);
        assert_eq!(ma_reach(8.), 14.8);
    }
    #[test]
    fn material_gains_are_normalized() {
        for material in 0..20 {
            let o = mix(1, [0.; 3], [0.; 3], 0., 0., 20., 0., false, material);
            assert!((0.0..=1.0).contains(&o[1]));
        }
    }
}
