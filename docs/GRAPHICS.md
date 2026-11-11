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
| Max | the Enhanced Graphics pack | Ultra plus the extras below |

High and Ultra stay selectable without the pack: the saved choice is kept and the game runs
as Standard (`effectiveGraphics()` in `js/render/quality.js`) until the pack is installed.
Choosing High or Ultra without it opens the Graphics screen with the download prompt. Nothing
is downloaded unless the player presses **Download**.

## Max

Max draws as Ultra everywhere (`effectiveGraphics()` returns `'ultra'`), and `maxMode.on`
(`js/render/quality.js`) switches on the extras:

| Feature | How |
|---|---|
| 4K PBR textures | the large map surfaces (`big: true`) at 4096 px, `hd/mat/<name>-<map>-4k.webp` (`node tools/build-materials.mjs --4k`); 16x anisotropic filtering. Weapon skins are already 4K on Ultra. |
| Lighting | baked sky and room light **and** SSAO together; a 4096 px sun shadow map in the match modes (Battle's is already 4096 on Ultra) |
| Reflections | screen-space reflections on upward-facing surfaces (floors, tables), marched through the depth, with Fresnel and edge fade (`world-post.js`, SSR pass) |
| Volumetric effects | sun shafts (a radial march over the sky in the depth, half resolution) and distance and height fog; thicker with the fog setting |
| Post-processing | bloom (bright parts, quarter resolution, two blur passes), then after ACES: colour grading (saturation, contrast, warm highlights, cool shadows) and a vignette |
| Destruction | in the match modes, shots that hit a wall leave cracked holes (300, oldest reused) and throw chips and dust (`game.js` `_impact`) |
| Weather | in rain or storms on Battle's outdoor maps, surfaces turn wet: glossier, darker, stronger reflections (`arena.js` `_maxEnv`) |
| Models | full-detail soldiers at every distance (no far model) |

The scene tells the post passes its sun, fog and wetness through `scene.userData.maxEnv`.
Animations are the same on every level: reloads, the draw and the inspect come from the pack,
and Black Ice skins have their own inspect.

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

**The soldier** (pack version 2, `hd/soldiers/soldier.rrmz`, about 26k triangles) is used
in Battle and the match modes on High and Ultra:
- a rounded helmet with a team band, side rails, a night-vision mount and a headset;
- a plate carrier with webbing straps, magazine and admin pouches and a radio;
- a belt with pouches, a backpack, elbow and knee pads, gloves, and boots with soles and laces.

It has exactly the pose and proportions of the simple soldier, so the hit shapes
(`SOLDIER_PARTS`) still match what you see. It is coloured per team, with its baked ambient
occlusion and cavity darkening in the vertex colours. Its builder is `tools/hd/soldier.mjs`.

Each gun model has two levels of detail: about 25k-90k triangles for first person, and about
5k-16k for guns other players carry. Every vertex stores baked data: ambient occlusion
(ray-traced against the whole gun), an edge mask (convex edges) and a cavity mask (inside
corners).

**Weapon animations** (pack version 4, `hd/anims/weapons.json`, 22 KB, built by
`tools/hd/anims.mjs`, played by `js/scene/weapon-anims.js`). These are used with the
pack's guns on High and Ultra:
- On those guns the support hand is a separate part.
- **Tactical reload:** the hand strips the magazine and stows it, brings a new one, seats
  it and slaps it home.
- **Empty reload:** the old magazine drops free while the hand fetches a new one, then
  the hand comes over and works the charging handle.
- **Draw:** the gun comes up with a turn and a settle, and the hand catches the handguard.
- **Inspect:** the right side with a chamber check, the left side, then a magazine check.
- **Per-gun styles:** the AK rocks its magazine in; the bullpup reaches back behind the
  grip; the machine pistol loads through the grip; the LMG has its own hold.
- **Anchors:** hand positions are given relative to points measured on each model (the
  magazine, its base, the charging handle, a pouch), so one clip fits every gun.
- **Timing:** clips use normalised time over the game's existing durations (the gun's
  reload time, 0.42 s draw, 3.2 s inspect). They change how things look, never when a
  magazine is ready.
- **Low and Standard** keep the procedural animations.

**Attachments** (milestone 8) are built onto the first-person and third-person guns in every
quality: muzzle devices, grips, the laser, the longer extended magazine and the quick-change
pull loop. They use neutral colours, so skins don't paint them. See ENGINE_API.md for the
effective stats.

### Pack version 5: the maps, the skins, and lighter distant soldiers

About 46 MB in all. Version 5 is a big update to how the maps look, and it adds detail that
makes rendering cheaper, not more expensive.

**Map materials** (`hd/mat/<name>-{albedo,normal,orm}.webp`, 58 materials). Every map surface
gets a physically based material on High and Ultra:
- Each material has three textures: colour, a normal map, and an ORM map (R occlusion,
  G roughness, B metalness).
- They are drawn offline as procedural GLSL, in `tools/hd/matgen.mjs`. All are original and
  tile seamlessly.
- Sizes are 512 to 2048 px. Ultra uses full size; High uses half, which saves memory and
  bandwidth.
- The match maps:
  - plaster walls with skirting and cornice, concrete block, poured concrete;
  - grass, lawn, dirt, asphalt;
  - wood floors and decking, carpets, tiles, marble, stone, ceilings, shingle roofs;
  - furniture, cars, shelves, barriers, planters, water.
- The building exteriors: red brick with a plinth and a soldier course (Workshop, Depot),
  painted clapboard (Ranch), and dressed stone with a rusticated base and a cornice
  (Embassy). There is also galvanised flashing on the roof edges.
- Battle's maps: containers, louvred metal panels, the oil-stained yard, grating, snow
  with footprints, log cabin walls, casino carpet and felt, lino, school walls, lockers,
  and a basement.

**Building exteriors in every quality.** A wall face is part of the facade when the sky is
open 0.6 m out from it (`js/modes/look.js`, `FACADE`). This covers walls above a lower roof
and courtyard walls too. Inside faces keep the plaster.
- Standard draws the facades with canvas textures.
- High and Ultra swap in the pack's materials.

**Baked light** (`hd/light/<map>.rrl`, `tools/build-light.mjs`). Each map has a 0.5 m grid of
two light values:
- **Sky light:** 24 cosine-weighted rays through the game's own collision.
- **Room light:** under roofs, darker in corners.

The game samples the grid as a 3D texture. Indirect light (sky, bounce, reflections) is
scaled by sky light, and rooms get a warm fill from room light. This gives shaded rooms,
dark corners and light falling in at doorways and windows.
- On High, this replaces screen-space ambient occlusion, which saves a full-screen pass.
- Battle's maps (Container Yard, Winter, Casino, School) have their own bakes.

**Props** (`hd/props/<name>.rrmz`, `tools/hd/props.mjs`). These replace the fitted boxes on
the match maps on High and Ultra:
- crates, cars (with paint per car), desks, tables, sofas, beds;
- shelves, counters, benches, barriers and planters, repeated along their box;
- the fountain, trees and bushes.

Each prop has baked ambient occlusion and is drawn instanced: one draw per prop and material.
Collision is unchanged.

**Redrawn skins** (`hd/skins/*.webp`, `tools/build-skin-atlas.mjs`, `js/render/skins2.js`).
All 201 skins are redrawn on High and Ultra by detail sheets and a shader:
- layered hand-cut camo with paint thickness;
- two-scale pixel camo;
- brushed tiger stripes;
- wear and grime by rarity;
- metallic flake on Epic skins;
- stencilled decals on many Rare and Epic skins.

They are still baked on the GPU at up to 4096 px. Nothing is downloaded per skin.

**Soldier levels of detail.** `soldier.rrmz` holds about 25.7k triangles near and about 9.9k
far. Soldiers more than 16 m away use the far model (`Fighter.lodFor`).

`node tools/build-materials.mjs [name ...]`, `node tools/build-light.mjs [map ...]`,
`node tools/build-props.mjs` and `node tools/build-skin-atlas.mjs` rebuild each part.
Then run `node tools/build-hd.mjs --manifest`.

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
`node tools/build-hd.mjs --manifest` rebuilds only the animations and the manifest.

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
