# Baseline and measurements

Numbers recorded before the overhaul (commit `f79359b`, 9 Nov 2026), so every later "faster" or
"lighter" claim has something real to be compared with. Later sections are added per milestone.

How to re-measure: `node tools/bench-sim.mjs`, `node tools/bench-browser.mjs`,
`node tools/check-modes.mjs`, `npm test`, `node tools/play-through.mjs`.

**Read this first.** These were measured in a cloud container with no graphics card: the
browser draws in software there. So there is **no real frames-per-second figure** in this file.
What is real: test results, simulation speed, how much each scene asks the graphics card to
draw (draw calls, triangles), memory, and load times on that machine.

## Milestone 0 baseline

### Tests
| Suite | Result |
|---|---|
| `npm test` (browser suite) | 156 passed, 0 failed |
| `node tools/check-modes.mjs` (unit tests + 20 bot matches per mode) | 79 passed, 0 failed |
| `node tools/play-through.mjs` (real clicks and keys through every mode) | no page errors |

### Simulation speed (Node v22.23.4)
The match kernel, operations per second (seeded questions, best of 3):

| Map | Solids | Waypoints | Raycasts/s | Sight checks/s | Paths/s | Push-outs/s | Walk checks/s |
|---|---|---|---|---|---|---|---|
| yard | 37 | 524 | 2,446,779 | 1,601,089 | 13,776 | 1,794,840 | 1,778,502 |
| containers | 55 | 433 | 448,808 | 3,175,382 | 20,001 | 1,603,239 | 2,504,307 |
| winter | 87 | 433 | 2,740,813 | 2,796,806 | 20,118 | 2,318,491 | 3,542,020 |
| casino | 161 | 233 | 2,024,793 | 2,151,409 | 16,954 | 3,730,818 | 2,734,738 |
| school | 38 | 308 | 3,322,317 | 3,861,813 | 30,423 | 6,653,006 | 4,312,534 |
| ranch | 114 | 799 | 2,273,091 | 2,105,675 | 5,799 | 2,164,280 | 1,612,336 |
| embassy | 128 | 748 | 2,640,855 | 2,863,672 | 5,458 | 5,171,353 | 2,196,541 |
| workshop | 119 | 809 | 2,546,566 | 2,828,710 | 6,593 | 4,847,310 | 2,232,386 |

Whole 5v5 bot matches, 60 simulated seconds, time per 60 Hz step:

| Match | Average ms | 99th percentile ms | Worst ms | Times faster than real time |
|---|---|---|---|---|
| tdm/containers | 0.0509 | 0.3962 | 3.95 | 327x |
| tdm/casino | 0.0466 | 0.3454 | 1.263 | 358x |
| ctf/winter | 0.053 | 0.3763 | 1.683 | 314x |
| ctf/yard | 0.0409 | 0.2706 | 1.904 | 407x |
| bomb/ranch | 0.0593 | 0.4954 | 4.795 | 281x |
| bomb/embassy | 0.0661 | 0.7396 | 4.198 | 252x |
| bomb/workshop | 0.0421 | 0.3543 | 1.172 | 396x |

A frame at 60 FPS has 16.7 ms. The simulation uses about 0.05 ms of it on average, so the
simulation is not what limits frame rate; drawing is. The worst steps (2 to 8 ms) are path
searches and memory clean-up pauses.

### What each scene asks the graphics card to draw
"Whole scene" is every object drawn from a fixed camera above the map (the same picture on
every run). "In play" is one first-person frame. Standard graphics unless noted.

| Scene | Whole scene: draw calls | Triangles | In play: draw calls | Triangles | Update ms per frame |
|---|---|---|---|---|---|
| range | 20 | 17,346 | 34 | 26,552 | 0.005 |
| battle/yard | 75 | 30,404 | 82 | 35,380 | 0.059 |
| battle/winter | 98 | 35,518 | 106 | 40,506 | 0.044 |
| battle/casino | 130 | 33,846 | 135 | 38,780 | 0.084 |
| battle/school | 92 | 30,684 | 99 | 35,670 | 0.068 |
| tdm/containers | 109 | 55,322 | 101 | 54,395 | 0.187 |
| tdm/casino | 157 | 54,554 | 163 | 61,823 | 0.171 |
| ctf/winter | 137 | 48,946 | 113 | 39,848 | 0.277 |
| ctf/school | 127 | 43,904 | 117 | 46,991 | 0.153 |
| ctf/yard | 123 | 79,460 | 114 | 78,499 | 0.291 |
| bomb/ranch | 206 | 71,260 | 197 | 70,293 | 0.069 |
| bomb/embassy | 212 | 82,872 | 214 | 90,069 | 0.072 |
| bomb/workshop | 205 | 82,845 | 159 | 71,864 | 0.143 |

By graphics setting (in play):

| Scene | Low | Standard | High | Ultra |
|---|---|---|---|---|
| range | 34 calls / 26,552 tris | 34 calls / 26,552 tris | 44 calls / 34,814 tris | 57 calls / 43,688 tris |
| battle/yard | 81 calls / 35,378 tris | 82 calls / 35,380 tris | 130 calls / 48,530 tris | 132 calls / 49,130 tris |
| battle/winter | 101 calls / 40,424 tris | 106 calls / 40,506 tris | 167 calls / 58,726 tris | 170 calls / 59,280 tris |
| battle/casino | 135 calls / 38,642 tris | 135 calls / 38,780 tris | 209 calls / 54,074 tris | 206 calls / 54,388 tris |
| battle/school | 98 calls / 35,658 tris | 99 calls / 35,670 tris | 146 calls / 49,578 tris | 151 calls / 50,214 tris |
| tdm/containers | 102 calls / 54,443 tris | 101 calls / 54,395 tris | 102 calls / 54,443 tris | 108 calls / 55,059 tris |
| tdm/casino | 164 calls / 61,871 tris | 163 calls / 61,823 tris | 167 calls / 65,891 tris | 258 calls / 90,215 tris |
| ctf/winter | 113 calls / 39,848 tris | 113 calls / 39,848 tris | 116 calls / 39,808 tris | 223 calls / 83,206 tris |
| ctf/school | 119 calls / 47,087 tris | 117 calls / 46,991 tris | 119 calls / 47,087 tris | 190 calls / 74,127 tris |
| ctf/yard | 114 calls / 78,499 tris | 114 calls / 78,499 tris | 114 calls / 78,499 tris | 183 calls / 117,285 tris |
| bomb/ranch | 196 calls / 70,245 tris | 197 calls / 70,293 tris | 286 calls / 111,981 tris | 290 calls / 112,641 tris |
| bomb/embassy | 215 calls / 90,069 tris | 214 calls / 90,069 tris | 304 calls / 131,905 tris | 307 calls / 132,565 tris |
| bomb/workshop | 158 calls / 71,864 tris | 159 calls / 71,864 tris | 241 calls / 113,606 tris | 245 calls / 114,266 tris |

### Load times (software-rendered container)
| What | Time |
|---|---|
| Page open to game ready | 1.2 to 4.4 s (two runs) |
| First Bomb match start | 141 ms |
| First Battle start (Casino) | 2.8 s (the map's textures are drawn in code at this point) |

### Memory across repeated match starts (Bomb, one page)
| Start | Geometries on the graphics card | Textures | JS memory (MB) |
|---|---|---|---|
| 1 | 146 | 46 | 14.2 |
| 2 | 193 | 52 | 14.9 |
| 3 | 233 | 55 | 15.6 |
| 4 | 256 | 56 | 15.7 |
| 5 | 303 | 57 | 16.1 |
| 6 | 350 | 58 | 16.4 |

Geometries grow by about 40 with every new match: a leak (bug B4 below).

### Bugs found in the audit
| # | Bug | Cause | Fixed in |
|---|---|---|---|
| B1 | Drones pass through walls in Bomb | One collision check per frame: a step is speed x frame time, so under about 20 FPS a drone step is longer than a wall is thick and the push-out finishes on the far side. Bot drones always took 0.4 m steps. | Milestone 1 |
| B2 | A sprinting player can pop through a thin wall or boarded door on a long frame (Battle and match modes) | The same single check per frame | Milestone 1 |
| B3 | Charge Dash knockback can put the victim on the other side of a wall | Victim placed 2.5 m away with no check in between | Milestone 1 |
| B4 | Graphics memory grows with every match in the match modes | The previous match's map geometry, floor textures and shadow map were never freed | Milestone 1 |
| B5 | A drone can be deployed straight through a wall you are facing; a spawn can land across a thin wall | Placed 0.6 m ahead (or offset) without a check in between | Milestone 1 |
| B6 | The previous match's kill feed stays on screen when a new match starts | Feed list cleared but not redrawn | Milestone 1 |
| B7 | Death replay in Team Deathmatch and Capture the Flag is cut off by the respawn | Replay ran 3.4 s, respawn is 3 s | Milestone 1 |
| B8 | You can knife or throw a grenade from your body while driving a drone | No check | Milestone 1 |
| B9 | Defender bots break boarded doors on the way to their posts in prep | Doors block defenders too | **Fixed in milestone 4** (interior doorways start open; defender paths treat barricades as closed) |
| B10 | Match modes on the Battle maps are ground floor only | The match engine has no heights | **Fixed in milestone 3** |
| B11 | Battle grenades are off in network games | Not sent to the other player | Later (relay only) |
| B12 | Step label says "3 Weapon" where step 3 is the operator | Label | Milestone 7 (UI redesign) |

## Milestone 1: bug fixes and drone collision

### The drone bug, measured
The cause was one collision check per frame. A drone moves 6 m/s, so at 10 to 15 FPS one step
is 0.4 to 0.6 m: longer than a wall is thick. The step put the drone's centre past the middle
of the wall and the push-out then moved it out on the far side. The fix cuts every move into
steps shorter than half the mover's radius, each followed by the push-out, so the centre can
never cross a face. Players, bots, Charge Dash, its knockback, drone deployment and spawn
offsets all move this way now.

Every wall, soft wall, reinforced wall and boarded door on Ranch, Embassy, Workshop and Depot,
driven at from both sides every 0.75 m (`node tools/check-modes.mjs`):

| Mover | Frame rates | Speed | Drives | Crossings before | Crossings after |
|---|---|---|---|---|---|
| Drone (old move) | 10 and 15 FPS | 6 m/s | — | 4,013 | — |
| Drone | 144 to 10 FPS | 6 and 30 m/s | 16,128 | — | 0 |
| Player body | 144 to 10 FPS | 5.9 m/s (sprint) | 12,198 | — | 0 |
| Charge Dash | 60 and 10 FPS | 17.2 m/s | 4,066 | — | 0 |
| Drone under boarded doors | 60 and 10 FPS | 6 m/s | 324 | — | 324 pass under, as intended |

In the browser at 10 FPS (`npm test`): a drone held against the outer wall for 3 s stays
outside; it cannot pass a reinforced wall; it rolls under a boarded door; a sprinting player
stays outside a wall and a boarded door; in Battle a sprinting player stays on their side of a
0.25 m Casino wall.

### Memory across repeated match starts (Bomb, one page)
| | Start 1 | Start 2 | Start 3 | Start 4 | Start 5 |
|---|---|---|---|---|---|
| Geometries before | 146 | 193 | 233 | 256 | 303 |
| Geometries after | 382 | 382 | 382 | 382 | 382 |

(The two rows come from different test pages, so compare the growth, not the absolute numbers:
before, about +40 per match; after, none.)

### Tests after milestone 1
| Suite | Result |
|---|---|
| `npm test` | 166 passed, 0 failed (10 new: match modes in the browser) |
| `node tools/check-modes.mjs` | 86 passed, 0 failed (7 new: collision) |
| `node tools/play-through.mjs` | no page errors |

Bugs B1 to B8 from the audit are fixed. B9 to B12 are scheduled in later milestones.

## Milestone 2: Rust core (WebAssembly)

The match-map kernel (collision, swept movement, raycasts, line of sight, pathfinding, door
and panel state) now runs in Rust (`rust/core`, 34 KB of WebAssembly, no outside libraries).
The JavaScript it replaced is kept only as a test reference in `tools/ref-js/`.

### Same answers
`node tools/check-core.mjs` asks the old JavaScript and the Rust core the same seeded questions
on all nine maps, with panels whole, broken and reset: 102,000 raycasts, 102,000 sight checks,
102,000 push-outs, 51,000 moves, 102,000 free checks, 102,000 walk checks, 25,500 neighbour
lists, 25,500 nearest-waypoint lookups, 8,500 paths, 25,500 door lookups. Every answer is
identical, bit for bit. Rebuilding the maps with the Rust core gives byte-identical map files.

### Speed, before and after (same machine, same seeded questions; operations per second)

| Map | Raycasts | | Sight checks | | Paths | | Push-outs | | Walk checks | |
|---|---|---|---|---|---|---|---|---|---|---|
| yard | 1,733,186 | 0.7x | 2,085,054 | 1.3x | 33,145 | 2.4x | 3,214,455 | 1.8x | 4,458,459 | 2.5x |
| containers | 2,048,934 | 4.6x | 2,763,704 | 0.9x | 31,111 | 1.6x | 4,181,734 | 2.6x | 5,029,561 | 2.0x |
| winter | 1,828,454 | 0.7x | 3,723,843 | 1.3x | 45,855 | 2.3x | 7,813,080 | 3.4x | 6,493,317 | 1.8x |
| casino | 2,099,438 | 1.0x | 2,814,333 | 1.3x | 33,158 | 2.0x | 3,795,146 | 1.0x | 3,365,745 | 1.2x |
| school | 3,386,338 | 1.0x | 4,194,160 | 1.1x | 65,354 | 2.1x | 7,789,982 | 1.2x | 7,999,888 | 1.9x |
| ranch | 2,484,361 | 1.1x | 2,443,090 | 1.2x | 15,994 | 2.8x | 3,932,216 | 1.8x | 2,643,682 | 1.6x |
| embassy | 3,375,818 | 1.3x | 3,805,526 | 1.3x | 15,228 | 2.8x | 7,438,636 | 1.4x | 5,422,597 | 2.5x |
| workshop | 3,168,990 | 1.2x | 4,023,222 | 1.4x | 17,417 | 2.6x | 6,981,205 | 1.4x | 5,071,483 | 2.3x |

(Each pair: the Rust figure, then how many times the JavaScript baseline it is.)

Whole 5v5 bot matches, time per 60 Hz step:

| Match | Average ms: before | after | 99th percentile ms: before | after | Worst ms: before | after |
|---|---|---|---|---|---|---|
| tdm/containers | 0.0509 | 0.0379 | 0.3962 | 0.1899 | 3.95 | 2.479 |
| tdm/casino | 0.0466 | 0.0387 | 0.3454 | 0.1459 | 1.263 | 2.817 |
| ctf/winter | 0.053 | 0.0395 | 0.3763 | 0.1541 | 1.683 | 4.283 |
| ctf/yard | 0.0409 | 0.0325 | 0.2706 | 0.1115 | 1.904 | 2.588 |
| bomb/ranch | 0.0593 | 0.0544 | 0.4954 | 0.3372 | 4.795 | 4.19 |
| bomb/embassy | 0.0661 | 0.0486 | 0.7396 | 0.3024 | 4.198 | 1.368 |
| bomb/workshop | 0.0421 | 0.033 | 0.3543 | 0.1371 | 1.172 | 4.336 |

What this means: pathfinding is 2 to 3 times faster, push-outs and walk checks about 1.5 to
2.5 times, sight checks slightly faster, raycasts about the same (the figures move by 20-30%
between runs). Whole matches run 15-25% faster on average and the 99th-percentile step is
roughly halved. The simulation was already a small part of a frame (0.05 ms of 16.7), so this
does **not** raise frame rate by itself; drawing is the limit, and that is milestone 6.

### Tests after milestone 2
| Suite | Result |
|---|---|
| `cargo test` (Rust unit tests) | 9 passed |
| `node tools/check-core.mjs` (parity + build is current) | 12 passed |
| `npm test` (now runs check-core first) | 179 passed, 0 failed (12 core checks + 167 browser checks) |
| `node tools/check-modes.mjs` | 82 passed, 0 failed (4 box tests moved to Rust unit tests) |
| `node tools/play-through.mjs` | no page errors |

## Milestone 3: physics, stairs, vaulting and the Bomb boundary

One body and one physics for every mode. Battle's height-aware collision (floors, stairs,
ramps, upper levels, falling, vaulting) and its multi-level pathfinding moved into the Rust
core, and the match modes (Team Deathmatch, Capture the Flag, Bomb) now use the same code.
Before, the match modes were ground floor only (B10): stairs were cover and upper floors
were a ceiling.

What changed for a player:
- Team Deathmatch and Capture the Flag on Container Yard, Winter Cabin, Jesse's Casino and
  School Basement have their stairs, ramps and upper floors (the Casino has 15 levels, the
  top 3.6 m up). You walk, sprint and crouch on them, fall off edges and land.
- C vaults over low cover or climbs onto a ledge up to 1.5 m in every mode (it was Battle
  only). It never goes over a full-height wall, a soft or reinforced wall or a boarded door.
- Bomb: defenders cannot leave the building, through a door, a window or a breached wall.
  Near a way out a quiet note says "Defenders stay inside the building". Attackers move
  freely. Defender bots plan their routes inside the building too.
- Bots in every mode find their way up and down stairs and ramps, and avoid acid.
- Gadgets, grenades, drones and the gas cloud work at the height they are at; drones roll
  up ramps (not stairs) and fall off ledges.
- The School Basement acid hurts in the match modes too.

### Same answers as the code it replaced
`node tools/check-core.mjs` asks the old JavaScript (`tools/ref-js/arena-ref.mjs`, Battle's
arena as it was) and the Rust core the same seeded questions on the four Battle maps, on
every level: 26,837 path nodes, 80,000 floor heights, 80,000 raycasts (with the face hit),
40,000 sight lines, 80,000 node lookups, 12,000 nearest nodes, 24,000 straight-walk checks
and 6,000 paths. All identical. Two things are deliberately not bit-identical:
- Movement: the core pushes a body out of walls in two passes (the old code did one), so
  at corners it ends up slightly differently. Over 224,400 steps of random walks at 60, 30
  and 15 FPS: the same position in 99.49%; a body was left overlapping a wall after a step
  249 times with the core and 838 times with the old code.
- Vaulting: 118 of 80,000 tries give a different answer (1,893 vaults). The core refuses
  landings where the body would not fit, and lets you climb from the side onto stairs and
  ramps. Every landing spot is checked to be free and standing.
The match maps' ground floor is still checked against the milestone 1 map code: identical.

### Physics on every map (`node tools/check-modes.mjs`)
- 540 walks along the game's own paths between random places on all nine maps, at 60 and
  15 FPS: all arrive.
- 34 climbs to every upper level and 34 descents: all arrive.
- 40 walks off the edge of an upper level: all land standing, inside the map.
- 48 doorways of the Bomb buildings walked through both ways: all within 4 s.
- 216 of 225 low obstacles (0.5 to 1.5 m) can be vaulted from at least one side. The other
  nine are pressed against walls or other cover on every side, so there is nowhere to land.
- 799 tries to vault full-height walls, panels and doors: none succeed.
- 44 opened doors and breached outside walls on the three Bomb maps: a defender pushing out
  through each never gets past the wall line; an attacker walks out of each freely.
- 60 bot matches (20 per mode): nobody below the floor, no defender outside the building at
  any step, bots go upstairs in 15 of 16 matches on maps with upper floors, no bot stuck
  more than 3 s.

### Played in the browser (`npm test`, real key presses)
Up the Casino stairs to the top floor with W held (5.8 s), camera at eye height, a bot
upstairs drawn upstairs, crouching up there, off the edge and landing, back down at 15 FPS,
C over a 1.2 m crate, C at a wall doing nothing, a Bomb defender stopped at an opened door
and a breached wall at 60 and 10 FPS with the warning shown, a defender bot stopped there
too, an attacker walking out of the same door, and Battle climbing the same stairs.

### Speed (same machine; operations per second, Rust core)

| Map | Paths: M2 | M3 | Raycasts: M2 | M3 | Push-outs: M2 | M3 |
|---|---|---|---|---|---|---|
| yard | 33,145 | 8,148 | 1,733,186 | 1,503,180 | 3,214,455 | 4,277,572 |
| containers | 31,111 | 9,760 | 2,048,934 | 2,684,207 | 4,181,734 | 4,793,220 |
| winter | 45,855 | 11,033 | 1,828,454 | 2,997,117 | 7,813,080 | 7,294,704 |
| casino | 33,158 | 3,637 | 2,099,438 | 1,966,406 | 3,795,146 | 4,877,008 |
| school | 65,354 | 15,739 | 3,386,338 | 2,416,222 | 7,789,982 | 8,762,629 |
| ranch | 15,994 | 4,636 | 2,484,361 | 3,772,236 | 3,932,216 | 5,518,939 |
| embassy | 15,228 | 3,603 | 3,375,818 | 3,813,334 | 7,438,636 | 7,483,056 |
| workshop | 17,417 | 4,503 | 3,168,990 | 3,373,614 | 6,981,205 | 7,038,462 |

Paths are 3 to 9 times slower than in milestone 2. That is the price of finding them on every
level over 0.5 m cells instead of over a 2 m ground-floor waypoint graph. Raycasts and
push-outs are about the same (the figures move 20-30% between runs). On Battle's maps the
core finds paths about 2 times faster than the JavaScript it replaced (0.19 ms against 0.41
ms on Container Yard, 0.35 against 0.70 on the Casino).

Whole 5v5 bot matches, ms per 60 Hz step:

| Match | Average: M2 | M3 | 99th percentile: M2 | M3 | Worst: M2 | M3 |
|---|---|---|---|---|---|---|
| tdm/containers | 0.0379 | 0.0577 | 0.1899 | 0.4679 | 2.479 | 3.882 |
| tdm/casino | 0.0387 | 0.0557 | 0.1459 | 0.6537 | 2.817 | 2.818 |
| ctf/winter | 0.0395 | 0.0863 | 0.1541 | 1.5656 | 4.283 | 6.696 |
| ctf/yard | 0.0325 | 0.0304 | 0.1115 | 0.2541 | 2.588 | 1.604 |
| bomb/ranch | 0.0544 | 0.0709 | 0.3372 | 0.6099 | 4.19 | 4.329 |
| bomb/embassy | 0.0486 | 0.0494 | 0.3024 | 0.5047 | 1.368 | 2.435 |
| bomb/workshop | 0.033 | 0.0457 | 0.1371 | 0.4049 | 4.336 | 2.523 |

The simulation got slower: on average 0.03 to 0.09 ms per step, at worst a few ms when
several bots plan long paths in the same step. That is still well inside a 16.7 ms frame,
and drawing is still the limit (milestone 6). Spreading path planning across steps is in
milestone 5 (bot AI).

### Tests after milestone 3
| Suite | Result |
|---|---|
| `cargo test` (Rust unit tests) | 18 passed |
| `node tools/check-core.mjs` | 20 passed |
| `npm test` (check-core, then the browser suite) | 203 passed, 0 failed |
| `node tools/check-modes.mjs` | 97 passed, 0 failed |
| `node tools/play-through.mjs` | no page errors |

Known limits: the nine low obstacles above have no room to vault; Battle grenades are still
off in network games (B11); defender bots still break boarded doors in prep (B9, milestone 4).
Movement is not checked by anyone but the player's own browser (there is no server).

## Milestone 4: Bomb maps, destruction and barbed wire

### The maps
Ranch, Embassy and Workshop were rebuilt bigger, with two storeys and more ways in. Every
map is original. Each new area gives a new angle, route or way in; none is empty space.

| Map | Map area | Building | Rooms (ground + upstairs) | Ways in through the outside walls (ground + upstairs) | Upstairs | Places a body can reach |
|---|---|---|---|---|---|---|
| Ranch | 80 x 60 m (was 68 x 48) | 52 x 28 m | 10 + 2 | 16 (6 doors, 7 windows, 3 soft walls) + 2 | loft, bedroom, balcony with back stairs | 1,167 on 10 levels |
| Embassy | 84 x 64 m (was 66 x 50) | 56 x 36 m | 14 + 5 | 19 (5 doors, 9 windows, 3 soft, 2 reinforced) + 4 | north wing (3 rooms), two landings, fire escape | 1,391 on 10 levels |
| Workshop | 84 x 64 m (was 68 x 48) | 56 x 34 m | 10 + 2 | 19 (8 doors, 6 windows, 5 soft walls) + 3 | manager's office, drafting room, garage catwalk, bridge, outside stairs | 1,423 on 11 levels |

- **Ranch:** the house gained a dining room, laundry, entry hall, a workshop off the garage
  and a loft with a bedroom (stairs in the living room). A balcony with back stairs is the
  attackers' way upstairs. Outside: a barn, a corral and a trailer.
- **Embassy:** a two-storey north wing over the archives (the site), landings in the west
  and east halls with windows over the courtyard, a vault with reinforced walls and a fire
  escape.
- **Workshop:** a double-height garage (the site) with a catwalk joined by a bridge over the
  maintenance corridor to the offices' upper floor; storage rooms, a paint shop, a server
  room with reinforced walls, lockers, a loading bay and outside stairs.

### New in Bomb
- **Windows:** a 1 m sill to vault and an opening to 2.3 m. Outside windows start boarded,
  as outside doors do; windows inside the building start open.
- **Interior doorways** start open, so defender bots no longer break their own doors (B9).
  Defenders barricade a doorway or window by holding E in it (1.5 s).
- **Reinforcing:** defenders hold E at a soft wall for 2.5 s (two each a round). It turns
  to metal, and only a Wall Charge or Breach Rounds open it after that. Walls are soft again
  next round.
- **Barbed wire:** two rolls for each defender in Bomb, in place of grenades (Caps Lock). It
  is 2.4 m long and laid across the way you face. It slows attackers to 40%, does 2 damage a
  second while they move through it, rattles (heard 14 m away) and snags drones (60%). Both
  teams see it. Three shots, a knife or any blast clears it.
- **Destruction:** soft walls are grids of cells (3 across, 4 up). Bullets chip a cell
  open in about 8 shots, a knife opens one at once, and blasts open the cells near them. A
  hole of two cells across and four up is a way through; a hole above an intact bottom row
  can be vaulted. Barricades splinter and darken as they take hits. Breaks throw debris.
- **Preparation time** is a match option (15 to 90 s; default 30).
- **Bots:** they vault: paths now include vault links over sills, rails and low cover,
  marked so bots, and the test walker, press vault there. Defender bots reinforce the
  site's walls, barricade its doorways and lay wire just inside a way in during prep.
  Attacker bots knife barricades and wire in their way.

### Engine fixes found by the new tests
- A drop in a path could fall "through" an upper floor wherever the floor had no walkable
  cell next to furniture. Drops now land on the floor actually underneath. The same bug was
  in Battle's old code, and the reference copy carries the fix.
- A body starting inside a stack of solid stair steps could be pushed through the wall
  beside them. Now a move that leaves a body overlapping something it cannot be pushed out
  of stops there. The new Rust test covers it.
- Wall tops, sills and rails are not floors any more, so nobody can walk along the top of
  a wall from an upper floor.

### Tests
| Check | Result |
|---|---|
| Physics on every map | 540 walks with 288 vaults on the way, 96 climbs and 96 descents, 113 falls, 94 doorways both ways: all arrive |
| Vaulting | 263 of 273 low obstacles vaultable from at least one side (the rest have no room to land); never over a full wall, panel or barricade |
| Defenders kept inside | 77 opened doors and breached outside walls: no defender gets past the wall line; attackers walk out of each (52 of 52) |
| Played in the browser | reinforcing, barricading, wire (laying, slowing, damage, knifing it), bullet and knife holes, knifing a boarded window open and vaulting through it, prep time 45 s |

### Balance (not fixed: milestone 5)
Bot-only Bomb matches, 8 per map, about 50 rounds each, share of rounds won by attackers:

| Code and maps | Ranch | Embassy | Workshop |
|---|---|---|---|
| Milestone 3 (old maps) | 62% | 74% | 74% |
| Milestone 4 (new maps) | 69 to 82% | 80 to 88% | 80 to 90% |

Attackers won more than before. Almost every round ends with all defenders dead, and
defenders die a median of 9 s into the action phase. Boarding the outside windows helped a
little. Switching off wall chipping or the defenders' prep jobs changed nothing, and nor did
a faster reaction for defenders holding an angle (reverted). The rooms are bigger and have
more ways in, and defender bots spread over them hold too little. Defender tactics
(falling back, holding the angles that matter, rotating) are the first item of milestone 5.

### Speed (same machine; Rust core)
Paths on the Bomb maps per second (M3, then M4): Ranch 4,636 to 2,307, Embassy 3,603 to
1,794, Workshop 4,503 to 2,160. The buildings are bigger, paths can vault, and closed
barricades are checked. Whole 5v5 bot matches, ms per 60 Hz step:

| Match | Average: M3 | M4 | 99th percentile: M3 | M4 | Worst: M3 | M4 |
|---|---|---|---|---|---|---|
| tdm/containers | 0.0577 | 0.0561 | 0.4679 | 0.4463 | 3.882 | 4.441 |
| tdm/casino | 0.0557 | 0.0438 | 0.6537 | 0.4011 | 2.818 | 2.985 |
| ctf/winter | 0.0863 | 0.1135 | 1.5656 | 4.5876 | 6.696 | 10.219 |
| ctf/yard | 0.0304 | 0.0396 | 0.2541 | 0.2935 | 1.604 | 2.325 |
| bomb/ranch | 0.0709 | 0.0786 | 0.6099 | 1.0026 | 4.329 | 3.379 |
| bomb/embassy | 0.0494 | 0.0675 | 0.5047 | 0.8187 | 2.435 | 3.937 |
| bomb/workshop | 0.0457 | 0.0542 | 0.4049 | 0.6608 | 2.523 | 2.217 |

The average step is still under 0.12 ms. The worst steps come from several bots planning
long paths in the same step; on Winter Cabin that reached 10 ms, which can show as a
hitch on a slow laptop. Spreading path planning over several steps is the first speed item
of milestone 5.

### Tests after milestone 4
| Suite | Result |
|---|---|
| `cargo test` | 21 passed |
| `node tools/check-core.mjs` | 20 passed |
| `npm test` | 213 passed, 0 failed |
| `node tools/check-modes.mjs` | 97 passed, 0 failed |
| `node tools/play-through.mjs` | no page errors |
