// Redraw the shadow maps only when something that casts a shadow moved, appeared, vanished or
// was swapped (people, doors, dropped guns, lights). The same picture as redrawing every time: an
// unchanged scene draws an identical shadow map. With people's shadows on they move nearly every
// frame, so this mostly saves work when those are off (settings.botShadows) or nobody moves.
// Matrices are last frame's (render() updates them), so a move is seen one frame late; `every`
// frames is the cap the matches already used.
export class ShadowGate {
  constructor() { this.sig = NaN; this.dirty = true; this.n = 99; }   // (draws on the first frame)
  update(renderer, scene, every = 2) {
    renderer.shadowMap.autoUpdate = false;
    let s = 0, k = 0;
    scene.traverseVisible((o) => {
      if (!o.castShadow) return;
      const e = o.matrixWorld.elements;
      k++;
      s += k * (e[0] + e[1] * 3 + e[2] * 5 + e[5] * 7 + e[8] * 11 + e[10] * 13 + e[12] * 17 + e[13] * 19 + e[14] * 23) + o.id * 0.001;
      if (o.isInstancedMesh) s += k * (o.instanceMatrix.version + o.count * 7);
      if (o.target) { const t = o.target.matrixWorld.elements; s += k * (t[12] + t[13] * 3 + t[14] * 5); }
    });
    s += k * 1e6;
    if (s !== this.sig) { this.sig = s; this.dirty = true; }
    if (this.dirty && ++this.n >= every) { this.n = 0; this.dirty = false; renderer.shadowMap.needsUpdate = true; }
  }
}
