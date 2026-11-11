// Pack weapon animations (Milestone 8): the shipped file is valid, current and complete.
// node tests/pack-anims.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildAnims } from '../tools/hd/anims.mjs';
import { validateAnims, sampleClip, eventsBetween } from '../js/scene/weapon-anims.js';

let checks = 0;
const check = (name, cond) => { assert.ok(cond, name); checks++; console.log('PASS ' + name); };
const raw = readFileSync(new URL('../hd/anims/weapons.json', import.meta.url));
const j = JSON.parse(raw);
check('hd/anims/weapons.json is valid', !!validateAnims(j));
check('it matches tools/hd/anims.mjs (rebuilt)', JSON.stringify(j) === JSON.stringify(buildAnims()));
const man = JSON.parse(readFileSync(new URL('../hd/manifest.json', import.meta.url)));
const e = man.files.find((f) => f.path === 'anims/weapons.json');
check('listed in the pack manifest with its hash (pack version 4)', man.version >= 4 && e && e.sha256 === createHash('sha256').update(raw).digest('hex'));
const an = { id: 't', rest: [0, -0.04, -0.26], mag: [0, -0.12, -0.1], magBottom: [0, -0.2, -0.1], port: [0.035, 0.012, 0.03], pouch: [-0.12, -0.42, -0.08] };
const out = {};
for (const [name, st] of Object.entries(j.styles)) {
  const ends = ['reload', 'reloadEmpty', 'draw', 'inspect'].every((c) => {
    const a = sampleClip(st[c], 0, an, {}), b = sampleClip(st[c], 1, an, {});
    const restOk = (s) => !s.hand || s.hand.every((v, i) => Math.abs(v - (i < 3 ? an.rest[i] : 0)) < 1e-6);
    const magOk = (s) => !s.mag || (s.mag.slice(0, 6).every((v) => Math.abs(v) < 1e-6) && s.mag[6] === 1);
    return restOk(b) && magOk(b) && (c === 'draw' || (restOk(a) && magOk(a)));
  });
  check(name + ': every clip ends at rest (hand on the handguard, magazine seated)', ends);
  sampleClip(st.reloadEmpty, 0.875, an, out);
  check(name + ': empty reload pulls the charging handle', out.bolt > 0.03);
  let hidden = false;
  for (let p = 0; p <= 1; p += 0.01) { sampleClip(st.reloadEmpty, p, an, out); if (out.mag[6] === 0) hidden = true; }
  check(name + ': the dropped magazine leaves, a new one comes in', hidden && eventsBetween(st.reloadEmpty, 0, 1).includes('slap'));
  sampleClip(st.reload, 0.3, an, out);
  check(name + ': tactical reload: the hand holds the magazine away from the gun', Math.hypot(out.hand[0] - an.rest[0], out.hand[1] - an.rest[1], out.hand[2] - an.rest[2]) > 0.1);
}
console.log(checks + ' pack animation checks passed');
