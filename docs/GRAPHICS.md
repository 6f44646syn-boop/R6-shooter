# Graphics: quality levels, the Enhanced Graphics pack, post-processing, performance

Milestone 6. What runs where, what the optional download contains, how it is built and
updated, and how to measure frame rate.

## Quality levels

| Level | Needs | What you get |
|---|---|---|
| Low | any browser | flat colours, the simplest gun, one light, the cheapest lens pass |
| Standard | any browser, nothing to download | the fast textured look; upscaling with sharpening when dynamic resolution lowers the world's resolution |
| High | the Enhanced Graphics pack | detailed gun models, PBR lighting, shadows, tone mapping, ambient occlusion, optional TAA |
| Ultra | the Enhanced Graphics pack | High plus 4K weapon skins with relief and lacquer, micro-detail, supersampling |

High and Ultra stay selectable without the pack: the saved choice is kept and the game runs
as Standard (`effectiveGraphics()` in `js/render/quality.js`) until the pack is installed.
Choosing High or Ultra without it opens the Graphics screen with the download prompt. Nothing
is downloaded unless the player presses **Download**.

## The Graphics screen (`js/ui/graphics-ui.js`)

Settings > View > **Graphics & performance...**
- the four levels (Low and Standard marked *Browser*, High and Ultra *Enhanced*);
- the pack: status, size, download with a progress bar, update, remove;
- performance profiles: **Competitive** (Standard, 144 fps target, light lens effects,
  sharpening), **Balanced** (High, 60 fps, ambient occlusion), **Quality** (Ultra, ambient
  occlusion, TAA); changing any value afterwards shows *Custom*;
- frame-rate target, sharpening, render resolution (below 100% the world is upscaled),
  ambient occlusion, temporal anti-aliasing, FPS counter.

## The Enhanced Graphics pack

`hd/` on the site: `manifest.json` (name, version, every file with its size and SHA-256) and
the files (`hd/guns/<model>.rrmz`, one per gun model).

- **Download** (`js/render/hd-pack.js`): started only by the player. Each file is streamed with
  progress, its size and SHA-256 are checked against the manifest, and it is stored in the
  browser's Cache Storage (`recoil-range-hd`). A damaged or cut-short file is refused and
  nothing is switched on. Same-site requests only.
- **Offline**: after a reload the pack is read from Cache Storage, with no network. If the
  browser cleared the files, the pack shows as not installed.
- **Updates**: the pack has its own version (`PACK_VERSION` in `tools/build-hd.mjs`),
  independent of the game. Opening the Graphics screen reads the manifest; a newer version
  shows **Update pack**. Files whose hash did not change are not downloaded again.
- **Remove** deletes the cache; High and Ultra go back to needing the pack.
- Browsers without `DecompressionStream` or `crypto.subtle` show the pack as unavailable and
  keep Standard. Browsers without Cache Storage keep it for the visit only (said on screen).

### What is in it

Ten detailed gun models, one per model in `js/scene/viewmodel.js` (`MODEL_FOR`): `carbine`,
`sfw`, `evo`, `bullpup`, `machinepistol`, `ak`, `compact`, `pdw`, `smg`, `lmg`. They are
original designs built to the same layout and anchor points as the low-poly guns (receiver
top, rails, grip, magazine, hand positions and muzzle), so sights, hands, reloads, the bolt,
brass and the muzzle flash line up unchanged.

Each model has two levels of detail: about 25k-90k triangles for first person, and about
5k-16k for guns other players carry. Every vertex stores baked data: ambient occlusion
(ray-traced against the whole gun), an edge mask (convex edges) and a cavity mask (inside
corners).

### How the models are built (`node tools/build-hd.mjs`)

- `tools/hd/kit.mjs`: modelling kit. Bevelled side profiles (with real holes for ports,
  slots and cut-outs), cross-sections, lathed profiles (barrels, brakes, buffer tubes),
  Picatinny rails with teeth, screws, pins, grips with finger grooves, straight and curved
  magazines with ribs, ventilated handguards, triggers and guards.
- `tools/hd/guns.mjs`: the ten guns.
- `tools/hd/bake.mjs`:
  - smooth normals across rounded edges, creased at sharp ones;
  - edge splitting to an even triangle size (matched by position, so there are no cracks);
  - a BVH ray tracer for per-vertex ambient occlusion (40 rays first person, 20 third person;
    back faces ignored so hidden vertices do not stain their neighbours);
  - curvature for the edge and cavity masks.
- `tools/hd/format.mjs` / `js/render/hd-mesh.js`: the `.rrm` format.
  - Positions are u16, quantised to the model's box.
  - Normals are octahedral, two i16.
  - Detail is u8 x 4.
  - Indices are u16 or u32.
  - The file is gzipped (`.rrmz`).
- `tools/hd/view.html?gun=ak&mode=shaded|ao|edge`: a viewer for checking a model.

Building all ten takes about two minutes. Bump `PACK_VERSION` when the content changes.

### What the pack changes at runtime

- **Guns** (`js/scene/viewmodel.js`, `buildHD`): the first-person gun and the guns players
  carry use the pack's meshes on High and Ultra, without UV maps. Materials are mapped by
  position (`triplanar(..., { hd: true })` in `js/render/gpu-tex.js`):
  - baked ambient occlusion darkens ambient light and reflections in crevices and under
    parts;
  - grime collects in inside corners;
  - edges wear to bare metal on coated parts and to lighter scuffs on polymer.
- **Skins**: a skin now wraps the furniture too (stocks, grips, handguards, magazine bodies:
  the `shell` role). On High and Ultra with the pack:
  - the skin's relief map stores its height, used for **parallax** (raised paint, engraved
    lines and Black Ice cracks sit at different depths as the gun turns; WebGL 2) and to
    shade the design's low parts;
  - paint chips off the model's real edges, raggedly, with a dark rim at the chip;
  - relief normals are stronger;
  - Black Ice crystals grow from the detailed model's top and bottom faces.

## World post-processing (`js/render/world-post.js`)

Shared by the Range (through the lens pass), Battle and the match modes:

1. The world is drawn into a half-float image with its depth. With TAA the camera is
   jittered by a Halton (2, 3) sub-pixel offset.
2. **Ambient occlusion** (High / Ultra, setting): screen-space, half resolution.
   - Normals are rebuilt from depth.
   - 12 spiral samples, rotated per pixel.
   - Two depth-aware blur passes.
   - Never darker than 30%, so players stay readable.
3. **Resolve**: occlusion applied, then ACES tone mapping and sRGB for the screen (linear when
   feeding the lens pass).
4. **TAA** (High / Ultra, setting): the last frame is reprojected through the depth and
   clamped to this frame's 3x3 neighbourhood (YCoCg). It uses less history when the view
   turns fast, which avoids ghost trails and smearing.
5. **Output**: upscale to the screen with contrast-adaptive sharpening; FXAA when TAA is off.

The weapon is drawn afterwards straight to the screen, so it is never blurred or smeared.

**Resolution scaling**: with WebGL 2 the screen stays at full resolution, and only the world
is drawn smaller (render resolution under 100%, or dynamic resolution), then upscaled and
sharpened. The gun, sight and HUD stay crisp.

**Dynamic resolution** follows the frame-rate target (60 / 120 / 144 / 240), capped at the
screen's measured refresh rate. It lowers the world's resolution to 60% at most.

**Low and Standard**: the pass runs only when upscaling (it costs a full-screen pass).

## Measuring (`FPS counter`, `js/ui/perf-hud.js`)

The counter shows:
- frames per second, average frame time and the 1% low;
- CPU time per frame;
- GPU time per frame (WebGL timer queries where the browser allows them, else "n/a");
- render resolution and scale, draw calls and triangles;
- the target and the screen's refresh rate;
- a frame-time graph with the target line.

F3 (debug readout) still has the detailed numbers.
