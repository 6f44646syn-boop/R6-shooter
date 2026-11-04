// A simple blocky gun held in the lower right. Purely cosmetic; hidden while aiming down
// sights. It is a child of the camera, so it follows the view (including recoil punch).
import * as THREE from '../../vendor/three/three.module.min.js';

export class Viewmodel {
  constructor(camera) {
    this.group = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x2b2e33 });
    const mid = new THREE.MeshLambertMaterial({ color: 0x4a4f57 });
    const parts = [
      [mid, 0.05, 0.07, 0.42, 0, 0, 0],            // receiver
      [dark, 0.022, 0.022, 0.26, 0, 0.012, -0.32],  // barrel
      [dark, 0.035, 0.11, 0.05, 0, -0.08, 0.04],    // grip
      [dark, 0.03, 0.12, 0.06, 0, -0.08, -0.1],     // magazine
      [mid, 0.045, 0.06, 0.16, 0, -0.01, 0.26],     // stock
      [dark, 0.03, 0.03, 0.08, 0, 0.05, -0.02],     // sight
    ];
    for (const [mat, w, h, d, x, y, z] of parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      this.group.add(m);
    }
    this.base = new THREE.Vector3(0.16, -0.15, -0.36);
    this.group.scale.setScalar(0.7);
    this.group.position.copy(this.base);
    this.group.rotation.y = 0.06;
    camera.add(this.group);
    this.kick = 0;
  }

  shot() { this.kick = Math.min(1, this.kick + 0.6); }

  update(dt, visible) {
    this.group.visible = visible;
    // Exponential decay of the kick, independent of frame rate.
    this.kick *= Math.exp(-dt * 18);
    this.group.position.set(this.base.x, this.base.y + this.kick * 0.01, this.base.z + this.kick * 0.04);
    this.group.rotation.x = this.kick * 0.08;
  }
}
