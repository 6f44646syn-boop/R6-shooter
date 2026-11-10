// Weapon skin catalogue: 200 skins from packs (100 Common, 60 Rare, 32 Epic, 8 Black Ice),
// generated from fixed seeds so every PC has the same catalogue (save codes refer to ids),
// plus the 10 factory skins each slot wears in Ultra graphics when nothing is equipped.
//
// A skin is drawn by the GPU skin shader (render/gpu-tex.js) from:
//   pattern  0 contour, 1 digital, 2 woodland, 3 tiger, 4 worn, 5 hex, 6 damascus, 7 blotch,
//            8 carbon, 9 splinter, 10 black ice, 11 fade, 12 stripes, 13 marble, 14 circuit
//   c        four colours (linear RGB)
//   p        [scale (whole number), warp, threshold shift, spare]
//   rm       [roughness, metalness] of the base, then of the accent
//   clearcoat, wear (bare metal at the edges), glow ([r, g, b] light from the accent lines)
import { mulberry32 } from './prng.js?v=5cafaa1-mwb62ceu';

export const RARITIES = [
  { key: 'common', name: 'Common', color: '#b4bcc6', odds: 0.70, refund: 20 },
  { key: 'rare', name: 'Rare', color: '#4da3ff', odds: 0.22, refund: 40 },
  { key: 'epic', name: 'Epic', color: '#c26bff', odds: 0.07, refund: 80 },
  { key: 'blackice', name: 'Black Ice', color: '#7ff3ff', odds: 0.01, refund: 200 },
  { key: 'legendary', name: 'Legendary', color: '#ffc23a', odds: 0, refund: 0 },     // not in packs: your own photo
];
// The Legendary skin (your photo, any gun; see legend.js) and the gold finish other players
// see on a gun wearing it.
export const LEGEND_ID = 2000, LEGEND_GOLD_ID = 2001;
const L3 = (r, g, b) => [r, g, b];
export const LEGEND = { id: LEGEND_ID, name: 'Legend', rarity: 'legendary', photo: true, pattern: 11, c: [L3(0.5, 0.32, 0.05), L3(1, 0.7, 0.2), L3(1, 0.85, 0.4), L3(0, 0, 0)], p: [1, 1, 0, 0], rm: [0.3, 0.25, 0.3, 0.25], clearcoat: 1, wear: 0.12, glow: [0, 0, 0] };
export const LEGEND_GOLD = { ...LEGEND, id: LEGEND_GOLD_ID, name: 'Legend', photo: false, rm: [0.25, 1, 0.2, 1], wear: 0.2 };
export const RARITY = Object.fromEntries(RARITIES.map((r) => [r.key, r]));
export const PATTERN_NAMES = ['Contour', 'Pixel', 'Woodland', 'Tiger', 'Veteran', 'Hexcore', 'Damascus', 'Blot', 'Weave', 'Shard', 'Black Ice', 'Fade', 'Line', 'Marble', 'Circuit', 'Blossom', 'Tide'];

// HSL (0..1) -> linear RGB.
function hsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [lin(f(0)), lin(f(8)), lin(f(4))].map((v) => Math.round(v * 1000) / 1000);
}
const pick = (rng, a) => a[Math.floor(rng() * a.length)];

// Colour families for common skins: [name, hue, saturation range, lightness range].
const FAMILIES = [
  ['Olive', 0.2, [0.15, 0.35], [0.18, 0.45]], ['Sand', 0.1, [0.18, 0.35], [0.35, 0.65]], ['Slate', 0.6, [0.05, 0.15], [0.15, 0.5]],
  ['Arctic', 0.58, [0.05, 0.18], [0.45, 0.85]], ['Forest', 0.33, [0.2, 0.4], [0.12, 0.4]], ['Dusk', 0.72, [0.12, 0.3], [0.15, 0.45]],
  ['Rust', 0.04, [0.3, 0.5], [0.18, 0.45]], ['Urban', 0.6, [0.02, 0.08], [0.2, 0.7]], ['Clay', 0.06, [0.2, 0.35], [0.3, 0.55]],
  ['Moss', 0.25, [0.2, 0.35], [0.2, 0.42]], ['Ash', 0.08, [0.03, 0.08], [0.3, 0.6]], ['Steel', 0.58, [0.06, 0.14], [0.25, 0.55]],
];
const COMMON_PATTERNS = [1, 2, 3, 4, 7, 9, 11, 12];
// Rare: [name, hue] so the name matches the colour.
const RARE_WORDS = [['Cobalt', 0.61], ['Crimson', 0.98], ['Viper', 0.3], ['Sunset', 0.06], ['Glacier', 0.53], ['Neon', 0.36], ['Ember', 0.03], ['Toxic', 0.24], ['Royal', 0.7], ['Coral', 0.01], ['Volt', 0.15], ['Jade', 0.42], ['Saffron', 0.11], ['Orchid', 0.83], ['Lagoon', 0.5]];
const RARE_PATTERNS = [0, 5, 8, 13, 1, 3, 9, 12];
const EPIC_WORDS = ['Nebula', 'Inferno', 'Aurora', 'Phantom', 'Solar Flare', 'Abyss', 'Prism', 'Overdrive', 'Tempest', 'Eclipse', 'Venom', 'Mirage', 'Paradox', 'Zenith', 'Vortex', 'Spectre'];
const EPIC_PATTERNS = [0, 5, 6, 13, 14, 15, 9, 16];      // 15 blossom and 16 tide: illustrated
// Black Ice: [name, hue] in four colours (blue, red, pink, purple), two of each.
const ICE = [['Glacier', 0.6], ['Deep Blue', 0.63], ['Red Shift', 0.99], ['Crimson Frost', 0.975], ['Rose', 0.93], ['Pink Frost', 0.905], ['Violet', 0.79], ['Purple Haze', 0.76],
  ['Venom Green', 0.37]];     // id 200 (added later, so it sits after the original 200)

function make(id) {
  const rng = mulberry32((id + 1) * 7919 + 13);
  if (id < 100) {                                       // Common: muted 2-4 colour camo, matt
    const fam = FAMILIES[id % FAMILIES.length];
    const pat = COMMON_PATTERNS[Math.floor(id / FAMILIES.length) % COMMON_PATTERNS.length];
    const s = () => fam[2][0] + rng() * (fam[2][1] - fam[2][0]);
    const l = (k) => fam[3][0] + (fam[3][1] - fam[3][0]) * k;
    const hj = () => fam[1] + (rng() - 0.5) * 0.08;
    const c = [hsl(hj(), s(), l(0.85)), hsl(hj(), s(), l(0.45)), hsl(hj(), s(), l(0.15)), hsl(hj(), s() * 0.6, l(0.6))];
    const metal = pat === 4 ? 1 : 0.1;
    return { id, rarity: 'common', name: fam[0] + ' ' + PATTERN_NAMES[pat], pattern: pat, c,
      p: [1 + Math.floor(rng() * 2), 0.5 + rng(), (rng() - 0.5) * 0.1, 0], rm: [0.6 + rng() * 0.15, 0.08, 0.5, metal], clearcoat: 0, wear: 0.8, glow: [0, 0, 0] };
  }
  if (id < 160) {                                       // Rare: neutral base + one vivid accent, satin
    const k = id - 100;
    const [word, hue] = RARE_WORDS[k % RARE_WORDS.length];
    const pat = RARE_PATTERNS[Math.floor(k / RARE_WORDS.length) % RARE_PATTERNS.length];
    const h = hue + (rng() - 0.5) * 0.03;
    const c = [hsl(0.6, 0.06, 0.08 + rng() * 0.1), hsl(h, 0.75 + rng() * 0.2, 0.42), hsl(h + 0.05, 0.6, 0.62), hsl(0.6, 0.05, 0.3 + rng() * 0.2)];
    return { id, rarity: 'rare', name: word + ' ' + PATTERN_NAMES[pat], pattern: pat, c,
      p: [1 + Math.floor(rng() * 2), 0.6 + rng(), (rng() - 0.5) * 0.1, 0], rm: [0.45 + rng() * 0.1, 0.3, 0.35, 0.5], clearcoat: 0.3, wear: 0.6, glow: [0, 0, 0] };
  }
  if (id < 192) {                                       // Epic: two vivid anodised colours, metallic, lacquered
    const k = id - 160;
    const word = EPIC_WORDS[k % EPIC_WORDS.length];
    const pat = EPIC_PATTERNS[(k + Math.floor(k / EPIC_WORDS.length) * 3) % EPIC_PATTERNS.length];
    const h = (k * 0.381966) % 1;
    let c = [hsl(h, 0.85, 0.12), hsl(h + 0.45 + rng() * 0.15, 0.95, 0.5), hsl(h + 0.08, 0.9, 0.35), hsl(h + 0.5, 0.6, 0.75)];
    // Illustrated designs get painterly palettes: dark branches, bright flowers, lacquered cream;
    // deep sea, bright water and white foam.
    if (pat === 15) c = [hsl(0.05, 0.3, 0.08), hsl(h, 0.85, 0.55), hsl(0.13, 0.9, 0.6), hsl(0.1, 0.25, 0.88)];
    if (pat === 16) c = [hsl(h, 0.8, 0.1), hsl(h + 0.03, 0.85, 0.42), hsl(h + 0.08, 0.7, 0.6), hsl(h, 0.15, 0.95)];
    const glows = pat === 14 || pat === 0 || pat === 5;
    return { id, rarity: 'epic', name: word + ' ' + PATTERN_NAMES[pat], pattern: pat, c,
      p: [1 + Math.floor(rng() * 2), 0.8 + rng(), (rng() - 0.5) * 0.08, 0], rm: [0.3, 0.75, 0.22, 1], clearcoat: 0.8, wear: 0.3,
      glow: glows ? c[1].map((v) => Math.round(v * 1.5 * 1000) / 1000) : [0, 0, 0] };
  }
  // Black Ice: a deep glossy colour, shattered pale cracks and sparkles, and 3D ice crystals
  // growing off the gun's edges (viewmodel.js iceCrystals).
  const [word, hue] = ICE[id - 192];
  const two = (id - 192) % 2;                          // the second of each pair is darker with brighter cracks
  const glow = hsl(hue, 0.9, 0.62);
  return { id, rarity: 'blackice', name: 'Black Ice ' + word, pattern: 10, ice: hsl(hue, 0.7, 0.78),
    c: [hsl(hue, 0.8, two ? 0.045 : 0.07), hsl(hue, 0.4, 0.88), [0.95, 0.97, 1], hsl(hue, 0.7, two ? 0.12 : 0.17)],
    p: [1 + two, 0.6, 0, 0], rm: [0.14, 0.35, 0.3, 0.2], clearcoat: 1, wear: 0.1, glow: glow.map((v) => Math.round(v * 0.9 * 1000) / 1000) };
}

export const SKIN_COUNT = 201;      // 100 Common, 60 Rare, 32 Epic, 9 Black Ice
export const CATALOGUE = Array.from({ length: SKIN_COUNT }, (_, i) => make(i));
// Unique names (the same word + pattern can come up twice).
{
  const seen = new Map();
  for (const s of CATALOGUE) {
    const n = (seen.get(s.name) || 0) + 1;
    seen.set(s.name, n);
    if (n > 1) s.name += ' ' + ['', '', 'II', 'III', 'IV', 'V', 'VI'][n];
  }
}

// Gun-exclusive skins (by loadout slot 0-9): every Black Ice belongs to one gun, every other
// Epic to one gun, and every fifth Rare to a family (SMGs, or rifles and carbines).
export const FAMILIES_BY_SLOT = { smg: [0, 3, 6, 8, 9], rifle: [1, 2, 4, 7] };
const BLACK_ICE_GUN = [4, 1, 0, 7, 2, 8, 5, 6, 9];     // Black Ice i -> one gun
for (const s of CATALOGUE) {
  if (s.rarity === 'blackice') s.guns = [BLACK_ICE_GUN[s.id - 192]];
  else if (s.rarity === 'epic' && (s.id - 160) % 2 === 0) s.guns = [((s.id - 160) / 2 + 3) % 10];
  else if (s.rarity === 'rare' && (s.id - 100) % 5 === 0) s.guns = ((s.id - 100) / 5) % 2 ? FAMILIES_BY_SLOT.rifle : FAMILIES_BY_SLOT.smg;
}
// Can skin id go on the gun in slot? (Factory skins and most others fit any gun.)
export function skinFits(id, slot) { const s = skinById(id); return !!s && (!s.guns || s.guns.includes(slot)); }   // Legendary fits every gun

// Factory finishes (Ultra, nothing equipped): the original ten slot skins.
const L = (r, g, b) => [r, g, b];
export const FACTORY = [
  { name: 'Contour Crimson', pattern: 0, c: [L(0.03, 0.03, 0.035), L(0.62, 0.05, 0.06), L(0.62, 0.05, 0.06), L(0, 0, 0)], rm: [0.32, 0.85, 0.25, 0.85], clearcoat: 0.6, wear: 0.6 },
  { name: 'Arctic Digital', pattern: 1, c: [L(0.86, 0.88, 0.9), L(0.6, 0.63, 0.67), L(0.3, 0.36, 0.43), L(0, 0, 0)], rm: [0.62, 0.08, 0.62, 0.08], clearcoat: 0, wear: 0.8 },
  { name: 'Deep Woodland', pattern: 2, c: [L(0.5, 0.46, 0.33), L(0.22, 0.29, 0.17), L(0.32, 0.22, 0.14), L(0.06, 0.06, 0.05)], rm: [0.7, 0.05, 0.7, 0.05], clearcoat: 0, wear: 0.7 },
  { name: 'Night Tiger', pattern: 3, c: [L(0.26, 0.27, 0.24), L(0.035, 0.035, 0.04), L(0.13, 0.13, 0.14), L(0, 0, 0)], rm: [0.5, 0.3, 0.5, 0.3], clearcoat: 0.2, wear: 0.6 },
  { name: 'Desert Veteran', pattern: 4, c: [L(0.46, 0.37, 0.26), L(0.3, 0.3, 0.32), L(0, 0, 0), L(0, 0, 0)], rm: [0.62, 0.15, 0.28, 1], clearcoat: 0, wear: 1.4 },
  { name: 'Teal Hexcore', pattern: 5, c: [L(0.05, 0.055, 0.06), L(0.04, 0.16, 0.17), L(0.08, 0.3, 0.31), L(0.2, 0.55, 0.55)], rm: [0.38, 0.45, 0.25, 0.45], clearcoat: 0.5, wear: 0.5 },
  { name: 'Damascus', pattern: 6, c: [L(0.16, 0.165, 0.18), L(0.66, 0.67, 0.69), L(0, 0, 0), L(0, 0, 0)], rm: [0.4, 1, 0.2, 1], clearcoat: 0.8, wear: 0.2 },
  { name: 'Dry Ridge', pattern: 7, c: [L(0.64, 0.57, 0.44), L(0.43, 0.43, 0.3), L(0.47, 0.34, 0.22), L(0.28, 0.21, 0.14)], rm: [0.72, 0.05, 0.72, 0.05], clearcoat: 0, wear: 0.9 },
  { name: 'Carbon Weave', pattern: 8, c: [L(0.025, 0.025, 0.025), L(0.06, 0.062, 0.068), L(0, 0, 0), L(0, 0, 0)], rm: [0.32, 0, 0.32, 0], clearcoat: 1, wear: 0.3 },
  { name: 'Concrete Splinter', pattern: 9, c: [L(0.58, 0.59, 0.6), L(0.34, 0.35, 0.37), L(0.13, 0.135, 0.145), L(0.22, 0.29, 0.38)], rm: [0.58, 0.12, 0.58, 0.12], clearcoat: 0, wear: 0.8 },
].map((s, i) => ({ id: 1000 + i, rarity: 'factory', p: [1, 1, 0, 0], glow: [0, 0, 0], ...s }));

export function skinById(id) {
  if (id === LEGEND_ID) return LEGEND;
  if (id === LEGEND_GOLD_ID) return LEGEND_GOLD;
  if (id >= 1000) return FACTORY[(id - 1000) % FACTORY.length];
  return CATALOGUE[id] || null;
}
