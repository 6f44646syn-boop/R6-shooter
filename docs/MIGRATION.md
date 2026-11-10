# Moving the engine to Rust

The plan from the overhaul document, kept honest: what is in Rust today, what is next, and
what stays in JavaScript and why. Each step is tested against the code it replaces before the
old code is removed. The game stays playable after every step.

## How Rust runs in the browser

- The Rust code is one crate, `rust/core`, compiled to WebAssembly (`wasm/recoil_core.wasm`).
- It uses no outside libraries (no crates, no wasm-bindgen): a small C-style interface and a
  hand-written loader (`js/wasm/core.js`). The site still loads nothing from anywhere else.
- The same file runs in Node for the headless tests.
- Build: `tools/build-wasm.sh` (needs the Rust compiler with the `wasm32-unknown-unknown`
  target). The built `.wasm` is committed, so GitHub Pages serves it as a static file.
  `npm test` fails if the committed file does not match the Rust source.

## Status by system

| System | Was | Now | Planned | Milestone |
|---|---|---|---|---|
| Match-map collision (push-out, swept movement) | JS `modes/map.js` | **Rust** | — | 2 |
| Raycast, line of sight (match maps) | JS `modes/map.js`, `geom.js` | **Rust** | — | 2 |
| Pathfinding (A* + path smoothing) | JS `modes/map.js` | **Rust** | — | 2 |
| Breakable panels and doors (state) | JS `modes/map.js` | **Rust** (state mirrored to JS for drawing) | — | 2 |
| Height-aware physics (floors, stairs, ramps, vault) | JS `battle/arena.js` | JS | Rust, shared by Battle and the match modes | 3 |
| Grenade and projectile flight | JS `modes/nades.js`, `abilities.js` | JS | Rust | 3–4 |
| Destruction, barbed wire, reinforcing | JS | JS | Rust | 4 |
| Match simulation (actors, rules, abilities) | JS `modes/sim.js`, `rules.js`, `abilities.js` | JS | Rust | 5 |
| Bot AI (match modes and Battle) | JS `modes/bots.js`, `battle/bot.js` | JS | Rust | 5 |
| Recoil, spread, weapon state, attachments | JS `core/` | JS | Rust | 8 |
| Replay recording | JS `modes/game.js`, `battle/battle.js` | JS | Rust | 10 |
| Drawing (three.js, WebGL) | JS | JS | Stays JS: see below | 6 |
| Menus, HUD, input, sound output, storage, WebRTC | JS | JS | Stays JS (browser APIs) | — |

## What stays in JavaScript, and why

- **Drawing stays on three.js.** Replacing it with a Rust renderer (wgpu) means rewriting
  every sight, skin, map and effect, adds a multi-megabyte download, and WebGPU is not on
  every school laptop. The Rust core instead hands three.js plain number buffers (positions,
  visibility lists), which is where Rust helps a renderer most.
- **Browser APIs** (DOM, pointer lock, WebAudio, localStorage, WebRTC) can only be called from
  JavaScript; those layers stay thin and hold no game rules.

## Rules for each step

1. Port one system; keep the JavaScript version as the reference under `tools/reference/`.
2. Parity test: the same seeded questions to both, answers must match (`tools/check-core.mjs`).
3. Run every suite (`npm test`, `tools/check-modes.mjs`) on the Rust path.
4. Measure before and after (`tools/bench-sim.mjs`), record in `BASELINE.md`.
5. Remove the JavaScript version from the game. New game logic is written in Rust.
