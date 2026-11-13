// Controller aim assist (controllers only, never the mouse): near a visible enemy the stick
// turns slower (friction) and the aim is nudged towards them, only while you move the stick.
export const PAD_ASSIST = {
  off: null,
  light: { cone: 4, slow: 0.3, pull: 0.04 },
  standard: { cone: 6, slow: 0.45, pull: 0.08 },
};
const DEG = Math.PI / 180;
// The visible target nearest the aim within cone degrees: { ey, ep, d } (degrees: target minus
// aim, yaw right and pitch up), or null. points: [[x, y, z], ...]; sight(a, b): clear line.
export function nearestAim(eye, yaw, pitch, points, cone, sight) {
  let best = null;
  for (const p of points) {
    const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];
    let ey = Math.atan2(dx, -dz) / DEG - yaw;
    ey -= 360 * Math.round(ey / 360);
    const ep = Math.atan2(dy, Math.hypot(dx, dz)) / DEG - pitch, d = Math.hypot(ey, ep);
    if (d < cone && (!best || d < best.d) && sight(eye, p)) best = { ey, ep, d };
  }
  return best;
}
// Stick look this frame (degrees: x right, y down) -> assisted [x, y].
export function assistLook(A, degX, degY, aim) {
  if (!A || !aim) return [degX, degY];
  const f = 1 - aim.d / A.cone, slow = 1 - A.slow * f, move = Math.min(1, Math.hypot(degX, degY) / 0.4);
  return [degX * slow + aim.ey * A.pull * f * move, degY * slow - aim.ep * A.pull * f * move];
}
