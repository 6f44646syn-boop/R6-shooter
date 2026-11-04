// User settings: defaults, validation and localStorage persistence.
// Storage can be missing or throw (private window, blocked site data), so every access is
// wrapped and the app always works with the defaults.

const KEY = 'recoilRange.settings.v1';

export const DEFAULTS = Object.freeze({
  dpi: 800,
  cm360: 40,
  hipFov: 90,            // horizontal degrees
  // Per-optic ADS multiplier overrides, keyed by zoom ("2.5"). Anything missing comes from
  // data/optics.json, so editing that file changes the defaults for everyone.
  opticOverrides: {},
  crosshair: { style: 'cross', size: 10, gap: 4, thickness: 2, color: '#3dff9a', outline: true },
  volume: 0.35,
  holeSizeCm: 3,
  renderScale: 1,
  showViewmodel: true,
  debugHud: false,
  fixedSeed: '',         // empty = new random seed every magazine
  gunIndex: 0,
  distance: 10,
});

export const DISTANCES = [5, 10, 15, 20];
export const CROSSHAIR_STYLES = ['cross', 'dot', 'cross-dot', 'circle', 't'];

const NUM = {
  dpi: [50, 32000],
  cm360: [1, 1000],
  hipFov: [60, 110],
  volume: [0, 1],
  holeSizeCm: [0.5, 10],
  renderScale: [0.5, 1],
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
      if (Number.isFinite(v)) out.opticOverrides[zoom] = v;
    }
  }

  out.showViewmodel = typeof s.showViewmodel === 'boolean' ? s.showViewmodel : DEFAULTS.showViewmodel;
  out.debugHud = typeof s.debugHud === 'boolean' ? s.debugHud : DEFAULTS.debugHud;
  out.fixedSeed = (typeof s.fixedSeed === 'string' && /^\d{0,10}$/.test(s.fixedSeed.trim())) ? s.fixedSeed.trim() : '';
  out.gunIndex = Number.isInteger(s.gunIndex) && s.gunIndex >= 0 ? s.gunIndex : DEFAULTS.gunIndex;
  out.distance = DISTANCES.includes(s.distance) ? s.distance : DEFAULTS.distance;
  return out;
}

export function loadSettings() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
  return sanitize(raw);
}

export function saveSettings(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); return true; } catch (e) { return false; }
}

export function clearSavedSettings() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
