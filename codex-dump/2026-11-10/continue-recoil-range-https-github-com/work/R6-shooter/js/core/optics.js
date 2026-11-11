// Sight catalogue (data/optics.json): validation, per-gun resolution and lookups.
// Pure functions with no DOM, shared by the page and tools/check-data.mjs.

export const HOUSING_SHAPES = ['rect', 'round'];
export const RETICLE_TYPES = ['dot', 'ring', 'line', 'poly'];
const HOUSING_FRACTIONS = ['w', 'h', 'radius', 'bezel', 'base', 'hood', 'tint'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// "2.5x" style key for a zoom level. Used for per-magnification ADS sensitivity.
export function zoomKey(zoom) {
  return zoom.toFixed(1) + 'x';
}

// Validate the catalogue. Returns { groups, optics, byId, errors }.
// Each optic in `optics` gets resolved fields: zoom, adsSpeedBonus, sensKey.
export function validateCatalogue(data) {
  const errors = [];
  const groups = {};
  const optics = [];
  const byId = new Map();
  if (!data || typeof data !== 'object' || !data.groups || typeof data.groups !== 'object' || !Array.isArray(data.optics)) {
    return { groups, optics, byId, errors: ['optics.json: expected { "groups": {...}, "optics": [...] }'] };
  }

  for (const [gid, g] of Object.entries(data.groups)) {
    const where = 'optics.json groups.' + gid;
    if (!g || typeof g !== 'object') { errors.push(where + ': not an object'); continue; }
    if (!isNum(g.zoom) || g.zoom < 1) { errors.push(where + '.zoom: must be a number >= 1 (got ' + JSON.stringify(g.zoom) + ')'); continue; }
    if (g.adsSpeedBonus !== undefined && (!isNum(g.adsSpeedBonus) || g.adsSpeedBonus < 0)) { errors.push(where + '.adsSpeedBonus: must be a number >= 0'); continue; }
    groups[gid] = { id: gid, label: typeof g.label === 'string' ? g.label : gid, zoom: g.zoom, adsSpeedBonus: g.adsSpeedBonus || 0 };
  }

  data.optics.forEach((o, i) => {
    const where = 'optics.json optics[' + i + ']' + (o && typeof o.id === 'string' ? ' (' + o.id + ')' : '');
    const errs = [];
    const bad = (f, msg) => errs.push(where + '.' + f + ': ' + msg);
    if (!o || typeof o !== 'object') { errors.push(where + ': not an object'); return; }
    if (typeof o.id !== 'string' || !o.id.trim()) bad('id', 'must be a non-empty string');
    else if (o.id.startsWith('@')) bad('id', 'must not start with @ (that marks a group)');
    else if (byId.has(o.id)) bad('id', 'duplicate optic id "' + o.id + '"');
    if (!groups[o.group]) bad('group', 'unknown group ' + JSON.stringify(o.group) + ' (have ' + Object.keys(groups).join(', ') + ')');
    if (o.zoom !== undefined && (!isNum(o.zoom) || o.zoom < 1)) bad('zoom', 'must be a number >= 1 (got ' + JSON.stringify(o.zoom) + ')');
    if (o.adsSpeedBonus !== undefined && (!isNum(o.adsSpeedBonus) || o.adsSpeedBonus < 0)) bad('adsSpeedBonus', 'must be a number >= 0');
    if (o.sensKey !== undefined && (typeof o.sensKey !== 'string' || !/^\d+(\.\d+)?x$/.test(o.sensKey))) bad('sensKey', 'must look like "2.5x"');

    const h = o.housing;
    if (!h || typeof h !== 'object') bad('housing', 'must be an object');
    else {
      if (!HOUSING_SHAPES.includes(h.shape)) bad('housing.shape', 'unknown shape ' + JSON.stringify(h.shape) + ' (use ' + HOUSING_SHAPES.join(' or ') + ')');
      for (const f of HOUSING_FRACTIONS) {
        const v = h[f];
        if (v === undefined && f !== 'w' && f !== 'h') continue;
        if (!isNum(v) || v < 0 || v > 1) bad('housing.' + f, 'must be a fraction of screen height from 0 to 1 (got ' + JSON.stringify(v) + ')');
      }
      if (isNum(h.tint) && h.tint > 0.3) bad('housing.tint', 'must be 0 to 0.3');
    }

    const r = o.reticle;
    if (!r || typeof r !== 'object' || !Array.isArray(r.shapes)) bad('reticle', 'must be an object with a "shapes" array');
    else {
      if (r.glow !== undefined && (!isNum(r.glow) || r.glow < 0 || r.glow > 1)) bad('reticle.glow', 'must be 0 to 1');
      r.shapes.forEach((s, k) => {
        const f = 'reticle.shapes[' + k + ']';
        if (!s || !RETICLE_TYPES.includes(s.t)) { bad(f + '.t', 'unknown reticle shape type ' + JSON.stringify(s && s.t) + ' (use ' + RETICLE_TYPES.join(', ') + ')'); return; }
        const need = { dot: ['r'], ring: ['r'], line: ['x1', 'y1', 'x2', 'y2'], poly: [] }[s.t];
        for (const n of need) if (!isNum(s[n])) bad(f + '.' + n, 'must be a number');
        if (s.t === 'poly' && (!Array.isArray(s.pts) || s.pts.length < 2 || s.pts.some((p) => !Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])))) {
          bad(f + '.pts', 'must be a list of [x, y] points');
        }
        if (s.c !== undefined && s.c !== 'reticle' && s.c !== 'dark') bad(f + '.c', 'must be "reticle" or "dark"');
      });
    }

    if (errs.length) { errors.push(...errs); return; }
    const g = groups[o.group];
    const zoom = o.zoom !== undefined ? o.zoom : g.zoom;
    const resolved = {
      id: o.id, group: o.group, label: typeof o.label === 'string' ? o.label : o.id,
      zoom, adsSpeedBonus: o.adsSpeedBonus !== undefined ? o.adsSpeedBonus : g.adsSpeedBonus,
      sensKey: o.sensKey || zoomKey(zoom),
      housing: { radius: 0, bezel: 0, base: 0, hood: 0, tint: 0, ...o.housing },
      reticle: { glow: r.glow !== undefined ? r.glow : 0.5, shapes: r.shapes },
    };
    byId.set(o.id, resolved);
    optics.push(resolved);
  });
  return { groups, optics, byId, errors };
}

// Every ADS sensitivity key in use, sorted by zoom ("1.0x", "2.5x", ...).
export function sensKeys(catalogue) {
  const seen = new Map();
  for (const o of catalogue.optics) if (!seen.has(o.sensKey)) seen.set(o.sensKey, parseFloat(o.sensKey));
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
}

// Expand a gun's "optics" list ("@group" tokens and ids) minus "opticsExclude".
// Returns { ids, errors } (errors as plain messages without a location prefix).
export function resolveGunOptics(gun, catalogue) {
  const errors = [];
  const ids = [];
  const list = Array.isArray(gun.optics) ? gun.optics : null;
  if (!list) return { ids, errors: ['optics: must be a list of optic ids and/or "@group" tokens'] };
  for (const tok of list) {
    if (typeof tok !== 'string') { errors.push('optics: ' + JSON.stringify(tok) + ' is not a string'); continue; }
    if (tok.startsWith('@')) {
      const gid = tok.slice(1);
      if (!catalogue.groups[gid]) { errors.push('optics: unknown group "' + tok + '"'); continue; }
      for (const o of catalogue.optics) if (o.group === gid && !ids.includes(o.id)) ids.push(o.id);
    } else if (!catalogue.byId.has(tok)) {
      errors.push('optics: unknown optic id "' + tok + '"');
    } else if (!ids.includes(tok)) {
      ids.push(tok);
    }
  }
  const ex = gun.opticsExclude === undefined ? [] : gun.opticsExclude;
  if (!Array.isArray(ex)) errors.push('opticsExclude: must be a list of optic ids');
  else for (const id of ex) {
    if (!catalogue.byId.has(id)) errors.push('opticsExclude: unknown optic id "' + id + '"');
    const k = ids.indexOf(id);
    if (k >= 0) ids.splice(k, 1);
  }
  if (!errors.length && !ids.length) errors.push('optics: resolves to an empty list');
  if (typeof gun.defaultOptic !== 'string') errors.push('defaultOptic: must be an optic id');
  else if (ids.length && !ids.includes(gun.defaultOptic)) errors.push('defaultOptic: "' + gun.defaultOptic + '" is not in the resolved list (' + ids.join(', ') + ')');
  if (gun.opticRecoilScale !== undefined) {
    if (!gun.opticRecoilScale || typeof gun.opticRecoilScale !== 'object') errors.push('opticRecoilScale: must be an object like {"mag_a": 1.0}');
    else for (const [id, v] of Object.entries(gun.opticRecoilScale)) {
      if (!catalogue.byId.has(id)) errors.push('opticRecoilScale: unknown optic id "' + id + '"');
      if (!isNum(v) || v <= 0) errors.push('opticRecoilScale.' + id + ': must be a number > 0');
    }
  }
  if (gun.opticsVerified !== undefined && typeof gun.opticsVerified !== 'boolean') errors.push('opticsVerified: must be true or false');
  return { ids, errors };
}
