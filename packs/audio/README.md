# Optional Recoil Range audio pack — Claude handoff

This is an optional, original sound pack for the future download manager. It
pre-renders the game's gunfire, eight ground-material footsteps, reloads, vaults
and gadget/UI cues into 81 mono 48 kHz PCM clips. Gunfire and footsteps have three
variants per bank. No third-party recordings or runtime libraries are included.
This is the audio portion of M8; attachments and the rest of M8 remain separate.

Use `recoil-range-audio-v1.rra` in the game. The ZIP also includes individual WAV
files for preview/editing, `manifest.json`, build provenance and measurements.
`SHA256SUMS` beside the ZIP verifies both downloadable files. The game never
fetches or enables this pack automatically; ordinary procedural playback remains
available without any download.

## Integration into the future download bundle

Codex is implementing UI/controls and audio on `feature/m7-ui-controls`, alongside
Claude's engine work. No engine-core or simulation changes are needed for this
pack. Use the existing shared `Sfx` instance, after its `unlock()` has been called
from a user gesture. Download/install during the optional pack flow, before a
match; avoid doing the decode in the middle of gameplay.

```js
// Inside the future pack-download button handler:
sfx.unlock();
const response = await fetch(audioPackUrl);
if (!response.ok) throw new Error(`Audio download failed: ${response.status}`);
await sfx.installPack(await response.arrayBuffer());
// To return to procedural sounds:
// sfx.removePack();
```

A corrupt replacement rejects without discarding the installed pack. Handle a
failed download with the pack manager's normal error/retry flow; synthesis still
works if no pack was installed. Cache this versioned file through the existing
pack manager if offline persistence is desired. This increment adds no persistence
or download UI and changes no hosting configuration.

The loader is `js/audio/audio-pack.js`. `Sfx.installPack(bytes)` validates and
decodes it into reusable AudioBuffers; `Sfx.removePack()` releases the bank for
garbage collection after active voices finish. Unknown future gun tones and
changed material profiles fall back to synthesis. Re-bake this pack if source
synthesis or Rust material profiles change; a source fingerprint check catches
stale committed assets.

Live Rust attenuation, floor/wall occlusion, HRTF/stereo positioning, priorities,
master volume and the 32-voice limit still apply. Samples replace source generation
only. No bot hearing rules, audibility limits, movement, weapons or networking
behavior changes. Keep Q/E leaning and middle-mouse ability controls as agreed;
there is no split-screen feature.

## Measured performance and cost

The raw runtime file is **1,397,000 bytes (1.33 MiB)**. Decoded samples occupy
**2,774,856 bytes (2.65 MiB)**, excluding browser/node overhead and the transient
input file. Decode took **39.4 ms wall time**, including intentional event-loop
yields, on the recorded Chromium environment.

| Same occluded HRTF gunfire workload | Procedural | Cached pack |
| --- | ---: | ---: |
| Nodes per voice, excluding shared master/limiter | 8 | 4 |
| Sources per voice | 2 | 1 |
| Median construction/recycling of 400 shots | 83.5 ms | 47.6 ms |
| Median one-second offline render with 32 voices | 28.9 ms | 12.8 ms |

Unoccluded voices omit the low-pass node in both paths. Measurements are from
interleaved warmed-up runs; raw runs, environment and method are in
`benchmark.json`. This shows lower source-generation work in this audio benchmark,
not measured game FPS or a guarantee on every device. Keep the pack optional and
verify on target hardware before choosing it as a default download.

## Format and editing

`RRAUDIO1` uses a 16-byte header: 8-byte ASCII magic, uint32 little-endian JSON
length, uint32 little-endian PCM payload length. UTF-8 manifest JSON follows,
padded to a 4-byte boundary, then concatenated mono PCM signed 16-bit little-endian
samples. Clip offsets are relative to that payload. The loader checks size,
format, bounds, overlap, identifiers and material metadata before decoding.

WAV previews are normalized to 0.98 peak. Each manifest clip's `gain` restores
the original source headroom in the runtime loader; apply it if importing the
WAVs into another playback pipeline. Do not apply it twice. Direction, volume
and occlusion are deliberately applied at playback rather than baked into clips.

## Rebuild and verify

Use existing external Playwright tooling; do not add game dependencies:

```sh
export NODE_PATH=/path/to/external-test-tools/node_modules
export PLAYWRIGHT_CHROMIUM=/usr/bin/chromium
npm run build:audio-pack
# Publish the newly baked file locally before benchmarking it:
cp work/audio-pack/recoil-range-audio-v1.rra packs/audio/
node tools/bench-audio-pack.mjs
# Review/update this README's measurements after a new benchmark:
python3 tools/package-audio-pack.py
npm run test:audio-pack
npm run test:audio
```

The packager copies build metadata and manifest, assembles the ZIP (including all
81 WAV previews), and regenerates the two published SHA-256 checksums. Baking is
seeded, but browser implementations can produce different samples; preserve the
recorded renderer and checksums when distributing an existing version.
