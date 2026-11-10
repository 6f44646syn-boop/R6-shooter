//! Independent controls ABI. No world, renderer, browser, or networking dependencies.
use std::cell::RefCell;
const N: usize = 24;
const DEFAULTS: [[u32; 2]; N] = [
    [128, 0], [130, 0], [23, 0], [19, 0], [1, 0], [4, 0], // fire, ADS, WASD
    [28, 29], [27, 0], [17, 131], [5, 132], // sprint, crouch, Q/E + mouse sides
    [129, 0], [6, 0], [18, 0], [3, 0], [7, 31], [11, 0], // ability, interact, reload, vault, grenade, knife
    [9, 0], [30, 0], [22, 0], [20, 0], [2, 0], // inspect, board, recall, drone zap, underbarrel
    [24, 0], [13, 0], [26, 0], // range reset, target cycle, debug zero
];
#[derive(Clone)]
struct Controls {
    bindings: [[u32; 2]; N], pressed: [bool; 256], active: [bool; N],
    toggle_ads: bool, gain: f64, ads_gain: f64, invert: bool,
}
impl Default for Controls {
    fn default() -> Self { Self { bindings: DEFAULTS, pressed: [false; 256], active: [false; N], toggle_ads: false, gain: 1., ads_gain: 1., invert: false } }
}
impl Controls {
    fn bind(&mut self, a: usize, slot: usize, code: u32) -> bool {
        if a >= N || slot > 1 || !valid(code) { return false; }
        if code != 0 && self.bindings.iter().enumerate().any(|(i,b)| b.iter().enumerate().any(|(j,&c)| c == code && (i != a || j != slot))) { return false; }
        self.bindings[a][slot] = code; true
    }
    fn event(&mut self, code: u32, down: bool) -> u32 {
        if code == 0 || !valid(code) || self.pressed[code as usize] == down { return 0; }
        self.pressed[code as usize] = down;
        let Some(a) = self.bindings.iter().position(|b| b.contains(&code)) else { return 0; };
        let next = if a == 1 && self.toggle_ads {
            if !down { return 0; } !self.active[a]
        } else { self.bindings[a].iter().any(|&c| c != 0 && self.pressed[c as usize]) };
        if self.active[a] == next { return 0; }
        self.active[a] = next;
        (a as u32 + 1) | if next { 256 } else { 0 }
    }
    fn release(&mut self) -> u32 {
        let mask = self.active.iter().enumerate().fold(0, |m,(i,&v)| m | if v {1 << i} else {0});
        self.pressed.fill(false); self.active.fill(false); mask
    }
}
fn valid(code: u32) -> bool { code == 0 || (1..=45).contains(&code) || (128..=132).contains(&code) }
fn bounded(v: f64, lo: f64, hi: f64) -> f64 { if v.is_finite() { v.clamp(lo,hi) } else { 1. } }
thread_local! { static STATE: RefCell<Controls> = RefCell::new(Controls::default()); }
#[no_mangle] pub extern "C" fn mc_abi() -> u32 { 1 }
#[no_mangle] pub extern "C" fn mc_count() -> u32 { N as u32 }
#[no_mangle] pub extern "C" fn mc_reset(profile: u32) {
    STATE.with(|s| { let mut c = Controls::default(); if profile == 1 { c.bindings[0] = [10,0]; c.bindings[1] = [12,0]; c.bindings[10] = [21,0]; } *s.borrow_mut() = c; });
}
#[no_mangle] pub extern "C" fn mc_bind(a: u32, slot: u32, code: u32) -> u32 { STATE.with(|s| s.borrow_mut().bind(a as usize,slot as usize,code) as u32) }
#[no_mangle] pub extern "C" fn mc_binding(a: u32, slot: u32) -> u32 { STATE.with(|s| s.borrow().bindings.get(a as usize).and_then(|b| b.get(slot as usize)).copied().unwrap_or(0)) }
#[no_mangle] pub extern "C" fn mc_event(code: u32, down: u32) -> u32 { STATE.with(|s| s.borrow_mut().event(code, down != 0)) }
#[no_mangle] pub extern "C" fn mc_release() -> u32 { STATE.with(|s| s.borrow_mut().release()) }
#[no_mangle] pub extern "C" fn mc_options(toggle: u32, gain: f64, ads: f64, invert: u32) {
    STATE.with(|s| { let mut c = s.borrow_mut(); c.toggle_ads = toggle != 0; c.gain = bounded(gain,0.1,4.); c.ads_gain = bounded(ads,0.1,2.); c.invert = invert != 0; });
}
#[no_mangle] pub extern "C" fn mc_look(delta: f64, ads: u32, vertical: u32) -> f64 {
    if !delta.is_finite() { return 0.; }
    STATE.with(|s| { let c = s.borrow(); delta * c.gain * if ads != 0 { c.ads_gain } else { 1. } * if vertical != 0 && c.invert { -1. } else { 1. } })
}
// No profile can enable competitive assistance. Server enforcement belongs to M9.
#[no_mangle] pub extern "C" fn mc_assist_allowed(training: u32, online: u32) -> u32 { (training == 1 && online == 0) as u32 }
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn defaults_preserve_leans() { let c=Controls::default(); assert_eq!(c.bindings[10][0],129); assert_eq!(c.bindings[8][0],17); assert_eq!(c.bindings[9][0],5); }
    #[test] fn hold_repeat_and_alias() { let mut c=Controls::default(); assert_eq!(c.event(17,true),265); assert_eq!(c.event(17,true),0); assert_eq!(c.event(131,true),0); assert_eq!(c.event(17,false),0); assert_eq!(c.event(131,false),9); }
    #[test] fn collisions_and_bounds() { let mut c=Controls::default(); assert!(!c.bind(10,0,17)); assert!(!c.bind(24,0,12)); assert!(!c.bind(0,2,12)); assert!(!c.bind(0,0,255)); assert!(c.bind(10,0,21)); assert_eq!(c.event(129,true),0); assert_eq!(c.event(21,true),267); }
    #[test] fn toggle_and_focus_release() { let mut c=Controls::default(); c.toggle_ads=true; assert_eq!(c.event(130,true),258); assert_eq!(c.event(130,false),0); assert_eq!(c.event(130,true),2); c.event(130,false); c.event(130,true); c.event(128,true); assert_eq!(c.release(),3); assert_eq!(c.release(),0); assert_eq!(c.event(128,true),257); }
    #[test] fn all_actions_release() { let mut c=Controls::default(); for b in DEFAULTS { c.event(b[0],true); } assert_eq!(c.release(),(1<<N)-1); }
    #[test] fn profiles_and_fairness() { mc_reset(1); assert_eq!(mc_binding(0,0),10); assert_eq!(mc_binding(10,0),21); for training in 0..3 { for online in 0..3 { assert_eq!(mc_assist_allowed(training,online),(training==1 && online==0) as u32); } } }
    #[test] fn sensitivity_validation() { mc_reset(0); mc_options(0,2.,0.5,1); assert_eq!(mc_look(10.,1,1),-10.); assert_eq!(mc_look(10.,0,0),20.); assert_eq!(mc_look(f64::NAN,0,0),0.); mc_options(0,f64::INFINITY,-9.,0); assert_eq!(mc_look(10.,1,0),1.); }
}
