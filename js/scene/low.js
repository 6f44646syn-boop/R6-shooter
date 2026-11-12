// Low graphics: flat colours, the look of the first versions. Each textured Lambert material
// is replaced by an untextured one in the texture's average colour, lit by one hemisphere
// light, so every pixel costs one colour and one light. Materials that carry information
// (the paper target's rings, screens, dots, bullet holes) keep their textures.
import * as THREE from '../../vendor/three/three.module.min.js?v=5cd0ef3-mwdhofew';

const avgCache = new WeakMap();
// Average colour of a canvas texture (linear), via a 16 x 16 downsample.
export function averageColor(tex) {
  if (avgCache.has(tex)) return avgCache.get(tex);
  const c = new THREE.Color(1, 1, 1);
  const img = tex && tex.image;
  if (img && img.width) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      if (a < 0.05) continue;
      r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
    }
    if (n) c.setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
  }
  avgCache.set(tex, c);
  return c;
}

// The flat replacement for a material, or null to keep it as it is.
export function flatMaterial(m) {
  if (!m || m.userData.keepInLow || !m.isMeshLambertMaterial) return null;
  const color = m.color.clone();
  if (m.map) color.multiply(averageColor(m.map));
  return new THREE.MeshLambertMaterial({
    color, vertexColors: m.vertexColors, transparent: m.transparent, opacity: m.opacity,
    depthWrite: m.depthWrite, polygonOffset: m.polygonOffset,
    polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits, side: m.side,
  });
}
