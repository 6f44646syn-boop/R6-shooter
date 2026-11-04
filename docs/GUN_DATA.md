# Gun data

All guns live in `data/guns.json`. Optic sensitivity multipliers live in `data/optics.json`.
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
  "optic": 1.0,
  "hipMultiplier": 1.0,
  "adsMultiplier": 1.0,
  "resetSeconds": 0.35,
  "fireMode": "auto",
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
| `optic` | number | Magnification when aiming. Must be one of the `zoom` values in `data/optics.json` (1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 5.0, 12.0). |
| `hipMultiplier` | number > 0 | Extra hipfire sensitivity factor for this gun. Normally 1.0. |
| `adsMultiplier` | number > 0 | Extra ADS sensitivity factor for this gun, on top of the optic multiplier. Normally 1.0. |
| `resetSeconds` | number > 0 | Pause after the last shot before the next shot counts as bullet 1 again. Should be longer than one shot interval. |
| `fireMode` | `"auto"` or `"semi"` (optional) | Default `"auto"`. Semi fires once per click, at most at `rpm`. |
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

## Optics: data/optics.json

```json
{ "optics": [ { "zoom": 2.5, "adsMultiplier": 1.0 }, ... ] }
```

- `zoom` is the magnification. ADS FOV is the hipfire FOV divided by `zoom` in tan-space:
  `tan(adsFov / 2) = tan(hipFov / 2) / zoom`.
- `adsMultiplier` scales sensitivity while aiming:
  `ADS deg/count = hip deg/count * optic adsMultiplier * gun adsMultiplier`.
  1.0 = same deg/count as hipfire.

Settings → ADS multipliers can override these per browser while you calibrate. Copy the
values you settle on back into `optics.json` so they become the defaults for everyone.
