# Recoil Range

A one-wall, first-person shooting range for practising recoil control in the browser.
Pick a gun, hold the trigger, pull against the recoil, and read the spray on the target.

- Static files only: plain HTML, CSS and ES modules. No build step, no backend.
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

## Performance

Built for Intel UHD 630 at 1920x1080 / 60 fps:

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
