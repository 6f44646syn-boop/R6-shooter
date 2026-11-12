// Procedural "matcap" textures: a picture of a lit sphere. A MeshMatcapMaterial looks the
// shading up by surface direction (one texture read per pixel, no lighting maths), so the gun
// and sight still read as dark anodised metal with lit edges at a fraction of the cost of
// MeshStandardMaterial. Neutral greys; the material colour tints them.
import * as THREE from '../../vendor/three/three.module.min.js?v=79b9476-mwderefs';

const cache = new Map();

export function matcap(kind = 'metal') {
  if (cache.has(kind)) return cache.get(kind);
  const S = 256, c = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const sphere = (stops) => {
    const gr = g.createRadialGradient(c * 0.7, c * 0.62, 0, c, c, c);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.fill();
  };
  if (kind === 'rubber') {
    sphere([[0, '#4a4c50'], [0.5, '#2c2e31'], [0.9, '#1a1b1d'], [1, '#101112']]);
  } else {
    // Anodised metal: soft body, a bright highlight upper-left, a cool rim light.
    sphere([[0, '#c9ced6'], [0.25, '#8d939c'], [0.6, '#4f545b'], [0.88, '#2e3136'], [1, '#5b6470']]);
    const hl = g.createRadialGradient(c * 0.62, c * 0.5, 0, c * 0.62, c * 0.5, c * 0.32);
    hl.addColorStop(0, 'rgba(255,255,255,0.75)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hl;
    g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(kind, tex);
  return tex;
}
