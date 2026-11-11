// Weapon attachments (Milestone 8): the browser side of rust/loadout (wasm/loadout.wasm).
//
// The engine entry point is effectiveGun(baseGun, code): it returns the gun one actor actually
// carries. The shared catalogue (data.guns) is never changed. With the loadout the gun was
// measured with, the result IS the catalogue gun (same object), so nothing changes unless a
// player picks different attachments. Otherwise it is a frozen copy with:
//   magSize, reloadSeconds, adsSeconds, damage, sprayPath / sprayPathSmooth / jitter (recoil),
//   hipCone (hip-fire cone multiplier), noise (shot noise reach multiplier), flash (muzzle flash
//   size, 0 = none), suppressed, laser, attach (the code) and base (the catalogue gun).
// Everything that reads a gun (Weapon, RecoilEngine, Spread, the match sim, Battle, the network
// host) therefore uses the same effective numbers. All the numbers come from Rust.
//
// A loadout code is four digits, one per slot: muzzle, grip, underbarrel, magazine.
import { smoothPath } from './recoil.js?v=a37f22c-mwcnqhgi';

export const SLOTS = [
  { key: 'muzzle', name: 'Muzzle', options: ['None', 'Flash hider', 'Compensator', 'Muzzle brake', 'Suppressor', 'Extended barrel'] },
  { key: 'grip', name: 'Grip', options: ['None', 'Vertical grip', 'Angled grip'] },
  { key: 'under', name: 'Underbarrel', options: ['None', 'Laser'] },
  { key: 'mag', name: 'Magazine', options: ['Standard', 'Extended', 'Quick-change'] },
];
// What each option does, for the armory (the numbers are read from Rust at load).
const HINT = [
  ['', 'Less climb and sideways kick, small flash', 'Much less sideways kick', 'Much less climb, louder', 'Quiet, no flash, less damage', 'More damage, slower to aim'],
  ['', 'Less climb', 'Faster to aim'],
  ['', 'Tighter hip fire'],
  ['', 'More rounds, slower reload', 'Faster reload'],
];
const MODELS = ['rifle', 'carbine', 'smg', 'lmg', 'marksman'];
const DEFAULT_DAMAGE = { smg: 28, rifle: 36, carbine: 34, lmg: 38, marksman: 48 };
// Names used in data/guns.json measurement.attachments -> [slot, id].
const MEASURED_NAMES = {
  'flash hider': [0, 1], compensator: [0, 2], 'muzzle brake': [0, 3], suppressor: [0, 4], 'extended barrel': [0, 5],
  'vertical grip': [1, 1], 'angled grip': [1, 2], laser: [2, 1],
};

const KEY = '__recoilLoadout';
let pending = null;
const url = () => new URL('../../wasm/loadout.wasm?v=lo-1', import.meta.url);
function bind(instance) {
  const e = instance.exports;
  if (e.lo_abi() !== 1) throw Error('Loadout WASM ABI mismatch. Reload the page.');
  for (let s = 0; s < SLOTS.length; s++) if (e.lo_count(s) !== SLOTS[s].options.length) throw Error('Loadout WASM does not match the attachment list. Reload the page.');
  globalThis[KEY] = e;
  return e;
}
function core() {
  if (!globalThis[KEY]) {
    if (typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function') {
      const bytes = process.getBuiltinModule('node:fs').readFileSync(url());
      bind(new WebAssembly.Instance(new WebAssembly.Module(bytes), {}));
    } else throw Error('Loadout module is not loaded. Reload the page.');
  }
  return globalThis[KEY];
}
// Browser: load before any gun is used (main.js awaits it at start-up).
export async function initLoadout() {
  if (globalThis[KEY]) return globalThis[KEY];
  if (!pending) {
    pending = (async () => {
      const r = await fetch(url());
      if (!r.ok) throw Error('Loadout module failed to load. Reload the page.');
      const { instance } = await WebAssembly.instantiate(await r.arrayBuffer(), {});
      return bind(instance);
    })();
    pending.catch(() => { pending = null; });
  }
  return pending;
}

const modelId = (g) => Math.max(0, MODELS.indexOf(g.model));
// The loadout a gun's data was measured with, as a code ("0000" when nothing is recorded).
export function measuredCode(g) {
  const ids = [0, 0, 0, 0];
  const list = (g.measurement && g.measurement.attachments) || g.measuredAttachments || [];
  for (const n of list) { const m = MEASURED_NAMES[String(n).toLowerCase()]; if (m) ids[m[0]] = m[1]; }
  return ids.join('');
}
const parse = (code) => (typeof code === 'string' && /^\d{4}$/.test(code) ? [...code].map(Number) : null);
export const baseOf = (g) => (g && g.base) || g;
// Index of a (possibly effective) gun in a catalogue list.
export const slotIn = (list, g) => list.indexOf(baseOf(g));

export function allowed(g, slot, id) { return core().lo_allowed(modelId(baseOf(g)), slot, id) === 1; }
// A valid code for this gun: the given one if every choice is allowed, else the measured one.
export function sanitize(g, code) {
  const b = baseOf(g), ids = parse(code);
  return ids && ids.every((id, s) => allowed(b, s, id)) ? code : measuredCode(b);
}

const cache = new WeakMap();
// The effective gun for one actor. code: four digits, or null / undefined for the measured loadout.
export function effectiveGun(gun, code) {
  const base = baseOf(gun);
  const m = measuredCode(base);
  const c = code == null ? m : sanitize(base, code);
  if (c === m) return base;
  let per = cache.get(base);
  if (!per) cache.set(base, (per = new Map()));
  let g = per.get(c);
  if (g) return g;
  const e = core(), mi = parse(m), ci = parse(c);
  e.lo_effective(modelId(base), base.magSize, mi[0], mi[1], mi[2], mi[3], ci[0], ci[1], ci[2], ci[3]);
  const fx = Array.from({ length: 10 }, (_, i) => e.lo_out(i));
  const [v, h, jit, ads, rel, , dmg, hip, noise, flash] = fx;
  const path = base.sprayPath.map((p) => [p[0] * h, p[1] * v]);
  const smooth = (base.sprayPathSmooth || smoothPath(base.sprayPath)).map((p) => [p[0] * h, p[1] * v]);
  g = Object.freeze({
    ...base,
    base, attach: c,
    magSize: e.lo_out(10),
    reloadSeconds: base.reloadSeconds * rel,
    adsSeconds: (base.adsSeconds || 0.3) * ads,
    damage: Math.round((base.damage ?? DEFAULT_DAMAGE[base.model] ?? 32) * dmg * 10) / 10,
    sprayPath: path, sprayPathSmooth: smooth,
    jitter: { yawDeg: base.jitter.yawDeg * jit, pitchDeg: base.jitter.pitchDeg * jit },
    hipCone: hip, noise, flash,
    suppressed: e.lo_out(11) === 1, laser: e.lo_out(12) === 1,
  });
  per.set(c, g);
  return g;
}

// The effect of a code on a gun, for the armory: [{ label, value, better }] (only what changed).
export function describe(gun, code) {
  const base = baseOf(gun), g = effectiveGun(base, code);
  const out = [];
  const pct = (a, b) => Math.round((a / b - 1) * 100);
  const climb = (p) => Math.abs(p[p.length - 1][1] - p[0][1]), side = (p) => p.reduce((s, q, i) => s + (i ? Math.abs(q[0] - p[i - 1][0]) : 0), 0);
  const add = (label, a, b, lowerIsBetter = true) => { const d = pct(a, b); if (d) out.push({ label, value: (d > 0 ? '+' : '') + d + '%', better: lowerIsBetter ? d < 0 : d > 0 }); };
  add('Climb', climb(g.sprayPath), Math.max(1e-6, climb(base.sprayPath)));
  add('Sideways', side(g.sprayPath), Math.max(1e-6, side(base.sprayPath)));
  add('Aim time', g.adsSeconds, base.adsSeconds || 0.3);
  add('Reload', g.reloadSeconds, base.reloadSeconds);
  if (g.magSize !== base.magSize) out.push({ label: 'Rounds', value: base.magSize + ' → ' + g.magSize, better: g.magSize > base.magSize });
  add('Damage', g.damage, base.damage ?? DEFAULT_DAMAGE[base.model] ?? 32, false);
  add('Hip spread', g.hipCone || 1, 1);
  add('Shot noise', g.noise || 1, 1);
  return out;
}
export const hint = (slot, id) => HINT[slot][id] || '';
export function codeName(gun, code) {
  const c = sanitize(gun, code);
  const names = [...c].map((d, s) => (Number(d) ? SLOTS[s].options[Number(d)] : null)).filter(Boolean);
  return names.length ? names.join(', ') : 'No attachments';
}
