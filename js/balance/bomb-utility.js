// Browser WASM loading only; all tuning values live in rust/bomb_utility.
// Node loads synchronously like the existing engine core, for headless simulation.
const KEY = '__recoilBombUtility';
const EXPORTS = '__recoilBombUtilityExports';
const FIELDS = [
  'reinforceSeconds',
  'barricadeSeconds',
  'barricadeHp',
  'wireHp',
  'wireSpeed',
  'actionSeconds',
  'reinforceReach',
];
let pending = null;
const url = () =>
  new URL('../../wasm/bomb_utility.wasm?v=bu-1', import.meta.url);
function bind(instance) {
  const e = instance.exports;
  if (e.bu_abi() !== 1)
    throw Error('Bomb utility WASM ABI mismatch. Reload the page.');
  const profiles = [0, 1].map((bomb) =>
    Object.freeze(
      Object.fromEntries(
        FIELDS.map((k, i) => {
          const v = e.bu_value(bomb, i);
          if (!Number.isFinite(v) || v <= 0)
            throw Error('Invalid Bomb utility policy.');
          return [k, v];
        }),
      ),
    ),
  );
  globalThis[EXPORTS] = e;
  globalThis[KEY] = profiles;
  return profiles;
}
export function utilityFor(mode) {
  if (!globalThis[KEY]) {
    if (
      typeof process !== 'undefined' &&
      typeof process.getBuiltinModule === 'function'
    ) {
      const bytes = process.getBuiltinModule('node:fs').readFileSync(url());
      bind(new WebAssembly.Instance(new WebAssembly.Module(bytes), {}));
    } else throw Error('Bomb utility module is not loaded. Reload the page.');
  }
  return globalThis[KEY][mode === 'bomb' ? 1 : 0];
}
export async function initBombUtility() {
  if (globalThis[KEY]) return globalThis[KEY];
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url());
      if (!response.ok)
        throw Error('Bomb utility module failed to load. Reload the page.');
      const { instance } = await WebAssembly.instantiate(
        await response.arrayBuffer(),
        {},
      );
      return bind(instance);
    })();
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

const ABILITIES = [
  ['jolt_mines', ['trigger', 'radius', 'slowTime', 'wobbleTime']],
  [
    'dread_mines',
    [
      'trigger',
      'radius',
      'shakeTime',
      'revealTime',
      'cloudTime',
      'cloudRadius',
    ],
  ],
  ['static_jammer', ['radius']],
  ['catcher', ['radius', 'recharge']],
  ['charge_dash', ['distance', 'stun', 'recharge']],
];
export function abilitiesFor(mode, source) {
  utilityFor(mode);
  const e = globalThis[EXPORTS],
    bomb = +(mode === 'bomb');
  const config = { ...source };
  ABILITIES.forEach(([id, fields], a) => {
    if (!source[id]) return;
    const overrides = {};
    fields.forEach((key, f) => {
      const value = e.bu_ability(bomb, a, f);
      if (Number.isFinite(value)) overrides[key] = value;
    });
    if (Object.keys(overrides).length)
      config[id] = { ...source[id], ...overrides };
  });
  return config;
}
export function sensoryFor(mode, flags) {
  utilityFor(mode);
  const e = globalThis[EXPORTS],
    bomb = +(mode === 'bomb');
  return {
    gain: e.bu_sensory(bomb, flags, 0),
    cutoff: e.bu_sensory(bomb, flags, 1),
    veil: e.bu_sensory(bomb, flags, 2),
  };
}
