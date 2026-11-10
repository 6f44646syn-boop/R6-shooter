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
const ABI: u32 = 4;
const BUF_LEN: usize = 1 << 16;

struct State {
    worlds: Vec<Option<World>>,
    buf: Vec<f64>,
    hit: i32,
    axis: i32,
    path: Vec<[f64; 4]>,
}

static mut STATE: *mut State = core::ptr::null_mut();

// The module runs on one thread (the page's, or Node's): one mutable state is safe.
fn st() -> &'static mut State {
    unsafe {
        if STATE.is_null() {
            STATE = Box::into_raw(Box::new(State { worlds: Vec::new(), buf: vec![0.0; BUF_LEN], hit: -1, axis: 1, path: Vec::new() }));
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

/// A new, empty world of half sizes hx, hz, with walls wall_h high and a ceiling at `ceil`
/// (0: open sky). Returns its handle.
#[no_mangle]
pub extern "C" fn rc_world_new(hx: f64, hz: f64, wall_h: f64, ceil: f64) -> u32 {
    let s = st();
    let w = World::new(hx, hz, wall_h, ceil);
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
/// kind: 0 solid, 1 boarded door, 2 breakable wall panel.
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
/// Append n hazard areas (acid) from the buffer: 4 numbers each (minX, maxX, minZ, maxZ).
#[no_mangle]
pub extern "C" fn rc_world_add_hazards(id: u32, n: u32) {
    let s = st();
    let n = (n as usize).min(BUF_LEN / 4);
    if let Some(Some(w)) = s.worlds.get_mut(id as usize) {
        for k in 0..n {
            w.hazards.push([s.buf[k * 4], s.buf[k * 4 + 1], s.buf[k * 4 + 2], s.buf[k * 4 + 3]]);
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
/// Build the navigation nodes for a body of radius body_r. Returns how many there are.
#[no_mangle]
pub extern "C" fn rc_nav_build(id: u32, body_r: f64) -> u32 {
    world(id).map_or(0, |w| {
        w.nav_build(body_r);
        w.nav.len() as u32
    })
}
/// Off: the nearest node is found exactly as the JavaScript reference did (parity tests).
#[no_mangle]
pub extern "C" fn rc_nav_careful(id: u32, on: u32) {
    if let Some(w) = world(id) {
        w.nav.careful = on != 0;
    }
}
/// Off: no vault links (parity tests). Call before rc_nav_build.
#[no_mangle]
pub extern "C" fn rc_nav_vaults(id: u32, on: u32) {
    if let Some(w) = world(id) {
        w.nav.vaults = on != 0;
    }
}
#[no_mangle]
pub extern "C" fn rc_nav_vault_count(id: u32) -> u32 {
    world(id).map_or(0, |w| w.nav_vault_count() as u32)
}
#[no_mangle]
pub extern "C" fn rc_nav_count(id: u32) -> u32 {
    world(id).map_or(0, |w| w.nav.len() as u32)
}
/// Copy up to n nodes starting at `from` into the buffer: (x, z, y, open) each. Returns how many.
#[no_mangle]
pub extern "C" fn rc_nav_nodes(id: u32, from: u32, n: u32) -> u32 {
    let s = st();
    if let Some(Some(w)) = s.worlds.get_mut(id as usize) {
        let from = from as usize;
        let n = (n as usize).min(BUF_LEN / 4).min(w.nav.len().saturating_sub(from));
        for k in 0..n {
            s.buf[k * 4] = w.nav.x[from + k] as f64;
            s.buf[k * 4 + 1] = w.nav.z[from + k] as f64;
            s.buf[k * 4 + 2] = w.nav.y[from + k] as f64;
            s.buf[k * 4 + 3] = if w.nav.open(from + k) { 1.0 } else { 0.0 };
        }
        return n as u32;
    }
    0
}
#[no_mangle]
pub extern "C" fn rc_set_alive(id: u32, solid: u32, alive: u32) {
    if let Some(w) = world(id) {
        let was = match w.solids.get_mut(solid as usize) {
            Some(b) => {
                let was = b.alive;
                b.alive = alive != 0;
                was
            }
            None => return,
        };
        w.nav_set_alive(solid, was, alive != 0);
    }
}

/// The height of what is underfoot at (x, z) for feet near y (a drone's with flyer != 0).
#[no_mangle]
pub extern "C" fn rc_ground(id: u32, x: f64, z: f64, y: f64, flyer: u32) -> f64 {
    world(id).map_or(0.0, |w| w.ground_step(x, z, y, if flyer != 0 { world::FLY_STEP } else { world::STEP }))
}
/// Push a circle with feet at y out of the solids. Result (x, z) in buf[0..2].
#[no_mangle]
pub extern "C" fn rc_resolve(id: u32, x: f64, y: f64, z: f64, r: f64, flyer: u32) {
    let p = match world(id) {
        Some(w) => w.resolve(x, y, z, r, flyer != 0),
        None => (x, z),
    };
    let s = st();
    s.buf[0] = p.0;
    s.buf[1] = p.1;
}
/// Move a circle by (dx, dz) without tunnelling, stepping up. Result (x, y, z) in buf[0..3].
#[no_mangle]
pub extern "C" fn rc_move(id: u32, x: f64, y: f64, z: f64, dx: f64, dz: f64, r: f64, flyer: u32) {
    let p = match world(id) {
        Some(w) => w.move_circle(x, y, z, dx, dz, r, flyer != 0),
        None => (x + dx, y, z + dz),
    };
    let s = st();
    s.buf[0] = p.0;
    s.buf[1] = p.1;
    s.buf[2] = p.2;
}
/// One step of a body: move, step up, stand or fall. Result (x, y, z, vy, on ground) in buf[0..5].
#[no_mangle]
pub extern "C" fn rc_step_body(id: u32, x: f64, y: f64, z: f64, vy: f64, dx: f64, dz: f64, r: f64, dt: f64, flyer: u32) {
    let p = match world(id) {
        Some(w) => w.step_body(x, y, z, vy, dx, dz, r, dt, flyer != 0),
        None => (x + dx, y, z + dz, vy, true),
    };
    let s = st();
    s.buf[0] = p.0;
    s.buf[1] = p.1;
    s.buf[2] = p.2;
    s.buf[3] = p.3;
    s.buf[4] = if p.4 { 1.0 } else { 0.0 };
}
#[no_mangle]
pub extern "C" fn rc_free(id: u32, x: f64, y: f64, z: f64, r: f64) -> u32 {
    world(id).map_or(0, |w| w.free(x, y, z, r) as u32)
}
#[no_mangle]
pub extern "C" fn rc_walk_clear(id: u32, ax: f64, az: f64, bx: f64, bz: f64, r: f64, y: f64) -> u32 {
    world(id).map_or(0, |w| w.walk_clear(ax, az, bx, bz, r, y) as u32)
}
/// Vault or climb from (x, y, z) facing (dx, dz). Returns 1 with the landing spot and the
/// top crossed (x, y, z, top) in buf[0..4], or 0.
#[no_mangle]
pub extern "C" fn rc_vault(id: u32, x: f64, y: f64, z: f64, dx: f64, dz: f64, r: f64) -> u32 {
    match world(id).and_then(|w| w.vault_target(x, y, z, dx, dz, r)) {
        Some(p) => {
            let s = st();
            s.buf[0] = p.0;
            s.buf[1] = p.1;
            s.buf[2] = p.2;
            s.buf[3] = p.3;
            1
        }
        None => 0,
    }
}
/// Raycast. Returns the hit distance, or -1 for no hit; rc_hit() then says what was hit
/// (a solid index, -2 for the floor, -3 for the ceiling) and rc_hit_axis() which way the
/// face looks (0 x, 1 y, 2 z).
#[no_mangle]
pub extern "C" fn rc_raycast(id: u32, ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64, max_t: f64) -> f64 {
    let (t, hit, axis) = match world(id) {
        Some(w) => {
            let (t, hit) = w.raycast(&[ox, oy, oz], &[dx, dy, dz], max_t);
            (t, hit, w.hit_axis)
        }
        None => (max_t, world::HIT_NONE, 1),
    };
    let s = st();
    s.hit = hit;
    s.axis = axis;
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
pub extern "C" fn rc_hit_axis() -> i32 {
    st().axis
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
pub extern "C" fn rc_door_on(id: u32, ax: f64, az: f64, bx: f64, bz: f64, r: f64, y: f64) -> i32 {
    world(id).map_or(-1, |w| w.door_on(ax, az, bx, bz, r, y))
}
/// The node you stand on at (x, z) with feet near y, or -1.
#[no_mangle]
pub extern "C" fn rc_node_at(id: u32, x: f64, z: f64, y: f64) -> i32 {
    world(id).map_or(-1, |w| w.node_at(x, z, y))
}
/// The zone (the building Bomb's defenders stay in): n rectangles from the buffer, 4 numbers
/// each (x0, z0, x1, z1).
#[no_mangle]
pub extern "C" fn rc_nav_zone(id: u32, n: u32) {
    let s = st();
    let n = (n as usize).min(BUF_LEN / 4);
    if let Some(Some(w)) = s.worlds.get_mut(id as usize) {
        let rects: Vec<[f64; 4]> = (0..n).map(|k| [s.buf[k * 4], s.buf[k * 4 + 1], s.buf[k * 4 + 2], s.buf[k * 4 + 3]]).collect();
        w.nav.set_zone(&rects);
    }
}
/// The node to path from or to for a point (see CellNav), or -1.
#[no_mangle]
pub extern "C" fn rc_nearest_node(id: u32, x: f64, z: f64, y: f64) -> i32 {
    world(id).map_or(-1, |w| w.nearest_node(x, z, y))
}
/// Can a body walk straight from a to b, stepping up and dropping down as it goes?
#[no_mangle]
pub extern "C" fn rc_clear_walk(id: u32, ax: f64, az: f64, ay: f64, bx: f64, bz: f64, by: f64) -> u32 {
    world(id).map_or(0, |w| w.clear_walk(&[ax, az, ay], &[bx, bz, by]) as u32)
}
/// A path from a to b: returns the number of points; (x, z, y, vault) per point are in the
/// buffer (vault 1: vault from this point to the next). flags: 1 only through the zone
/// (rc_nav_zone), 2 standing doors are closed.
#[no_mangle]
pub extern "C" fn rc_path(id: u32, ax: f64, az: f64, ay: f64, bx: f64, bz: f64, by: f64, flags: u32) -> u32 {
    let s = st();
    let mut out = core::mem::take(&mut s.path);
    if let Some(Some(w)) = s.worlds.get_mut(id as usize) {
        w.find_path_in(ax, az, ay, bx, bz, by, flags, &mut out);
    } else {
        out.clear();
    }
    let n = out.len().min(BUF_LEN / 4);
    for k in 0..n {
        s.buf[k * 4] = out[k][0];
        s.buf[k * 4 + 1] = out[k][1];
        s.buf[k * 4 + 2] = out[k][2];
        s.buf[k * 4 + 3] = out[k][3];
    }
    s.path = out;
    n as u32
}
