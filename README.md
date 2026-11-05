# Recoil Range

A one-wall, first-person shooting range for practising recoil control in the browser.
Pick a gun, hold the trigger, pull against the recoil, and read the spray on the target.

- Static files only: plain HTML, CSS and ES modules. No build step, no backend.
- No third-party requests at runtime: Three.js (r160) is vendored in `vendor/three/`, no web
  fonts, no analytics. Sounds are synthesised with WebAudio.
- Gun recoil is data in `data/guns.json`. The 10 guns shipped here are **placeholders** with
  invented patterns (tagged `PLACEHOLDER RECOIL` in the HUD). See [docs/GUN_DATA.md](docs/GUN_DATA.md)
  to paste in your own measurements.

## Controls

| Input | Action |
|---|---|
| Mouse | Look |
| Left button | Fire (hold for automatic) |
| Right button | Aim down sights (hold) |
| R | Reload |
| 1-9, 0 | Select gun 1-10 |
| Q / E | Target closer / further (5, 10, 15, 20 m) |
| C | Clear bullet holes and shot counters |
| M | Moving red dot target on / off |
| F3 | Debug readout (Z zeroes its counters) |
| Esc | Release the mouse and open the menu / settings |

## Sensitivity

Set your **mouse DPI** and **cm/360** in the menu. The game converts them to degrees per count:

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
- ADS sensitivity = hip deg/count × the optic's multiplier (`data/optics.json`, editable in
  Settings) × the gun's own `adsMultiplier`. All default to 1.0.
- Horizontal FOV 60-110 (default 90). ADS FOV divides the hip FOV by the optic zoom in
  tan-space.

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

- About 15 draw calls and under 1,000 triangles. Lambert/basic materials, no shadows, no
  post-processing, no antialiasing, `devicePixelRatio` capped at 1.
- Bullet holes are one `InstancedMesh` (one draw call), capped at 300; the oldest is recycled.
- The frame loop creates no objects; HUD text is only rewritten when a value changes. Measured
  with Chrome's heap sampler: about 5 KB/s idle (the `requestAnimationFrame` call itself) and
  about 10 KB/s while firing, far below anything that causes GC hitches.
- Settings → Render resolution (85/75/50%) helps on slower machines.

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
data/guns.json           gun data (placeholders)
data/optics.json         ADS multipliers per optic
docs/GUN_DATA.md         gun data schema
tools/serve.mjs          local static server
tools/path-from-points.mjs   traced hole pixels -> sprayPath degrees
tools/make-placeholder-guns.mjs  regenerates the placeholder guns
tests/                   headless Chrome tests
test/capability-test.html    browser capability check
vendor/three/            Three.js r160 (MIT)
```

All names, shapes, sounds and art here are original and generic.
