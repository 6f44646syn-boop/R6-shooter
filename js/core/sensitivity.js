// Sensitivity and field-of-view maths. Pure functions, no DOM, so they can be unit tested.
//
// A mouse reports movement in "counts". DPI (really CPI) is counts per inch of travel.
// cm/360 is how far the mouse travels for one full 360 degree turn.
//
//   counts per 360 = DPI [counts/inch] * (cm360 / 2.54) [inches]
//   degrees per count = 360 / counts per 360
//
// Example: 800 DPI, 40 cm/360 -> 40 / 2.54 = 15.748 in -> 12598.4 counts -> 0.028575 deg/count.

export const CM_PER_INCH = 2.54;

export function inchesPer360(cm360) {
  return cm360 / CM_PER_INCH;
}

export function countsPer360(dpi, cm360) {
  return dpi * inchesPer360(cm360);
}

export function degPerCount(dpi, cm360) {
  return 360 / countsPer360(dpi, cm360);
}

const DEG = Math.PI / 180;

// Vertical FOV for a given horizontal FOV and aspect ratio (width / height).
// The view frustum is defined by the tangent of the half-angle, so convert in tan-space:
//   tan(v/2) = tan(h/2) / aspect
export function verticalFovDeg(hFovDeg, aspect) {
  return 2 * Math.atan(Math.tan(hFovDeg * DEG / 2) / aspect) / DEG;
}

// FOV through an optic of magnification `zoom`. Magnification scales the tangent of the
// half-angle (everything on screen gets `zoom` times bigger), not the angle itself:
//   tan(ads/2) = tan(hip/2) / zoom
export function zoomedFovDeg(fovDeg, zoom) {
  return 2 * Math.atan(Math.tan(fovDeg * DEG / 2) / zoom) / DEG;
}
