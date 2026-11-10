# Bomb defender tuning — Codex to Claude

## User-approved scope

The user requested help making Bomb slightly defender-sided, with roughly 55%
defender round wins as a target. They selected defensive utility buffs, then
explicitly added a shorter attack phase, buffs to all five defender abilities,
and stronger vision/sound disruption. They chose range, duration and uptime
improvements with damage unchanged. These changes apply to Bomb only.

This is a draft candidate on `feature/m7-ui-controls`, based on Claude's M4
`7fcbf5a`. No push to `main`, deployment or merge is authorized by this work.
**The 55% target has not been achieved or verified.** Bot tactics remain Claude's
M5 work; these changes do not edit `bots.js`, Rust physics, map data or weapons.

## Final utility and clock changes

| Setting | M4 | Candidate |
| --- | ---: | ---: |
| Attack phase before planting | 150 s | 120 s |
| Reinforcement placement reach | 1.6 m | 1.8 m |
| Barricade health | 100 | 150 |
| Bullet impacts to clear wire | 3 | 4 |
| Movement multiplier in enemy wire | 0.40 | 0.35 |

Reinforcement remains 2.5 s, barricading 1.5 s, with two reinforcements and two
wire rolls per defender. Reinforced walls still require the existing breaching
counter; barricades take two 100-damage knife hits and seven 22-damage bullet
hits. Wire still clears with one close-range knife hit or the existing blast.
Health, weapon damage, ability damage, charges and recoil remain unchanged.

Preparation stays configurable. Planting remains 5 s, defusing 6 s, and a
successful late plant still gets the full 40 s fuse. The old action deadline
does not end an already planted round. The setup note reads the Rust clock
value rather than duplicating a displayed time.

## Defender abilities, Bomb only

| Operator / ability | Improvements |
| --- | --- |
| Ayla / Jolt | Trigger radius 2.2 → 2.5 m; effect radius 4 → 4.5 m; slow/wobble duration 4 → 5 s |
| Fenrik / Dread | Trigger 2.2 → 2.5 m; effect radius 4 → 4.5 m; shake/reveal 6 → 7 s; cloud duration 5 → 6 s and radius 3 → 3.5 m |
| Muse / Static Jammer | Radius 8 → 10 m |
| Kamai / Catcher | Radius 5 → 6 m; recharge 10 → 8 s |
| Onyx / Charge Dash | Reach 6 → 6.5 m; stun 2 → 2.5 s; recharge 10 → 8 s |

Overrides are merged into a copy of the ability configuration **before** the
existing engine initializes actors. Humans and bots read the same effective
configuration. The shared `data/abilities.json` catalogue is not mutated;
attacker abilities, TDM and CTF retain their original numbers.

## Stronger vision and sound disruption

The Rust policy consumes active Jolt/Dread/jammer/stun flags. It returns targets
for two shared WebAudio nodes and a static screen vignette. The existing wobble
and shake amplitudes are not increased; longer ability durations and the new
veil make the disruption last longer and impair vision more.

| Active condition | Hearing gain target | Low-pass cutoff | Extra vignette opacity |
| --- | ---: | ---: | ---: |
| Jolt | 0.80 | 3500 Hz | 0.30 |
| Dread | 0.65 | 2400 Hz | 0.65 |
| Jammer | 0.55 | 1600 Hz | 0.40 |
| Stun | 0.65 | 2500 Hz | 0.50 |

Overlaps choose the strongest individual value per channel; they do not multiply
into silence or a black screen. These are node/overlay targets, not guaranteed
headphone loudness measurements. Master volume remains in control. No new
flashing or louder effect is added. OS reduced motion suppresses camera motion
and animated jammer static while retaining the static veil and hearing effects.

Effects clear on status expiry, death, pause, replay and mode exit. Spectators do
not inherit the dead player's impairment. Drone views use their jammer state;
body Jolt/Dread/stun are not applied to the drone view. `Sfx.stopAll()` resets
hearing so Range/Battle and menus do not inherit an effect.

Bot aim/reaction penalties already use `wobbleUntil` and `shakeUntil`, so their
longer durations apply without changing Claude's AI implementation. WebAudio and
the visual overlay are presentation effects, not a replacement AI hearing model.
Existing simulation noise/report/jammer rules remain in effect.

## Integration map

- `rust/bomb_utility/`: dependency-free policy, ABI 1. Exports `bu_abi`,
  `bu_value(bomb,field)`, `bu_ability(bomb,ability,field)`,
  `bu_sensory(bomb,flags,channel)`. Unknown sparse ability fields return NaN,
  meaning retain the supplied data value. Other modes receive baseline utility
  and neutral sensory values.
- `wasm/bomb_utility.*`, `tools/build-bomb-utility.sh`: committed WASM and source
  fingerprint. No core ABI change or package dependency. Browser loads it with
  controls/audio before boot; Node loads synchronously like the existing core.
- `js/balance/bomb-utility.js`: WASM loading and configuration serialization.
- Small engine hooks in `sim.js`: construct `m.utility`, set per-map barricade HP,
  merge ability config, use the existing speed calculation for wire.
- `rules.js`: use policy clock, placement reach and hold durations. `BOMB.action`
  remains a compatible getter for the Rust value; role swaps/refill remain owned
  by the existing rules.
- `map.js`: reset/rebuild barricades with the match's HP value. Geometry, collision,
  pathfinding and destruction algorithms are unchanged.
- `abilities.js`: wire initial HP comes from the policy; ability dispatch is unchanged.
- `game.js`: existing status flags drive presentation. `js/audio/hearing.js` owns
  only browser nodes; `sfx.js` attaches/reset them. Main boot/menu glue is small.
- Import query stamps are consistent across modules. Apart from the listed hooks,
  engine-owned files only receive cache stamps.

Please preserve these hooks when merging M5, and rerun the paired balance tool
on the new tactics before claiming the target. Use `m.utility.actionSeconds` or
`BOMB.action` instead of a new hardcoded 150 s. Do not add a separate bot balancing
system or change weapons to compensate for early defender deaths.

## Measurement and verification

`tools/measure-bomb-balance.mjs` runs full seeded normal-difficulty 5v5 bot
matches with abilities, lethal headshots and 30 s prep. Reports contain seeds,
round sides/reasons and per-match results. Baseline and candidate each use eight
matches per map with the same seeds 1–8 and normal side swaps.

| Map | M4 defender rounds | Final candidate defender rounds |
| --- | ---: | ---: |
| Ranch | 15 / 46 (32.61%) | 9 / 45 (20.00%) |
| Embassy | 15 / 48 (31.25%) | 17 / 48 (35.42%) |
| Workshop | 8 / 43 (18.60%) | 13 / 51 (25.49%) |

Pooled results are 38/137 (27.74%) versus 39/144 (27.08%). Equal-weight mean of
per-match defender shares is 27.66% versus 28.27%. Neither shows an established
overall improvement or a 55% defender win rate. Round counts vary as matches end
at four wins, and rounds within a match are not independent samples. This is
small-sample bot evidence; human balance has not been playtested.

Early fast-setup and extra-reinforcement variants also failed to establish the
target and were dropped. Their reports are retained under `reports/bomb-utility/`
for diagnosis. These results support focusing M5 on defensive positioning,
survival and rotations rather than adding arbitrary damage or health bonuses.
The candidate provides the requested stronger utility and ability mechanics;
it is not a completed balance calibration.

```sh
export NODE_PATH=/path/to/external-test-tools/node_modules
export PLAYWRIGHT_CHROMIUM=/usr/bin/chromium
npm run build:bomb-utility
npm run test:bomb-utility
node tools/measure-bomb-balance.mjs . 8 /tmp/bomb-tuned.json
node tools/measure-bomb-balance.mjs /path/to/M4-checkout 8 /tmp/bomb-baseline.json
npm test
node tools/check-modes.mjs
```

Focused checks: 6 native Rust, 37 Node/WASM/integration and 13 Chromium checks
passed. Tests cover exact deadline behavior, late plant/fuse preservation, side
swaps, real utility use and counterplay, ability radius/duration/damage, mode
isolation, actual F interaction with Q/E still leaning, reduced motion, audible
filtered audio and effect cleanup. Mode simulations: 97 passed. Data validation
passed. Full regression: **263 passed, one failed** (known direct WebRTC join
timeout). Relay test skipped because no relay was configured. The timing-boundary
shot-count check passed in this run; it failed in earlier baseline runs. Fresh CI
results are recorded in the draft PR.

The M4-imported browser test used `KeyE` directly to reinforce/barricade, which
now means leaning. It is corrected to the established `Interact` semantic action;
this fixes test setup without restoring E interaction. Other baseline failures
are reported, never hidden by weakening their assertions.
