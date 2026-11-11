# Recoil Range

A one-wall, first-person shooting range for practising recoil control in the browser.
Pick a gun, hold the trigger, pull against the recoil, and read the spray on the target.

- Static files only: HTML, CSS, ES modules and one WebAssembly file. No backend. The game
  core is being moved to Rust (`rust/core` → `wasm/recoil_core.wasm`, built with
  `tools/build-wasm.sh` and committed, so the site itself still needs no build step). See
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/MIGRATION.md](docs/MIGRATION.md),
  [docs/BASELINE.md](docs/BASELINE.md), [docs/ENGINE_API.md](docs/ENGINE_API.md) and
  [docs/GRAPHICS.md](docs/GRAPHICS.md) (quality levels, the optional Enhanced Graphics pack,
  post-processing, the FPS counter).
- No third-party requests at runtime: Three.js (r160) is vendored in `vendor/three/`, no web
  fonts, no analytics. Sounds are synthesised with WebAudio.
- Gun recoil is data in `data/guns.json`. Slots 2-10 use sprays measured in game while aiming
  (converted at each sight's aimed FOV; tagged MEASURED SPRAY); slot 1 is still a placeholder with an invented pattern. See [docs/GUN_DATA.md](docs/GUN_DATA.md)
  to paste in your own measurements.

## Controls

| Input | Action |
|---|---|
| Mouse | Look |
| W A S D | Move (small area behind the firing line; you cannot step past it) |
| Shift | Sprint (hold) |
| Space | Crouch (hold) |
| X | Back to the firing line |
| Left button | Fire (hold for automatic) |
| Right button | Aim down sights (hold) |
| R | Reload |
| [ / ] | Previous / next sight (while not aiming) |
| 1-9, 0 | Select gun 1-10 |
| Q / E | Lean left / right (hold; also the mouse back / forward side buttons) |
| - / + | Target closer / further (5, 10, 15, 20 m) |
| C | Clear all bullet holes and shot data (also a button in the menu) |
| M | Moving red dot target on / off |
| F3 | Debug readout (Z zeroes its counters) |
| F4 | Sight gallery |
| Esc | Release the mouse and open the menu / settings |

## Sensitivity

Set your **mouse DPI** and the Siege-style **horizontal / vertical sensitivity** (1-50) in the
menu. Degrees per count = sens x 0.00572958, from your own numbers (sens 7 at 1600 DPI =
14.25 cm/360); vertical sensitivity scales pitch only. cm/360 is shown, derived. The game converts them to degrees per count:

```
counts per 360 = DPI * cm360 / 2.54
deg per count  = 360 / counts per 360
```

- The mouse is captured with `requestPointerLock({ unadjustedMovement: true })` (raw input,
  so Windows pointer speed and "Enhance pointer precision" do not apply). If the browser
  does not support raw input, it falls back to normal pointer lock and shows a small notice.
- Every `mousemove` event's `movementX/Y` goes straight into yaw/pitch as float64. No
  smoothing, acceleration, filtering, or frame-rate scaling. Single events over 2000 counts
  are dropped (a known Chrome glitch) and counted in the debug readout.
- ADS sensitivity = hip deg/count × the multiplier for the sight's magnification
  (`"ads"` in `data/sens.json`, keyed `"1.0x"`, `"2.5x"`, ..., editable in Settings) × the gun's own
  `adsMultiplier`. A magnification with no value yet uses the 1.0x value divided by the zoom
  and is marked placeholder.
- Vertical FOV 60-90, default 83, like the game's slider. Measured recoil assumes 83.
  ADS FOV = 2·atan(tan(FOV / 2) / zoom), reached over the gun's ADS time.

**Checking it:** press F3, press Z to zero the counters, then turn. The readout shows total
counts, the unwrapped yaw, and counts per 360. Turning exactly `counts / 360` counts gives
360.000000°.

## Run locally

ES modules and `fetch()` of the JSON files do not work from `file://`, so serve the folder:

```bash
node tools/serve.mjs
```

Then open http://localhost:8080/. (Any static server works, e.g. `python -m http.server 8080`.)

## Battle Royale side project

Keep this mode on `feature/battle-royale`, separate from `main` and the live release.
In the local game, choose **Battle Royale** and deploy directly to **Blacktide Island**,
a 160 × 128 m map exclusive to the mode. One human and 20 bots compete individually.
Each fighter has one life, and the safe zone shrinks until one remains.

Deployment skips weapon selection. Every fighter starts without a gun or grenades and
gets them from the island's 33 chests. The player's starting pickaxe harvests wall
materials, damages nearby opponents, and breaks built cover. Default controls:

| Input | Action |
|---|---|
| F | Open a nearby chest |
| Left mouse while unarmed, or K at any time | Swing the pickaxe |
| B | Build a destructible wall |
| Middle mouse while aiming at your wall | Open the 3×3 editor or confirm an edit |
| Left mouse in the editor | Select or drag across panels |
| V / right mouse in the editor | Reset the grid / cancel the edit |

One chest has a chance to hold the Pirate Token in 1 in 1,000 matches. Collecting it
unlocks all nine Black Ice skins on the local profile and in its save code. A completed
match shows the final recorded kill, winner lineup, and placement leaderboard.

Run `npm run test:royale` with Playwright installed to check deployment, chest-only
loadouts, pickaxe hits and harvesting, wall editing, the token unlock, and a full bot match.

## Deploy to GitHub Pages

The repository root is the site: `index.html` is at the top and every URL is relative, so it
works under `https://<user>.github.io/<repo>/`. The empty `.nojekyll` file stops GitHub
running Jekyll over the files.

1. Create a repository on GitHub and push this folder to its `main` branch:

   ```bash
   git remote add origin https://github.com/<user>/<repo>.git
   ```

   ```bash
   git push -u origin main
   ```

2. On GitHub, open the repository's **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick **main**
   and **/ (root)**, and click **Save**.
4. After a minute the site is live at `https://<user>.github.io/<repo>/`. The capability
   test is at `https://<user>.github.io/<repo>/test/capability-test.html`.

`tests/`, `tools/` and `docs/` are published too. They are harmless (nothing loads them) but
you can delete them from a deploy branch if you prefer.

### Google Sites

Google Sites shows embeds in a sandboxed iframe that blocks pointer lock and fullscreen. When
the page detects it is inside a frame, it replaces the start screen with an **Open in a full
tab** button. Embed the GitHub Pages URL and players click through to a normal tab.

## Menus

Main menu: choose a mode (Shooting range, Battle vs bots, Network battle), then its settings
(bots, level, kills to win, the network lobby; every other setting folds out below), then
your weapon: sights on the left, the gun turning in 3D in the middle (‹ › or the slot strip
switch guns), skins on the right. Deploy starts. Esc pauses: Resume, Change weapon,
Settings, Skins & packs, Main menu. Every gun has its own model.

## Skins, packs and save codes

Menu > Skins & packs. Battle kills earn points (20, +10 for a headshot kill; +50 for winning
a battle; in split screen, player 1's kills count). A pack costs 100 points and spins a
slot-machine reel that lands on one of 201 skins: Common 70%, Rare 22%, Epic 7%, Black Ice
1% (9 Black Ice: blue, red, pink, purple and green, with deep carved cracks and 3D ice
shards that shoot off and regrow when you inspect). A duplicate gives points back (20 / 40 / 80 / 200). Click a skin in your collection to
put it on the gun selected in Loadout; it shows in every graphics mode. Some skins are
exclusive: each Black Ice and half the Epics fit one gun only, and some Rares one gun
family (SMGs, or rifles and carbines).

Skins are generated on the GPU from a pattern (15 styles: contour, pixel, woodland, tiger,
veteran, hexcore, damascus, blot, weave, shard, black ice, fade, line, marble, circuit), four
colours and a finish (core/skins.js); the catalogue is the same on every PC.

Progress is kept in this browser and in a save code (Copy save code / Load). Paste the code
on another PC or browser to carry your points, skins and equipped skins over. The code is
checksummed, so a mistyped code is refused.

## Battle mode

Maps (Settings > Map): **Container Yard** (containers, crates, walls, barriers), **Winter
Cabin** (snowy clearing, log cabin, shed, pines, woodpiles, snowbanks, falling snow),
**Jesse's Casino** (slot machine rows with lit screens, card tables, roulette, bar, gold
pillars, chandeliers, neon signs) and **School** (lockers, desks and chairs, cafeteria
tables, trophy case, vending machine, whiteboards). Each is point-symmetric, drawn in code
(js/battle/maps.js), and the host's map is used in network games.

Main menu > Battle vs bots: you against 1-6 bots (Easy, Medium or Hard). First side to the kill target (5, 10,
20 or 30) wins; you respawn 3 s after dying, with 1.5 s of spawn protection, and health
regenerates after 5 s without damage.

- Arena: an original walled yard with shipping containers, stacked crates, tall walls, low
  walls you can crouch behind and concrete barriers, point-symmetric so both sides are equal.
  Cover stops bullets; bullet holes stay on it.
- Guns: the same guns, measured sprays, sights and sensitivity as the range. Damage per
  bullet comes from the gun data (head x2.5, limbs x0.75).
- Bots see along clear sight lines, react after a delay, turn at a limited rate with a
  drifting aim error that settles while they track you, and fire bursts with the gun's real
  spray, partly controlled. Easy: slow, inaccurate, stands still. Medium: faster, strafes,
  retreats to cover when hurt. Hard: quick, accurate, aims for the head, strafes, crouch-peeks
  low cover. They roam the arena on A* paths. (Stationary at 12 m, a single bot kills you in
  about 3 s on Easy, 1.4 s on Medium and 0.5 s on Hard.)
- Esc pauses and opens the menu (Resume battle / Leave battle).

### Network battle (other PCs on the same network)

Main menu > Network battle. No server and no outside service: the browsers connect directly
(WebRTC), introduced by copy-paste codes.

1. Host: press **Host a game**. Each other player: press **Join a game** and send the host
   the join code (chat, email...).
2. Host: paste each join code, press **Make reply code** and send the reply code back.
3. Player: paste the reply code and press **Connect**.
4. Host: press **Start battle** (bots optional, as a third side). Players join automatically
   and click "Join the battle" to capture the mouse.

The host runs the match (health, damage, bots, respawns, score). Each player moves and aims
on their own PC, so recoil and sensitivity feel exactly like single player; their PC decides
what their bullets hit (on what they saw) and the host checks it. Up to 5 other players.
All PCs must be on the same network, and that network must allow devices to reach each
other: many home networks do; some school and public Wi-Fi blocks it.

### Publishing

Run `node tools/stamp.mjs` before pushing: it adds `?v=<build>` to every module import and to
the page's script and stylesheet links, so browsers never mix new files with old cached ones
(GitHub Pages lets browsers cache files for 10 minutes).

## Performance

Built for Intel UHD 630 at 1920x1080 / 60 fps:

- Low graphics: flat colours (each texture replaced by its average colour), one hemisphere
  light, no shadows, the cheapest lens path and 100% render size: the look of the first
  versions, for the slowest PCs.
- Standard graphics (default): about 32 draw calls in hip-fire (the indoor hall's static
  structure is merged into one mesh per material), around 32,000 triangles, two lights, no
  shadows. The room uses Lambert; the gun and sight use cheap matcap shading.
- Settings > Graphics quality > High is for gaming PCs: physically based materials with
  procedural normal and roughness maps (tread plate, corrugated walls, riveted backstop, gun
  finishes with edge wear, polymer stipple and machined barrels), a 2048 soft shadow map from
  a key light, image-based lighting from the dusk sky and ACES filmic tone mapping. It adds the
  shadow pass (about 5 draw calls) and heavier pixel shading. Everything is still generated in
  code: no image files, no extra libraries.
- Settings > Graphics quality > Ultra is for a PC with a graphics card. Surface textures are
  drawn at 2-8x resolution with normal maps baked on the GPU, 4096 x 4096 micro-detail
  (concrete pores and cracks, orange-peel paint and scratches, brushed steel) is mapped by 3D
  position so nothing stretches, shadows are 4096 with a second shadow-casting lamp on the
  target, and each of the ten guns wears its own 4096 procedural skin (Contour Crimson,
  Arctic Digital, Deep Woodland, Night Tiger, Desert Veteran, Teal Hexcore, Damascus, Dry
  Ridge, Carbon Weave, Concrete Splinter) with edge wear and a clearcoat where it suits. Guns
  get extra parts (ejection port, bolt, trigger and guard, selector, pins, vents, muzzle
  brake, magazine ribs). Auto render resolution supersamples at 150% or more. All of it is
  baked by shaders at start-up (js/render/gpu-tex.js); about 0.5 GB of video memory.
- Weapon animations (Settings > View, on by default): draw on switching guns, reload (tilt,
  magazine out and in, slap, charge), sprint pose, inspect (I), bolt cycling, muzzle flash
  and ejected brass.
- Aiming adds one lens pass (4 draw calls: downsample, two half-resolution blur passes,
  composite). The scene is never drawn twice. Hip-fire skips the pass entirely.
- Settings > Lens effects: Auto lowers the lens quality one step at a time if frames average
  over 20 ms for 2 s while aiming (blur off, then fringing off, then glare off).
- Bullet holes are one `InstancedMesh`, capped at 300; red dots are two instanced meshes.
- Settings > Render resolution and Antialiasing help on slower machines.
- The test suite's frame rates come from a software renderer and are far below real
  hardware; use `test/capability-test.html` on the school PCs.

## Tests

Dev-only, run in headless Chrome through Playwright (not a dependency of the site):

```bash
node tests/run.mjs
```

- Unit tests (`tests/unit.html`): cm/360 → deg/count, N counts = 360°, FOV maths, glitch
  guard, sprayPath interpolation and extrapolation, recoil engine, seeded jitter, data
  validation.
- Magazine simulation: fires full magazines with a fixed seed through the real game code
  (`index.html?test`) and checks hole positions against `sprayPath` (to 0.01 mm), seed
  determinism, 30 fps vs 144 fps giving identical sprays, rate of fire, recovery and the
  hole cap.
- Frame-time check at 1920x1080: draw calls, render size, CPU time per frame. Headless
  Chrome uses a software GPU, so its fps figure is not representative of real hardware.
  Use `test/capability-test.html` on the school PCs for that.

Handy URL options: `?seed=1234` forces the jitter seed for every magazine.

## Layout

```
index.html               the app
css/style.css
js/main.js               wiring and frame loop
js/core/                 sensitivity maths, mouse look, pointer lock, recoil engine,
                         weapon timing, gun data validation, settings, PRNG
js/scene/                range, target (shape + hit test), bullet holes, viewmodel
js/ui/                   HUD, crosshair, magazine plot, debug readout, settings panel
js/audio/sfx.js          WebAudio sounds
data/guns.json           gun data (slots 2-10 measured, slot 1 placeholder)
data/optics.json         sight catalogue (see docs/SCOPES.md)
data/sens.json           your in-game sensitivity values; ADS rows per magnification
docs/GUN_DATA.md         gun data schema
docs/SCOPES.md           sights: recipes and drawing reference
tools/check-data.mjs     validates the data files (npm run check)
tools/merge-measured.mjs merges a measurement file into data/guns.json by slot
tools/check-spray-fit.mjs checks measured sprays against their hole pixels
tools/refit-aimed.mjs    refits measured sprays at each sight's aimed FOV
tools/refit-fov.mjs      refits a measurement file at another vertical FOV
reference/               private screenshots and measurement notes (gitignored, never served)
tools/serve.mjs          local static server
tools/path-from-points.mjs   traced hole pixels -> sprayPath degrees
tools/make-placeholder-guns.mjs  regenerates placeholder guns (refuses while any gun is measured)
tests/                   headless Chrome tests
test/capability-test.html    browser capability check
vendor/three/            Three.js r160 (MIT)
```

All names, shapes, sounds and art here are original and generic.
