import * as THREE from '../../vendor/three/three.module.min.js?v=a37f22c-mwcnqhgi';
import { mulberry32 } from '../core/prng.js?v=a37f22c-mwcnqhgi';

const AXIS = new THREE.Vector3(0, 0, 1);
const regular = (n, r, x = 0, y = 0, phase = 0) => Array.from({ length: n }, (_, i) => {
  const a = i * Math.PI * 2 / n + phase;
  return [x + r * Math.cos(a), y + r * Math.sin(a)];
});

function sides(gun) {
  const surfaces = gun.children.filter(part => part.isMesh);
  gun.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), normalMatrix = new THREE.Matrix3();
  return (side, y, z) => {
    ray.ray.origin.set(side * 0.14, y, z);
    ray.ray.direction.set(-side, 0, 0);
    const hit = ray.intersectObjects(surfaces, false)[0];
    if (!hit?.object.material.userData.skinKey) return null;
    const normal = hit.face.normal.clone().applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
    return side * normal.x > 0.72 ? { point: hit.point, normal } : null;
  };
}

function seat(gun, cast, side, y, z, width, aspect = 0.46, turn = 0) {
  const hit = cast(side, y, z);
  if (!hit) return null;
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(hit.normal, hit.point);
  // Probe the actual footprint so a large inlay never bridges a vent, edge or gap.
  for (const [u, v] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const x = u * width, h = v * width * aspect;
    const sin = Math.sin(turn), cos = Math.cos(turn);
    const edge = cast(side, y + x * sin + h * cos, z - side * (x * cos - h * sin));
    if (!edge || hit.normal.dot(edge.normal) < 0.88 || Math.abs(plane.distanceToPoint(edge.point)) > 0.0013) return null;
  }
  const panel = new THREE.Group();
  panel.position.copy(hit.point).addScaledVector(hit.normal, -Math.min(0.0011, width * .028));
  panel.quaternion.setFromUnitVectors(AXIS, hit.normal);
  panel.rotateZ(turn);
  panel.scale.set(width, width * aspect / 0.46, width * .80);
  gun.add(panel);
  return panel;
}

function plate(panel, points, material, depth = 0.13, bevel = 0.028) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: true, bevelSegments: 1,
    bevelThickness: bevel, bevelSize: bevel });
  panel.add(new THREE.Mesh(geometry, material));
}

function ridge(panel, points, material, radius = 0.035, z = 0.11, closed = false) {
  const path = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, z)), closed);
  panel.add(new THREE.Mesh(new THREE.TubeGeometry(path, points.length * 4, radius, 5, closed), material));
}

// Small original marks for the sixteen themes, carried by both versions of each finish.
const MARKS = [
  [[-.28, 0], [-.08, .06], [0, .25], [.08, .06], [.28, 0], [.08, -.06], [0, -.25], [-.08, -.06]],
  [[-.24, -.21], [-.22, .03], [-.06, .13], [-.02, .25], [.10, .06], [.23, .03], [.22, -.21]],
  [[-.27, -.12], [-.15, .17], [-.08, -.02], [.06, .19], [.14, -.02], [.25, .11], [.23, -.18]],
  [[-.26, .14], [-.14, .24], [.14, .24], [.26, .14], [.19, -.10], [0, -.24], [-.19, -.10]],
  [[-.28, 0], [-.13, .09], [-.10, .20], [0, .15], [.10, .20], [.13, .09], [.28, 0], [.13, -.09], [0, -.19], [-.13, -.09]],
  [[-.28, .19], [0, .08], [.28, .19], [.19, -.05], [0, -.25], [-.19, -.05]],
  [[-.26, -.17], [0, .25], [.26, -.17]],
  [[-.10, .26], [.13, .26], [.05, .04], [.24, .04], [-.13, -.27], [-.04, -.05], [-.23, -.05]],
  [[-.28, .10], [-.11, .21], [.27, .21], [.14, .08], [-.10, .08], [.15, -.04], [.02, -.22], [-.20, -.15], [-.08, -.05]],
  [[-.15, .23], [.04, .15], [.12, 0], [.04, -.15], [-.15, -.23], [.09, -.23], [.24, 0], [.09, .23]],
  [[-.28, .18], [0, .05], [.28, .18], [.24, -.06], [0, -.24], [-.24, -.06]],
  [[-.28, -.10], [-.12, .09], [.07, .15], [.28, .10], [.15, -.02], [-.02, -.06], [-.16, -.18]],
  [[-.27, .17], [-.03, .17], [.23, -.15], [.05, -.15], [-.12, .05], [-.27, .05]],
  [[-.28, -.17], [-.03, .24], [.08, .07], [.14, .15], [.28, -.17], [.07, -.17], [-.03, -.02], [-.13, -.17]],
  [[-.28, .16], [-.05, .23], [.23, .12], [.25, -.08], [.05, -.24], [-.16, -.16], [-.17, -.02], [.02, .08], [.09, .01], [-.02, -.07], [.04, -.15], [.13, -.10], [.15, .09], [-.06, .14]],
  [[-.27, .19], [0, .13], [.25, .23], [.16, .02], [.23, -.11], [0, -.23], [-.23, -.11], [-.16, .02]],
];

function epicPanel(panel, skin, [dark, enamel, trim], rng) {
  switch (skin.pattern) {
    case 0: // sculpted contour lines
      for (const s of [1, 0.82, 0.64]) ridge(panel, [[-.91, -.04], [-.65, -.37], [.39, -.34], [.92, -.10], [.76, .29], [-.42, .36]].map(([x, y]) => [x * s, y * s]), s === 0.82 ? trim : enamel, 0.026, 0.12, true);
      break;
    case 5: // raised ceramic hexes
      for (const x of [-.72, -.49, .49, .72]) for (const y of [-.18, .12]) {
        plate(panel, regular(6, 0.145, x + y * 0.22, y, Math.PI / 6), rng() < 0.35 ? trim : enamel, 0.09 + rng() * 0.07);
      }
      break;
    case 6: // forged ribbons
      for (const y of [-.23, -.08, .08, .23]) ridge(panel, [[-.91, y], [-.61, y + .10], [-.26, y + .04], [.24, y - .07], [.58, y + .04], [.91, y]], y > 0 ? trim : enamel, 0.037, 0.115);
      break;
    case 13: // split mineral plates and bright seams
      plate(panel, [[-.93, -.28], [-.79, .28], [-.46, .33], [-.26, .10], [-.35, -.23]], enamel);
      plate(panel, [[.24, -.12], [.44, .30], [.87, .27], [.91, -.22], [.60, -.35]], enamel, 0.17);
      ridge(panel, [[-.88, -.18], [-.68, -.07], [-.56, .10], [-.42, .13], [-.34, .24]], trim, 0.022, 0.165);
      ridge(panel, [[.34, -.13], [.50, -.04], [.55, .12], [.73, .17], [.86, .23]], trim, 0.022, 0.20);
      break;
    case 14: // traces and contact pads
      for (const side of [-1, 1]) for (const y of [-.21, .15]) {
        plate(panel, [[.25, y], [.55, y], [.65, y + .09], [.84, y + .09], [.84, y + .04], [.68, y + .04], [.57, y - .05], [.25, y - .05]].map(([x, v]) => [x * side, v]), trim, 0.075, 0.012);
        plate(panel, regular(4, 0.105, .83 * side, y + .06, Math.PI / 4), enamel, 0.15);
      }
      break;
    case 15: // lacquered stem and petal relief
      ridge(panel, [[-.89, -.22], [-.62, -.10], [-.34, .16], [.04, .04], [.42, -.04], [.69, .17], [.87, .22]], trim, 0.031, 0.09);
      for (const [x, y] of [[-.61, .11], [.58, -.09], [.75, .16]]) {
        const petals = regular(20, 0.18, x, y).map(([u, v], i) => i % 4 === 0 ? [x + (u - x) * .61, y + (v - y) * .61] : [u, v]);
        plate(panel, petals, enamel, 0.12, 0.016);
        plate(panel, regular(6, .045, x, y), trim, 0.16, 0.01);
      }
      break;
    case 9: // irregular enamel facets
      for (const side of [-1, 1]) {
        plate(panel, [[.28, -.26], [.52, .33], [.88, .17]].map(([x, y]) => [x * side, y]), enamel, 0.18);
        plate(panel, [[.30, -.30], [.91, .12], [.80, -.23]].map(([x, y]) => [x * side, y]), trim, 0.09);
      }
      break;
    case 16: // curling wave crests
      for (const side of [-1, 1]) {
        const crest = [[.27, -.26], [.53, -.28], [.81, -.14], [.91, .08], [.73, .27], [.55, .19], [.59, .06], [.72, .08]];
        ridge(panel, crest.map(([x, y]) => [x * side, y]), enamel, 0.062, 0.13);
        ridge(panel, crest.slice(2, 7).map(([x, y]) => [x * side, y + .053]), trim, 0.029, 0.175);
      }
      break;
  }
  plate(panel, regular(8, .31, 0, 0, Math.PI / 8), dark, 0.17, 0.034);
  const mark = MARKS[(skin.id - 160) % MARKS.length];
  plate(panel, mark.map(([x, y]) => [x * .79, y * .79]), trim, 0.215, 0.012);
}

export function epicRelief(gun, skin, materials) {
  const cast = sides(gun);
  const rng = mulberry32(skin.id * 193);
  const centers = [[.003, -.035], [.018, .035], [-.009, .075], [.018, -.105], [.026, -.055], [0, -.15], [0, 0], [.02, .12]];
  for (const side of [-1, 1]) {
    let panel;
    for (const width of [0.044, 0.034, 0.024, 0.015]) {
      for (const [y, z] of centers) {
        panel = seat(gun, cast, side, y, z, width);
        if (panel) break;
      }
      if (panel) break;
    }
    if (panel) epicPanel(panel, skin, materials, rng);
  }
}

export function giltPatches(gun, gold, agedGold) {
  const cast = sides(gun);
  for (const side of [-1, 1]) for (const [y, z, width, turn] of [[.018, .068, .027, -.22], [.016, -.104, .023, .16], [-.023, -.025, .018, -.18], [.010, -.223, .015, .3], [.014, .266, .016, -.24]]) {
    const panel = seat(gun, cast, side, y, z, width, .30, turn);
    if (!panel) continue;
    plate(panel, [[-.91, -.19], [-.67, .09], [-.35, .10], [-.18, .27], [.17, .18], [.33, .29], [.87, .06], [.65, -.18], [.23, -.29], [-.16, -.22], [-.44, -.31]], agedGold, .10, .032);
    plate(panel, [[-.79, -.12], [-.53, .04], [-.27, .09], [-.14, .20], [.17, .12], [.34, .22], [.75, .05], [.55, -.11], [.23, -.23], [-.15, -.16], [-.43, -.23]], gold, .185, .021);
    ridge(panel, [[-.65, -.09], [-.23, -.034], [.05, .06], [.45, .04], [.58, .07]], agedGold, .020, .19);
  }
}
