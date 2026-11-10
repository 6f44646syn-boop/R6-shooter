// The only sound rules live in rust/m8_audio. This adapter serializes current map
// metadata, queries the existing Rust geometry, and reads acoustic parameters.
export const MAPS = [
  'yard',
  'winter',
  'casino',
  'school',
  'ranch',
  'embassy',
  'workshop',
  'depot',
  'range',
];
export const KINDS = [
  '',
  'ground',
  'plank',
  'crate',
  'container',
  'steel',
  'deck',
  'floor',
  'ramp',
  'stairs',
  'house',
  'bed',
  'sofa',
  'couch',
  'table',
  'desk',
  'bench',
  'barrel',
  'car',
  'rail',
  'shelf',
  'logwall',
  'shed',
  'logs',
  'hill',
  'snowbank',
  'metal',
  'wood',
  'carpet',
  'concrete',
  'tiles',
  'stone',
];
export const TEXTURES = [
  '',
  'concrete',
  'wood',
  'metal',
  'carpet',
  'snow',
  'grass',
  'lawn',
  'dirt',
  'marble',
  'stone',
  'tiles',
  'tiles2',
  'carpet2',
];
export const SOUNDS = {
  shot: 0,
  step: 1,
  blast: 2,
  reload: 3,
  vault: 4,
  knife: 5,
  zap: 6,
  crack: 7,
  switch: 8,
};
export const MATERIALS = [
  'air',
  'concrete',
  'wood',
  'metal',
  'carpet',
  'snow',
  'soil',
  'stone',
  'tile',
];
const code = (list, key) => Math.max(0, list.indexOf(key));
const RAD = 180 / Math.PI;
export function cameraPose(camera) {
  const p = camera.position,
    r = camera.rotation;
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: -r.y * RAD,
    pitch: r.x * RAD,
    roll: (r.z || 0) * RAD,
  };
}
export async function createAcoustics() {
  const response = await fetch(
    new URL('../../wasm/m8_audio.wasm?v=m8-1', import.meta.url),
  );
  if (!response.ok)
    throw Error('Audio module could not load. Reload the page to retry.');
  const { instance } = await WebAssembly.instantiate(
    await response.arrayBuffer(),
    {},
  );
  return new Acoustics(instance.exports);
}
export class Acoustics {
  constructor(e) {
    if (e.ma_abi() !== 1 || e.ma_len() !== 16)
      throw Error('Audio module ABI mismatch. Reload the page.');
    this.e = e;
    this.geometry = null;
  }
  get f() {
    return new Float64Array(this.e.memory.buffer, this.e.ma_buf(), 16);
  }
  configure(geometry, arena = null) {
    if (this.geometry === geometry) return;
    this.geometry = geometry;
    this.e.ma_zones_clear();
    this.e.ma_steps_clear();
    const data = geometry?.data || geometry?.map || {};
    this.mapId = code(
      MAPS,
      data.arena || geometry?.mapId || geometry?.id || 'range',
    );
    this.ground = code(TEXTURES, data.ground);
    for (const c of data.callouts || [])
      if (c.floor)
        this.e.ma_zone(c.x0, c.z0, c.x1, c.z1, code(TEXTURES, c.floor));
    // Existing Winter Cabin metadata marks the wooden cabin interior excluded from snow.
    for (const r of arena?.map?.snowSkip || data.snowSkip || [])
      this.e.ma_zone(r[0], r[2], r[1], r[3], 2);
  }
  orientation(pose) {
    this.e.ma_mix(
      0,
      pose.x,
      pose.y,
      pose.z,
      pose.x,
      pose.y,
      pose.z,
      pose.yaw,
      pose.pitch,
      1,
      0,
      0,
      1,
    );
    const forward = Array.from(this.f.slice(7, 10));
    this.e.ma_up(pose.yaw, pose.pitch, pose.roll || 0);
    return { forward, up: Array.from(this.f.slice(0, 3)) };
  }
  locate(
    kind,
    source,
    listener,
    geometry,
    arena = null,
    { reach = 80, teammate = false, trace = true } = {},
  ) {
    this.configure(geometry, arena);
    const world = geometry?.world;
    let material = 1;
    const run = (blocked) => {
      this.e.ma_mix(
        SOUNDS[kind] ?? 0,
        source.x,
        source.y,
        source.z,
        listener.x,
        listener.y,
        listener.z,
        listener.yaw,
        listener.pitch,
        reach,
        blocked,
        +teammate,
        material,
      );
    };
    run(0);
    if (kind === 'step' && world && this.f[1] > 0) {
      const y = source.feetY ?? source.y;
      const t = world.raycast([source.x, y + 0.08, source.z], [0, -1, 0], 0.24);
      const hit = world.hit;
      const box = (arena?.boxes || geometry.boxes || geometry.solids || [])[
        hit
      ];
      const k =
        t < 0
          ? -1
          : code(KINDS, box?.src?.kind || box?.look || box?.kind || '');
      material = this.e.ma_surface(
        this.mapId,
        k,
        this.ground,
        source.x,
        y,
        source.z,
      );
      run(0);
    }
    let blocked = 0;
    if (trace && world && this.f[1] > 0) {
      for (let i = 0; i < 3; i++) {
        this.e.ma_probe(
          i,
          source.x,
          source.y,
          source.z,
          listener.x,
          listener.y,
          listener.z,
        );
        const f = this.f;
        if (!world.sight(Array.from(f.slice(0, 3)), Array.from(f.slice(3, 6))))
          blocked++;
      }
      run(blocked / 3);
    }
    const f = this.f;
    return {
      dist: f[0],
      gain: f[1],
      pan: f[3],
      muffle: f[14],
      material: MATERIALS[material],
      route: {
        position: [f[4], f[5], f[6]],
        cutoff: f[2],
        pan: f[3],
        priority: f[15],
      },
      step: { hz: f[10], q: f[11], duration: f[12], ring: f[13] },
    };
  }
}
