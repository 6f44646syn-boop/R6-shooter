//! Weapon attachment policy (Milestone 8). Engine-owned: player weapons, bots and the
//! network host all take a gun's effective stats from here, so they always agree.
//!
//! Every gun's spray in data/guns.json was measured with certain attachments
//! (`measurement.attachments`). Effects are therefore applied *relative to the measured
//! loadout*: the measured loadout gives exactly the data file's numbers, and any other choice
//! scales them by product(chosen) / product(measured).
//!
//! Slots and ids (the browser adapter `js/core/loadout.js` holds the names):
//!   0 muzzle:      0 none, 1 flash hider, 2 compensator, 3 muzzle brake, 4 suppressor, 5 extended barrel
//!   1 grip:        0 none, 1 vertical grip, 2 angled grip
//!   2 underbarrel: 0 none, 1 laser
//!   3 magazine:    0 standard, 1 extended, 2 quick-change
//! Models: 0 rifle, 1 carbine, 2 smg, 3 lmg, 4 marksman.

pub const SLOTS: usize = 4;
pub const COUNTS: [u32; SLOTS] = [6, 3, 2, 3];

/// Effect fields, all multipliers (1 = no change).
/// 0 vertical recoil, 1 horizontal recoil, 2 recoil jitter, 3 aim-down-sights time,
/// 4 reload time, 5 magazine size, 6 damage, 7 hip-fire cone, 8 shot noise reach, 9 muzzle flash.
pub const FX: usize = 10;
const ONE: [f64; FX] = [1.; FX];

const MUZZLE: [[f64; FX]; 6] = [
    ONE,
    //  vert  horiz jit   ads   rel  mag  dmg   hip  noise flash
    [0.92, 0.92, 0.95, 1., 1., 1., 1., 1., 1., 0.45], // flash hider: a little of everything, small flash
    [1., 0.78, 0.90, 1., 1., 1., 1., 1., 1., 1.1],    // compensator: much less sideways
    [0.88, 1., 0.90, 1., 1., 1., 1., 1., 1.15, 1.2],  // muzzle brake: much less climb, louder
    [0.97, 0.97, 1., 1.05, 1., 1., 0.92, 1., 0.4, 0.], // suppressor: quiet, no flash, less damage
    [1., 0.95, 1., 1.06, 1., 1., 1.08, 1., 1., 0.8],  // extended barrel: more damage, slower to aim
];
const GRIP: [[f64; FX]; 3] = [
    ONE,
    [0.88, 1., 1., 1., 1., 1., 1., 1., 1., 1.], // vertical grip: less climb
    [1., 1., 1., 0.82, 1., 1., 1., 1., 1., 1.], // angled grip: faster aim
];
const UNDER: [[f64; FX]; 2] = [
    ONE,
    [1., 1., 1., 0.97, 1., 1., 1., 0.72, 1., 1.], // laser: tighter hip fire
];
const MAG: [[f64; FX]; 3] = [
    ONE,
    [1., 1., 1., 1.05, 1.15, 1.4, 1., 1., 1., 1.], // extended: 40% more rounds, slower reload and aim
    [1., 1., 1., 1., 0.78, 1., 1., 1., 1., 1.],    // quick-change: faster reload
];

fn table(slot: usize) -> &'static [[f64; FX]] {
    match slot {
        0 => &MUZZLE,
        1 => &GRIP,
        2 => &UNDER,
        _ => &MAG,
    }
}

/// Whether attachment `id` may go in `slot` on a gun of `model`.
pub fn allowed(model: u32, slot: u32, id: u32) -> bool {
    if slot as usize >= SLOTS || model > 4 || id >= COUNTS[slot as usize] {
        return false;
    }
    // An LMG's belt box is already large: no extended magazine.
    !(model == 3 && slot == 3 && id == 1)
}

/// Result of a loadout: effect multipliers, flags and the magazine size.
#[derive(Debug, Clone, PartialEq)]
pub struct Effective {
    pub fx: [f64; FX],
    pub mag_size: u32,
    pub suppressed: bool,
    pub laser: bool,
    pub valid: bool,
}

fn product(ids: &[u32; SLOTS]) -> [f64; FX] {
    let mut out = ONE;
    for (slot, &id) in ids.iter().enumerate() {
        let row = &table(slot)[id as usize];
        for i in 0..FX {
            out[i] *= row[i];
        }
    }
    out
}

/// measured: the loadout the data was measured with; chosen: the player's choice.
/// An invalid choice (unknown id or not allowed on this model) falls back to the measured
/// loadout, so the effective gun is exactly the data file's, and `valid` is false.
pub fn effective(model: u32, base_mag: u32, measured: [u32; SLOTS], chosen: [u32; SLOTS]) -> Effective {
    let ok_m = (0..SLOTS).all(|s| measured[s] < COUNTS[s]);
    let measured = if ok_m { measured } else { [0; SLOTS] };
    let valid = (0..SLOTS).all(|s| allowed(model, s as u32, chosen[s]));
    let chosen = if valid { chosen } else { measured };
    let a = product(&chosen);
    let b = product(&measured);
    let mut fx = ONE;
    for i in 0..FX {
        fx[i] = if b[i] > 0. { a[i] / b[i] } else { a[i] };
    }
    // Flash and noise: the suppressor's 0 must stay 0 whatever was measured.
    fx[9] = a[9];
    let mag_size = ((base_mag as f64) * fx[5]).round().clamp(1., 1000.) as u32;
    Effective { fx, mag_size, suppressed: chosen[0] == 4, laser: chosen[2] == 1, valid }
}

// ---- WASM ABI 1 ----
static mut OUT: [f64; 16] = [0.; 16];

#[no_mangle]
pub extern "C" fn lo_abi() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn lo_count(slot: u32) -> u32 {
    COUNTS.get(slot as usize).copied().unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn lo_allowed(model: u32, slot: u32, id: u32) -> u32 {
    allowed(model, slot, id) as u32
}

/// Computes the loadout; read the result with lo_out(i):
/// 0..9 the effect multipliers, 10 magazine size, 11 suppressed, 12 laser, 13 valid.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn lo_effective(model: u32, base_mag: u32, m0: u32, m1: u32, m2: u32, m3: u32, c0: u32, c1: u32, c2: u32, c3: u32) -> u32 {
    let e = effective(model, base_mag, [m0, m1, m2, m3], [c0, c1, c2, c3]);
    unsafe {
        let out = &mut *core::ptr::addr_of_mut!(OUT);
        out[..FX].copy_from_slice(&e.fx);
        out[10] = e.mag_size as f64;
        out[11] = e.suppressed as u32 as f64;
        out[12] = e.laser as u32 as f64;
        out[13] = e.valid as u32 as f64;
    }
    e.valid as u32
}

#[no_mangle]
pub extern "C" fn lo_out(i: u32) -> f64 {
    unsafe { (*core::ptr::addr_of!(OUT)).get(i as usize).copied().unwrap_or(f64::NAN) }
}

#[cfg(test)]
mod tests {
    use super::*;
    const FH_VG_LASER: [u32; 4] = [1, 1, 1, 0];

    #[test]
    fn measured_loadout_is_exactly_the_data() {
        let e = effective(0, 25, FH_VG_LASER, FH_VG_LASER);
        assert!(e.valid);
        for i in 0..9 {
            assert!((e.fx[i] - 1.).abs() < 1e-12, "field {i}");
        }
        assert_eq!(e.mag_size, 25);
    }
    #[test]
    fn removing_the_grip_adds_climb() {
        let e = effective(0, 25, FH_VG_LASER, [1, 0, 1, 0]);
        assert!((e.fx[0] - 1. / 0.88).abs() < 1e-12);
        assert_eq!(e.fx[1], 1.);
    }
    #[test]
    fn compensator_cuts_sideways_recoil() {
        let e = effective(2, 30, [0; 4], [2, 0, 0, 0]);
        assert!(e.fx[1] < 0.8 && e.fx[0] == 1.);
    }
    #[test]
    fn suppressor_is_quiet_without_flash_and_weaker() {
        let e = effective(0, 30, FH_VG_LASER, [4, 1, 1, 0]);
        assert!(e.suppressed && e.fx[9] == 0. && e.fx[8] < 0.5 && e.fx[6] < 1.);
    }
    #[test]
    fn extended_mag_holds_more_and_reloads_slower() {
        let e = effective(0, 30, [0; 4], [0, 0, 0, 1]);
        assert_eq!(e.mag_size, 42);
        assert!(e.fx[4] > 1. && e.fx[3] > 1.);
        let q = effective(0, 30, [0; 4], [0, 0, 0, 2]);
        assert_eq!(q.mag_size, 30);
        assert!(q.fx[4] < 1.);
    }
    #[test]
    fn lmg_cannot_take_an_extended_mag_and_falls_back() {
        assert!(!allowed(3, 3, 1));
        let e = effective(3, 50, [1, 1, 0, 0], [0, 0, 0, 1]);
        assert!(!e.valid);
        assert_eq!(e.mag_size, 50);
        for i in 0..9 {
            assert!((e.fx[i] - 1.).abs() < 1e-12);
        }
    }
    #[test]
    fn unknown_ids_are_rejected() {
        assert!(!allowed(0, 0, 6) && !allowed(0, 4, 0) && !allowed(5, 0, 0));
        assert_eq!(lo_effective(0, 30, 0, 0, 0, 0, 9, 0, 0, 0), 0);
        assert_eq!(lo_out(13), 0.);
        assert!(lo_out(99).is_nan());
    }
    #[test]
    fn laser_tightens_hip_fire() {
        let e = effective(2, 30, [0; 4], [0, 0, 1, 0]);
        assert!(e.laser && e.fx[7] < 0.8);
    }
}
