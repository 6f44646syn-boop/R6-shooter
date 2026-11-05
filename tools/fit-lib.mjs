// Shared spray fitting for the tools: bullet-hole pixels -> view angles.
//
// Pinhole camera at the vertical FOV the screenshot was taken at (1920x1080, crosshair at the
// centre). Aimed screenshots must use the AIMED FOV: hip vFOV x the sight's multiplier from
// data/sens.json model.adsVFovMultipliers (2.5x: 83 x 0.42 = 34.86 deg; 1x: 83 x 0.9 = 74.7).
//   f     = (H / 2) / tan(vFOV / 2)
//   yaw   = atan(dx / f)
//   pitch = atan(dy / sqrt(f^2 + dx^2))
// Angles are relative to bullet 1 and rounded to 0.01 deg.
const DEG = 180 / Math.PI;

export function refit(holes, vFovDeg, W = 1920, H = 1080) {
  const f = (H / 2) / Math.tan(vFovDeg / DEG / 2);
  const cx = W / 2, cy = H / 2;
  const ang = holes.map(([x, y]) => {
    const dx = x - cx, dy = cy - y;
    return [Math.atan(dx / f) * DEG, Math.atan(dy / Math.hypot(f, dx)) * DEG];
  });
  const r2 = (v) => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0
  return ang.map(([y, p]) => [r2(y - ang[0][0]), r2(p - ang[0][1])]);
}

// Aimed vertical FOV for a sight id, from the optics catalogue and the sens.json model.
export function aimedVFov(opticId, opticsJson, sensJson) {
  const o = opticsJson.optics.find((x) => x.id === opticId);
  if (!o) throw new Error('unknown sight "' + opticId + '"');
  const zoom = o.zoom !== undefined ? o.zoom : opticsJson.groups[o.group].zoom;
  const hip = (sensJson.model && sensJson.model.hipVFov) || 83;
  const m = sensJson.model && sensJson.model.adsVFovMultipliers && sensJson.model.adsVFovMultipliers[zoom.toFixed(1) + 'x'];
  return m !== undefined ? hip * m : 2 * Math.atan(Math.tan(hip / DEG / 2) / zoom) * DEG;
}
