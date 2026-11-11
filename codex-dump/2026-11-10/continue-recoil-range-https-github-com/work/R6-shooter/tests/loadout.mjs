// Weapon attachments (Milestone 8): the Rust policy, the effective-gun entry point, and the
// match engine using it. Node only (no browser): node tests/loadout.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateGuns } from '../js/core/guns.js';
import { validateCatalogue } from '../js/core/optics.js';
import { effectiveGun, measuredCode, sanitize, slotIn, baseOf, describe, SLOTS } from '../js/core/loadout.js';
import { Weapon } from '../js/core/weapon.js';
import { RecoilEngine } from '../js/core/recoil.js';
import { Spread } from '../js/core/spread.js';
import { MatchMap } from '../js/modes/map.js';
import { Match } from '../js/modes/sim.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url));
const json = (p) => JSON.parse(read(p));
let checks = 0;
const check = (name, cond) => { assert.ok(cond, name); checks++; console.log('PASS ' + name); };

const source = createHash('sha256');
for (const p of ['Cargo.toml', 'src/lib.rs']) source.update(read('rust/loadout/' + p));
check('WASM is built from the current Rust source', source.digest('hex') === read('wasm/loadout.hash').toString().trim());

const cat = validateCatalogue(json('data/optics.json'));
const { guns } = validateGuns(json('data/guns.json'), cat);
const byId = new Map(guns.map((g) => [g.id, g]));

// 1. The measured loadout is the catalogue gun itself, for every gun.
check('measured loadout returns the catalogue gun (all guns)', guns.every((g) => effectiveGun(g, measuredCode(g)) === g && effectiveGun(g, null) === g));
check('measured codes come from the data (F2: flash hider, vertical grip, laser)', measuredCode(byId.get('rifle-01')) === '1110' && measuredCode(byId.get('smg-01')) === '0000');

// 2. The catalogue is never changed.
const before = JSON.stringify(guns);
for (const g of guns) for (const c of ['0000', '4120', '2011', '3102', '5212']) effectiveGun(g, c);
check('catalogue unchanged after building effective guns', JSON.stringify(guns) === before);

// 3. Numbers.
const f2 = byId.get('rifle-01');
const noGrip = effectiveGun(f2, '1010');
const last = (p) => p[p.length - 1];
check('removing the vertical grip adds 1/0.88 climb', Math.abs(last(noGrip.sprayPath)[1] / last(f2.sprayPath)[1] - 1 / 0.88) < 1e-9);
check('...and leaves sideways recoil alone', Math.abs(last(noGrip.sprayPath)[0] - last(f2.sprayPath)[0]) < 1e-9);
const ext = effectiveGun(f2, '1111');
check('extended magazine: 25 -> 35 rounds, slower reload', ext.magSize === 35 && ext.reloadSeconds > f2.reloadSeconds);
const sup = effectiveGun(f2, '4110');
check('suppressor: no flash, 40% noise reach, less damage', sup.flash === 0 && Math.abs(sup.noise - 0.4) < 1e-9 && sup.damage < f2.damage && sup.suppressed);
const ang = effectiveGun(f2, '1210');
check('angled grip: faster to aim', ang.adsSeconds < f2.adsSeconds);
const lmg = byId.get('lmg-01');
check('LMG cannot take an extended magazine (Rust rejects it)', sanitize(lmg, '1101') === measuredCode(lmg) && effectiveGun(lmg, '1101') === lmg);
check('garbage codes fall back to the measured loadout', [undefined, '', '12', '99999', 'abcd', 1234, { x: 1 }].every((c) => effectiveGun(f2, c) === f2 || (c === undefined && effectiveGun(f2, c) === f2)));
check('same code gives the same object (cached)', effectiveGun(f2, '4110') === sup);
check('effective guns are frozen and point at their base', Object.isFrozen(sup) && baseOf(sup) === f2 && slotIn(guns, sup) === guns.indexOf(f2));
check('describe() lists the changes', describe(f2, '1111').some((d) => d.label === 'Rounds' && d.value === '25 → 35'));
check('four slots with the Rust option counts', SLOTS.map((s) => s.options.length).join() === '6,3,2,3');

// 4. The engine pieces take the effective gun as is.
const w = new Weapon();
w.setGun(ext);
check('Weapon: capacity from the effective magazine', w.capacity === 35 + (ext.chambered ? 1 : 0));
w.ammo = 0; w.startReload(0);
check('Weapon: reload time from the effective gun', Math.abs(w.reloadDur - ext.reloadSeconds) < 1e-9);
const r = new RecoilEngine();
r.setGun(noGrip); r.aimed = false;
const out = [0, 0];
let t = 0;
for (let i = 0; i < noGrip.sprayPath.length; i++) { r.fire(t, out); t += 60 / noGrip.rpm; }
// (jitter is random, so compare the climb with a margin far below the 14% difference)
const r0 = new RecoilEngine(); r0.setGun(f2); const out0 = [0, 0]; t = 0;
for (let i = 0; i < f2.sprayPath.length; i++) { r0.fire(t, out0); t += 60 / f2.rpm; }
check('RecoilEngine: more climb without the grip', out[1] > out0[1] * 1.05);
const sp = new Spread();
const smg = byId.get('smg-01');
check('Spread: the laser tightens the hip-fire cone', sp.cone(0, effectiveGun(smg, '0010'), false, false) < sp.cone(0, smg, false, false) * 0.8);

// 5. Match engine: the human carries their attachments; bots the measured loadout.
const raw = json('data/guns.json').guns;
const make = (attach) => new Match({
  map: new MatchMap(json('data/maps/yard.json')), mode: 'tdm', guns: raw, ops: json('data/ops.json'),
  abilities: json('data/abilities.json'), teamSize: 3, seed: 5, human: { op: json('data/ops.json').attackers[0].id, side: 'attack' }, attach,
});
const m0 = make(null);
const me0 = m0.actors.find((a) => a.human);
const code = me0.gunData.model === 'lmg' ? '0002' : '0001';
const m1 = make({ [me0.gunData.id]: code });
const me1 = m1.actors.find((a) => a.human);
check('match: the human gets their effective gun', me1.gunData.attach === sanitize(me1.gunData, code) && me1.gun.attach === me1.gunData.attach);
check('match: bots keep the measured loadout', m1.actors.filter((a) => !a.human).every((a) => !a.gunData.base));
check('match: magazine size follows the attachment', code === '0001' ? me1.gun.magSize > me0.gun.magSize : me1.gun.reload < me0.gun.reload);
const m2 = make({ [me0.gunData.id]: '4' + measuredCode(me0.gunData).slice(1) });
const me2 = m2.actors.find((a) => a.human);
for (let i = 0; i < 300 && !me2.alive; i++) m2.step();
me2.protectUntil = 0;
m2.noises.length = 0;
m2.humanShot(me2, m2.eye(me2), [0, 0, 1]);
const n = m2.noises.find((x) => x.kind === 'shot');
check('match: a suppressed shot carries 40% as far', n && Math.abs(n.range - 35 * 0.4) < 1e-9);

console.log(checks + ' loadout checks passed');
