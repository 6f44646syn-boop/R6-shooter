// A loading wheel for anything still loading: track(promise, label) shows it (after a short delay, so
// quick loads do not flash it) until every tracked promise has settled. Textures loaded through
// three.js's default loading manager count too. It never blocks clicks.
import * as THREE from '../../vendor/three/three.module.min.js?v=66e6c20-mwe5ta04';

const jobs = new Map();
let el = null, label = null, timer = 0, seq = 0;
function ensure() {
  if (el) return;
  el = document.createElement('div'); el.className = 'busy'; el.hidden = true; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  const wheel = document.createElement('div'); wheel.className = 'busy-wheel';
  label = document.createElement('span'); label.className = 'busy-label';
  el.append(wheel, label); document.body.append(el);
}
function refresh() {
  ensure();
  const names = [...jobs.values()];
  label.textContent = names[names.length - 1] || 'Loading';
  clearTimeout(timer);
  if (names.length) { if (el.hidden) timer = setTimeout(() => { el.hidden = !jobs.size; }, 180); }
  else el.hidden = true;
}
export function track(promise, name = 'Loading') {
  const id = ++seq; jobs.set(id, name); refresh();
  const done = () => { jobs.delete(id); refresh(); };
  Promise.resolve(promise).then(done, done);
  return promise;
}
// textures and other three.js loads
let textures = null;
THREE.DefaultLoadingManager.onStart = () => { if (!textures) { let end; textures = new Promise((r) => { end = r; }); textures.end = end; track(textures, 'Loading textures'); } };
THREE.DefaultLoadingManager.onLoad = () => { if (textures) { textures.end(); textures = null; } };
