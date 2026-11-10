# Recoil Range: how the game is built

A map of every system, what it depends on, and what language it is in. Updated as the engine
moves to Rust (see `MIGRATION.md`).

The game is a static site (GitHub Pages): `index.html`, `css/`, `js/`, `data/`, `wasm/`,
`vendor/three/`. Nothing is loaded from other sites while it runs.

## The three engines

| Engine | Used by | Code | Notes |
|---|---|---|---|
| Range | Shooting range | `js/main.js`, `js/core/`, `js/scene/`, `js/render/`, `js/ui/` | The aim trainer: measured recoil, sights, sensitivity. |
| Battle | Battle vs bots, split screen, network battle | `js/battle/` | Height-aware maps (floors, stairs, ramps, vaulting), free-for-all style. |
| Match | Team Deathmatch, Capture the Flag, Bomb | `js/modes/` | Fixed 60 Hz simulation, seeded and repeatable; teams, operators, abilities. |

All three share the player's own systems (look, recoil, spread, weapon, sights, weapon model)
through `js/battle/human.js`, and one WebGL renderer (three.js r160).

## Systems

### Shared core (`js/core/`) — pure logic, no drawing
| File | Does | Depends on |
|---|---|---|
| `guns.js` | Loads and checks `data/guns.json` (10 guns, measured spray paths) | optics, recoil |
| `recoil.js` | Recoil offset over time from a gun's spray path | prng |
| `spread.js` | Hip-fire spread cone | — |
| `weapon.js` | Magazine, fire rate, reload timing | — |
| `look.js`, `sensitivity.js` | Mouse counts to view angles; cm/360 and per-sight multipliers | — |
| `optics.js` | The 15 sights and their zoom data | — |
| `player.js` | Range movement, lean, crouch | — |
| `settings.js`, `profile.js`, `skins.js`, `legend.js` | Saved settings, points and unlocked skins (localStorage) | prng |
| `pointer-lock.js`, `prng.js` | Mouse capture; seeded random numbers | — |

### Drawing (`js/scene/`, `js/render/`, `js/ui/`, `js/audio/`)
| Part | Does |
|---|---|
| `scene/range.js`, `range-tex.js`, `dummy.js`, `dots.js`, `holes.js` | The range room, targets, bullet holes |
| `scene/viewmodel.js`, `sight-model.js`, `matcap.js`, `low.js` | First-person gun, sights, skins, low-graphics materials |
| `render/lens-post.js`, `gpu-tex.js` | Scope lens pass; textures drawn on the GPU |
| `ui/*` | HUD, crosshair, settings form, packs, scope overlay, debug readout |
| `audio/sfx.js`, `voice.js` | Synthesised sounds (WebAudio), bot voice lines (speech) |

### Battle (`js/battle/`)
| File | Does | Depends on |
|---|---|---|
| `maps.js` | The four Battle maps as data plus their textures | three.js |
| `solids.js` | A Battle map's layout as solid boxes (stairs as steps, ramps as slices); shared with the match maps | — |
| `arena.js` | Builds a map's scene, spawns, cover spots, weather; collision, raycasts and paths are asked of the Rust core | maps, solids, three.js, **Rust core** |
| `battle.js` | The match: scoring, respawn, bullets, kill cam, HUD, network host/client | arena, fighter, bot, human, nades |
| `bot.js` | Battle bot brain (aim model, hearing, cover, radio) | core |
| `human.js` | The player controller used by Battle and the match modes | core, scene |
| `fighter.js`, `soldier.js` | Soldier model, outlines, spawn shield, teammate silhouette | three.js |
| `nades.js` | Battle grenades | three.js |

### Match modes (`js/modes/`)
| File | Does | Depends on |
|---|---|---|
| `geom.js` | Ray/box/sphere/capsule tests, circle-box push | — |
| `map.js` | A map from `data/maps/*.json`: solids, breakable panels, doors; collision, stairs, falling, vaulting, raycast, line of sight and paths on every level are asked of the Rust core | **Rust core** |
| `sim.js` | The match: actors, spawning, damage, shooting, knife, the 60 Hz step | map, bots, rules, abilities, nades |
| `bots.js` | Bot brain: perception, utility states, aim, movement, doors | sim |
| `rules.js` | Team Deathmatch, Capture the Flag, Bomb (rounds, roles, objectives, the defenders' boundary) | — |
| `abilities.js` | The ten operator abilities, gadgets, drones | geom |
| `nades.js` | Frag grenades | geom |
| `game.js` | Browser side: scene, player, HUD, effects, death replay | everything above, battle/human, fighter |
| `look.js`, `gadget-look.js` | Map and gadget visuals | three.js |

### Network (`js/net/`, `relay/`)
`link.js` (WebRTC data channels with copy-paste codes), `relay.js` (game codes through the
relay), `relay/` (a Cloudflare Worker that only passes messages between players). Online play
is Battle only; the host's browser is the authority.

### Rust core (`rust/core/` → `wasm/recoil_core.wasm`)
See `MIGRATION.md` for what lives here. Loaded by `js/wasm/core.js`; `js/wasm/world.js`
(`CoreWorld`) is the one JavaScript face of a map inside the core, used by Battle's arena and
the match maps alike.

### Data, tools, tests
| Path | Does |
|---|---|
| `data/guns.json`, `optics.json`, `sens.json`, `ops.json`, `abilities.json`, `maps/*.json` | Game data |
| `tools/build-maps.mjs` | Builds the match maps (layout → places on every level, cover; checks every spot is reachable) |
| `tools/build-wasm.sh` | Compiles the Rust core to WebAssembly |
| `tools/stamp.mjs` | Cache-busting version stamp before publishing |
| `tools/check-modes.mjs` | Unit tests and 20 seeded bot matches per mode |
| `tools/bench-sim.mjs`, `bench-browser.mjs` | Speed and drawing measurements |
| `tools/play-through.mjs` | Plays every mode with real clicks and keys, reports errors |
| `tests/run.mjs` | The browser test suite (`npm test`) |

## How a match frame runs (match modes)
1. `game.js` reads input and moves the player with `human.js` (collision through the map).
2. The simulation steps at 60 Hz (`sim.js`): rules → bots think/act → abilities → grenades →
   bodies pushed apart → noises → win checks.
3. `game.js` handles the step's events (shots, hits, kills), places the soldier models, gadgets
   and effects, records the replay buffer, updates the HUD.
4. `render()` draws the map scene, then the first-person gun on top.
