# Sights

Everything about sights is data: `data/optics.json` (the catalogue), the sight fields on each
gun in `data/guns.json`, and ADS sensitivity per magnification in `data/sens.json`.
Edit JSON, reload the page. No code changes.

In game: the **Sight** row in the menu's Loadout panel lists the current slot's sights.
`[` and `]` switch sights while not aiming. F4 opens the sight gallery.

## a. Give a gun a sight

On the gun in `data/guns.json`:

```json
"optics": ["@iron", "@sight", "@magnified"],
"opticsExclude": ["dot_b"],
"defaultOptic": "mag_a",
"opticRecoilScale": {},
"opticsVerified": false
```

- `optics`: optic ids and/or `@group` tokens. `@sight` means every sight in group `sight`.
- `opticsExclude`: ids removed after the groups are expanded.
- `defaultOptic`: the starting sight. A sight the player picked (saved per slot in the browser
  as `scope:<gun id>`) wins, unless the gun no longer allows it.
- `opticRecoilScale`: optional, e.g. `{"mag_a": 1.1}` multiplies the spray path by 1.1 with
  that sight. Missing = 1 (the same spray with every sight; on-screen kick still grows with zoom
  because the FOV narrows).
- `opticsVerified`: set to `true` once you have checked the list in your game.

House rules: defenders start on `holo_a`, attackers on `mag_a`. Attackers get `@magnified`;
defender automatics do not. `@telescopic` is for attacker marksman rifles only.

## b. Add a new sight

Add an entry to `optics` in `data/optics.json`:

```json
{ "id": "holo_e", "group": "sight", "label": "Holo E",
  "housing": { "shape": "rect", "w": 0.34, "h": 0.24, "radius": 0.03,
               "bezel": 0.01, "base": 0.03, "hood": 0.0, "tint": 0.04 },
  "reticle": { "glow": 0.6,
               "shapes": [ { "t": "ring", "r": 24, "w": 2 }, { "t": "dot", "r": 2 } ] } }
```

Every gun that lists `@sight` gets it automatically. To give it to one gun only, put it in a
group nobody lists with `@`, and add its id to that gun's `optics`.

## c. Add a new magnification

Either override the zoom on one sight:

```json
{ "id": "mag_d", "group": "magnified", "zoom": 3.0, "label": "Magnified D", "housing": { ... }, "reticle": { ... } }
```

or add a group:

```json
"groups": { "long": { "label": "Long", "zoom": 4.0, "adsSpeedBonus": 0.0 } }
```

The Settings page gets a new ADS sensitivity row (`3.0x`, `4.0x`, ...) automatically. Until
you give it a value in `data/sens.json` (or in Settings), it uses the `1.0x` value divided by
the zoom and shows a **placeholder** badge. `sensKey` on a sight can point it at a different
row, e.g. `"sensKey": "2.5x"`.

## d. Draw a reticle and housing

Housing (fractions of screen **height**, so the look does not change with aspect ratio):

| Field | Meaning |
|---|---|
| `shape` | `"rect"` (rounded rectangle) or `"round"` (ellipse) |
| `w`, `h` | clear glass window |
| `radius` | corner radius (rect only) |
| `bezel` | dark ring around the window |
| `base`, `hood` | optional dark bars under / over the window |
| `tint` | darkening of the glass, 0 to 0.3 |

Reticle shapes: pixels at 1080p (scaled with screen height), origin at screen centre, y down.

```json
{ "t": "dot",  "r": 2.5 }
{ "t": "ring", "r": 20, "w": 2 }
{ "t": "line", "x1": -12, "y1": 0, "x2": -4, "y2": 0, "w": 2 }
{ "t": "poly", "pts": [[0, -6], [5, 4], [-5, 4]], "fill": true }
```

Add `"c": "dark"` to a shape to draw it in the housing colour instead of the reticle colour
(used for the iron sight's front post). `glow` (0 to 1) sets the soft glow. Reticle colour is
a setting (red, green, cyan, white, yellow).

Example 1, a reflex sight with a bar and dot:

```json
{ "id": "reflex_d", "group": "sight", "label": "Reflex D",
  "housing": { "shape": "rect", "w": 0.26, "h": 0.19, "radius": 0.01, "bezel": 0.009, "base": 0.025, "tint": 0.03 },
  "reticle": { "glow": 0.6, "shapes": [
    { "t": "line", "x1": 0, "y1": 8, "x2": 0, "y2": 24, "w": 3 },
    { "t": "dot", "r": 2 } ] } }
```

Example 2, a magnified sight with a chevron and range lines:

```json
{ "id": "mag_d", "group": "magnified", "label": "Magnified D",
  "housing": { "shape": "round", "w": 0.42, "h": 0.36, "bezel": 0.065, "base": 0.05, "tint": 0.08 },
  "reticle": { "glow": 0.5, "shapes": [
    { "t": "poly", "fill": true, "pts": [[0, 0], [8, 11], [5, 11], [0, 5], [-5, 11], [-8, 11]] },
    { "t": "line", "x1": -9, "y1": 28, "x2": 9, "y2": 28, "w": 2 },
    { "t": "line", "x1": -6, "y1": 42, "x2": 6, "y2": 42, "w": 2 } ] } }
```

## e. Check my data

```bash
node tools/check-data.mjs
```

(or `npm run check`). It fails with a readable message on duplicate ids, unknown ids or
`@groups`, empty sight lists, a `defaultOptic` outside the list, bad zooms, unknown shapes and
housing fractions outside 0 to 1. On success it prints how many sights each slot gets. The page
runs the same checks on load and lists problems in the menu and the browser console.

## f. Confirm a slot in your own game

In the game: operator select → pick the operator → open the weapon's attachments → read the
Sight list. Update that slot's `optics` (and `opticsExclude`) to match, then set
`"opticsVerified": true`. The Loadout panel stops showing "not yet checked in game" for it.

## g. Tune the look against screenshots

1. Put your own screenshots in `reference/` at the repo root. That folder is in `.gitignore`
   and the dev server refuses to serve it, so it is never committed or published. Never add it
   to the site.
2. Open the F4 gallery. Every sight is drawn there with the same code as the in-game overlay,
   at 1080p proportions.
3. Compare by eye, then adjust the numbers in `data/optics.json` (window `w`/`h`, `bezel`,
   reticle sizes, `glow`) and reload. Everything on screen stays drawn from scratch; the
   screenshots are only for reading off proportions.
