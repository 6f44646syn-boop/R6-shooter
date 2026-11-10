# Enhanced pack v2: M6 integration and Claude handoff

M6 `5cafaa1` is integrated into `feature/m7-ui-controls`. Main was not changed.
Controls, independent audio/Bomb WASM, M4 destruction/utility, prep time, floor heights,
`effectiveGraphics`, world post-processing and Graphics test IDs are preserved.
No split-screen, new multiplayer transport, engine physics, AI or map geometry changes.

## Pack contents and integration

The existing HDPack manager now installs 29 checked files, **18,898,457 bytes (18.02 MiB)**.
No addon request occurs at startup. Existing v1 installations retain their fallback and
are offered a v2 update. Downloads remain explicit, same-site, verified and removable.

- The existing 83-clip runtime is included at `hd/audio/recoil-range-audio-v1.rra`.
  `connectAudioPack()` reads only HDPack's cached bytes. Decoding waits for the existing
  player-gesture unlock, including cached reloads. Removal and missing/corrupt files
  restore procedural sound. A generation guard prevents late decoding from reinstalling
  a removed bank. Audio works at every graphics preset; PCM remains 2.72 MiB.
- Eight existing map materials are rerendered from their authored patterns with sharper
  seams and restrained wood/metal/fabric grain. High uses 512 px, Ultra 1024 px, with
  anisotropy capped at 4/8. Ultra alone adds subtle bump sampling. UVs, cover, map data,
  collision, nav, lighting and competitive sightlines are unchanged. This increment
  targets the match-map material system; separate Battle arena scenery remains M6's.
- Soldier carrier webbing, stitches, pouch lips, straps, fasteners and goggles use the
  existing RRM codec, adding **972 triangles**, merged into the existing body mesh.
  Hitboxes, outline/ghost geometry, team colors and poses are unchanged.
- Existing High/Ultra skin bakes gain restrained directional grain, coherent paint/metal
  roughness and reduced edge wear. IDs, ownership, rarity, unlocks and equipment are
  unchanged. Existing texture caps remain; evicted relief textures are now disposed.

The visual contribution is deliberately bounded detail, not a replacement character rig
or a complete photorealistic map-art overhaul.

## Verification on Windows desktop

External Playwright with installed Edge; no project dependency added. Node 24.22.1.
The `npm test` command's constituent scripts were run directly because npm is not on PATH.

- Controls WASM, 18 audio WASM/geometry checks, 37 Bomb checks, core checks, mode checks
  and data checks pass.
- Browser: controls 25, audio 21, standalone audio pack 11, Bomb 13, combined pack 16 pass.
- Audio pack: 14 format/provenance/checksum checks pass. Pack-assets checks verify all
  29 hashes/sizes, texture dimensions, identical audio bytes and the triangle/20 MiB cap.
- Full browser suite: **202 passed, 2 failed**. The one-second shot boundary produced
  18 instead of 19 shots (also failed on the merged M6 baseline). The Casino stairs
  test took 60.1 s against its 60 s budget in the final run; it passed the baseline.
  This second result is an unresolved timing limit, not claimed fixed or proven unrelated.
  Direct WebRTC passed. Relay skipped because no relay was running. No assertions weakened.
- No new native Rust build was needed: Rust source and committed WASM stayed unchanged.

## Paired visual and performance results

[Comparison images](reports/pack-v2/overview.jpg), [baseline raw metrics](reports/pack-v2/before.json),
[pack v2 raw metrics](reports/pack-v2/after.json).

Physical **Intel UHD integrated GPU**, ANGLE D3D11 (device 0x468B), headless Edge,
1280x720, High, 100% scale, AO on, TAA off, fixed seed/poses, 2048 px skin cap.
Each scene warms 30 frames and samples 120. The harness suppresses the normal game draw
while capturing and resets renderer counters for every measured frame. These are short
presentation-scene samples, not full-match or discrete gaming-card benchmarks.

| Scene | M6 ms/frame | v2 ms/frame | Draw calls, both |
|---|---:|---:|---:|
| Ranch ground | 26.71 | 25.27 | 238 |
| Ranch upper | 29.89 | 27.19 | 235 |
| Embassy ground | 27.42 | 26.35 | 240 |
| Embassy upper | 24.64 | 27.92 | 240 |
| Workshop ground | 23.00 | 24.75 | 149 |
| Workshop upper | 26.63 | 25.31 | 232 |

Equal-scene mean: 26.38 -> 26.13 ms; mixed individual changes do **not** establish a speed
improvement. The final High samples are approximately 36-40 FPS, not a 60 FPS claim.
All six map vertex-buffer hashes match; draw calls are identical.

Measured map texture estimates including mipmaps are 9.24-12.16 MiB on High (exclude
framebuffers and driver overhead). The eight optional surfaces have a 10.67 MiB High /
42.67 MiB Ultra GPU upper bound; both decoded image sets occupy about 40 MiB CPU memory.
Four repeated matches stayed at 76-77 renderer textures, 222-246 geometries and roughly
36.8-37.5 MiB JS heap, without monotonic growth. Native image/GPU memory is not JS heap.
Local startup: 1.51 -> 1.35 s; local pack install/decode: 0.53 -> 1.75 s. Network download
speed is not represented. First captured shader warmup: 1.29 -> 1.37 s; later scenes
0.14-0.29 s. See raw metrics for p95 and CPU submission times.

## Build and remaining checks

- `npm run build:enhanced-surfaces` regenerates surfaces and soldier details through
  `tools/build-hd.mjs --surfaces`, then updates the shared manifest.
- `node tools/build-audio-pack.mjs packs/audio` rebakes audio; regenerate its ZIP and
  SHA256SUMS, then `node tools/build-hd.mjs --manifest` to refresh the manager's copy.
- `npm run test:enhanced-pack`; existing controls/audio/Bomb and full shared-file suites.
- `node tools/compare-pack.mjs <repo-root> <output-directory>` reproduces paired captures.

Claude: preserve these small presentation hooks when continuing M5. Please investigate
both reported full-suite timing failures. Dedicated/discrete GPU and broad device/Ultra
performance testing remain pending. The 55% Bomb defender target remains unverified;
this work changes no balance. PR stays draft; do not merge main automatically.
