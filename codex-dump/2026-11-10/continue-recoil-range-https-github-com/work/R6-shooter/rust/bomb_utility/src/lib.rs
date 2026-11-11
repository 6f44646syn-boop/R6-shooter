//! User-approved Bomb utility policy. No player, weapon, map or AI state.
//! ABI field order: reinforce seconds, barricade seconds, barricade HP,
//! wire bullet hits, wire movement multiplier, action-phase seconds, reinforcement placement reach.
const BASELINE: [f64; 7] = [2.5, 1.5, 100., 3., 0.4, 150., 1.6];
const BOMB: [f64; 7] = [2.5, 1.5, 150., 4., 0.35, 120., 1.8];

#[no_mangle]
pub extern "C" fn bu_abi() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn bu_value(bomb: u32, field: u32) -> f64 {
    let values = if bomb == 1 { &BOMB } else { &BASELINE };
    values.get(field as usize).copied().unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn other_modes_keep_the_original_policy() {
        for mode in [0, 2, u32::MAX] {
            for i in 0..7 {
                assert_eq!(bu_value(mode, i), BASELINE[i as usize]);
            }
        }
    }
    #[test]
    fn utility_is_stronger_without_removing_counterplay() {
        assert_eq!(BOMB[0], BASELINE[0]);
        assert_eq!(BOMB[1], BASELINE[1]);
        assert!(BOMB[6] > BASELINE[6] && BOMB[6] < 2.);
        assert!(BOMB[2] > BASELINE[2] && BOMB[2] <= 150.);
        assert_eq!(BOMB[3], 4.);
        assert!(BOMB[4] > 0. && BOMB[4] < BASELINE[4]);
    }
    #[test]
    fn attack_clock_is_two_minutes() {
        assert_eq!(bu_value(1, 5), 120.);
    }
    #[test]
    fn invalid_fields_are_rejected_by_the_adapter() {
        assert!(bu_value(1, 7).is_nan());
        assert!(bu_value(0, u32::MAX).is_nan());
    }
}

// Sparse overrides: NaN means retain the supplied data value. Damage and charges
// are deliberately absent, including in other modes.
#[no_mangle]
pub extern "C" fn bu_ability(bomb: u32, ability: u32, field: u32) -> f64 {
    if bomb != 1 {
        return f64::NAN;
    }
    match (ability, field) {
        (0, 0) | (1, 0) => 2.5, // mine trigger radius
        (0, 1) | (1, 1) => 4.5, // mine effect radius
        (0, 2) | (0, 3) => 5.,  // jolt slow / wobble duration
        (1, 2) | (1, 3) => 7.,  // dread shake / reveal duration
        (1, 4) => 6.,
        (1, 5) => 3.5, // dread cloud time / radius
        (2, 0) => 10., // jammer radius
        (3, 0) => 6.,
        (3, 1) => 8., // catcher radius / recharge
        (4, 0) => 6.5,
        (4, 1) => 2.5,
        (4, 2) => 8., // dash reach / stun / recharge
        _ => f64::NAN,
    }
}

// Flags: jolt=1, dread=2, jammer=4, stun=8. Strongest channel wins;
// overlapping abilities never multiply into silence or a fully black screen.
#[no_mangle]
pub extern "C" fn bu_sensory(bomb: u32, flags: u32, channel: u32) -> f64 {
    let (mut gain, mut cutoff, mut veil): (f64, f64, f64) = (1., 22000., 0.);
    if bomb == 1 {
        for (bit, g, hz, v) in [
            (1, 0.8, 3500., 0.3),
            (2, 0.65, 2400., 0.65),
            (4, 0.55, 1600., 0.4),
            (8, 0.65, 2500., 0.5),
        ] {
            if flags & bit != 0 {
                gain = gain.min(g);
                cutoff = cutoff.min(hz);
                veil = veil.max(v);
            }
        }
    }
    match channel {
        0 => gain,
        1 => cutoff,
        2 => veil,
        _ => f64::NAN,
    }
}

#[cfg(test)]
mod effects_tests {
    use super::*;
    #[test]
    fn no_overrides_outside_bomb_or_for_unknown_ability_fields() {
        for id in 0..5 {
            for field in 0..6 {
                assert!(bu_ability(0, id, field).is_nan());
            }
        }
        assert!(bu_ability(1, 5, 0).is_nan());
        assert!(bu_ability(1, 0, 99).is_nan());
    }
    #[test]
    fn sensory_effects_are_bounded_for_every_flag_combination() {
        for flags in 0..32 {
            assert!((0.55..=1.).contains(&bu_sensory(1, flags, 0)));
            assert!((1600.0..=22000.).contains(&bu_sensory(1, flags, 1)));
            assert!((0.0..=0.65).contains(&bu_sensory(1, flags, 2)));
            assert_eq!(bu_sensory(0, flags, 0), 1.);
            assert_eq!(bu_sensory(0, flags, 2), 0.);
        }
        assert_eq!(bu_sensory(1, 0, 0), 1.);
        assert_eq!(bu_sensory(1, 0, 2), 0.);
    }
}
