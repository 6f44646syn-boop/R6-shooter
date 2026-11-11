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

Network play uses the existing relay and WebRTC links with a player as host.

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

The existing recorders retain six seconds at up to 30 Hz. Match recording is sampled
from the fixed simulation loop. Each new frame has version 2. Match frames have
`stride: 13` with the original seven fields first, followed by ADS blend, lean,
catalogue gun slot, firing, recoil yaw and recoil pitch. Per-frame `loadouts` carry
attachment code, skin and optic. Unversioned seven-field match frames still play.

Battle frames retain their original ten fields and append lean, catalogue gun slot,
attachment code, skin and optic. Older ten-field frames still play. A kill cam owns
an immutable frame/shot window so live recorder trimming cannot move its shot cursor.
Stopping either mode clears its recording.

`js/replay/view.js` applies the live Human lean distance/roll and tangent-space ADS
FOV blend. Kill cams rebuild the recorded effective gun through `effectiveGun()`
and draw its first-person rig after the world-post pass. Battle's existing state
messages append lean and optic, with defaults for older peers and bounded lean input.

Hold the bound grenade action to follow your confirmed throw. Releasing it returns to
first person. Grenade deaths replay the recorded path and hold on the blast for one second.
The path may play faster to fit the respawn window. The camera clips against walls.
Online clients record positions from the existing host messages. Battle links the kill
feed to the blast by grenade ID. Match modes associate a grenade kill with its boom
and send the resulting ID in the same event stream. A kill cam uses first person if it
cannot establish the projectile identity or path.

The win screen uses the last player-caused kill in Battle, Team Deathmatch, Capture
the Flag and Bomb. The final kill always plays from the killer’s first-person view.
Afterward, the winning side appears in a 3D lineup with the full leaderboard.
Draws can line up the top six by kills and deaths. Matches without a recorded kill go
straight to results. The host sends the final scores with the end message.

## Bomb teammate spectating (milestone 11)

An eliminated player can follow living teammates after the kill cam. The fire and
ADS bindings cycle forward and backward, and 1–5 select a teammate directly. The
view switches to a surviving teammate when the current one dies, and returns to
the player when they respawn.

The camera uses the followed teammate’s ADS, lean, recoil, optic, attachments,
and skin. The spectator render hides enemy outlines and any enemy whose head and
torso are both occluded. The filter applies only during the spectator draw.
The same view works for local and online Bomb matches.

## Network (milestone 9, Claude)

Every mode plays online over the existing relay or a direct peer-to-peer link. There is no
server: one player hosts. In the lobby (Battle setup, Network) the host picks **Game**
(Battle, Team Deathmatch, Capture the Flag or Bomb) and, for the match modes, the map. Team
size, bot level, time, preparation and abilities come from that mode's own settings. Each
player brings the operator they last picked for the mode, their Bomb side and their
attachments (`hello`: `ops`, `side`, `atm`).

**Battle:** unchanged model (each player moves on their PC; the host owns damage and kills).
Grenades now work online (B11 fixed):
- The host throws every grenade (clients send `{ k: 'nade', yaw, pitch }`) and sends `nd`
  (start position, velocity, fuse) so each PC flies it on the same physics.
- The host alone applies damage and sends `blast` where it went off.
- Host bots throw too. The grenade count is in the snapshot.

**Match modes** (`js/modes/net-match.js`): `MatchHost` / `MatchClient`.
- **The host runs the simulation.** Players on other PCs are human actors with `remote`
  set (`Match` options `remotes`; `m.human()` is the local player, `m.isMe(a)` tests for it).
- **Clients build the same `Match` from the host's roster** (`o.roster`, same actor ids,
  `o.client: true`, so no bot brains) and never step it.
- **Movement:** each player moves on their PC and sends `st` about 30 times a second. The host
  keeps them out of walls. Spawns, rounds and the Bomb boundary move a player with `force`.
- **Shots:** `shot` = eye, direction and what the shooter saw hit. The host fires it in its
  simulation (walls, doors, gadgets, noise). It accepts a claimed hit its older positions
  missed only if the target is alive, an enemy, within 2 m of the claimed point and in sight.
- **Actions** (`act`): ability press and release, drone zap and recall, the breaching
  shotgun, Interact holds (plant, defuse, reinforce, barricade), grenade, knife. Drone controls
  ride on `st`.
- **The host sends:**
  - `ms` (fast, 20 Hz): positions, health, grenades, drones, breaching rounds;
  - `mstate`: rules, scores, carriers, holds, ability state, Bomb stock, when changed;
  - `mgad`: gadgets and gas clouds, when changed;
  - `mmap`: each wall or door panel's kind, health and cell bits, when the map changes;
  - `mev`: the frame's events (shots, hits, kills, explosions, messages).
- **References:** actors, gadgets and panels travel as `{ $a }`, `{ $g }` and `{ $p }`.
- **Leaving:** a player who leaves is replaced by a bot. The host leaving ends the match for
  everyone (`stopped`).
- **Pausing** in a network match only opens the menu; the match runs on.

Not done: client-side prediction of others (others glide between updates) and late joining
of a running match.

## Events and bots (milestone 5)

- **Events with a height:** `boom`, `door`, `pulse`, `wire`, `splinter`, `debris`, shots and
  noises carry `y` (feet or centre height). The bomb (`m.rules.bomb`) has `x, y, z`.
- **Path budget:** `m.pathBudget` is the number of new bot routes per simulation step (2). A
  bot over budget keeps its route and asks again at its next think. Anything that plans
  routes for many actors at once should go through `Brain.setGoal`.
- **Bomb bot report** (dev): `node tools/bomb-ai-report.mjs [matches per map] [maps]
  [difficulty]`.

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

## Weapons, attachments and effective stats (milestone 8, Claude)

This answers the request for an engine-owned per-actor effective weapon configuration.

**Entry point:** `effectiveGun(baseGun, code)` in `js/core/loadout.js`, backed by
`rust/loadout` (`wasm/loadout.wasm`, ABI 1; `tools/build-loadout.sh --test`).
- `code` is four digits, one per slot: muzzle, grip, underbarrel, magazine (ids in the
  table below). `null` or an invalid code (unknown id, or not allowed on that model)
  gives the measured loadout. Rust decides what is allowed (`lo_allowed`).
- Effects are relative to the loadout each gun's spray was measured with
  (`measurement.attachments` in `data/guns.json`, kept as `gun.measuredAttachments`). The
  measured loadout returns the catalogue gun itself (same object), so the data is
  reproduced exactly. The catalogue is never mutated.
- Other codes return a frozen copy, cached per gun and code: `magSize`, `reloadSeconds`,
  `adsSeconds`, `damage`, `sprayPath` / `sprayPathSmooth` / `jitter` (recoil), plus
  `hipCone`, `noise`, `flash`, `suppressed`, `laser`, `attach` (the code) and `base` (the
  catalogue gun).
- Use `baseOf(g)` / `slotIn(list, g)` to find a gun's catalogue entry; never
  `list.indexOf(g)`.

| Slot | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| muzzle | none | flash hider | compensator | muzzle brake | suppressor | extended barrel |
| grip | none | vertical grip | angled grip | | | |
| underbarrel | none | laser | | | | |
| magazine | standard | extended (LMGs: not allowed) | quick-change | | | |

**Who consumes it** (no consumer needed new rules: they read the gun they are given):
- `Weapon` (capacity, reload);
- `RecoilEngine` (spray, jitter);
- `Spread` (`hipCone`);
- Battle's ADS time scale;
- the match sim (`gunStats` carries `noise` / `suppressed`; a suppressed shot's
  `NOISE.shot` reach is multiplied by `noise`);
- shot sounds (suppressed: 45% gain);
- muzzle flashes (`flash`);
- `buildWorldGun` / `WeaponRig.setGun` (attachment models; cache keys include the code).

**Where codes come from:**
- **Range:** `localStorage['attach:<gun id>']`, chosen in the armory.
- **Match modes:** `Match` option `attach: { [gunId]: code }` for the human, applied in
  `Match.gunFor(human, id)` (also used on the Bomb side swap). Bots carry the measured loadout.
- **Battle network:** `hello`, `gun`, `look` and the roster carry `at` (the code). The host
  rebuilds the effective gun with `effectiveGun()`, so its damage and fire-rate checks use
  the Rust-validated stats. A client cannot claim an invalid combination: Rust falls back
  to the measured loadout.

**Codex (M10-M12):**
- Kill cams that draw the killer's gun should pass the killer's effective gun (`f.gun` /
  `a.gunData`) to `WeaponRig.setGun`, so attachments show.
- The Training Academy's recoil lessons can call `effectiveGun()` to compare loadouts.

**Pack animations:** see [GRAPHICS.md](GRAPHICS.md). `Weapon.reloadEmpty` is set at each
reload start; `WeaponRig.reloadEmpty` picks the empty-reload clip.

## Audio

Audio is the UI side's (milestone 8, including any downloadable sound files). The engine
only calls `sfx` functions on its events; milestone 4 added one, `sfx.wire()` (the barbed
wire rattle), which a new audio system should keep a sound for.

## Audio integration (Milestone 8, Codex)

`rust/m8_audio/`, `wasm/m8_audio.*` and `js/audio/` are owned by Codex. The audio
WASM is independent of `rust/core` (audio ABI 1, engine ABI 4). It calls no engine
exports directly. The browser adapter reads `CoreWorld.sight()` and `raycast()`
for propagation and underfoot material lookup, preserving all physics ownership.

- `Sfx.wire(vol, route, muffle)` preserves M4 barbed-wire rattle events and uses
  the same bounded voice graph. New splinter/reinforce/barricade cues retain their
  supplied heights; the wire HUD retains configurable grenade bindings.
- `Sfx.installPack(bytes)` / `Sfx.removePack()` opt into the pre-rendered bank.
  No automatic download; see [the pack handoff](../packs/audio/README.md), which
  includes loader code, tradeoffs, source assets and benchmark results for the
  future HD download manager.
- `Sfx.listen(camera)` follows the active camera's position, yaw, pitch and lean.
- `Sfx.locate(kind, source, camera, geometry, arena, options)` returns Rust-owned
  distance/gain/cutoff parameters and a WebAudio route. Sources with a real `y`
  use full 3D distance and occlusion.
- Match footsteps consume `m.noises`: `kind`, `range`, `id`, `team`, `x,y,z,t`.
  Zero noise ranges remain silent; this preserves silent match crouch walking.
- Battle/Range presentation steps use Rust cadence on existing actor poses.
  Battle's AI noise list is unchanged. Network clients use existing interpolated
  poses; no new message, transport or backend was added.
- Room floor textures come from `data.callouts[].floor`; Arena material kinds
  come from `arena.boxes`. The built Arena match maps preserve that box order.
- Replay audio remains a later extension of the existing recorder. See the
  Replays section for the versioned view-state layout.

### Requests for the engine owner

These requests do not change current engine behavior and are not implemented in
engine-owned files by this increment:

1. Please include the actual `y` on `boom` events in grenades, bomb rules and
   abilities, `door` events, gadget `pulse` events and M4 `wire` events. Those currently carry
   `x,z` only, even where the emitter can be on an upper floor. The audio adapter
   already accepts optional `e.y`; until supplied, those cues retain horizontal
   positioning at the listener's height. Shots, footsteps, Battle blasts and
   catcher events already have usable heights.
2. For future map additions, optional explicit surface/material metadata on
   floor regions and standable boxes would avoid guessed defaults for unknown
   kinds. Existing authored room floors and Arena kinds are supported now.
3. *(Done by Claude: see "Weapons, attachments and effective stats" above.)* For the next M8
   attachment increment, agree on an engine-owned per-actor effective weapon configuration
   entry point. It should accept a Rust-validated
   attachment result at spawn/loadout change for humans and bots, without
   mutating the shared base gun catalogue. Recoil, ADS, spread, ammo/reload and
   host-side validation must consume that same effective configuration. Codex
   will own the attachment policy, UI and existing network serialization.


## User-approved Bomb balance hooks (Codex)

The user explicitly requested Bomb-only defensive utility and ability buffs,
stronger vision/sound disruption and less attacker time. The separate
`rust/bomb_utility` policy is loaded before matches; the engine core stays ABI 4.
Small hooks in `modes/{sim,rules,map,abilities}.js` consume `m.utility` and a
copied ability config. No bot, physics, map-data or weapon implementation is
changed. See [BOMB_BALANCE_HANDOFF.md](BOMB_BALANCE_HANDOFF.md) for exact values,
merge locations and paired results. Attack time is now 120 s (`BOMB.action` is
a Rust-backed getter); late plants still get the full 40 s fuse. The requested
55% defender win rate remains unverified and is not claimed by this candidate.

For M5 integration, keep the small hooks and measure against the updated tactics.
The latest paired M4 bot sample still has early defender eliminations and strong
map variation; do not treat these utility changes as a completed tactics fix.

## Enhanced pack v2 (Codex contribution)

The player-started HDPack lifecycle now includes the 83-clip audio bank, bounded map
surfaces, RRM soldier equipment and skin finish parameters. `js/audio/pack-bridge.js`
connects the existing Sfx instance; decoding waits for user-gesture unlock. `installPack`
accepts an optional completion guard to reject stale results after pack removal.
`js/render/pack-art.js` loads presentation assets only through `HDPack.file()` and supplies
`applyMapArt()`/`packArt`; no physics or map-data exports change. High/Ultra gates remain.
See [PACK_INTEGRATION.md](PACK_INTEGRATION.md) for limits, measurements and failing checks.
