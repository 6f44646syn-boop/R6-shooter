// Loads and validates data/guns.json and data/optics.json.
// Bad guns are skipped with a clear message naming the gun and the field; the rest still load.

const MODELS = ['rifle', 'carbine', 'smg', 'lmg', 'marksman'];
// Default model when the field is missing: guess from the id ("smg-01" -> smg).
const guessModel = (id) => MODELS.find((m) => id.toLowerCase().startsWith(m)) || 'rifle';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Returns { guns, errors, warnings }. `opticZooms` is the list of zoom levels from optics.json.
export function validateGuns(data, opticZooms) {
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
    if (!isNum(g.optic)) bad('optic', 'must be a number such as 1.0 or 2.5');
    else if (!opticZooms.includes(g.optic)) bad('optic', g.optic + ' is not in data/optics.json (have ' + opticZooms.join(', ') + ')');
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

    // Soft checks: the gun still loads.
    const p0 = g.sprayPath[0];
    if (p0[0] !== 0 || p0[1] !== 0) warnings.push(where + '.sprayPath[0] is ' + JSON.stringify(p0) + ', expected [0, 0]. Offsets are taken relative to it.');
    if (g.resetSeconds < 60 / g.rpm) warnings.push(where + '.resetSeconds (' + g.resetSeconds + ') is shorter than the shot interval (' + (60 / g.rpm).toFixed(3) + ' s), so every shot restarts the spray.');
    if (g.sprayPath.length < 2) warnings.push(where + '.sprayPath has one entry, so there is no recoil.');

    ids.add(g.id);
    guns.push({
      id: g.id, name: g.name, rpm: g.rpm, magSize: g.magSize, reloadSeconds: g.reloadSeconds,
      optic: g.optic, hipMultiplier: g.hipMultiplier, adsMultiplier: g.adsMultiplier,
      resetSeconds: g.resetSeconds, placeholder: g.placeholder,
      fireMode: g.fireMode || 'auto', model: g.model || guessModel(g.id), tone: g.tone === undefined ? 0.5 : g.tone,
      sprayPath: g.sprayPath.map((p) => [p[0], p[1]]),
      jitter: { yawDeg: g.jitter.yawDeg, pitchDeg: g.jitter.pitchDeg },
      recovery: { delaySeconds: g.recovery.delaySeconds, degPerSecond: g.recovery.degPerSecond },
    });
  });
  return { guns, errors, warnings };
}

// Returns { optics: [{zoom, adsMultiplier}], errors }
export function validateOptics(data) {
  const errors = [];
  const optics = [];
  const list = data && Array.isArray(data.optics) ? data.optics : null;
  if (!list) return { optics, errors: ['optics.json: expected an object with an "optics" array.'] };
  list.forEach((o, i) => {
    if (!o || !isNum(o.zoom) || o.zoom < 1) errors.push('optics[' + i + '].zoom: must be a number >= 1');
    else if (!isNum(o.adsMultiplier) || o.adsMultiplier <= 0) errors.push('optics[' + i + '].adsMultiplier: must be a number > 0');
    else optics.push({ zoom: o.zoom, adsMultiplier: o.adsMultiplier });
  });
  return { optics, errors };
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error(url + ': invalid JSON (' + e.message + ')'); }
}

// Loads both files (relative URLs, so it works under any GitHub Pages sub-path).
export async function loadGameData() {
  const out = { guns: [], optics: [], errors: [], warnings: [] };
  try {
    const o = validateOptics(await fetchJson('data/optics.json'));
    out.optics = o.optics;
    out.errors.push(...o.errors);
  } catch (e) {
    out.errors.push(String(e.message || e));
  }
  if (!out.optics.length) out.optics = [{ zoom: 1, adsMultiplier: 1 }];
  try {
    const g = validateGuns(await fetchJson('data/guns.json'), out.optics.map((o) => o.zoom));
    out.guns = g.guns;
    out.errors.push(...g.errors);
    out.warnings.push(...g.warnings);
  } catch (e) {
    out.errors.push(String(e.message || e));
  }
  for (const e of out.errors) console.error('[data] ' + e);
  for (const w of out.warnings) console.warn('[data] ' + w);
  return out;
}
