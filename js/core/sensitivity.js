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

// Siege-style sensitivity sliders (1-50). Your own numbers fix the scale: sensitivity 7 at
// 1600 DPI turns 360 deg in 14.25 cm, i.e. degrees per count = sens x 0.00572958
// (360 x 2.54 / (1600 x 14.25 x 7) = 0.0057296).
export const DEG_PER_COUNT_PER_SENS = 0.00572958;
export function sensToCm360(dpi, sens) {
  return 360 * CM_PER_INCH / (dpi * sens * DEG_PER_COUNT_PER_SENS);
}
export function cm360ToSens(dpi, cm360) {
  return 360 * CM_PER_INCH / (dpi * cm360 * DEG_PER_COUNT_PER_SENS);
}

// Vertical FOV for a given horizontal FOV and aspect ratio (width / height).
// The view frustum is defined by the tangent of the half-angle, so convert in tan-space:
//   tan(v/2) = tan(h/2) / aspect
export function verticalFovDeg(hFovDeg, aspect) {
  return 2 * Math.atan(Math.tan(hFovDeg * DEG / 2) / aspect) / DEG;
}

// Horizontal FOV for a given vertical FOV and aspect ratio: tan(h/2) = tan(v/2) * aspect.
export function horizontalFovDeg(vFovDeg, aspect) {
  return 2 * Math.atan(Math.tan(vFovDeg * DEG / 2) * aspect) / DEG;
}

// Focal-length scaling (monitor distance matching). Sensitivity multiplier for a view of
// vertical FOV `fov` relative to the hip FOV `hip`, matched at coefficient `c` of the way
// from the screen centre to the top/bottom edge:
//   c = 0  (0%, focal length): tan(fov / 2) / tan(hip / 2)
//          -> a mouse movement moves the view by the same distance ON SCREEN at the crosshair
//   c > 0: atan(c * tan(fov / 2)) / atan(c * tan(hip / 2))  (c = 1: matched at the edge)
// Pure function of the current FOV, so it changes smoothly frame by frame with the zoom.
export function focalRatio(fovDeg, hipDeg, c = 0) {
  const a = Math.tan(fovDeg * DEG / 2), b = Math.tan(hipDeg * DEG / 2);
  if (!(c > 1e-6)) return a / b;
  return Math.atan(c * a) / Math.atan(c * b);
}

// FOV through an optic of magnification `zoom`. Magnification scales the tangent of the
// half-angle (everything on screen gets `zoom` times bigger), not the angle itself:
//   tan(ads/2) = tan(hip/2) / zoom
export function zoomedFovDeg(fovDeg, zoom) {
  return 2 * Math.atan(Math.tan(fovDeg * DEG / 2) / zoom) / DEG;
}
