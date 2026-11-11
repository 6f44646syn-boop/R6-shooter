// Shared first-person replay camera. Distances and roll match Human's live view.
const DEG = Math.PI / 180;
export function replayCamera(camera, pose, settings, adsFov) {
  const lean = Math.max(-1, Math.min(1, pose.lean || 0));
  const ads = Math.max(0, Math.min(1, pose.ads || 0));
  const yaw = pose.yaw * DEG;
  camera.position.set(pose.x + Math.cos(yaw) * 0.32 * lean,
    pose.y + pose.eye - 0.05 * Math.abs(lean), pose.z + Math.sin(yaw) * 0.32 * lean);
  camera.rotation.set(Math.max(-89, Math.min(89, pose.pitch)) * DEG, -yaw, -11 * lean * DEG, 'YXZ');
  const hip = Math.tan(settings.fov * DEG / 2), aim = Math.tan(adsFov * DEG / 2);
  const fov = 2 * Math.atan(hip + (aim - hip) * ads) / DEG;
  if (Math.abs(camera.fov - fov) > 0.001) { camera.fov = fov; camera.updateProjectionMatrix(); }
}
