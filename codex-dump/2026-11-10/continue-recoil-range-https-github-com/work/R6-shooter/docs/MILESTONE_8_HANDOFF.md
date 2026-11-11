# Milestone 8 — spatial audio increment

## Scope and ownership

This increment implements the audio foundation and playback integration of
Milestone 8 on `feature/m7-ui-controls`. It uses Claude's M3 integration at
`98bf6f1`, then merges Claude's M4 commit `7fcbf5a` in feature commit `880fd42`.
Engine ABI 4 and all M4 maps/destruction/rules are preserved; protected engine
files differ from that M4 commit only in uniform import cache stamps. It does not change the
engine core, map geometry, bot hearing rules, damage, weapons,
attachments or network protocol. `main` is not modified by Codex.

Separately, the user authorized Bomb-only utility/ability tuning and a shorter
attack phase. Those small engine hooks are documented in
[BOMB_BALANCE_HANDOFF.md](BOMB_BALANCE_HANDOFF.md), including the unmet win-rate
target; they are not part of the acoustic propagation policy.

The user has confirmed that multiplayer stays with the existing relay and
peer-to-peer Battle. No dedicated backend, new service or package dependency is
introduced. External Playwright test tooling stays outside the game checkout.

## Operational behavior

- WebAudio HRTF positioning uses full world-space emitter locations and the
  active listener camera, including height, pitch and lean. A stereo preference
  retains the same attenuation and occlusion rules.
- Rust computes 3D distance, finite attenuation with a hard audibility limit,
  wall gain reduction and low-pass cutoff. It makes no visual enemy indicators.
- Three geometry probes sample occlusion through the live engine world. Breaking
  a door changes sound propagation immediately; upper floors occlude sound.
- Rust chooses concrete, wood, metal, carpet, snow, soil, stone and tile footstep
  profiles from the actual surface hit and authored floor metadata. Profile
  frequency, resonance, duration and relative level differ by material.
- Match footsteps retain the existing engine noise events and audibility
  budgets, including silent crouch walking. Battle's AI noise list is unchanged.
- Battle and Range presentation cadence runs in Rust using observed travel,
  with no first-seen, repeated-time or teleport step. A maximum of 64 tracked
  actors bounds its state. Existing interpolated remote positions use that same
  playback path, without adding or faking a connection.
- Remote Battle shots use the existing trace origin's full `x,y,z` instead of
  centred playback. Known-height match shots/catcher events and Battle blasts
  also preserve their supplied heights.
- Reload, switching, vault, gadget, destruction, radio and existing weapon
  sound cues remain synthesized locally by default. The optional sound pack
  replaces source synthesis only when explicitly installed.
- M4 barbed-wire rattles and new destruction/reinforce/barricade cues use
  the same bounded playback path. Preparation selection, cell rendering and
  binding-aware barbed-wire HUD survive the integration.
- A limiter and 32-voice cap bound playback. Source completion and mode exit
  stop and disconnect voice graphs. Lower-priority steps cannot evict gunfire
  when the voice budget is full.
- A dedicated Audio settings tab exposes master volume and HRTF/stereo choice;
  the preference is sanitized, saved and restored with existing settings.

## Rust / browser contract

`rust/m8_audio` has no dependencies. `tools/build-audio.sh --test` compiles native
unit tests and the committed `wasm/m8_audio.wasm`; the adjacent hash fingerprints
its Rust sources. No generated glue, engine-core change or new build system is
needed for the static site.

| ABI 1 export | Meaning |
| --- | --- |
| `ma_abi`, `ma_len`, `ma_buf` | Version 1; shared output buffer with 16 f64 fields |
| `ma_mix` | Kind, source/listener position, yaw/pitch, audibility budget, wall fraction, team relation and material → propagation/profile values |
| `ma_up` | Listener up vector, including camera lean |
| `ma_probe` | One of three height-preserving occlusion probe endpoints |
| `ma_surface` | Surface profile from map/kind/ground identifiers and foot position |
| `ma_zones_clear`, `ma_zone` | Up to 128 authored ground floor rectangles |
| `ma_step`, `ma_steps_clear` | Bounded presentation cadence state from actor travel |
| `ma_reach` | Existing engine footstep noise budget → audio reach; zero stays zero |

The mix buffer contains distance, gain, cutoff, stereo fallback pan, source
`x,y,z`, listener forward `x,y,z`, footstep frequency/Q/duration/resonance, wall
fraction and voice priority. The adapter copies values before querying the
separate engine buffer, so one WASM module cannot overwrite the other's results.

`js/audio/acoustics.js` serializes metadata and invokes the existing geometry
interface. `js/audio/sfx.js` owns only WebAudio nodes, buffer synthesis and
resource lifetime. Shared glue changes in `main.js`, `modes/game.js` and
`battle/battle.js` attach playback to existing cameras and events; no movement,
combat or bot rules are reimplemented there.

## Optional downloadable sound pack (user request)

[Download/integration handoff](../packs/audio/README.md) includes the single
`.rra` runtime file, a ZIP with 83 WAV previews, manifest, source fingerprint,
SHA-256 checksums, browser loader example and recorded benchmark. The assets are
original synthesized sounds, including M4 wire rattle. This adds no automatic
fetch, pack selection UI, service or project dependency; Claude can add the
versioned runtime file to the future optional HD download bundle.

`Sfx.installPack(bytes)` validates and asynchronously decodes the file after
`unlock()`; `removePack()` restores synthesis. Invalid replacements preserve the
old bank. Unknown weapon tones and changed material profiles fall back to live
synthesis. Rust propagation, audibility rules and voice priorities are unchanged.

The runtime file is 1,436,728 bytes (1.37 MiB), and decoded PCM is 2,853,912 bytes
(2.72 MiB), plus browser/voice overhead. Measured decode wall time was 36.1 ms,
including event-loop yields. With occluded HRTF gunfire, nodes per voice fell from
8 to 4, median construction of 400 events from 78.0 to 54.2 ms, and median
one-second offline render of 32 voices from 30.5 to 13.9 ms. These are audio
microbenchmarks, not game FPS measurements or promises for every device. Keep
this pack optional and measure on target hardware before making it a default.

## Integration requests and remaining M8 work

See the requests in [ENGINE_API.md](ENGINE_API.md). Several engine `boom`, `door`,
`wire` and `pulse` events still omit `y`. Their existing horizontal positioning is
retained until the engine provides the height. This increment does not invent
an upper-floor origin for those events or claim they are fully positioned.

The sound model uses direct probes, attenuation and filtering; it does not claim
room reverb, diffraction, multi-bounce propagation or hardware-calibrated hearing.
Human listening tests on physical headphones, Safari/Firefox, and a connected
remote multiplayer session remain to be done. Automated channel-energy tests
verify the browser render graph, not how a particular headset sounds.

Attachments, balance, animation transitions, per-actor effective weapon stats
and attachment synchronization remain the next M8 work. An engine-owned entry
point for effective gun configurations is requested so the same Rust policy can
feed player weapons, bots and peer-host validation without editing Claude's
simulation or mutating the shared base gun catalogue. M8 is not declared complete.

## Verification

```sh
# Existing external browser test tooling (no npm ci / project dependency):
export NODE_PATH=/path/to/test-tools/node_modules
export PLAYWRIGHT_CHROMIUM=/usr/bin/chromium
rustup target add wasm32-unknown-unknown
npm run build:audio
npm run test:audio
npm run test:audio-pack
npm run test:controls
npm test
node tools/check-modes.mjs
npm run check
```

Verified on the M4 integration:

- Native acoustic unit tests: 19 passed.
- WASM/source freshness and actual engine geometry checks: 18 passed.
- Chromium audio/render/settings checks: 21 passed (including M4 wire events).
- Existing controls/WASM/browser checks: 26 passed.
- Optional pack format/source/checksum checks: 14 passed.
- Optional pack browser/render/fallback checks: 11 passed.
- Mode simulations: 97 passed; data validation passed.

The audio suite measures actual OfflineAudioContext left/right channel energy
through HRTF; renders different wood/metal tails; stresses 300 simultaneous
shots while checking the 32-voice ceiling, priority and cleanup; validates
preference persistence, supplied heights, camera tracking and silent engine
footsteps. Geometry tests use actual M3 maps, door destruction, room floors,
container/crate surfaces and an occluding upper floor.

Before M4 integration, the full audio regression produced 215 passes and the
same two local baseline failures: exact-boundary shot count (19 expected, 18
received) and direct WebRTC join timeout. The relay subtest was skipped with no
relay configured. Serial click-through of Range, Battle, TDM, CTF and Bomb was
clean; its first concurrent run timed out under rendering load, then the isolated
rerun passed. The harness now prints full error stacks for diagnosis.

The final M4/Bomb-policy full regression produced **263 passes, one failure**:
the known direct WebRTC join timeout. The shot-count boundary check passed on
this run. Relay coverage was skipped with no relay configured. M4's two direct
`KeyE` reinforcement/barricade test calls were corrected to the existing
`Interact` action; both played checks passed. Bomb policy has 6 native Rust,
37 Node/integration and 13 browser checks, documented separately in its handoff.
No engine implementation was changed to hide baseline failures. Automated checks do not establish real internet multiplayer coverage.
