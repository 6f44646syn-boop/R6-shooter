# QA report: human-style play testing

How this was tested, what was found and fixed, what passed, and what was not covered.

## How it was tested (and what that means)

**No human played the game for this report.** Every session below was driven by Claude through
a real Chromium browser (Playwright), using the same input a player gives:
- real key presses and mouse buttons (W A S D, Shift, Space, Q / E, C, R, G, K, F, Tab, Escape,
  1-0, [ ], middle mouse, J / L / U on the trackpad profile);
- the menus clicked like a player: mode, settings, weapon or operator, Deploy, pause, Main menu.

Screenshots of each scene were looked at, and the game's state was read back after every action.
The test also sometimes placed the player directly, held bots still, or stepped game time in
fixed frames, so that each rule could be seen on its own.

What that leaves out:
- **Hardware:** the browser renders in software on a server, at 4-12 fps. Feel, real frame
  rates on a graphics card, and sound were not judged.
- **Mouse look:** headless Chrome reports no movement while the mouse is locked, so mouse-look
  events were sent to the page directly. They are the same events, through the same handler.

## Bugs found and fixed

| # | Bug | Where | Fix |
|---|-----|-------|-----|
| 1 | **Bomb: a broken window barricade could never be rebuilt.** Holding F ran the full hold, then nothing was built. The clear-opening test looked at the floor under the sill, which is wall. | `js/modes/map.js` `barricade` | A window's opening starts at its sill. |
| 2 | **Bomb prep and between rounds: holding fire spent ammunition.** No shot, sound or tracer, but the rounds were gone. | `js/modes/game.js` | The trigger does nothing while shooting is not allowed. |
| 3 | **Battle Royale threw an error every frame after you were eliminated.** `Fighter.lodFor` ran on a fighter with no pack model. | `js/battle/fighter.js` | Guarded. |
| 4 | **Graphics: a slow High / Ultra / Max load that finished after you switched back to Standard still added pack materials and props.** In Bomb, 712k triangles were left on Standard against 130k. | `js/render/pack-materials.js`, `pack-props.js` | Only the latest request is applied. |
| 5 | **Vault: a C tap shorter than one frame was lost.** At 15 fps that is a 66 ms tap. | `js/battle/human.js`, `battle.js`, `modes/game.js` | Key-down is remembered until the next frame. |
| 6 | The match pause menu offered the range's "Clear bullet holes and data (C)". In a match, C is vault. | `js/main.js` | Shown in the range only. |
| 7 | Barbed wire gave `metalness` / `roughness` to a Lambert material, which logged two warnings every Bomb round. | `js/modes/gadget-look.js` | Removed. |
| 8 | Range spray panel: the gun name and the hits line overlapped. | `js/ui/plot.js`, `index.html`, `css/style.css` | The rows now stack, and the panel is 16 px taller. |

## New automated checks (they run in `npm test`)

- **`tools/check-core.mjs`:** every doorway and window on every Bomb map can be barricaded again
  after it is broken. It fails on the old code (bug 1).
- **`tests/qa-browser.mjs`** (also `npm run test:qa`), with real key and mouse input:
  - no rounds spent in Bomb prep (bug 2);
  - a quick C tap vaults (bug 5);
  - Battle Royale runs on without errors after the zone kills you (bug 3).
- **`tests/run.mjs`:** clicking quickly through High, Ultra and Max to Standard leaves no pack
  materials or props (bug 4).

- **`tests/run.mjs`:** a flaky Battle check was fixed. "Tapping a bot at 10 m kills it" failed
  about 1 run in 20, because the bot could climb onto the new 0.9 m drums while roaming. The test
  then moved it into the firing lane but kept its height, so the bot floated and the shots went
  under it. The test now puts the bot back on the ground and clears grenades still in the air
  (40 / 40 runs pass).

## What was played, and the results

| Session | What was done | Result |
|---------|---------------|--------|
| First launch and menus | Controls prompt, every menu tab, every settings tab. Every select was stepped through each option, every checkbox toggled, every slider set to min and max. Controls and bindings, Skins & packs. | No errors. Bug 8 found. |
| Shooting range | All 10 weapons: hip fire, aimed taps (all hit the dummy), R reload refills, emptying a magazine stops at 0, an empty gun does not fire. All 11 sights with `]`. M cycles targets; + / - change distance. | All passed. |
| Battle vs bots | Mouse look, W A S D, Shift sprint (about 2x walk), Space crouch, Q / E lean, right-mouse aim, fire, R, G grenade, K knife, I inspect, Tab scoreboard. Killed by Hard bots, kill cam (V shoulder view, Space skips), respawn in 3 s, match end screen, Play again. | All passed. |
| Battle maps | Yard, Winter, Casino and School with 3 and with 5 bots. Small and big Winter and School sizes, bots roam, nobody inside cover or out of bounds. | 24 / 24 passed. |
| Bomb operators | All 10 operators picked in the menu and deployed. Prep, action, middle-mouse ability, drone and recall (V), underbarrel (B), grenade, knife, reload, Escape pause, Main menu. | Passed. Aiko's Pulse Scanner: see below. |
| Bomb walls and doors | Every soft wall (66) and every doorway and window (106) on Ranch, Embassy and Workshop. Bullets break soft walls; F reinforces; reinforced walls stop bullets and the knife; closed doors stop a body while a drone rolls under; knife and bullets open doors; you can walk through; F barricades again. | All passed after fix 1. Two to three panels per map had no room to stand and were skipped. |
| Bomb round flow | Drone in prep, plant (an early release cancels it), 40 s fuse and detonation, 5 s summary, time-out round, one life (no respawn), spectating teammates, wipe, side swap after round 3 (wire and reinforcements, no grenades), barbed wire, a bot plants, F defuses in 6 s, match ends at 4 rounds. | All passed. |
| Team Deathmatch and Capture the Flag | Both modes on all 5 maps: start from the menu, move, fire, grenade. TDM: kill cam, respawn, scoreboard, 40-kill win. CTF: pick up, capture, flag drops on death, 3 captures win, back to the menu. | 74 / 74 passed. |
| Battle Royale | Deploy with no weapon step, start unarmed against 20, run, pickaxe, F opens chests (gun and materials), B builds, Z changes piece, the zone shrinks, staying outside kills you, after death. | Passed. Bug 3 found. |
| Multiplayer (two browsers, join codes) | Connect through the menus, Join the battle, both players move and both PCs agree. The player's tab closes mid-match: the host is told within about 6 s and plays on. A new player rejoins and a new match starts. The host leaves: the player is told. | 12 / 12 passed. |
| Edge cases | Sprinting into all four arena corners and 12 container and crate corners. Vault over low cover; a grenade while vaulting. Dying while reloading (respawn with a full magazine, not stuck). Lean + aim + middle mouse + knife + grenade at once. 40 rapid weapon switches while firing and reloading. Trackpad profile: J fires, L toggles aim, Q leans. Drone rolled at 134 doorways and walls (never inside one). Dying with a wall charge placed. Five bots through one doorway (no overlap). | All passed. Bug 5 found. |
| Graphics switching mid-match | Low, Standard, High, Ultra, Max and back on the four Battle maps and in Bomb, with the pack installed. | No errors. Bug 4 found. |
| Existing suites | Rust unit tests (62), mode simulations (99), core collision checks, full `npm test`. | All passed. |

## Performance

Measured in the headless software renderer. Use the relative numbers, not the absolute ones.
- **Game update:** 0.2-0.6 ms a frame with 5-6 bots, on every map at every graphics level.
- **Draw calls:**
  - Battle maps: 160-210 on Low and Standard, 210-400 on High to Max.
  - Bomb (Embassy, 5v5): 160-270.
- **Triangles:** 80-130k on Standard; 200-600k on High to Max.
- **Memory:** 12 battles started and left, and a 5-minute match with 6 Hard bots. The heap stayed
  flat, and update time did not grow.
- **Pause:** the first switch to Ultra paused for one frame (37 ms) while shaders compiled.
- **Graphics pack:** installs in about 2 minutes from the local server.

## Not covered, and known limits

- **No real person played.** Feel, aim and sound need a human playtest on real hardware.
- **Real frame rates on a graphics card** were not measured.
- **Online over the relay (game codes)** was not tested, because no relay ran here. Same-network
  join codes were tested.
- **Split-screen** is not in the game (removed earlier) and was not tested, as asked.
- **Aiko's Pulse Scanner and Royale edit mode:** pressing middle mouse changed nothing visible in
  the state the test read, so these need a check by hand.
- **Drone routes:** drones were rolled at every opening on Embassy only. Ranch and Workshop were
  covered by the wall and door sweep's "drone rolls under a closed door" check.
- **"Throwing grenades while jumping":** the game has no jump. Grenades thrown while vaulting were
  tested instead.
- **"Ability while switching weapons":** in the modes with abilities you carry one gun, so it
  does not apply.
- **Skins:** not tested, because new skins are coming.
