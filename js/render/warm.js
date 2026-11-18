// Compile every material in a scene, hidden ones too (muzzle flashes, shields, outlines), so they
// do not stutter the first time they show. Call it under a loading screen: it blocks.
import * as THREE from '../../vendor/three/three.module.min.js?v=4485eaa-mwlojqse';

const CAM = new THREE.PerspectiveCamera();
export function warmScene(renderer, scene) {
  if (!renderer?.compile || !scene) return;
  const hidden = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  try { renderer.compile(scene, CAM); } catch { /* a context without compile: it compiles on first draw */ }
  for (const o of hidden) o.visible = false;
}

// For objects about to join a scene that is already on screen (the Enhanced pack's materials and
// props arrive after a match starts): compile their shaders without blocking a frame (three's
// compileAsync, which uses KHR_parallel_shader_compile) and upload their textures one per frame,
// so swapping them in costs nothing. `objects` must not be in a scene yet; they are left in a
// temporary group, which the caller's add() takes them out of.
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
// Texture upload time per frame; main.js raises it while a loading screen covers the match.
export const warmBudget = { ms: 6 };
export async function warmObjects(renderer, scene, objects) {
  if (!renderer?.compileAsync || !scene || !objects.length) return;
  const g = new THREE.Group();
  for (const o of objects) g.add(o);
  try { await renderer.compileAsync(g, CAM, scene); } catch { /* compiles on first draw instead */ }
  const texs = new Set();
  for (const o of objects) for (const m of [].concat(o.material || [])) for (const k in m) if (m[k]?.isTexture && m[k].image) texs.add(m[k]);
  // Uploads take about 6 ms of each frame (a 4K texture takes a frame on its own); copies of an
  // already uploaded image (same source) cost nothing.
  let t0 = performance.now();
  for (const t of texs) {
    try { renderer.initTexture(t); } catch { /* uploads on first draw instead */ }
    if (performance.now() - t0 > warmBudget.ms) { await nextFrame(); t0 = performance.now(); }
  }
}
