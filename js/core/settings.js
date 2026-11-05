// User settings: defaults, validation and localStorage persistence.
// Storage can be missing or throw (private window, blocked site data), so every access is
// wrapped and the app always works with the defaults.

import { sensToCm360, cm360ToSens } from './sensitivity.js';

const KEY = 'recoilRange.settings.v1';

export const DEFAULTS = Object.freeze({
  dpi: 1600,             // your mouse (data/sens.json)
  sensH: 7,              // Siege-style horizontal sensitivity (1-50); yours is 7
  sensV: 7,              // vertical sensitivity (1-50)
  cm360: 14.25,          // derived from DPI and sensH (kept for display and the maths)
  aimAssist: 0,          // 0..1 slight pull and slowdown near a target (0 = off)
  fov: 83,               // VERTICAL degrees, like the game's FOV slider (60-90)
  // Per-magnification ADS multiplier overrides, keyed like "2.5x". Anything missing comes from
  // data/sens.json (or a placeholder of the 1.0x value / zoom), so editing that file changes the defaults.
  opticOverrides: {},
  reticleColor: 'red',   // ADS sight reticle: red, green, cyan, white, yellow
  crosshair: { style: 'cross', size: 10, gap: 4, thickness: 2, color: '#3dff9a', outline: true },
  volume: 0.35,
  holeSizeCm: 3,
  aimRecoil: 1,          // Aimed recoil strength (1 = as measured)
  aimSmooth: false,      // optional smoothing of measured sprays while aiming (off: the sprays were measured aimed)
  reloadSpeed: 2,        // x faster than each gun's measured reloadSeconds (1 = as measured)
  renderScale: 0,        // 0 = auto (screen's pixel ratio, up to 2x); else 0.5 to 2 (above 1 = supersampling)
  antialias: true,       // MSAA; takes effect after a reload
  lensQuality: 'auto',   // ADS lens pass: 'auto' or 3 (all) / 2 (no blur) / 1 (no blur, fringing) / 0 (no glare either)
  showViewmodel: true,
  targetMode: 'dummy',   // 'dummy' or 'dots' (M cycles dummy -> still dots -> moving dots)
  dotCount: 5,
  dotMoving: false,
  dotSpeed: 1.5,         // metres per second
  dotSizeCm: 20,         // dot diameter
  debugHud: false,
  fixedSeed: '',         // empty = new random seed every magazine
  gunIndex: 0,
  distance: 10,
});

export const RETICLE_COLOR_NAMES = ['red', 'green', 'cyan', 'white', 'yellow'];
export const DISTANCES = [5, 10, 15, 20];
export const CROSSHAIR_STYLES = ['cross', 'dot', 'cross-dot', 'circle', 't'];

const NUM = {
  dpi: [50, 32000],
  cm360: [1, 1000],
  sensH: [1, 50],
  sensV: [1, 50],
  aimAssist: [0, 1],
  fov: [60, 90],
  volume: [0, 1],
  holeSizeCm: [0.5, 10],
  reloadSpeed: [1, 5],
  aimRecoil: [0.25, 1.5],
  renderScale: [0, 2],
  dotSpeed: [0.25, 6],
  dotSizeCm: [5, 50],
};
const XH_NUM = { size: [2, 60], gap: [0, 40], thickness: [1, 8] };

function num(v, [lo, hi], fallback) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// Returns a fresh, fully populated and range-checked settings object.
export function sanitize(input) {
  const s = (input && typeof input === 'object') ? input : {};
  const out = {};
  for (const k of Object.keys(NUM)) out[k] = num(s[k], NUM[k], DEFAULTS[k]);

  const xi = (s.crosshair && typeof s.crosshair === 'object') ? s.crosshair : {};
  const xh = { ...DEFAULTS.crosshair };
  for (const k of Object.keys(XH_NUM)) xh[k] = num(xi[k], XH_NUM[k], DEFAULTS.crosshair[k]);
  if (CROSSHAIR_STYLES.includes(xi.style)) xh.style = xi.style;
  if (typeof xi.color === 'string' && /^#[0-9a-f]{6}$/i.test(xi.color)) xh.color = xi.color;
  if (typeof xi.outline === 'boolean') xh.outline = xi.outline;
  out.crosshair = xh;

  out.opticOverrides = {};
  if (s.opticOverrides && typeof s.opticOverrides === 'object') {
    for (const [zoom, m] of Object.entries(s.opticOverrides)) {
      const v = num(m, [0.01, 20], NaN);
      // Keys are magnifications like "2.5x"; old-style keys ("2.5") are dropped.
      if (Number.isFinite(v) && /^\d+(\.\d+)?x$/.test(zoom)) out.opticOverrides[zoom] = v;
    }
  }

  out.reticleColor = RETICLE_COLOR_NAMES.includes(s.reticleColor) ? s.reticleColor : DEFAULTS.reticleColor;
  out.targetMode = s.targetMode === 'dots' || s.targetMode === 'dummy' ? s.targetMode : (s.movingTarget === true ? 'dots' : DEFAULTS.targetMode);
  out.dotMoving = typeof s.dotMoving === 'boolean' ? s.dotMoving : (s.movingTarget === true ? true : DEFAULTS.dotMoving);
  out.dotCount = Number.isInteger(s.dotCount) ? Math.min(12, Math.max(1, s.dotCount)) : DEFAULTS.dotCount;
  out.lensQuality = ['auto', '3', '2', '1', '0'].includes(String(s.lensQuality)) ? String(s.lensQuality) : DEFAULTS.lensQuality;
  out.aimSmooth = typeof s.aimSmooth === 'boolean' ? s.aimSmooth : DEFAULTS.aimSmooth;
  out.antialias = typeof s.antialias === 'boolean' ? s.antialias : DEFAULTS.antialias;
  if (out.renderScale > 0 && out.renderScale < 0.5) out.renderScale = 0.5;
  out.showViewmodel = typeof s.showViewmodel === 'boolean' ? s.showViewmodel : DEFAULTS.showViewmodel;
  out.debugHud = typeof s.debugHud === 'boolean' ? s.debugHud : DEFAULTS.debugHud;
  out.fixedSeed = (typeof s.fixedSeed === 'string' && /^\d{0,10}$/.test(s.fixedSeed.trim())) ? s.fixedSeed.trim() : '';
  out.gunIndex = Number.isInteger(s.gunIndex) && s.gunIndex >= 0 ? s.gunIndex : DEFAULTS.gunIndex;
  out.distance = DISTANCES.includes(s.distance) ? s.distance : DEFAULTS.distance;
  // cm/360 always follows DPI and the horizontal slider.
  out.cm360 = sensToCm360(out.dpi, out.sensH);
  return out;
}

export function loadSettings() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
  // Saved settings still on the old defaults (800 DPI, 40 cm/360) move to the new ones.
  if (raw && raw.dpi === 800 && raw.cm360 === 40) { raw.dpi = DEFAULTS.dpi; raw.cm360 = DEFAULTS.cm360; }
  // Older saves had only cm/360: turn it into Siege-style sliders (same turn distance).
  if (raw && raw.sensH === undefined && typeof raw.cm360 === 'number' && typeof raw.dpi === 'number') {
    const sens = Math.round(cm360ToSens(raw.dpi, raw.cm360) * 100) / 100;
    raw.sensH = raw.sensV = Math.min(50, Math.max(1, sens));
  }
  return sanitize(raw);
}

export function saveSettings(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); return true; } catch (e) { return false; }
}

export function clearSavedSettings() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
