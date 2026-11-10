# Desktop Codex continuation

## Start here

Repository: https://github.com/6f44646syn-boop/R6-shooter

Branch: `feature/m7-ui-controls`. Draft PR:
https://github.com/6f44646syn-boop/R6-shooter/pull/1

Source implementation is committed in `4ad58d3`; detailed audio/Bomb reports in
`a3a419d`. This handoff is a subsequent documentation-only commit. Fetch the
latest remote branch, inspect local changes and AGENTS.md before editing. Never
reset an existing desktop working tree or push/merge `main` without approval.

The user asked to finish this cloud session quickly and transfer to the desktop
app. Their **next priority** is adding to Claude's optional download pack and
making skins and maps visually higher quality. The audio addon is already built;
joining Claude's download manager and the skin/map visual upgrade remain to do.
Do not describe those remaining tasks as complete.

## Collaboration and user constraints

- Codex owns UI/controls, audio and later milestones; Claude owns the evolving
  engine, physics, maps, AI and rendering work in M1–6. Read PR comments and
  `docs/ENGINE_API.md` before changing shared files. The feature branch integrates M4
  `7fcbf5a` in `880fd42` (core ABI 4). **Late transfer update:** main now has
  Claude's M6 `5cafaa1`; it was fetched/read but is not merged into this branch.
- M5 bot tactics and M6 rendering/HD pack may advance during transfer. Inspect
  current commits/interfaces before integrating. Preserve Claude's work.
- No split-screen. Middle mouse is ability, Q/E lean, F interaction, C vault.
- Multiplayer scope is **existing relay and peer-to-peer Battle only**. No new
  dedicated/authoritative backend or simulated online features.
- Suitable logic belongs in Rust/WASM. JS handles browser integration. Do not add
  game dependencies beyond existing Three.js without asking the user. External
  Playwright test tooling is already supported; package.json has no dependencies.
- Small logical commits on the feature branch; update the draft PR, do not merge.
- Ask before committing to additional balance directions. The decisions below
  have already been answered/authorized; do not ask them again.

## What is implemented

M7: independent `rust/m7_controls`, raw-input bridge, tabbed menus, first-launch
profiles, rebinding, ADS/sensitivity, focus-loss cleanup, operator/weapon search.
No profile aim/recoil advantage is applied online.

M8 audio: independent `rust/m8_audio`, actual geometry-driven distance/occlusion,
material footsteps, WebAudio HRTF, 32-voice cap/cleanup and an Audio settings tab.
Several engine boom/door/pulse/wire events still omit y; requests are in ENGINE_API.
No attachments or animation overhaul is claimed complete.

Optional audio pack: `packs/audio/recoil-range-audio-v1.rra` (1,436,728 bytes),
`recoil-range-audio-v1.zip` (1,598,176 bytes), 83 original mono 48 kHz clips/WAV
previews, manifest, source fingerprints, benchmarks, checksums and Claude loader
instructions in `packs/audio/README.md`. Nothing fetches it automatically.

Use the existing Sfx instance: call `sfx.unlock()` from a user gesture, fetch the
versioned runtime `.rra` through the eventual pack manager, then
`await sfx.installPack(bytes)`. `removePack()` restores procedural fallback.
Integrate this addon into Claude's manager; do not build a competing downloader.
Claude's M6 has now published the actual manager on `origin/main`:
`js/render/hd-pack.js`, `hd/manifest.json`, `tools/build-hd.mjs` and
`docs/GRAPHICS.md`. These are not yet in the M4-based feature working tree.
`js/ui/packs.js` is the cosmetic loot/collection UI, not that download manager.

Merge M6 into the feature branch first, preserving both sides' shared-file work.
The current manager provides `init`, `check`, player-started `install`, `remove`,
`ready`, `onChange` and `file(path)`. Its manifest lists `path`, `size`, `sha256`,
plus a pack version and total. Cache Storage is `recoil-range-hd`; nongzipped
`.rra` bytes can be read directly with `HDPack.file('audio/recoil-range-audio-v1.rra')`.
Copy/build the audio runtime into that location, update the existing build tool
and versioned manifest, then pass cached bytes to `sfx.installPack`. Reset the
sample bank when the pack is removed. Defer AudioContext-dependent decoding until
user-gesture unlock, including after a cached reload; do not add a separate fetch
or cache manager.

Decoded PCM is 2.72 MiB plus browser/node overhead. Cached occluded gunfire uses
4 nodes/voice instead of 8. A final isolated local microbenchmark measured 81.0
vs 54.2 ms construction of 400 shots and 30.9 vs 13.9 ms for one-second offline
rendering of 32 voices; decode wall time 36.1 ms. This is audio work, not game FPS.
Do not enable a mandatory download based on these numbers alone. Re-bake the
pack after Sfx/Rust material changes or import stamping; source-hash tests catch
stale assets. Preview WAV gain is restored from manifest metadata by the loader.

## User-approved Bomb tuning

The user answered: Bomb only, stronger reinforcement/barricade/wire utility,
slight defender edge with approximately 55% defender wins as a target. They then
explicitly asked for less attacker time, defender ability buffs, and stronger
vision/sound impairment. They selected range/duration/uptime with damage unchanged.

Current candidate (`rust/bomb_utility`, separate WASM, minimal engine hooks):

- Attack phase 150 → 120 s; preparation unchanged/configurable. Plant 5 s,
  defuse 6 s, full planted fuse 40 s, including a late successful plant.
- Reinforcement placement reach 1.6 → 1.8 m; setup durations/counts unchanged.
- Barricade HP 100 → 150; wire bullet hits 3 → 4, wire speed multiplier .4 → .35.
  Knife/blast counterplay remains. Weapons, health, damage and charges unchanged.
- Jolt/Dread coverage and duration, jammer radius, Catcher radius/recharge and
  Onyx dash reach/stun/recharge improve only in Bomb. Exact table is in
  `docs/BOMB_BALANCE_HANDOFF.md`. Shared ability data is not mutated; bots/humans
  use the same copied config, other modes retain baseline values.
- Active status flags drive bounded muffling and a static extra vignette.
  Overlaps do not stack into silence/blackout. Effects reset on expiry, death,
  pause, replay and mode exit. Reduced motion suppresses camera shake/animated
  static while retaining the impairment.

**55% has not been achieved or verified.** Paired M4 normal-bot samples (8 full
matches/map, same seeds) were 38/137 defender rounds at baseline and 39/144 with
the final candidate. Ranch worsened; Embassy/Workshop improved. Equal-weight
per-match means are 27.66% vs 28.27%. No established overall improvement or human
balance claim. Early setup/count variants were dropped; reports are committed.
Keep the candidate in review and remeasure against Claude's M5 positioning and
rotation fixes. Do not quietly inflate health, damage or bot knowledge to reach
a headline percentage. No AI implementation or Rust core was edited for this.

## Verification at transfer

- Full `npm test`: **263 passed, 1 failed** — known direct WebRTC join timeout.
  Relay subtest skipped without a running relay. The shot-count boundary test
  passed this run, although it failed on earlier baseline runs.
- Bomb policy: 6 native Rust, 37 Node/WASM/integration and 13 Chromium checks pass.
- Spatial audio: 18 WASM/geometry + 21 browser/render checks pass.
- Optional pack: 14 format/hash/source + 11 browser/render/fallback checks pass.
- Controls: 26 checks passed on M4 integration; fresh CI reruns them.
- Existing M4 core native Rust: 21 passed. Mode simulations: 97 passed. Data check
  and `git diff --check` pass.
- Imported M4 tests that used KeyE for reinforcing/barricading now send the
  established `Interact` action. E still leans. Assertions were not weakened.
- Earlier serial click-through of Range, Battle, TDM, CTF, Bomb was clean; new
  balanced mechanics and effects were verified by focused tests/full regression.
- CI for feature merge `880fd42` passed, run `42802993202`. Source CI at `a3a419d` passed, run `42807398726`:
  https://github.com/6f44646syn-boop/R6-shooter/actions/runs/42807398726
  The transfer commits are documentation-only. These checks cover the M4-based
  feature source, not the newly published, unmerged M6 integration.

Cloud repo path was `/workspace/work/R6-shooter`; the desktop path will differ.
Do not assume cloud toolchain paths exist locally. Use available Rust/Chromium
and external Playwright via NODE_PATH, as described in the handoffs:

```sh
npm run build:bomb-utility
npm run test:bomb-utility
npm run test:audio
npm run test:audio-pack
npm run test:controls
npm test
node tools/check-modes.mjs
npm run check
```

Cloud logs were outside the repo under `/workspace/work/`; rely on committed
reports, documented results and fresh local checks after transfer. The original
PDF was design context; explicit user changes above override it.

## Next: Claude's download pack, skins and map appearance

1. Fetch current branch/main and read Claude's latest PR notes and ENGINE_API.
   Merge M6 `5cafaa1` into the feature branch without modifying main. Preserve
   `effectiveGraphics(settings)` instead of direct graphics-level reads, existing
   `worldPost.draw()` integration, and the Graphics test IDs (`#gfx`,
   `#gx-download`, `#gx-remove`, `#set-open-graphics`, `#perf`). Keep M7 controls,
   all three independent WASM boot modules, spatial audio, Bomb policy and
   Interact tests alongside M6. Resolve cache stamps consistently and re-bake
   audio because its source fingerprint includes Sfx imports. Inspect quality settings,
   resource budgets and build tool. Add the existing audio runtime file there
   as an optional component, with graceful missing/corrupt fallback. Preserve
   the base game's small startup download and existing hosting.
2. M6 already supplies detailed gun meshes, baked AO/edge/cavity data and 4K
   relief/parallax skins on Ultra. Improve those existing **assets/materials**, preserving skin IDs, ownership, rarity,
   unlocks, save codes, equipped loadouts and weapon silhouettes. Inspect
   `js/core/skins.js`, `js/render/gpu-tex.js` (`skinThumb`, material/detail bakers)
   and `js/scene/viewmodel.js`. Higher quality should include sharper authored
   patterns, coherent metal/paint roughness and restrained surface wear, not
   merely larger textures. Reuse Claude's established asset formats/codecs.
3. Improve map **appearance** through the same optional pack: cohesive
   concrete/wood/metal/floor materials, normals/roughness where supported,
   sensible texel density and readable cover/enemies under existing lighting.
   Preserve map geometry, navigation, collision, floor heights, material IDs and
   competitive sightlines; coordinate geometry changes with Claude separately.
4. Preserve merged geometry/instancing, reuse/atlas materials where appropriate,
   cap texture sizes/anisotropy/VRAM for each device preset, dispose resources on
   mode exit, and verify cache reuse. Do not default every surface to 4K/8K or
   silently introduce a new loader dependency. If Claude's pack API is still
   pending, prepare the asset contribution and a concrete integration patch
   against his contract rather than inventing another downloader.
5. After merging, run the full shared-file suite and mode checks before further
   visual changes. Compare before/after screenshots in representative skins and maps, including
   dark interiors and upper floors. Measure download size, decoded texture
   memory, startup and shader warmup, draw calls, repeated-match memory and frame
   times at matching settings/hardware. Software-GPU timings are not a claim
   about physical gaming GPUs. Test the base fallback and missing/corrupt pack
   cases, then update the draft PR with actual results and remaining limits.

Continue useful independent work; do not ask the user again about approved
scope, profile defaults, multiplayer scope or the absence of split-screen.
