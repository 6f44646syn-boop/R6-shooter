import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Acoustics, cameraPose } from '../js/audio/acoustics.js';
import { MatchMap } from '../js/modes/map.js';
import { MAPS } from '../js/battle/maps.js';
import { layoutSolids } from '../js/battle/solids.js';
const root = new URL('../', import.meta.url),
  src = new URL('rust/m8_audio/', root),
  hash = createHash('sha256');
for (const f of [
  'Cargo.toml',
  ...readdirSync(new URL('src/', src))
    .filter((f) => f.endsWith('.rs'))
    .sort()
    .map((f) => 'src/' + f),
])
  hash.update(readFileSync(new URL(f, src)));
assert.equal(
  hash.digest('hex'),
  readFileSync(new URL('wasm/m8_audio.hash', root), 'utf8').trim(),
  'committed audio WASM source freshness',
);
const { instance } = await WebAssembly.instantiate(
  readFileSync(new URL('wasm/m8_audio.wasm', root)),
  {},
);
const audio = new Acoustics(instance.exports);
let passes = 0;
const check = (name, value) => {
  assert.ok(value, name);
  passes++;
  console.log('PASS ' + name);
};
check(
  'audio WASM ABI and output buffer',
  audio.e.ma_abi() === 1 && audio.f.length === 16,
);
const ear = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 };
const clear = audio.locate('shot', { x: 10, y: 1.6, z: 0 }, ear, null, null, {
  trace: false,
  reach: 80,
});
const far = audio.locate('shot', { x: 60, y: 1.6, z: 0 }, ear, null, null, {
  trace: false,
  reach: 80,
});
check(
  'far source quieter than near and right source pans right',
  far.gain < clear.gain && clear.pan === 1,
);
const left = audio.locate('shot', { x: -10, y: 1.6, z: 0 }, ear, null, null, {
  trace: false,
});
check(
  'left/right symmetry',
  Math.abs(left.gain - clear.gain) < 1e-12 && left.pan === -1,
);
const high = audio.locate('shot', { x: 0, y: 11.6, z: 0 }, ear, null, null, {
  trace: false,
});
check(
  'height contributes to propagation distance',
  Math.abs(high.dist - 10) < 1e-10 &&
    high.pan === 0 &&
    high.route.position[1] === 11.6,
);
const silent = audio.locate(
  'shot',
  { x: 0, y: 1.6, z: -1000 },
  ear,
  null,
  null,
  { trace: false, reach: 80 },
);
check('no minimum audible volume leaks faraway shots', silent.gain === 0);
const geometry = { data: { id: 'yard' }, world: { sight: () => false } };
const blocked = audio.locate('shot', { x: 10, y: 1.6, z: 0 }, ear, geometry);
check(
  'occlusion lowers level and low-pass cutoff',
  blocked.gain < clear.gain &&
    blocked.route.cutoff < clear.route.cutoff &&
    blocked.muffle === 1,
);
const invalid = audio.locate('shot', { x: NaN, y: 0, z: 0 }, ear, null, null, {
  trace: false,
});
check(
  'invalid emitter creates finite silence',
  invalid.gain === 0 &&
    Object.values(invalid.route).flat().every(Number.isFinite),
);
const pose = cameraPose({
  position: { x: 3, y: 5, z: 7 },
  rotation: { x: Math.PI / 6, y: -Math.PI / 2, z: 0.2 },
});
const orientation = audio.orientation(pose);
check(
  'listener adapter preserves height and orientation',
  pose.y === 5 &&
    Math.abs(orientation.forward[0] - Math.sqrt(0.75)) < 1e-10 &&
    Math.abs(orientation.forward[1] - 0.5) < 1e-10,
);
check(
  'lean roll keeps listener up perpendicular to forward',
  Math.abs(
    orientation.forward.reduce((s, v, i) => s + v * orientation.up[i], 0),
  ) < 1e-10,
);
const load = (id) =>
  new MatchMap(
    JSON.parse(readFileSync(new URL('data/maps/' + id + '.json', root))),
  );
{
  const map = load('ranch');
  const door = map.panels.find((p) => p.kind === 'door'),
    b = door.box;
  const x = (b.minX + b.maxX) / 2,
    z = (b.minZ + b.maxZ) / 2;
  const alongX = b.maxX - b.minX > b.maxZ - b.minZ;
  const source = {
    x: x + (alongX ? 0 : 0.8),
    y: 1.2,
    z: z + (alongX ? 0.8 : 0),
  };
  const listener = {
    x: x - (alongX ? 0 : 0.8),
    y: 1.2,
    z: z - (alongX ? 0.8 : 0),
    yaw: 0,
    pitch: 0,
  };
  const before = audio.locate('shot', source, listener, map);
  map.breakPanel(door);
  const after = audio.locate('shot', source, listener, map);
  check(
    'breaking a real engine door clears sound occlusion immediately',
    before.muffle > after.muffle &&
      after.muffle === 0 &&
      after.gain > before.gain,
  );
  const wood = map.data.callouts.find((c) => c.floor === 'wood');
  if (wood) {
    // The M4 room centre contains furniture. Select an exposed floor point,
    // so this assertion tests floor metadata rather than the object on top.
    let exposed = null;
    for (let x = wood.x0 + 0.5; x < wood.x1 && !exposed; x += 1)
      for (let z = wood.z0 + 0.5; z < wood.z1; z += 1) {
        const t = map.world.raycast([x, 0.08, z], [0, -1, 0], 0.24);
        if (t >= 0 && map.world.hit === -2 && map.world.free(x, z, 0.32, 0)) {
          exposed = [x, z];
          break;
        }
      }
    assert.ok(exposed, 'authored wood room contains exposed ground');
    const [sx, sz] = exposed;
    const floor = audio.locate(
      'step',
      { x: sx, y: 0.12, z: sz, feetY: 0 },
      { ...ear, x: sx, z: sz },
      map,
      null,
      { trace: false, reach: 20 },
    );
    check(
      'footsteps use authored room floor texture metadata',
      floor.material === 'wood',
    );
  }
  map.dispose();
}
{
  const map = load('containers'),
    arena = { boxes: layoutSolids(MAPS.yard), map: MAPS.yard };
  const metal = audio.locate(
    'step',
    { x: 0, y: 2.72, z: 0, feetY: 2.6 },
    ear,
    map,
    arena,
    { trace: false, reach: 20 },
  );
  const wood = audio.locate(
    'step',
    { x: 3.75, y: 1.32, z: 0.5, feetY: 1.2 },
    ear,
    map,
    arena,
    { trace: false, reach: 20 },
  );
  check(
    'actual metal container and wooden crate select different footsteps',
    metal.material === 'metal' &&
      wood.material === 'wood' &&
      metal.step.hz !== wood.step.hz,
  );
  const air = audio.locate(
    'step',
    { x: 0, y: 6, z: 0, feetY: 5.88 },
    ear,
    map,
    arena,
    { trace: false, reach: 20 },
  );
  check(
    'airborne actors do not play floor contacts',
    air.material === 'air' && air.gain === 0,
  );
  map.dispose();
}
{
  const map = load('casino'),
    arena = { boxes: layoutSolids(MAPS.casino), map: MAPS.casino };
  const b = arena.boxes.find(
    (b) => b.minY > 3 && b.maxY - b.minY < 0.5 && b.maxX - b.minX > 3,
  );
  assert.ok(b, 'casino upper floor exists');
  const x = (b.minX + b.maxX) / 2,
    z = (b.minZ + b.maxZ) / 2;
  const source = { x, y: b.maxY + 0.12, z, feetY: b.maxY };
  const below = audio.locate(
    'step',
    source,
    { x, y: b.minY - 1, z, yaw: 0, pitch: 0 },
    map,
    arena,
    { reach: 20 },
  );
  const above = audio.locate(
    'step',
    source,
    { x, y: b.maxY + 1.6, z, yaw: 0, pitch: 0 },
    map,
    arena,
    { reach: 20 },
  );
  check(
    'real upper floor occludes footsteps from the floor below',
    below.muffle === 1 && above.muffle === 0,
  );
  map.dispose();
}
{
  audio.e.ma_steps_clear();
  let count = 0;
  for (let i = 0; i <= 60; i++)
    if (audio.e.ma_step(42, i / 60, i * 0.05, 0, 0, 1, 0)) count++;
  check('footstep cadence derives from travelled distance', count === 2);
  check(
    'network teleport emits no footstep',
    audio.e.ma_step(42, 1.1, 99, 0, 0, 1, 0) === 0,
  );
}
check(
  'engine silent noise budget remains silent',
  audio.e.ma_reach(0) === 0 && audio.e.ma_reach(-1) === 0,
);
const invalidStep = audio.locate('step', { x: NaN, y: 0, z: 0 }, ear, {
  data: { id: 'yard' },
  world: {
    raycast() {
      throw Error('invalid coordinates reached geometry');
    },
  },
});
check(
  'invalid footstep input is rejected before engine queries',
  invalidStep.gain === 0,
);
console.log(`${passes} audio integration checks passed`);
