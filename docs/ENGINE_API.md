# Engine interfaces (for the UI, controls and network work)

Milestones 1-6 (engine: Rust core, physics, maps, bots, rendering) and milestones 7-12 (UI,
controls, audio, network, replays, spectating, ranked, training) are built in parallel.
This page is the contract between them, as of milestone 6. Change it in the same commit
as the code it describes.

## Who owns what

| Area | Files | Owner |
|---|---|---|
| Rust game core, its WebAssembly and loader | `rust/core/`, `wasm/recoil_core.*`, `js/wasm/` | engine |
| Physics, collision, paths, maps | `js/battle/arena.js`, `solids.js`, `maps.js`, `js/modes/map.js`, `tools/build-maps.mjs`, `data/maps/` | engine |
| Match simulation, rules, abilities, grenades, bots | `js/modes/sim.js`, `rules.js`, `abilities.js`, `nades.js`, `bots.js`, `js/battle/bot.js` | engine |
| Drawing performance, graphics quality | `js/scene/`, `js/render/`, `js/modes/look.js`, `gadget-look.js` | engine |
| Enhanced Graphics pack (models, build tools, download) | `hd/`, `tools/hd/`, `tools/build-hd.mjs`, `js/render/hd-pack.js`, `hd-mesh.js`, `quality.js`, `world-post.js` | engine |
| Graphics screen, FPS counter | `js/ui/graphics-ui.js`, `js/ui/perf-hud.js` | engine for now (milestone 6); the UI side may restyle or move them, keeping the ids and hooks below |
| Controls, menus, settings screens, HUD wording | `rust/m7_controls/`, `js/ui/`, `index.html`, `css/` | UI |
| Network play | `js/net/`, `relay/`, the network parts of `js/battle/battle.js` | UI (milestone 9) |
| Replays, spectator, ranked, training | new files | UI (milestones 10-12) |
| Shared glue | `js/main.js`, `js/modes/game.js`, `js/battle/human.js`, `js/battle/battle.js`, `tests/run.mjs` | both: keep edits small and say what changed in the commit |

Network play means the existing relay and WebRTC Battle only (the user's decision): no
dedicated server. Nothing in the engine assumes a server; nothing should claim one exists.

## Input: what the engine reads

The engine reads plain input state. It does not care which key or button produced it.

- **Body** (`Human` in `js/battle/human.js`, used by Battle and the match modes):
  `h.in = { fwd, back, left, right, sprint, crouch, leanL, leanR, fire, ads, vault }` (booleans,
  held state) and `h.mouseMove(dx, dy)`. `vault` is edge-triggered inside `update()`: set it
  true on press, false on release.
- **Match modes** (`ModeGame.key(code, down)` in `js/modes/game.js`): movement codes map
  onto `h.in`. Match-mode actions: `OperatorAbility` (Q before milestone 7; also the Bomb
  prep drone), `DroneZap`, `Interact` (Bomb plant / defuse), `KeyV` drone recall, `KeyB`
  Huck's shotgun, `KeyK` knife, `CapsLock` / `KeyG` grenade, `KeyR` reload. **`KeyC` is
  vault in every mode since milestone 3** (it was crouch in the match modes); crouch is
  Space. The controls adapter should send the semantic `vault` action as `KeyC`, or set
  `h.in.vault` directly.
- **Battle** (`Battle.key(code, down)`): `KeyC` vault, `Interact` / `KeyF` flashlight at
  night, `CapsLock` / `KeyG` grenade.
- **Bomb, milestone 4:** the interact hold (E before milestone 7, `Interact` after) also
  reinforces a soft wall or barricades an open doorway or window for a defender facing it
  (in prep and in the action phase); the grenade input lays barbed wire for a defender
  (2 rolls a round, no grenades). No new input actions were needed.
- **Match option `prepTime`** (seconds, 10 to 120, default 30): passed to
  `ModeGame.start({ ..., prepTime })`. The current menu has a "Preparation" select; the new
  menus should offer the same values for Bomb.
- Releasing everything (`h.releaseAll()`, `controls.release()`) on respawn, mode change
  and pointer-lock loss is the controls' job; the engine never holds input across those.

## Physics and maps (`js/wasm/world.js`, `CoreWorld`)

One map inside the Rust core. Battle's `Arena.world` and the match modes' `MatchMap.world`
are both a `CoreWorld`. Heights are feet heights (y); the ground floor is 0.

| Call | Answers |
|---|---|
| `groundAt(x, z, y)` | height of what is underfoot for feet near y |
| `stepBody(p, dx, dz, dt)` | moves `p = { x, y, z, vy }`: no tunnelling, up stairs, falls; returns on-ground |
| `move(p, dx, dz, r, flyer)` | the same without gravity (drones: `flyer` true) |
| `resolve(p, r)`, `free(x, z, r, y)`, `walkClear(...)` | push-out and clearance |
| `vaultTarget(x, y, z, dx, dz)` | `{ x, y, z, top }` to vault to, or null |
| `raycast(o, d, maxT)`, `sight(a, b)` | `t` or -1; `world.hit` (solid index, -2 floor, -3 ceiling), `world.axis` |
| `path(ax, az, ay, bx, bz, by, flags)` | `[[x, z, y, vault], ...]` on every level, or `[]`; vault 1 = vault from this point to the next; flags `PATH.zone`, `PATH.doors` (barricades closed) |
| `nearestNode`, `nodeAt`, `clearWalk`, `navNodes()` | path-node queries |
| `setAlive(i, alive)` | a breakable panel or door changed (paths open and close with it) |
| `dispose()` | free the core's copy (when a match or arena is done) |

`wasm/recoil_core.wasm` interface version is 4 (`rc_abi()`); the loader refuses a stale file.
Solid codes: 0 a floor you can stand on, 1 a barricade, 2 a breakable wall cell, 3 solid but
not a floor (wall tops, sills, rails: you slide off).
The controls module (`wasm/m7_controls.wasm`, `mc_*`) is separate and stays separate.

## Match state other code may read (read only)

`ModeGame.m` is the `Match`. Per actor: `x, y, z, vx, vy, vz, yaw, pitch, crouch, ads, hp,
alive, team, op, gun, kills, deaths, ab` (ability state), `carry`, `reinf`, `wire` (Bomb
defenders: reinforcements and wire rolls left), `hold` (`{ type: 'plant' | 'defuse' |
'reinforce' | 'barricade', t0, need, label }`). `m.rules` has `name`,
`phase` (Bomb), `score`, `keepIn(a, x, z)` (Bomb: the nearest spot a defender may stand),
`edgeAhead(a)`. `m.events` is the step's event list (`shot`, `hit`, `kill`, `spawn`,
`boom`, `msg`, `splinter`, `debris`, `reinforce`, `barricade`, `wire`, `gadget`, ...),
cleared by `ModeGame` every frame. Map state: `m.map.panels` (soft walls with their `cells`,
reinforced walls, barricades with `hp`, `slot`, `win`). Only the engine writes to these.

## Replays (milestone 10)

`ModeGame._record()` keeps 5 s of frames: per actor `[x, z, yaw, pitch, crouch, alive, y]`
(7 floats since milestone 3) plus shots and hits. Lean, ADS and recoil offset are not
recorded yet; add them to the frame (and bump the stride) rather than keeping a second
recorder.

## Network (milestone 9)

Battle's host is the authority: clients send input, the host simulates and sends states.
Fighters carry `y` already (stairs and upper floors work online through the same arena
physics). Battle grenades are still off in network games (bug B11 in `BASELINE.md`). The
match modes (TDM, CTF, Bomb) are offline only; their simulation is seeded and fixed-step
(60 Hz), so it can be run by a host later without changes to the rules. If Bomb goes
online, the destruction state to send is which wall cells and barricades stand, which panels
are reinforced (`m.map.panels`), and the gadgets (`m.ab.gadgets`, wire included).

## Graphics (milestone 6; details in [GRAPHICS.md](GRAPHICS.md))

- **Quality**: read `effectiveGraphics(settings)` (`js/render/quality.js`), never
  `settings.graphics` directly. High and Ultra need the Enhanced Graphics pack and run as
  Standard until it is installed; `needsPack(level)` says which levels do.
- **Pack**: `HDPack` (`js/render/hd-pack.js`).
  - `state` is `'none' | 'downloading' | 'installed' | 'update' | 'unsupported' | 'error'`;
    `ready` says whether it can be used.
  - `progress`, `size`, `error`, `onChange(fn)`.
  - `check()` reads the manifest; call it only when showing the pack.
  - `install()` is started by the player only. `remove()` frees the space.
- **Settings** (in `settings`): `fpsCounter`, `fpsTarget` (60 / 120 / 144 / 240), `ao`,
  `taa`, `sharpen`, plus the existing `graphics` and `renderScale`.
  - Commit `'post'` after changing `ao`, `taa` or `sharpen`.
  - Commit `'perf'` after changing `fpsCounter` or `fpsTarget`.
  - Commit `'graphics'` after changing the level.
- **Element ids** the tests use:
  - `#gfx` (the Graphics screen) and `#gx-download`, `#gx-remove`;
  - `.gx-prompt`, `.gx-status`;
  - `#gx-counter` (FPS counter checkbox);
  - `#perf` (the counter);
  - `#set-open-graphics` (button in Settings).

  Keep them if the screens are redesigned.
- **Drawing the world** in a new view (replays, spectating): call
  `deps.worldPost.draw(scene, camera)` when `deps.worldPost.active`, else
  `renderer.render(scene, camera)`. Then draw any first-person weapon on top after
  `renderer.clearDepth()`. This applies ambient occlusion, TAA and upscaling the same way
  everywhere.

## Audio

Audio is the UI side's (milestone 8, including any downloadable sound files). The engine
only calls `sfx` functions on its events; milestone 4 added one, `sfx.wire()` (the barbed
wire rattle), which a new audio system should keep a sound for.
