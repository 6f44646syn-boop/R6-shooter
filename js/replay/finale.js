import * as THREE from '../../vendor/three/three.module.min.js?v=c21a8fc-mwdidpy7';

export class MatchFinale {
  constructor(end, table) {
    this.end = end;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111b27);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.03, 100);
    this.lineup = new THREE.Group();
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 5, 4);
    this.scene.add(new THREE.HemisphereLight(0xddeaff, 0x404556, 2), key, this.lineup);
    this.size = new THREE.Vector2();

    this.names = document.createElement('p');
    this.names.className = 'b-lineup-names';
    table.before(this.names);
    this.replayBar = document.createElement('div');
    this.replayBar.className = 'b-finale-replay';
    this.replayBar.hidden = true;
    this.label = document.createElement('strong');
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.textContent = 'Skip';
    skip.addEventListener('click', () => { this.finish(); end.querySelector('.b-end-box button:not([hidden])')?.focus(); });
    this.replayBar.append(this.label, skip);
    end.append(this.replayBar);
  }

  reset() {
    this.active = false;
    this.lineup.clear();
    this.names.textContent = '';
    this.replayBar.hidden = true;
    delete this.end.dataset.finale;
  }

  // flex: you won; after the replay your own view plays your weapon inspect, then the results.
  begin(t, entrants, clip, flex = false) {
    this.reset();
    this.active = true;
    this.flex = flex;
    const visible = entrants.slice(0, 6);
    visible.forEach(({ figure, name }, i) => {
      if (!figure) return;
      // Share the actor's render assets, without copying HUD sprites or effects.
      const model = new THREE.Group();
      model.add(figure.body.clone());
      for (const leg of figure.legs) {
        const pivot = leg.piv.clone(false);
        pivot.rotation.set(0, 0, 0);
        pivot.add(leg.piv.children[0].clone());
        model.add(pivot);
      }
      if (figure._gunModel) {
        const mount = figure.gunG.clone(false);
        mount.rotation.set(0, 0, 0);
        mount.add(figure._gunModel.clone());
        model.add(mount);
      }
      model.position.x = (i - (visible.length - 1) / 2) * 1.03;
      this.lineup.add(model);
    });
    this.names.textContent = visible.map(entry => entry.name).join(' · ');
    if (!clip) { if (flex) this._flex(t); else this.finish(); return; }
    this.until = t + clip.seconds;
    this.label.textContent = 'Final kill · ' + clip.name;
    this.end.dataset.finale = 'replay';
    this.replayBar.hidden = false;
  }

  finish() {
    this.end.dataset.finale = 'results';
    this.replayBar.hidden = true;
  }
  _flex(t) {
    this.end.dataset.finale = 'flex';
    this.until = t + 8;                       // at most; the game ends it when the inspect is done
    this.label.textContent = 'Victory';
    this.replayBar.hidden = false;
  }

  replaying(t) {
    if (this.end.dataset.finale !== 'replay') return false;
    if (t < this.until) return true;
    if (this.flex) this._flex(t); else this.finish();
    return false;
  }
  flexing(t) {
    if (this.end.dataset.finale !== 'flex') return false;
    if (t < this.until) return true;
    this.finish();
    return false;
  }

  render(renderer) {
    if (!this.active || this.end.dataset.finale !== 'results') return false;
    const { x: width, y: height } = renderer.getSize(this.size);
    const lineupHeight = Math.max(1, Math.floor(height * 0.51));
    const aspect = width / lineupHeight;
    const distance = Math.max(3.6, (1.03 * this.lineup.children.length + 0.5) / (0.57 * aspect));
    this.camera.aspect = aspect;
    this.camera.position.set(0, 1.35, distance);
    this.camera.lookAt(0, 0.93, 0);
    this.camera.updateProjectionMatrix();
    renderer.info.reset();
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    renderer.clear();
    renderer.setViewport(0, height - lineupHeight, width, lineupHeight);
    renderer.render(this.scene, this.camera);
    renderer.setViewport(0, 0, width, height);
    return true;
  }
}
