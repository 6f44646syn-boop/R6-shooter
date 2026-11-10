//! Recoil Range game core, compiled to WebAssembly (and natively for `cargo test`).
//!
//! The browser side (js/wasm/core.js) talks to this through plain C-style functions and one
//! shared buffer of 64-bit floats: no generated glue, no dependencies. A map lives here as a
//! `World`; JavaScript holds a small integer handle to it.

pub mod geom;
pub mod nav;
pub mod world;

use geom::Solid;
use world::World;

/// Bumped whenever the functions below change, so the loader can refuse a stale .wasm.
const ABI: u32 = 1;
const BUF_LEN: usize = 1 << 16;

struct State {
    worlds: Vec<Option<World>>,
    buf: Vec<f64>,
    hit: i32,
    path: Vec<[f64; 2]>,
}

static mut STATE: *mut State = core::ptr::null_mut();

// The module runs on one thread (the page's, or Node's): one mutable state is safe.
fn st() -> &'static mut State {
    unsafe {
        if STATE.is_null() {
            STATE = Box::into_raw(Box::new(State { worlds: Vec::new(), buf: vec![0.0; BUF_LEN], hit: -1, path: Vec::new() }));
        }
        &mut *STATE
    }
}
fn world(id: u32) -> Option<&'static mut World> {
    st().worlds.get_mut(id as usize).and_then(|w| w.as_mut())
}

#[no_mangle]
pub extern "C" fn rc_abi() -> u32 {
    ABI
}
/// The shared buffer: arguments too big for registers go in, results come out.
#[no_mangle]
pub extern "C" fn rc_buf() -> *mut f64 {
    st().buf.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn rc_buf_len() -> u32 {
    BUF_LEN as u32
}

/// A new, empty world of half sizes hx, hz. Returns its handle.
#[no_mangle]
pub extern "C" fn rc_world_new(hx: f64, hz: f64) -> u32 {
    let s = st();
    let w = World::new(hx, hz);
    if let Some(i) = s.worlds.iter().position(|x| x.is_none()) {
        s.worlds[i] = Some(w);
        return i as u32;
    }
    s.worlds.push(Some(w));
    (s.worlds.len() - 1) as u32
}
#[no_mangle]
pub extern "C" fn rc_world_free(id: u32) {
    let s = st();
    if (id as usize) < s.worlds.len() {
        s.worlds[id as usize] = None;
    }
}
/// How many worlds are alive (leak checks).
#[no_mangle]
pub extern "C" fn rc_world_count() -> u32 {
    st().worlds.iter().filter(|w| w.is_some()).count() as u32
}
/// Append n solids from the buffer: 8 numbers each (minX, maxX, minY, maxY, minZ, maxZ, kind, alive).
#[no_mangle]
pub extern "C" fn rc_world_add_solids(id: u32, n: u32) {
    let s = st();
    let n = (n as usize).min(BUF_LEN / 8);
    if let Some(Some(w)) = s.worlds.get_mut(id as usize) {
        for k in 0..n {
            let b = &s.buf[k * 8..k * 8 + 8];
            w.solids.push(Solid { min_x: b[0], max_x: b[1], min_y: b[2], max_y: b[3], min_z: b[4], max_z: b[5], kind: b[6] as u8, alive: b[7] != 0.0 });
        }
    }
}
/// Build the grid. Call after the last rc_world_add_solids.
#[no_mangle]
pub extern "C" fn rc_world_build(id: u32) {
    if let Some(w) = world(id) {
        w.build();
    }
}
#[no_mangle]
pub extern "C" fn rc_set_alive(id: u32, solid: u32, alive: u32) {
    if let Some(w) = world(id) {
        if let Some(b) = w.solids.get_mut(solid as usize) {
            b.alive = alive != 0;
        }
    }
}
/// Waypoints: n (x, z) pairs from the buffer; `first` != 0 starts a new list.
#[no_mangle]
pub extern "C" fn rc_nav_nodes(id: u32, n: u32, first: u32) {
    let s = st();
    let n = (n as usize).min(BUF_LEN / 2);
    if let Some(Some(w)) = s.worlds.get_mut(id as usize) {
        let mut nodes = if first != 0 { Vec::new() } else { core::mem::take(&mut w.nav.nodes) };
        for k in 0..n {
            nodes.push([s.buf[k * 2], s.buf[k * 2 + 1]]);
        }
        w.nav.set_nodes(nodes);
    }
}
/// Links between waypoints: n (a, b) index pairs from the buffer.
#[no_mangle]
pub extern "C" fn rc_nav_links(id: u32, n: u32) {
    let s = st();
    let n = (n as usize).min(BUF_LEN / 2);
    if let Some(Some(w)) = s.worlds.get_mut(id as usize) {
        for k in 0..n {
            w.nav.add_link(s.buf[k * 2] as u32, s.buf[k * 2 + 1] as u32);
        }
    }
}

/// Push a circle out of the solids. Result (x, z) in buf[0..2].
#[no_mangle]
pub extern "C" fn rc_resolve(id: u32, x: f64, z: f64, r: f64, flyer: u32) {
    let p = match world(id) {
        Some(w) => w.resolve(x, z, r, flyer != 0),
        None => (x, z),
    };
    let s = st();
    s.buf[0] = p.0;
    s.buf[1] = p.1;
}
/// Move a circle by (dx, dz) without tunnelling. Result (x, z) in buf[0..2].
#[no_mangle]
pub extern "C" fn rc_move(id: u32, x: f64, z: f64, dx: f64, dz: f64, r: f64, flyer: u32) {
    let p = match world(id) {
        Some(w) => w.move_circle(x, z, dx, dz, r, flyer != 0),
        None => (x + dx, z + dz),
    };
    let s = st();
    s.buf[0] = p.0;
    s.buf[1] = p.1;
}
#[no_mangle]
pub extern "C" fn rc_free(id: u32, x: f64, z: f64, r: f64) -> u32 {
    world(id).map_or(0, |w| w.free(x, z, r) as u32)
}
#[no_mangle]
pub extern "C" fn rc_walk_clear(id: u32, ax: f64, az: f64, bx: f64, bz: f64, r: f64) -> u32 {
    world(id).map_or(0, |w| w.walk_clear(ax, az, bx, bz, r) as u32)
}
/// Raycast. Returns the hit distance, or -1 for no hit; rc_hit() then says what was hit
/// (a solid index, or -2 for the floor).
#[no_mangle]
pub extern "C" fn rc_raycast(id: u32, ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64, max_t: f64) -> f64 {
    let (t, hit) = match world(id) {
        Some(w) => w.raycast(&[ox, oy, oz], &[dx, dy, dz], max_t),
        None => (max_t, world::HIT_NONE),
    };
    st().hit = hit;
    if hit == world::HIT_NONE {
        -1.0
    } else {
        t
    }
}
#[no_mangle]
pub extern "C" fn rc_hit() -> i32 {
    st().hit
}
#[no_mangle]
pub extern "C" fn rc_sight(id: u32, ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64) -> u32 {
    world(id).map_or(1, |w| w.sight(&[ax, ay, az], &[bx, by, bz]) as u32)
}
/// Live solids near a point: returns how many; their indices are in the buffer.
#[no_mangle]
pub extern "C" fn rc_near(id: u32, x: f64, z: f64, r: f64) -> u32 {
    let s = st();
    if let Some(Some(w)) = s.worlds.get_mut(id as usize) {
        let list = w.near(x, z, r);
        let n = list.len().min(BUF_LEN);
        for k in 0..n {
            s.buf[k] = list[k] as f64;
        }
        w.recycle(list);
        return n as u32;
    }
    0
}
#[no_mangle]
pub extern "C" fn rc_door_on(id: u32, ax: f64, az: f64, bx: f64, bz: f64, r: f64) -> i32 {
    world(id).map_or(-1, |w| w.door_on(ax, az, bx, bz, r))
}
#[no_mangle]
pub extern "C" fn rc_nearest_node(id: u32, x: f64, z: f64, need_sight: u32) -> i32 {
    world(id).map_or(-1, |w| w.nearest_node(x, z, need_sight != 0))
}
/// A path from a to b: returns the number of points; (x, z) pairs are in the buffer.
#[no_mangle]
pub extern "C" fn rc_path(id: u32, ax: f64, az: f64, bx: f64, bz: f64) -> u32 {
    let s = st();
    let mut out = core::mem::take(&mut s.path);
    if let Some(Some(w)) = s.worlds.get_mut(id as usize) {
        w.path(ax, az, bx, bz, &mut out);
    } else {
        out.clear();
    }
    let n = out.len().min(BUF_LEN / 2);
    for k in 0..n {
        s.buf[k * 2] = out[k][0];
        s.buf[k * 2 + 1] = out[k][1];
    }
    s.path = out;
    n as u32
}
