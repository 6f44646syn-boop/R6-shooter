// Pack skins keep their original IDs so existing save codes still recognize the finishes.
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
import { mulberry32 } from './prng.js?v=4485eaa-mwlojqse';

export const RARITIES = [
  { key: 'common', name: 'Common', color: '#b4bcc6', odds: 0.65, refund: 20 },
  { key: 'rare', name: 'Rare', color: '#4da3ff', odds: 0.22, refund: 40 },
  { key: 'epic', name: 'Epic', color: '#c26bff', odds: 0.07, refund: 80 },
  { key: 'blackice', name: 'Black Ice', color: '#7ff3ff', odds: 0.05, refund: 200 },
  { key: 'legendary', name: 'Legendary', color: '#ffc23a', odds: 0.01, refund: 400 },       // (shared by ten skins)
];
// The Legendary skin (your photo, any gun; see legend.js) and the gold finish other players
// see on a gun wearing it.
export const LEGEND_ID = 2000, LEGEND_GOLD_ID = 2001;
const L3 = (r, g, b) => [r, g, b];
export const LEGEND = { id: LEGEND_ID, name: 'Legend', rarity: 'legendary', photo: true, pattern: 11, c: [L3(0.5, 0.32, 0.05), L3(1, 0.7, 0.2), L3(1, 0.85, 0.4), L3(0, 0, 0)], p: [1, 1, 0, 0], rm: [0.3, 0.25, 0.3, 0.25], clearcoat: 1, wear: 0.12, glow: [0, 0, 0] };
export const LEGEND_GOLD = { ...LEGEND, id: LEGEND_GOLD_ID, name: 'Legend', photo: false, rm: [0.25, 1, 0.2, 1], wear: 0.2 };
const LEG_BASE = 201;            // the Legendaries follow the 201 generated skins
// which catalogue a save's skin ids belong to (saved in the code: a save from another one keeps its points, its skins are reset)
export const CATALOGUE_GEN = 1;
export const SAKURA_ID = LEG_BASE;
const SAKURA = {
  id: SAKURA_ID, name: 'Sakura Gilt', rarity: 'legendary', guns: [2], pattern: 18, art: 'data/skins/sakura-gilt.webp',
  artRect: [-0.52308, 0.28734, -0.35822, 0.24959], artLook: 'lacquer',      // painted from the R4-C concept (00-sakura-gilt-r4c.jpg)
  c: [[0.98, 0.69, 0.14], [0.46, 0.054, 0.13], [0.71, 0.17, 0.32], [0.011, 0.012, 0.016]],
  rm: [0.085, 0.88, 0.087, 0.62], clearcoat: 1, wear: 0, glow: [0, 0, 0],
};
// Storm Kiln (F2 only): glazed porcelain painted with cobalt clouds and waves, silver repair
// seams, a silver moon; the painting is the concept art (data/skins), laid out in F2 gun space.
export const KILN_ID = LEG_BASE + 1;
const KILN = {
  id: KILN_ID, name: 'Storm Kiln', rarity: 'legendary', guns: [1], pattern: 18, art: 'data/skins/storm-kiln.webp',
  artRect: [-0.55244, 0.24416, -0.27069, 0.26019],   // gun z from, to; y from, to: the concept's edges on the traced F2
  c: [[0.86, 0.82, 0.72], [0.05, 0.12, 0.5], [0.022, 0.03, 0.06], [0.78, 0.8, 0.84]],
  rm: [0.14, 0, 0.2, 1], clearcoat: 1, wear: 0, glow: [0, 0, 0], artLook: 'porcelain',
};
// Abyssal Crown (G8A1 only): oxidised bronze relic, nautilus whorls, glowing teal inlays, a glass depth dial.
export const ABYSS_ID = LEG_BASE + 2;
const ABYSS = {
  id: ABYSS_ID, name: 'Abyssal Crown', rarity: 'legendary', guns: [5], pattern: 18, art: 'data/skins/abyssal-crown.webp',
  artRect: [-0.65072, 0.40208, -0.38946, 0.31216], artLook: 'bronze',
  c: [[0.3, 0.2, 0.1], [0.06, 0.45, 0.4], [0.04, 0.05, 0.045], [0.55, 0.42, 0.25]],
  rm: [0.32, 0.9, 0.08, 0], clearcoat: 0.4, wear: 0, glow: [0, 0, 0],
};
// Vesper Glass (C8-SFW only): blackened pewter tracery and garnet, violet and amber glass, a rose window.
export const VESPER_ID = LEG_BASE + 3;
const VESPER = {
  id: VESPER_ID, name: 'Vesper Glass', rarity: 'legendary', guns: [7], pattern: 18, art: 'data/skins/vesper-glass.webp',
  artRect: [-0.55978, 0.31133, -0.35542, 0.22511], artLook: 'glass',
  c: [[0.06, 0.055, 0.06], [0.45, 0.04, 0.08], [0.03, 0.03, 0.035], [0.3, 0.08, 0.35]],
  rm: [0.45, 0.55, 0.05, 0], clearcoat: 0.6, wear: 0, glow: [0, 0, 0],
};
// The other six Legendaries: each gun traced from its concept, wearing the concept as its paint.
// Looks: 'gilt' polishes the metals in the painting (the lacquer shading), 'resin' lets the
// coloured stone, amber and opal glow (the glass shading), 'forge' is gilt with a live molten seam.
const LATE = [
  ['Forgeheart', 4, 'forgeheart', [-0.59933, 0.37984, -0.39229, 0.26025], 'forge', [[0.04, 0.035, 0.035], [0.9, 0.3, 0.05], [0.02, 0.02, 0.022], [0.55, 0.3, 0.16]]],
  ['Midnight Orrery', 0, 'midnight-orrery', [-0.31901, 0.34515, -0.25629, 0.18633], 'orrery', [[0.03, 0.05, 0.16], [0.75, 0.55, 0.22], [0.015, 0.02, 0.05], [0.85, 0.8, 0.6]]],
  ['Amber Reliquary', 6, 'amber-reliquary', [-0.32516, 0.28071, -0.26153, 0.14224], 'amber', [[0.8, 0.45, 0.08], [0.7, 0.72, 0.74], [0.05, 0.045, 0.04], [0.45, 0.25, 0.08]]],
  ['Jade Coil', 9, 'jade-coil', [-0.25133, 0.36905, -0.23606, 0.17739], 'jade', [[0.12, 0.5, 0.3], [0.6, 0.45, 0.2], [0.02, 0.05, 0.035], [0.4, 0.7, 0.5]]],
  ['Velvet Ante', 3, 'velvet-ante', [-0.21361, 0.41797, -0.2903, 0.1306], 'velvet', [[0.35, 0.03, 0.05], [0.85, 0.65, 0.25], [0.04, 0.01, 0.015], [0.9, 0.86, 0.76]]],
  ['Opal Overture', 8, 'opal-overture', [-0.30471, 0.35412, -0.27329, 0.16576], 'opal', [[0.85, 0.75, 0.7], [0.3, 0.75, 0.75], [0.02, 0.02, 0.025], [0.55, 0.35, 0.75]]],
].map(([name, gun, file, artRect, artLook, c], i) => ({
  id: LEG_BASE + 4 + i, name, rarity: 'legendary', guns: [gun], pattern: 18, art: 'data/skins/' + file + '.webp', artRect, artLook, c,
  ...(file === 'forgeheart' ? { artPeak: 'data/skins/forgeheart-peak.webp' } : {}),      // the inspect's peak (04-forgeheart-peak.webp)
  ...(file === 'jade-coil' ? { artPeak: 'data/skins/jade-coil-bare.webp' } : {}),        // the gun with its dragon gone (it comes alive)
  rm: [0.2, 0.6, 0.1, 0.3], clearcoat: 0.8, wear: 0, glow: [0, 0, 0],
}));
export const RARITY = Object.fromEntries(RARITIES.map((r) => [r.key, r]));
export const PATTERN_NAMES = ['Contour', 'Pixel', 'Woodland', 'Tiger', 'Veteran', 'Hexcore', 'Damascus', 'Blot', 'Weave', 'Shard', 'Black Ice', 'Fade', 'Line', 'Marble', 'Circuit', 'Blossom', 'Tide', 'Gilt Blossom', 'Storm Kiln'];

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
// Each Epic has a named colour direction. Its second pattern uses an alternate accent.
const EPIC_HUES = [[0.77, 0.53], [0.99, 0.07], [0.48, 0.36], [0.71, 0.84], [0.03, 0.13], [0.63, 0.5], [0.84, 0.13], [0.62, 0.1],
  [0.57, 0.7], [0.77, 0.11], [0.31, 0.18], [0.07, 0.5], [0.86, 0.5], [0.58, 0.14], [0.65, 0.78], [0.75, 0.48]];

// Black Ice: one per gun. They keep the IDs of the first Black Ices (save codes and owned skins carry over);
// BLACK_ICE_GUN[i] is the gun (loadout slot) of BLACK_ICE_IDS[i].
export const BLACK_ICE_IDS = [192, 193, 194, 195, 196, 197, 198, 199, 200, 211];
const BLACK_ICE_GUN = [4, 1, 0, 7, 2, 8, 5, 6, 9, 3];

// Weapon slot order. Palettes are HSL hue angles for the body, rime and highlights.
// The structure vector is [horizontal stretch, vertical stretch, shear, facet strength].
// Integer stretch and shear keep the baked fracture texture seamless.
const NEW_ICE = [
  // Name, hues, depth, scale, rime, shard shape, structure, base roughness.
  ['Crevasse',       [209, 185, 174], 0.24, 1, 0.57, 1.24, [1, 2, 1, 0.83], 0.12],  // EVO
  ['Moon Rime',      [226, 216, 202], 0.16, 2, 0.93, 0.82, [2, 1, 0, 0.38], 0.24],  // F2
  ['Polar Crown',    [162, 171,  56], 0.20, 1, 0.66, 1.31, [1, 1, -1, 0.9], 0.13],  // R4-C
  ['Ghost Hail',     [261, 247, 217], 0.19, 2, 0.84, 0.70, [1, 1, 0, 0.55], 0.19],  // SMG-11
  ['Aurora Fault',   [263, 163, 228], 0.27, 1, 0.73, 1.14, [1, 2, -1, 1.0], 0.10],  // AK-12
  ['Blue Pressure',  [230, 226, 257], 0.24, 1, 0.43, 1.40, [1, 1, 0, 0.98], 0.08],  // G8A1
  ['Brine Glass',    [178, 157, 187], 0.20, 1, 0.50, 0.92, [1, 3, 0, 0.77], 0.10],  // MP5K
  ['Glacier Bloom',  [306, 337, 271], 0.22, 1, 0.81, 1.12, [2, 1, 1, 0.62], 0.17],  // C8-SFW
  ['Jet Frost',      [222, 194, 212], 0.12, 2, 0.69, 0.80, [1, 1, 1, 0.92], 0.13],  // MP7
  ['Sun Dog',        [ 25,  43,  55], 0.21, 1, 0.57, 1.17, [1, 1, 1, 0.69], 0.15],  // T-5
];

function make(id) {
  const rng = mulberry32((id + 1) * 7919 + 13);
  if (id < 100) {                                       // Common: muted 2-4 colour camo, matt
    const fam = FAMILIES[id % FAMILIES.length];
    const pat = COMMON_PATTERNS[Math.floor(id / FAMILIES.length) % COMMON_PATTERNS.length];
    const s = () => fam[2][0] + rng() * (fam[2][1] - fam[2][0]);
    const l = (k) => fam[3][0] + (fam[3][1] - fam[3][0]) * k;
    const hj = () => fam[1] + (rng() - 0.5) * 0.08;
    const c = [hsl(hj(), s() * 0.7, l(0.65)), hsl(hj(), s(), l(0.98)), hsl(hj(), s() * 0.8, l(0.10)), hsl(hj(), s() * 0.45, l(0.36))];
    const metal = pat === 4 ? 1 : 0.1;
    return { id, rarity: 'common', name: fam[0] + ' ' + PATTERN_NAMES[pat], pattern: pat, c,
      p: [1 + Math.floor(rng() * 2), 0.65 + rng() * 0.55, (rng() - 0.5) * 0.16, 0], rm: [0.67 + rng() * 0.13, 0.05, 0.57, metal], clearcoat: 0.12, wear: 0.83, glow: [0, 0, 0] };
  }
  if (id < 160) {                                       // Rare: neutral base + one vivid accent, satin
    const k = id - 100;
    const [word, hue] = RARE_WORDS[k % RARE_WORDS.length];
    const pat = RARE_PATTERNS[Math.floor(k / RARE_WORDS.length) % RARE_PATTERNS.length];
    const h = hue + (rng() - 0.5) * 0.03;
    const c = [hsl(h + 0.46, 0.13, 0.14 + rng() * 0.07), hsl(h, 0.73 + rng() * 0.2, 0.45), hsl(h + 0.04, 0.65, 0.68), hsl(h - 0.035, 0.35, 0.43 + rng() * 0.15)];
    return { id, rarity: 'rare', name: word + ' ' + PATTERN_NAMES[pat], pattern: pat, c,
      p: [1 + Math.floor(rng() * 2), 0.7 + rng() * 0.65, (rng() - 0.5) * 0.14, 0], rm: [0.38 + rng() * 0.12, 0.46, 0.26, 0.73], clearcoat: 0.48, wear: 0.43, glow: [0, 0, 0] };
  }
  if (id < 192) {                                       // Epic: formed inlays over a finish tailored to the pattern
    const k = id - 160;
    const word = EPIC_WORDS[k % EPIC_WORDS.length];
    const pat = EPIC_PATTERNS[(k + Math.floor(k / EPIC_WORDS.length) * 3) % EPIC_PATTERNS.length];
    const [h, accent] = EPIC_HUES[k % EPIC_HUES.length];
    const a = accent + (k < EPIC_WORDS.length ? -0.025 : 0.035);
    let c = [hsl(h, 0.67, 0.19), hsl(a, 0.85, 0.54), hsl(h + 0.065, 0.82, 0.45), hsl(a, 0.57, 0.77)];
    // Illustrated designs get painterly palettes: dark branches, bright flowers, lacquered cream;
    // deep sea, bright water and white foam.
    if (pat === 15) c = [hsl(h, 0.42, 0.12), hsl(a, 0.82, 0.55), hsl(a + 0.1, 0.79, 0.71), hsl(h, 0.21, 0.66)];
    if (pat === 16) c = [hsl(h, 0.75, 0.15), hsl(h + 0.03, 0.8, 0.39), hsl(a, 0.69, 0.59), hsl(a, 0.22, 0.90)];
    const glows = pat === 14 || pat === 0 || pat === 5;
    const rm = {
      0: [0.33, 0.65, 0.20, 0.72], 5: [0.41, 0.30, 0.23, 0.45], 6: [0.29, 0.94, 0.19, 0.95],
      9: [0.37, 0.65, 0.16, 0.77], 13: [0.47, 0.19, 0.24, 0.63], 14: [0.48, 0.60, 0.20, 0.84],
      15: [0.32, 0.23, 0.22, 0.47], 16: [0.30, 0.30, 0.16, 0.36],
    }[pat];
    return { id, rarity: 'epic', name: word + ' ' + PATTERN_NAMES[pat], pattern: pat, c,
      p: [1 + Math.floor(rng() * 2), 0.65 + rng() * 0.55, (rng() - 0.5) * 0.12, 0], rm, clearcoat: 0.9, wear: 0.19,
      glow: glows ? c[1].map((v) => v * 0.42) : [0, 0, 0] };
  }
  if (BLACK_ICE_IDS.includes(id)) {
    const slot = BLACK_ICE_GUN[BLACK_ICE_IDS.indexOf(id)];
    const [name, hues, depth, scale, rime, crystalShape, iceStructure, roughness] = NEW_ICE[slot];
    const [body, frost, highlight] = hues.map((hue) => hue / 360);
    return { id, rarity: 'blackice', name: 'Black Ice ' + name, guns: [slot], pattern: 10,
      ice: hsl(frost, 0.58, 0.81), crystalShape, iceStructure, scale: 1.85,
      c: [hsl(body, 0.44, depth * 0.36), hsl(frost, 0.64, 0.73), hsl(highlight, 0.48, 0.94), hsl(body, 0.69, depth)],
      p: [scale, rime, crystalShape, 21 + slot], rm: [roughness, 0.13, 0.24 + rime * 0.2, 0.04],
      clearcoat: 1, wear: 0.025, glow: hsl(frost, 0.55, 0.67).map((v) => v * 0.40) };
  }
  if (id === SAKURA_ID) return SAKURA;
  if (id === KILN_ID) return KILN;
  if (id === ABYSS_ID) return ABYSS;
  if (id === VESPER_ID) return VESPER;
  if (id >= LEG_BASE + 4 && id < LEG_BASE + 10) return LATE[id - LEG_BASE - 4];
  throw new Error('no skin ' + id);
}

// Each picture is fitted part by part: the box a part fills in the picture (pixels: x from, to; y from, to,
// measured on the picture) onto that part's box on the traced gun (gun space: z from, to; y from, to). The
// body is the gun without its barrel (sights, rail and barrel are not painted). Parts not listed stay plain.
export const DEFAULT_ART = [
  // slot, picture, its size, { part: [picture box, gun box] }
  [0, 'evo', [1774, 887], { body: [[215, 1718, 240, 655], [-0.248, 0.332, -0.095, 0.086]], grip: [[1000, 1210, 445, 750], [0.042, 0.141, -0.163, -0.035]], magazine: [[630, 835, 500, 785], [-0.126, -0.035, -0.186, -0.035]] }],
  [1, 'f2', [1774, 887], { body: [[410, 1722, 205, 615], [-0.425, 0.221, -0.101, 0.115]], grip: [[945, 1125, 495, 745], [-0.181, -0.081, -0.153, -0.022]], magazine: [[1195, 1375, 500, 830], [-0.031, 0.034, -0.17, -0.058]] }],
  [2, 'r4c', [1774, 887], { body: [[235, 1727, 228, 592], [-0.424, 0.28, -0.116, 0.068]], grip: [[1100, 1310, 440, 705], [-0.003, 0.096, -0.19, -0.055]], magazine: [[710, 945, 455, 810], [-0.193, -0.075, -0.247, -0.05]] }],
  [3, 'smg11', [1774, 887], { body: [[595, 1260, 130, 335], [-0.128, 0.182, -0.063, 0.085]], grip: [[878, 1078, 330, 620], [0.001, 0.088, -0.139, -0.031]], magazine: [[900, 1045, 620, 845], [0.007, 0.085, -0.241, -0.14]], stock: [[1258, 1620, 195, 625], [0.183, 0.403, -0.12, 0.028]] }],
  [4, 'ak12', [2172, 724], { body: [[682, 2137, 139, 543], [-0.41, 0.364, -0.148, 0.076]], grip: [[1466, 1645, 320, 586], [0.033, 0.135, -0.19, -0.06]], magazine: [[1030, 1298, 310, 684], [-0.187, -0.034, -0.222, -0.042]] }],
  [5, 'g8a1', [2172, 724], { body: [[326, 2118, 195, 538], [-0.5, 0.392, -0.132, 0.056]], grip: [[1412, 1553, 402, 673], [0.034, 0.148, -0.165, -0.044]], magazine: [[1005, 1233, 386, 662], [-0.166, -0.054, -0.165, -0.032]] }],
  [6, 'mp5k', [1672, 941], { body: [[250, 1410, 215, 520], [-0.245, 0.257, -0.087, 0.066]], grip: [[1100, 1395, 500, 835], [0.038, 0.137, -0.177, -0.036]], magazine: [[595, 815, 480, 865], [-0.154, -0.049, -0.208, -0.036]], foregrip: [[400, 515, 395, 620], [-0.211, -0.166, -0.122, -0.032]] }],
  [7, 'c8', [1200, 434], { body: [[237, 1145, 65, 275], [-0.413, 0.3, -0.193, 0.058]], grip: [[760, 885, 195, 360], [-0.002, 0.101, -0.205, -0.065]], magazine: [[495, 645, 205, 395], [-0.209, -0.106, -0.233, -0.081]] }],
  [8, 'mp7', [1200, 407], { body: [[338, 975, 85, 258], [-0.226, 0.34, -0.097, 0.092]], foregrip: [[372, 408, 178, 293], [-0.197, -0.153, -0.134, -0.028]], grip: [[582, 665, 180, 300], [-0.022, 0.076, -0.15, -0.023]], magazine: [[565, 645, 300, 390], [-0.022, 0.052, -0.23, -0.15]] }],
  [9, 't5', [2172, 724], { body: [[469, 1955, 141, 478], [-0.176, 0.359, -0.076, 0.091]], grip: [[1043, 1243, 391, 652], [0.028, 0.113, -0.125, -0.014]], magazine: [[1320, 1466, 407, 695], [0.051, 0.132, -0.186, -0.126]] }],
];
// a picture box onto a gun box -> the art rectangle (the picture's edges in gun space) for that part
const fitRect = ([W, H], [x0, x1, py0, py1], [z0, z1, y0, y1]) => {
  const sz = (z1 - z0) / (x1 - x0), sy = (y1 - y0) / (py1 - py0), Z0 = z0 - x0 * sz, Y1 = y1 + py0 * sy;
  return [Z0, Z0 + W * sz, Y1 - H * sy, Y1];
};
export const SKIN_COUNT = 212;      // 100 Common, 60 Rare, 32 Epic, 9 Black Ice, 10 Legendary, then the 10th Black Ice (id 211)
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
for (const s of CATALOGUE) {
  if (s.rarity === 'epic' && (s.id - 160) % 2 === 0) s.guns = [((s.id - 160) / 2 + 3) % 10];
  else if (s.rarity === 'rare' && (s.id - 100) % 5 === 0) s.guns = ((s.id - 100) / 5) % 2 ? FAMILIES_BY_SLOT.rifle : FAMILIES_BY_SLOT.smg;
}
// Can skin id go on the gun in slot? (Factory skins and most others fit any gun.)
export function skinFits(id, slot) { const s = skinById(id); return !!s && (!s.guns || s.guns.includes(slot)); }   // Legendary fits every gun

// Default skins: what a gun wears when nothing is equipped, painted from a side-on picture of the gun (by
// slot). The picture is laid on the traced gun like a Legendary's (artRect: gun z from, to; y from, to: the
// picture's edges), with the real light on it ('default' look: gpu-tex.js). Slots without one show the
// gun's own gunmetal, walnut and steel.
export const DEFAULT_SKINS = Object.fromEntries(DEFAULT_ART.map(([slot, file, size, boxes]) => {
  const parts = Object.fromEntries(Object.entries(boxes).map(([name, [px, gun]]) => [name, fitRect(size, px, gun)]));
  return [slot, {
    id: 1100 + slot, name: 'Default', rarity: 'common', guns: [slot], pattern: 18, art: 'data/skins/defaults/' + file + '.webp',
    artRect: parts.body, parts, artLook: 'default', wear: 0, p: [1, 1, 0, 0], glow: [0, 0, 0],
    c: [[0.03, 0.03, 0.032], [0.06, 0.06, 0.065], [0.02, 0.02, 0.022], [0.1, 0.1, 0.11]],
  }];
}));
const DEFAULT_BY_ID = Object.fromEntries(Object.values(DEFAULT_SKINS).map((s) => [s.id, s]));

// The Weapon Skins pack (tools/build-skin-pack.mjs, skinpack/<slot>/<id>.webp): each skin painted on each gun,
// on the same renders as the default pictures, scaled to 1200 px wide with a name bar under them (PACK_SIZE).
// A gun with a default picture keeps its part fit, scaled; the others (C8-SFW, MP7) are fitted whole: the
// picture box of the whole gun onto its gun box (every part's outline lines up with the picture as one).
export const PACK_SIZE = { 0: [1200, 655], 1: [1200, 655], 2: [1200, 655], 3: [1200, 655], 4: [1200, 455], 5: [1200, 455], 6: [1200, 730], 7: [1200, 594], 8: [1200, 567], 9: [1200, 455] };
const PACK_WHOLE = { 7: [[70, 1148, 108, 495], [-0.547, 0.3, -0.233, 0.091]], 8: [[258, 978, 118, 497], [-0.293, 0.34, -0.23, 0.123]] };
const packSkins = new Map();
// The skin def painted with its pack picture for the gun in slot (art: the picture's 'pack:' address).
export function packSkin(def, slot) {
  const key = def.id + '@' + slot;
  if (!packSkins.has(key)) {
    const size = PACK_SIZE[slot], fit = !PACK_WHOLE[slot] && DEFAULT_ART.find(([s]) => s === slot);   // (the C8-SFW and MP7 pack renders are not their default pictures)
    let parts = null, artRect;
    if (fit) {
      const k = size[0] / fit[2][0];
      parts = Object.fromEntries(Object.entries(fit[3]).map(([name, [px, gun]]) => [name, fitRect(size, px.map((v) => v * k), gun)]));
      artRect = parts.body;
    } else artRect = fitRect(size, ...PACK_WHOLE[slot]);
    packSkins.set(key, { ...def, id: key, art: 'pack:' + slot + '/' + def.id + '.webp', artRect, parts, artLook: 'default', pattern: 18, wear: 0,
      artGlow: { common: 0.45, rare: 0.45, epic: 1.7 }[def.rarity] || 0 });   // subtle on Commons and Rares, strong on Epics and Black Ices
  }
  return packSkins.get(key);
}

// Factory finishes (no longer worn by default): the original ten slot skins.
const L = (r, g, b) => [r, g, b];
export const FACTORY = [
  { name: 'Contour Crimson', pattern: 0, c: [L(0.035, 0.031, 0.037), L(0.37, 0.026, 0.041), L(0.63, 0.11, 0.086), L(0, 0, 0)], rm: [0.43, 0.58, 0.32, 0.66], clearcoat: 0.47, wear: 0.6 },
  { name: 'Arctic Digital', pattern: 1, c: [L(0.69, 0.74, 0.78), L(0.42, 0.48, 0.53), L(0.17, 0.23, 0.29), L(0.58, 0.62, 0.65)], rm: [0.69, 0.05, 0.62, 0.08], clearcoat: 0.12, wear: 0.74 },
  { name: 'Deep Woodland', pattern: 2, c: [L(0.34, 0.32, 0.21), L(0.14, 0.23, 0.12), L(0.25, 0.15, 0.087), L(0.05, 0.077, 0.044)], rm: [0.75, 0.05, 0.66, 0.07], clearcoat: 0, wear: 0.7 },
  { name: 'Night Tiger', pattern: 3, c: [L(0.18, 0.20, 0.19), L(0.039, 0.044, 0.052), L(0.28, 0.24, 0.16), L(0, 0, 0)], rm: [0.56, 0.24, 0.46, 0.42], clearcoat: 0.23, wear: 0.5 },
  { name: 'Desert Veteran', pattern: 4, c: [L(0.48, 0.35, 0.21), L(0.38, 0.36, 0.32), L(0, 0, 0), L(0, 0, 0)], rm: [0.71, 0.10, 0.38, 0.9], clearcoat: 0.08, wear: 1.25 },
  { name: 'Teal Hexcore', pattern: 5, c: [L(0.041, 0.061, 0.064), L(0.049, 0.19, 0.18), L(0.091, 0.32, 0.32), L(0.39, 0.65, 0.57)], rm: [0.46, 0.45, 0.26, 0.68], clearcoat: 0.53, wear: 0.42 },
  { name: 'Damascus', pattern: 6, c: [L(0.12, 0.14, 0.17), L(0.53, 0.51, 0.46), L(0, 0, 0), L(0, 0, 0)], rm: [0.36, 0.91, 0.25, 1], clearcoat: 0.67, wear: 0.27 },
  { name: 'Dry Ridge', pattern: 7, c: [L(0.58, 0.50, 0.36), L(0.32, 0.35, 0.25), L(0.49, 0.32, 0.18), L(0.21, 0.16, 0.1)], rm: [0.77, 0.03, 0.69, 0.07], clearcoat: 0, wear: 0.85 },
  { name: 'Carbon Weave', pattern: 8, c: [L(0.024, 0.027, 0.032), L(0.10, 0.105, 0.116), L(0, 0, 0), L(0, 0, 0)], rm: [0.38, 0.06, 0.28, 0.18], clearcoat: 0.85, wear: 0.2 },
  { name: 'Concrete Splinter', pattern: 9, c: [L(0.49, 0.52, 0.51), L(0.31, 0.34, 0.36), L(0.095, 0.11, 0.12), L(0.22, 0.30, 0.37)], rm: [0.66, 0.09, 0.53, 0.18], clearcoat: 0.08, wear: 0.68 },
].map((s, i) => ({ id: 1000 + i, rarity: 'factory', p: [1, 1, 0, 0], glow: [0, 0, 0], ...s }));

export function skinById(id) {
  if (id === LEGEND_ID) return LEGEND;
  if (id === LEGEND_GOLD_ID) return LEGEND_GOLD;
  if (DEFAULT_BY_ID[id]) return DEFAULT_BY_ID[id];
  if (id >= 1000) return FACTORY[(id - 1000) % FACTORY.length];
  return CATALOGUE[id] || null;
}
