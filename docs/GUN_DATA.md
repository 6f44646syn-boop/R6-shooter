# Gun data

All guns live in `data/guns.json`. Sights live in `data/optics.json` and ADS sensitivity per
magnification in `data/sens.json`; both are covered in [SCOPES.md](SCOPES.md).
Edit the files, reload the page, done: no code changes needed.

The guns shipped in this repo are **placeholders** (`"placeholder": true`). Their recoil
numbers are invented shapes for testing the engine and are not measurements of any game.
The HUD shows a `PLACEHOLDER RECOIL` tag for any gun with `"placeholder": true`. Set it to
`false` once you have pasted in your own measured numbers.

If a gun has a bad field, the page skips that gun, lists the problem in the menu, and logs it
to the browser console (F12), naming the gun and the field, e.g.
`guns[3] (smg-01).rpm: must be a number > 0 (got -5)`.

## File layout

```json
{
  "guns": [
    { ...gun 1... },
    { ...gun 2... }
  ]
}
```

Keys `1`-`9` and `0` select the first ten guns in file order.

## One gun, with every field

```json
{
  "id": "rifle-01",
  "name": "Rifle 01",
  "placeholder": true,
  "rpm": 750,
  "magSize": 30,
  "reloadSeconds": 2.4,
  "hipMultiplier": 1.0,
  "adsMultiplier": 1.0,
  "resetSeconds": 0.35,
  "adsSeconds": 0.3,
  "side": "attacker",
  "optics": ["@iron", "@sight", "@magnified"],
  "opticsExclude": [],
  "defaultOptic": "mag_a",
  "opticRecoilScale": {},
  "opticsVerified": false,
  "fireMode": "auto",
  "model": "rifle",
  "tone": 0.5,
  "jitter": { "yawDeg": 0.04, "pitchDeg": 0.03 },
  "recovery": { "delaySeconds": 0.2, "degPerSecond": 10 },
  "sprayPath": [
    [0, 0],
    [0, 0.35],
    [0.02, 0.7],
    [0.05, 1.05]
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string, unique | Internal id. |
| `name` | string | Shown in the HUD. Use generic names ("Rifle 01"). |
| `placeholder` | true / false | `true` shows the PLACEHOLDER RECOIL tag. |
| `rpm` | number > 0 | Rounds per minute. Shot interval = 60 / rpm seconds. |
| `magSize` | integer 1-1000 | Rounds per magazine. |
| `reloadSeconds` | number >= 0 | Time from pressing R until you can fire again. |
| `optics`, `opticsExclude`, `defaultOptic`, `opticRecoilScale`, `opticsVerified` | see [SCOPES.md](SCOPES.md) | Which sights the gun can use, the starting sight, an optional per-sight spray multiplier, and whether you have checked the list in game. |
| `adsSeconds` | number (optional) | Time to aim down sights. Default 0.3. Each sight group's `adsSpeedBonus` divides it: time = adsSeconds / (1 + bonus). |
| `side` | `"attacker"` or `"defender"` (optional) | Used for the sight rules in SCOPES.md. Shown in the loadout. |
| `hipMultiplier` | number > 0 | Extra hipfire sensitivity factor for this gun. Normally 1.0. |
| `adsMultiplier` | number > 0 | Extra ADS sensitivity factor for this gun, on top of the per-magnification multiplier in `data/sens.json`. Normally 1.0. |
| `resetSeconds` | number > 0 | Pause after the last shot before the next shot counts as bullet 1 again. Should be longer than one shot interval. |
| `fireMode` | `"auto"` or `"semi"` (optional) | Default `"auto"`. Semi fires once per click, at most at `rpm`. |
| `model` | optional | First-person model: `rifle`, `carbine`, `smg`, `lmg` or `marksman`. Cosmetic. If missing, guessed from the start of `id`, else `rifle`. The sight drawn on the model follows the selected sight (iron posts, a 1x sight, or a scope sized by zoom). |
| `tone` | 0-1 (optional) | Pitch of the synthesised shot sound. Cosmetic. Default 0.5. |
| `jitter.yawDeg`, `jitter.pitchDeg` | number >= 0 | Standard deviation, in degrees, of random noise added to each shot's kick. 0 = perfectly repeatable spray. |
| `recovery.delaySeconds` | number >= 0 | How long the view stays where the recoil left it after you stop firing (never less than one shot interval). |
| `recovery.degPerSecond` | number >= 0 | How fast the view then returns to where you aimed. 0 = never returns. |
| `sprayPath` | array of `[yawDeg, pitchDeg]` | See below. |

## sprayPath

`sprayPath[i]` is where bullet `i` lands **relative to bullet 0**, in degrees, if you hold the
trigger and do not touch the mouse. That is exactly what you get by tracing a spray on a wall.

- First entry: `[0, 0]` (bullet 1 lands where you aimed).
- Positive pitch = up, positive yaw = right.
- Usually one entry per bullet in the magazine. If the magazine is longer than the path, the
  game keeps going with the average of the last 3 steps (plus jitter).

How it plays:

1. Each bullet leaves through the centre of the crosshair.
2. After each shot the view is kicked by the step to the next entry
   (`sprayPath[i+1] - sprayPath[i]`, plus jitter). The kick eases in over 40% of the shot
   interval, so the crosshair visibly climbs and has arrived before the next shot.
3. You pull against it with the mouse. With jitter at 0 and no mouse movement, bullet `i`
   lands exactly at `sprayPath[i]` (the test suite checks this to 0.01 mm).

Jitter is added to each step, so it accumulates through the spray. A new random seed is
picked for every magazine. To replay the same spray, set **Fixed seed** in Settings (or add
`?seed=1234` to the URL).

### From a traced spray to sprayPath

1. In the game, stand a known distance from a flat wall, aim at a mark, hold the trigger for a
   full magazine without touching the mouse. Screenshot the holes straight on.
2. Note each hole's pixel position in firing order (any image editor shows cursor x, y).
   Save them one per line, `x y`, in a text file.
3. Measure the image scale: pixels per metre on the wall (for example a known 1 m marking).
4. Run:

   ```
   node tools/path-from-points.mjs holes.txt --distance 10 --px-per-metre 85.3
   ```

   It prints a `"sprayPath": [...]` block to paste into the gun.

The tool assumes the camera looked straight at the wall and bullet 1 hit the aim point.

## Measured guns

Slots 2-10 use sprays measured in game (hip-fire, mouse held still, 12 m wall, 1920x1080) at
**83 deg vertical FOV**. Their `sprayPath` values are real view angles in degrees: never rescale
them. The trainer's FOV setting is vertical and defaults to 83 to match.

Extra fields on a measured gun:

| Field | Meaning |
|---|---|
| `placeholder: false` | The spray is measured. The HUD shows MEASURED SPRAY instead of PLACEHOLDER RECOIL. |
| `placeholderFields` | Values that are still placeholders (jitter, recovery, resetSeconds, adsSeconds, hip/adsMultiplier). Shown as a tooltip in the HUD and loadout. |
| `measuredAtVFov` | Vertical FOV the spray was measured at (83). |
| `tail: "hold"` | Past the last measured bullet the view stays on the last point instead of extrapolating. |
| `chambered: true` | Holds magSize + 1. A reload with rounds left gives magSize + 1; from empty, magSize. |
| `damage` | Per-bullet damage from the game. Shown in the loadout; not used in the sim. |
| `measurement` | The bullet-hole pixels (`holesPx`) the spray was computed from, plus notes. |

Tools (the measurement file lives in the gitignored `reference/` folder because it names real
operators; `data/` is published with the site):

```bash
node tools/merge-measured.mjs reference/guns.measured.json --write
```

Merges by slot into `data/guns.json` (never replaces it), keeps each gun's generic id, name,
model and sights, and leaves slots that are not in the file (slot 1) unchanged.

```bash
node tools/check-spray-fit.mjs 83
```

Read-only: confirms every measured `sprayPath` matches its stored hole pixels at 83 deg.

```bash
node tools/refit-fov.mjs <vFOV> reference/guns.measured.json
```

Recomputes the measurement file's angles from the pixels at another vertical FOV, if the FOV
assumption ever turns out wrong. Merge again afterwards.

`tools/make-placeholder-guns.mjs` refuses to run while any gun is measured (use `--force` only
to throw the measured data away).

## Sights and ADS sensitivity

Sights moved to their own catalogue. See [SCOPES.md](SCOPES.md) for `data/optics.json`, the
per-gun sight fields and `data/sens.json` (ADS multiplier per magnification, keyed `"1.0x"`,
`"2.5x"`, `"3.5x"`). The old single `optic` number on a gun is no longer used; if it is still
there the page warns and ignores it.
