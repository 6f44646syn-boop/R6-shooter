// Studio shots of a skin: the gun alone on a dark backdrop, side on and at an angle (installs the Enhanced pack from the local server first).
// node tools/skin-studio.mjs <out dir> [skin id, default 900] [gun indices, default 0,1,2]
import { startServer } from './serve.mjs';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [OUT, SKIN = '900', GUNS = '0,1,2'] = process.argv.slice(2);
const server = await startServer(8125);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://127.0.0.1:8125/index.html?test&seed=1234', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__range?.ready); await page.locator('[data-first-profile=mouse]').click();
for (const gi of GUNS.split(',').map(Number)) {
  const shots = await page.evaluate(async ([gi, skin]) => {
    const v = [...document.querySelectorAll('script[type=module]')].map((s) => s.src).join(' ').match(/v=([\w-]+)/);
    const THREE = await import('/vendor/three/three.module.min.js?v=' + (v ? v[1] : ''));
    const R = window.__range, rig = R.rigObj(), r = R.renderer();
    R.manual(true); if (window.__packOk === undefined) window.__packOk = (await R.hdInstall()).ok; R.setGraphics('ultra'); rig.noHands = true; rig.forceSkin = skin; R.selectGun(gi); R.step(0.3, 30);
    const gun = rig.current.userData.gun, name = R.guns[gi].name;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x1d1e22);
    gun.removeFromParent(); gun.position.set(0, 0, 0); gun.quaternion.identity(); gun.scale.setScalar(1);
    const holder = new THREE.Group(); holder.add(gun); scene.add(holder);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x202024, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(-1, 2, 2); scene.add(key);
    const rim = new THREE.DirectionalLight(0xcfe6ff, 2.0); rim.position.set(1.5, 1, -2); scene.add(rim);
    const out = [];
    for (const [ry, rx] of [[Math.PI / 2, 0], [Math.PI / 2 + 0.55, 0.18]]) {
      holder.rotation.set(rx, ry, 0); holder.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(gun), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
      const cam = new THREE.PerspectiveCamera(24, 4 / 3, 0.01, 20);
      const dist = Math.max(s.x, s.y * 1.33) / (2 * Math.tan(12 * Math.PI / 180)) * 0.78;
      cam.position.set(c.x, c.y, c.z + dist + s.z / 2); cam.lookAt(c);
      r.setRenderTarget(null); r.setSize(1024, 768, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
      for (let i = 0; i < 3; i++) r.render(scene, cam);
      out.push(r.domElement.toDataURL('image/png'));
    }
    return { name, out, pack: window.__packOk };
  }, [gi, Number(SKIN)]);
  shots.out.forEach((d, i) => writeFileSync(`${OUT}/g${gi}-${i}.png`, Buffer.from(d.split(',')[1], 'base64')));
  console.log(gi, shots.name, 'pack', shots.pack);
}
console.log('errors', JSON.stringify(errs.slice(0, 5)));
await browser.close(); server.close();
