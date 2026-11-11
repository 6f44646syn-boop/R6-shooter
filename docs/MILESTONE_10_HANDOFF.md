# M10 first-person replay increment

Based on Claude's M8 commit `3a5db4d`, fast-forwarded into `feature/m7-ui-controls`.

The existing Battle and match recorders now retain six seconds at up to 30 Hz with
versioned view state. Kill cams reproduce ADS and lean, use the recorded attachment,
optic and skin, and render a first-person weapon in TDM, CTF and Bomb. Older Battle
and seven-field match frames still play. Battle freezes the replay window at death,
and the existing network messages carry lean and optic with safe defaults.

Shared changes are confined to the recording/playback paths, one Human view-state
copy, and an optic lookup in the existing dependency wiring. Engine simulation and
attachment/animation implementations stay with Claude.

## Validation

- `tests/replay-browser.mjs` passes 14 checks. Coverage includes ADS/right lean,
  yaw wrap, historical attachments/skin, existing snapshot messages, invalid lean,
  older frames, six-second retention, stop cleanup and five repeated Battle
  replays using one rig with stable texture counts. The repetition uses the same
  loadout and does not establish a memory bound across every possible loadout.
- `tools/check-modes.mjs` passes 99 checks.
- The exact `package.json` test sequence was executed with bundled Node because
  this desktop has no npm executable. Node/WASM suites completed. The initial
  browser pass reported shot count, a shooting fixture and a skin fixture.
- A browser repeat passed all except the 1080-rpm one-second check (18 shots
  versus 19). The same shot-count failure occurs on unchanged M8 `3a5db4d`.
  Both runs passed the two-session direct WebRTC kill-cam checks. Relay coverage
  was skipped because no relay was running.
- The shooting fixture now respawns the player before its scripted shots,
  resetting weapon state left by the roaming combat. The skin fixture selects a
  compatible gun when the random reward is gun-specific. Both original gameplay
  assertions pass in a separate run of their containing browser section.
- Syntax and whitespace checks pass.

## Remaining scope

M10 is still in progress. Grenade trajectory recording, a rebindable chase-camera
hold and grenade death playback remain. Battle currently disables online grenades,
and match modes are offline. Online grenade playback needs engine/network work.
For reliable grenade kill attribution, a useful engine hook would carry the
projectile ID and owner through kill/boom events, alongside blast position.

M11 spectator/ranked play and M12 Training Academy remain subsequent milestones.
This increment is ready for review as a draft and is not a completed M10 release.
Before live publication, use the established stamping/audio-rebake workflow.
