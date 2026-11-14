// Compile every material in a scene, hidden ones too (muzzle flashes, shields, outlines), so they
// do not stutter the first time they show. Call it under a loading screen: it blocks.
import * as THREE from '../../vendor/three/three.module.min.js?v=d05ab44-mwg7imxt';

const CAM = new THREE.PerspectiveCamera();
export function warmScene(renderer, scene) {
  if (!renderer?.compile || !scene) return;
  const hidden = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  try { renderer.compile(scene, CAM); } catch { /* a context without compile: it compiles on first draw */ }
  for (const o of hidden) o.visible = false;
}
