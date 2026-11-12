import * as THREE from '../../vendor/three/three.module.min.js?v=ef9b523-mwd9feqb';

export const PLATFORM_HALF = 1.6;
export const PLATFORM_MASK = 15;
const THICKNESS = .14;
export const RAMP_RISE = 1.7;
const RISE = { ramp:RAMP_RISE, cone:1.25 };
export const platformHeight = kind => THICKNESS + RISE[kind];

function height(kind, x, z, raised) {
  if (!raised) return THICKNESS;
  const h = PLATFORM_HALF;
  return THICKNESS + RISE[kind] * (kind === 'ramp' ? (.5 - z / (2*h)) : (1 - Math.max(Math.abs(x), Math.abs(z)) / h));
}

function tile(i) {
  const h = PLATFORM_HALF;
  return [(i % 2 - 1) * h, (Math.floor(i / 2) - 1) * h];
}

export function platformMeshes(piece, material) {
  for (const mesh of piece.mesh.children.slice()) { mesh.geometry.dispose(); mesh.removeFromParent(); }
  for (let i = 0; i < 4; i++) {
    const [x,z] = tile(i), s = PLATFORM_HALF;
    const raised = piece.kind === 'ramp' || Boolean(piece.mask & (1 << i));
    const corners = [[x,z], [x+s,z], [x+s,z+s], [x,z+s]];
    const top = corners.map(([x,z]) => [x,height(piece.kind,x,z,raised),z]);
    const bottom = corners.map(([x,z]) => [x,0,z]);
    const tris = piece.kind === 'cone' && (i === 1 || i === 2) ? [[0,3,1],[1,3,2]] : [[0,3,2],[0,2,1]];
    const positions = tris.flatMap(tri => tri.flatMap(k => top[k]));
    for (let k = 0; k < 4; k++) {
      const next = (k + 1) % 4;
      positions.push(...top[k], ...top[next], ...bottom[k], ...top[next], ...bottom[next], ...bottom[k]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = mesh.receiveShadow = true;
    piece.mesh.add(mesh);
  }
  piece.mesh.rotation.y = piece.dir * Math.PI / 2;
}

export function platformSolids(piece, mask = piece.mask, dir = piece.dir) {
  const { kind, mesh:{position:p} } = piece;
  const theta = dir * Math.PI / 2, sin = Math.round(Math.sin(theta)), cos = Math.round(Math.cos(theta));
  const solids = [];
  for (let i = 0; i < 4; i++) {
    const raised = Boolean(mask & (1 << i));
    if (!raised && kind === 'ramp') continue;
    const [x,z] = tile(i);
    const rows = raised ? 4 : 1, cols = kind === 'cone' && raised ? 4 : 1;
    const dx = PLATFORM_HALF / cols, dz = PLATFORM_HALF / rows;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const cx = x + (col+.5)*dx, cz = z + (row+.5)*dz;
      const wx = p.x + cx*cos + cz*sin, wz = p.z - cx*sin + cz*cos;
      const w = cos ? dx : dz, d = cos ? dz : dx;
      solids.push({minX:wx-w/2,maxX:wx+w/2,minY:p.y,maxY:p.y+height(kind,cx,cz,raised),minZ:wz-d/2,maxZ:wz+d/2});
    }
  }
  return solids;
}
