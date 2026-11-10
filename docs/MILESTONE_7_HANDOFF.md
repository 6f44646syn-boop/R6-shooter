# Milestone 7 — UI and controls handoff

## Baseline and scope

Audited `feature/m7-ui-controls` at `018aa02bb03efd6a3e2ea863e1dd6f9148cc1fa8`.
At audit, `main` and this branch pointed to the same Milestone 2 commit. None of
`rust/m7_controls/`, `js/ui/m7-raw-input.js`, or this document existed. There were
no AGENTS.md instructions in the checkout.

The supplied complete-engine PDF is design context for Milestones 7–12. The
immediate implementation is Milestone 7. The user confirmed that split-screen
is unwanted: this work adds no split-screen mode or selection UI.

Milestone 3 is now on `main` at `651d04c`. Claude prepared merge commit
`98bf6f1` on `integration/m3-m7`, combining that engine with our original
`6ebd245` feature head. The feature branch has adopted that exact merge by
fast-forward, preserving both histories and Claude's conflict resolutions.
Codex has not pushed to `main`.

Read [ENGINE_API.md](ENGINE_API.md) for the current engine contract. The handoff
was read directly from [Claude's PR comment](https://github.com/6f44646syn-boop/R6-shooter/pull/1#issuecomment-6763983308).
Engine ownership stays with Claude; UI, controls, the existing network layer and
later milestone modules stay with Codex. Shared glue edits must remain small.

## Implemented

- Tactical menu shell, direct Play/Settings/Controls/Customisation navigation,
  mode categories, searchable operators and weapons.
- Match settings separated from five settings categories; controls have separate
  device/aim and binding panels, with Movement/Combat/Utilities subcategories.
- Native first-launch modal asks for mouse or trackpad, traps focus and remembers
  selection. Storage failures fall back to session-only controls.
- Rust-owned primary and alternate bindings for 24 actions, duplicate rejection,
  held-input transitions, repeat suppression, ADS hold/toggle, optional automatic
  ADS while firing, look/ADS gain, inversion and release-all.
- Mouse defaults: middle **click** ability, Q/E lean, F interact/flashlight, G and
  Caps Lock grenade. Wheel scrolling is not intercepted.
- Trackpad defaults: J fire, L toggle ADS, U ability, automatic ADS on. All are
  configurable. Selecting either preset restores its bindings; aim multipliers
  remain user settings. Bindings and options survive reload.
- F dispatches bomb interaction and drone zap; T is a separately remappable drone
  zap input. The internal legacy rule key `KeyE` remains an adapter detail.
- Ability/cooldown, grenade and bomb HUD hints use the selected bindings.
- Blur, hidden document, pointer-lock loss, profile changes, mode changes and
  respawn release inputs. Text fields do not drive gameplay. Middle click is
  consumed without autoscroll.
- Accessible native inputs, labelled ARIA tabs, arrow/Home/End tab navigation,
  visible focus and responsive layouts. No external fonts or art requests.

## Rust / WASM contract

`rust/m7_controls` is a dependency-free crate, separate from `rust/core` to avoid
collisions with engine migration. Static hosting serves committed
`wasm/m7_controls.wasm`; `wasm/m7_controls.hash` fingerprints its Rust sources.
No wasm-bindgen or bundler is required.

ABI 1 exports:

| Export | Contract |
| --- | --- |
| `mc_abi()`, `mc_count()` | ABI 1, 24 actions |
| `mc_reset(profile)` | Restore mouse (0) or trackpad (1) defaults |
| `mc_bind(action,slot,code)` | Slot 0/1; 0 unbinds; reject collisions/bounds |
| `mc_binding(action,slot)` | Read a slot |
| `mc_event(code,down)` | 0 if unchanged; otherwise action index + 1 in low byte, bit 8 = down |
| `mc_secondary()` | Drain the extra ADS transition caused by automatic ADS |
| `mc_release()` | Clear state; return bit mask of actions to release |
| `mc_options(toggle,gain,adsGain,invert)` | Gain 0.1–4; ADS gain 0.1–2; finite values only |
| `mc_auto_ads(on)` | Enable input-based ADS while firing |
| `mc_look(delta,ads,vertical)` | Scaled/inverted finite input, no smoothing or target data |
| `mc_assist_allowed(training,online)` | True only for offline range training |

Action order is defined in `ACTIONS` in `js/ui/m7-raw-input.js` and the Rust
`DEFAULTS` array. Input codes 1–26 mean physical KeyA–KeyZ; 27–45 are the
`CODES` special keys; 128–132 mean DOM mouse buttons 0–4. Escape and F3/F4
remain browser/menu shortcuts. Digits, brackets and distance shortcuts are
reserved by the range. UI rebinding cannot consume these reserved shortcuts.

`createControls()` loads WASM and validates localStorage (`recoilRange.controls.v1`).
`attachRawInput()` captures DOM input and emits `onAction(id,down)`; it holds no
weapon, ability, damage, movement or networking rules. `main.js` translates
semantic actions to the existing engine's input methods. A future Rust engine
can consume these actions directly without changing the menus or storage.

## Integration with Claude's Milestone 3

The imported integration preserves:

1. `KeyC: 'vault'` in every mode; crouch is Space. The existing `vault` semantic
   action already emits KeyC, so it needs no new adapter.
2. `OperatorAbility`, `Interact` and `DroneZap`; Q/E remain lean inputs.
3. `controls.release()` on respawn alongside the real floor height (`me.y`, `f.y`).
4. Early core loading (`loadAll()`), `needCore()` before Battle startup, and the
   existing `data-errors` feedback.
5. `CoreWorld` in `js/wasm/world.js`, shared by Arena and MatchMap. The game core
   is ABI **3**; the separate controls WASM remains ABI **1**.
6. The existing replay recorder's seven-float actor stride:
   `[x, z, yaw, pitch, crouch, alive, y]`.

Codex's follow-up changes do not edit Claude's engine directories or physics,
map, simulation, AI, ability, bomb-rule or grenade implementations. Any engine
check failure is recorded for Claude instead of changing his implementation.
When touching shared glue, run `npm test` and `node tools/check-modes.mjs`.

## Fairness and remaining Milestone 7 work

The PDF also requests moderated trackpad recoil reduction, assisted tracking and
smoothing. These are **not implemented**. Both input profiles currently use the
same recoil, spread and target rules. The existing optional range assist is
explicitly limited to offline range training. Automatic ADS is ordinary input
composition and grants no aim, recoil or damage benefit.

The existing multiplayer uses a player-hosted authority. Client restrictions do
not establish competitive security against a modified client or host, and this
work makes no such claim. Keep profile assistance disabled online and do not
accept client-provided profile or ranked flags as proof of fairness.

Claude reports that the user narrowed networking to the existing relay/WebRTC
Battle. Confirmation was requested in this conversation because the original
brief asked for a broader backend. Until resolved, this increment makes no new
networking implementation or backend commitment.

Remaining verification/integration: browser/device testing on physical trackpads and Safari/Firefox;
Mac Caps Lock's unusual key-up-only behavior; full operator/model/role catalogue
presentation (the current data supplies name, weapon, sight and ability).
This is an operational Milestone 7 increment, not a claim that the entire
Milestone 7 or Milestones 8–12 are finished.

## Later milestone dependencies

| Milestone | Existing foundation and integration need |
| --- | --- |
| 8 | Existing WebAudio SFX, optic catalogue and weapon viewmodels; Rust weapon/attachment state and authoritative balance still needed |
| 9 | Codex owns the existing relay/WebRTC Battle; networking scope confirmation is pending. Coordinate B11 (online grenades) through the engine contract before touching engine-owned grenade logic |
| 10 | Extend `ModeGame._record()` and its seven-float actor stride for lean, ADS and recoil; use the existing recorder rather than adding another |
| 11 | Server results, identity, matchmaking and persistent seasonal records must precede rankings/rewards; no simulated online ranking UI |
| 12 | Existing range and local profile can host drill UI once Rust drill state/stat interfaces are agreed |

## Build and verification

```sh
# Use existing external Playwright test tooling, without project dependencies:
# export NODE_PATH=/path/to/test-tools/node_modules
# export PLAYWRIGHT_CHROMIUM=/usr/bin/chromium
cargo test --manifest-path rust/core/Cargo.toml
rustup target add wasm32-unknown-unknown
npm run build:controls
npm run test:controls
npm test
node tools/check-modes.mjs
npm run check
```

Playwright is not declared in the project's package.json and no package lockfile
is required. Browser tests load it with `createRequire`, matching `tests/run.mjs`.
Use an existing global installation with `NODE_PATH` pointing to its module root,
or external test tooling supplied by the development environment. In CI it is
pinned and installed only under the runner's temporary test-tools directory;
there is no project-local installation or `npm ci` step.

For an existing system Chromium, set `PLAYWRIGHT_CHROMIUM=/usr/bin/chromium`.
Build controls before running tests when Rust changes. CI validates native Rust,
committed WASM source freshness, persistence and real Chromium UI/input tests.
`tests/output/m7/` contains generated desktop/mobile screenshots (gitignored).
Full regression results and any baseline failures are recorded in the PR.

### Historical results before the Milestone 3 integration

| Check | Result |
| --- | --- |
| Native `rust/m7_controls` tests | 8 passed |
| Native existing `rust/core` tests | 9 passed |
| `npm run test:controls` with system Chromium | 26 checks passed, including committed WASM validation |
| `node tools/check-modes.mjs` | 82 checks passed |
| `npm run check` | Passed; existing unverified sight data remains labelled as such |
| `npm test` | 173 checks passed; 2 failures reproduced on the baseline |
| `git diff --check` | Passed |

The unchanged baseline produced 171 passes and 3 failures. One was the missing
favicon resource, fixed here in both game and unit-test HTML. The two remaining
failures are an exact-boundary shot-count expectation (1080 RPM over 1 second:
expected 19, received 18) and direct WebRTC join timeout in this environment.
The relay integration subtest was skipped because no relay was running. No
claim is made that real internet multiplayer was verified by this task.

The full suite ran after the main integration; subsequent tab-focus, HUD-label
and input-guard refinements were verified with the focused controls suite.
The click-through smoke test result is also recorded in the PR.

### Milestone 3 integration verification

The integration was revalidated in the Codex workspace, using Playwright from
outside the checkout and no project `node_modules` directory:

- Existing core native Rust tests: 18 passed.
- Controls native Rust tests: 8 passed.
- Controls/WASM/browser checks: 26 passed.
- Mode simulations: 97 checks passed.
- Data validation: passed.

- Full integrated `npm test`: 197 checks passed, 2 failed. The same exact-boundary
  shot-count mismatch (19 expected, 18 received) and direct WebRTC connection
  timeout reproduced here. Relay testing was skipped because no relay was running.
- Missing external test tooling: exits cleanly with status 2 and setup guidance.
- [Integrated controls CI](https://github.com/6f44646syn-boop/R6-shooter/actions/runs/42793392544): passed.

Claude's reported results are separate evidence: 204 checks passed, mode checks
97 passed and a clean play-through on his integration environment. His two
previously failing checks passed there. The environment difference is recorded;
no engine implementation was changed to make our run pass.
