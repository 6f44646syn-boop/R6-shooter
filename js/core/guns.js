// Loads and validates data/guns.json, data/optics.json and data/sens.json.
// Bad guns are skipped with a clear message naming the gun and the field; the rest still load.
import { validateCatalogue, resolveGunOptics } from './optics.js?v=7d32aaa-mwd4tpe8';
import { smoothPath } from './recoil.js?v=7d32aaa-mwd4tpe8';

const MODELS = ['rifle', 'carbine', 'smg', 'lmg', 'marksman'];
// Default model when the field is missing: guess from the id ("smg-01" -> smg).
const guessModel = (id) => MODELS.find((m) => id.toLowerCase().startsWith(m)) || 'rifle';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const SIDES = ['attacker', 'defender'];

// Returns { guns, errors, warnings }. `catalogue` is validateCatalogue(optics.json).
export function validateGuns(data, catalogue) {
  const errors = [];
  const warnings = [];
  const guns = [];
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.guns) ? data.guns : null);
  if (!list) {
    errors.push('guns.json: expected an object with a "guns" array.');
    return { guns, errors, warnings };
  }
  const ids = new Set();

  list.forEach((g, idx) => {
    const where = 'guns[' + idx + ']' + (g && typeof g.id === 'string' ? ' (' + g.id + ')' : '');
    const errs = [];
    const bad = (field, msg) => errs.push(where + '.' + field + ': ' + msg);
    if (!g || typeof g !== 'object') { errors.push(where + ': not an object'); return; }

    if (typeof g.id !== 'string' || !g.id.trim()) bad('id', 'must be a non-empty string');
    else if (ids.has(g.id)) bad('id', 'duplicate id "' + g.id + '"');
    if (typeof g.name !== 'string' || !g.name.trim()) bad('name', 'must be a non-empty string');

    const positive = (f, max) => {
      if (!isNum(g[f]) || g[f] <= 0) bad(f, 'must be a number > 0 (got ' + JSON.stringify(g[f]) + ')');
      else if (max && g[f] > max) bad(f, 'must be <= ' + max + ' (got ' + g[f] + ')');
    };
    positive('rpm', 3000);
    if (!Number.isInteger(g.magSize) || g.magSize < 1 || g.magSize > 1000) bad('magSize', 'must be an integer from 1 to 1000 (got ' + JSON.stringify(g.magSize) + ')');
    if (!isNum(g.reloadSeconds) || g.reloadSeconds < 0) bad('reloadSeconds', 'must be a number >= 0');
    positive('hipMultiplier', 20);
    positive('adsMultiplier', 20);
    positive('resetSeconds', 10);
    if (g.adsSeconds !== undefined && (!isNum(g.adsSeconds) || g.adsSeconds <= 0 || g.adsSeconds > 3)) bad('adsSeconds', 'must be a number from 0 to 3 if given');
    if (g.damage !== undefined && (!isNum(g.damage) || g.damage < 0)) bad('damage', 'must be a number >= 0 if given');
    if (g.tail !== undefined && g.tail !== 'hold' && g.tail !== 'extrapolate') bad('tail', 'must be "hold" or "extrapolate" if given');
    if (g.chambered !== undefined && typeof g.chambered !== 'boolean') bad('chambered', 'must be true or false if given');
    if (g.measuredAtVFov !== undefined && (!isNum(g.measuredAtVFov) || g.measuredAtVFov <= 0 || g.measuredAtVFov >= 180)) bad('measuredAtVFov', 'must be a vertical FOV in degrees if given');
    if (g.side !== undefined && !SIDES.includes(g.side)) bad('side', 'must be "attacker" or "defender" if given');
    const res = resolveGunOptics(g, catalogue);
    for (const e of res.errors) errs.push(where + '.' + e);
    if (typeof g.placeholder !== 'boolean') bad('placeholder', 'must be true or false');
    if (g.fireMode !== undefined && g.fireMode !== 'auto' && g.fireMode !== 'semi') bad('fireMode', 'must be "auto" or "semi" if given');
    if (g.model !== undefined && !MODELS.includes(g.model)) bad('model', 'must be one of ' + MODELS.join(', ') + ' if given');
    if (g.tone !== undefined && (!isNum(g.tone) || g.tone < 0 || g.tone > 1)) bad('tone', 'must be a number from 0 to 1 if given');

    if (!Array.isArray(g.sprayPath) || g.sprayPath.length < 1) {
      bad('sprayPath', 'must be an array of [yawDeg, pitchDeg] pairs with at least one entry');
    } else {
      g.sprayPath.forEach((p, i) => {
        if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) {
          bad('sprayPath[' + i + ']', 'must be [yawDeg, pitchDeg] with two numbers (got ' + JSON.stringify(p) + ')');
        }
      });
    }

    const obj = (f, keys) => {
      const o = g[f];
      if (!o || typeof o !== 'object') { bad(f, 'must be an object with ' + keys.join(', ')); return; }
      for (const k of keys) if (!isNum(o[k]) || o[k] < 0) bad(f + '.' + k, 'must be a number >= 0 (got ' + JSON.stringify(o[k]) + ')');
    };
    obj('jitter', ['yawDeg', 'pitchDeg']);
    obj('recovery', ['delaySeconds', 'degPerSecond']);

    if (errs.length) { errors.push(...errs); return; }
    if (g.optic !== undefined) warnings.push(where + '.optic: old field, ignored. Sights now come from "optics" / "defaultOptic" (see docs/SCOPES.md).');

    // Soft checks: the gun still loads.
    const p0 = g.sprayPath[0];
    if (p0[0] !== 0 || p0[1] !== 0) warnings.push(where + '.sprayPath[0] is ' + JSON.stringify(p0) + ', expected [0, 0]. Offsets are taken relative to it.');
    if (g.resetSeconds < 60 / g.rpm) warnings.push(where + '.resetSeconds (' + g.resetSeconds + ') is shorter than the shot interval (' + (60 / g.rpm).toFixed(3) + ' s), so every shot restarts the spray.');
    if (g.sprayPath.length < 2) warnings.push(where + '.sprayPath has one entry, so there is no recoil.');

    ids.add(g.id);
    guns.push({
      id: g.id, name: g.name, rpm: g.rpm, magSize: g.magSize, reloadSeconds: g.reloadSeconds,
      optics: res.ids, defaultOptic: g.defaultOptic, opticRecoilScale: { ...(g.opticRecoilScale || {}) },
      opticsVerified: g.opticsVerified === true, side: g.side || null, adsSeconds: g.adsSeconds || 0.3,
      hipMultiplier: g.hipMultiplier, adsMultiplier: g.adsMultiplier,
      resetSeconds: g.resetSeconds, placeholder: g.placeholder,
      damage: isNum(g.damage) ? g.damage : null, tail: g.tail || 'extrapolate', chambered: g.chambered === true,
      measuredAtVFov: g.measuredAtVFov || null,
      measuredAttachments: g.measurement && Array.isArray(g.measurement.attachments) ? g.measurement.attachments.filter((a) => typeof a === 'string') : [],
      measuredAiming: g.measuredAiming === true, measuredSight: typeof g.measuredSight === 'string' ? g.measuredSight : null,
      placeholderFields: Array.isArray(g.placeholderFields) ? g.placeholderFields.filter((f) => typeof f === 'string') : [],
      fireMode: g.fireMode || 'auto', model: g.model || guessModel(g.id), tone: g.tone === undefined ? 0.5 : g.tone,
      sprayPath: g.sprayPath.map((p) => [p[0], p[1]]),
      sprayPathSmooth: smoothPath(g.sprayPath),
      jitter: { yawDeg: g.jitter.yawDeg, pitchDeg: g.jitter.pitchDeg },
      recovery: { delaySeconds: g.recovery.delaySeconds, degPerSecond: g.recovery.degPerSecond },
    });
  });
  return { guns, errors, warnings };
}

// data/sens.json: the player's in-game sensitivity screen, plus optional calibrated multipliers.
//   "magnifications": [{ "key": "2.5x", "slider": 90 }, ...]   rows for the Settings table
//   "ads": { "2.5x": 0.4 }                                       optional ADS multipliers
// The in-game slider values are stored for reference only: how the game turns a slider into
// degrees per count is not known here, so they do not change sensitivity. A magnification with
// no "ads" value uses the 1.0x multiplier divided by its zoom (marked placeholder in Settings).
// Returns { ads, magnifications, game, errors }.
export function validateSens(data) {
  const ads = {};
  const magnifications = [];
  const errors = [];
  const keyOk = (k) => typeof k === 'string' && /^\d+(\.\d+)?x$/.test(k);
  if (!data || typeof data !== 'object') return { ads, magnifications, game: {}, errors: ['sens.json: expected an object'] };
  if (data.ads !== undefined) {
    if (!data.ads || typeof data.ads !== 'object') errors.push('sens.json ads: must be an object like { "1.0x": 1.0 }');
    else for (const [k, v] of Object.entries(data.ads)) {
      if (!keyOk(k)) errors.push('sens.json ads.' + k + ': key must look like "2.5x"');
      else if (!isNum(v) || v <= 0) errors.push('sens.json ads.' + k + ': must be a number > 0');
      else ads[k] = v;
    }
  }
  if (data.magnifications !== undefined) {
    if (!Array.isArray(data.magnifications)) errors.push('sens.json magnifications: must be a list of { "key": "2.5x", "slider": 90 }');
    else data.magnifications.forEach((m, i) => {
      if (!m || !keyOk(m.key)) errors.push('sens.json magnifications[' + i + '].key: must look like "2.5x"');
      else if (m.slider !== undefined && !isNum(m.slider)) errors.push('sens.json magnifications[' + i + '].slider: must be a number');
      else magnifications.push({ key: m.key, slider: m.slider });
    });
  }
  // Turn distances measured in game: ADS multiplier = hip cm/360 / ADS cm/360.
  if (data.adsCm360 !== undefined) {
    if (!isNum(data.hipCm360) || data.hipCm360 <= 0) errors.push('sens.json hipCm360: must be a number > 0 when adsCm360 is given');
    else if (!data.adsCm360 || typeof data.adsCm360 !== 'object') errors.push('sens.json adsCm360: must be an object like { "1.0x": 11.8 }');
    else for (const [k, v] of Object.entries(data.adsCm360)) {
      if (!keyOk(k)) errors.push('sens.json adsCm360.' + k + ': key must look like "2.5x"');
      else if (!isNum(v) || v <= 0) errors.push('sens.json adsCm360.' + k + ': must be a number > 0');
      else if (ads[k] === undefined) ads[k] = data.hipCm360 / v;
    }
  }
  // FOV model: vertical FOV multiplier per magnification while aimed, and the ease time range.
  const model = { adsVFovMultipliers: {}, adsEaseSeconds: [0.12, 0.18] };
  if (data.model !== undefined) {
    const m = data.model;
    if (!m || typeof m !== 'object') errors.push('sens.json model: must be an object');
    else {
      if (m.adsVFovMultipliers !== undefined) {
        for (const [k, v] of Object.entries(m.adsVFovMultipliers || {})) {
          if (!keyOk(k)) errors.push('sens.json model.adsVFovMultipliers.' + k + ': key must look like "2.5x"');
          else if (!isNum(v) || v <= 0 || v > 1) errors.push('sens.json model.adsVFovMultipliers.' + k + ': must be a number from 0 to 1');
          else model.adsVFovMultipliers[k] = v;
        }
      }
      if (m.adsEaseSeconds !== undefined) {
        const e = m.adsEaseSeconds;
        if (!Array.isArray(e) || e.length !== 2 || !isNum(e[0]) || !isNum(e[1]) || e[0] <= 0 || e[1] < e[0]) errors.push('sens.json model.adsEaseSeconds: must be [min, max] seconds');
        else model.adsEaseSeconds = [e[0], e[1]];
      }
    }
  }
  const game = {};
  for (const k of ['horizontal', 'vertical', 'aimMode', 'globalAim', 'advancedMouseSensitivity', 'dpi', 'hipCm360']) if (data[k] !== undefined) game[k] = data[k];
  return { ads, magnifications, game, model, errors };
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error(url + ': invalid JSON (' + e.message + ')'); }
}

// Loads both files (relative URLs, so it works under any GitHub Pages sub-path).
export async function loadGameData() {
  const out = { guns: [], catalogue: null, sens: { ads: {}, magnifications: [], game: {}, model: { adsVFovMultipliers: {}, adsEaseSeconds: [0.12, 0.18] } }, errors: [], warnings: [] };
  let catalogue = { groups: {}, optics: [], byId: new Map(), errors: [] };
  try {
    catalogue = validateCatalogue(await fetchJson('data/optics.json'));
    out.errors.push(...catalogue.errors);
  } catch (e) {
    out.errors.push(String(e.message || e));
  }
  out.catalogue = catalogue;
  try {
    const s = validateSens(await fetchJson('data/sens.json'));
    out.sens = s;
    out.errors.push(...s.errors);
  } catch (e) {
    out.errors.push(String(e.message || e));
  }
  try {
    const g = validateGuns(await fetchJson('data/guns.json'), catalogue);
    out.guns = g.guns;
    out.errors.push(...g.errors);
    out.warnings.push(...g.warnings);
  } catch (e) {
    out.errors.push(String(e.message || e));
  }
  for (const e of out.errors) console.warn('[data] ' + e);
  for (const w of out.warnings) console.warn('[data] ' + w);
  return out;
}
