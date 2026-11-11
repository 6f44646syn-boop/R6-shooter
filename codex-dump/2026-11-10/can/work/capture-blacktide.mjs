import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from 'file:///C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/continue-recoil-range-https-github-com/work/R6-shooter-battle-royale/tools/serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startServer(8174);
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
  const page = await browser.newPage({ viewport:{width:1600, height:1000}, deviceScaleFactor:1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8174/index.html?test');
  await page.waitForFunction(() => window.__range?.ready);
  await page.locator('[data-first-profile=mouse]').click();
  await page.click('[data-mode=royale]');
  await page.evaluate(() => {
    __range.manual(true);
    __range.setGraphics('high');
    document.querySelector('#b-voices').value = 'off';
    document.querySelector('#b-voices').dispatchEvent(new Event('change'));
  });
  await page.click('#setup-next');
  await page.waitForFunction(() => __range.battle()?.royale);
  await page.evaluate(() => {
    const R = __range, b = R.battle(), r = b.royale, h = b.humans[0], arena = b.arena;
    for (const bot of b.bots) bot.update = () => {};
    h.f.protectUntil = 0;
    for (const chest of r.chests.filter(c=>!c.pirate).slice(0,3)) {
      const loot = chest.position;
      Object.assign(h.f, {x:loot.x, y:loot.y-.31, z:loot.z});
      b.key('Interact', true);
    }
    if (r.materials < 4) throw Error('Chests did not supply enough stock');
    const place = (x, z) => {
      const y = arena.groundAt(x, z, 0);
      Object.assign(h.f, {x,y,z,vx:0,vy:0,vz:0});
      h.camY = y;
    };
    place(5.5, 0);
    h.look.setAngles(0, 0);
    b.key('KeyB', true);
    const wall = r.walls[0];
    if (!wall) throw Error('Wall placement failed');
    place(wall.mesh.position.x + .6, wall.mesh.position.z + 4.25);
    const aim = (x,y,z) => {
      const dx = x - h.f.x, dz = z - h.f.z;
      const pitch = Math.atan2(y - h.f.y - h.f.eyeH, Math.hypot(dx,dz)) * 180 / Math.PI;
      h.look.setAngles(Math.atan2(dx, -dz) * 180 / Math.PI, pitch);
      R.step(.05);
      R.renderFrame();
    };
    window.aimCapture = aim;
    r.noticeUntil = 0;
    aim(wall.mesh.position.x, wall.mesh.position.y, wall.mesh.position.z);
  });
  await page.screenshot({path:'C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/can/outputs/blacktide-building.png'});
  await page.evaluate(() => {
    const R = __range, b = R.battle(), r = b.royale, wall = r.walls[0], p = wall.mesh.position;
    b.key('OperatorAbility', true);
    if (r.editing !== wall) throw Error('Wall edit did not open');
    b.mouseButton(0, true);
    window.aimCapture(p.x, wall.box.minY + .45, p.z);
    b.mouseButton(0, false);
    window.aimCapture(p.x + .93, p.y + .9, p.z);
    if (r.editMask === wall.mask) throw Error('Edit mask did not change');
    R.renderFrame();
  });
  await page.screenshot({path:'C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/can/outputs/blacktide-editing.png'});
  for (const [kind,x,z] of [['ramp',14,16], ['cone',-14,16]]) {
    await page.evaluate(({kind,x,z}) => {
      const R = __range, b = R.battle(), r = b.royale, h = b.humans[0];
      r.cancelEdit();
      b.key('KeyZ',true);
      Object.assign(h.f,{x,y:0,z,vx:0,vy:0,vz:0});
      h.look.setAngles(0,0);
      b.key('KeyB',true);
      const piece = r.walls.at(-1), p = piece.mesh.position;
      if (piece.kind !== kind) throw Error('Could not stage the ' + kind);
      h.camera.position.set(p.x+.18, p.y+3.35, p.z+2.95);
      h.camera.lookAt(p.x-.6,p.y+.65,p.z-.6);
      b.key('OperatorAbility',true);
      if (r.editing !== piece) throw Error('Could not open the ' + kind + ' editor');
      b.mouseButton(0,true);
      b.mouseButton(0,false);
      h.camera.lookAt(p.x+.3,p.y+.5,p.z-.16);
      r.updateHud();
      R.renderFrame();
      if (r.editMask === piece.mask) throw Error('No panel selected in the ' + kind + ' editor');
    }, {kind,x,z});
    await page.screenshot({path:'C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/can/outputs/blacktide-'+kind+'-edit.png'});
  }
  await page.setViewportSize({width:1600,height:1100});
  await page.evaluate(async () => {
    const THREE = await import('/vendor/three/three.module.min.js?v=9dd0f7b-mwbioun8');
    const R = __range, b = R.battle(), r = b.royale, a = b.arena;
    r.cancelEdit();
    for (const f of b.fighters) f.group.visible = false;
    for (const wall of r.walls) wall.mesh.visible = false;
    r.ring.visible = false;
    if (a.sky) a.sky.visible = false;
    a.scene.fog = null;
    a.scene.background = new THREE.Color('#101b23');
    b.hud.root.hidden = true;
    const h = 74, w = h * innerWidth / innerHeight;
    const camera = new THREE.OrthographicCamera(-w,w,h,-h,.1,500);
    camera.position.set(0,170,0);
    camera.up.set(0,0,-1);
    camera.lookAt(0,0,0);
    const renderer = R.renderer();
    b.render = () => {
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setViewport(0,0,renderer.domElement.width,renderer.domElement.height);
      renderer.autoClear = true;
      renderer.shadowMap.autoUpdate = true;
      renderer.render(a.scene, camera);
    };
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;font-family:Inter,Segoe UI,sans-serif;color:#eff6fa';
    document.body.append(overlay);
    const add = (str, css) => {
      const e = document.createElement('div');
      e.textContent = str;
      e.style.cssText = 'position:absolute;' + css;
      overlay.append(e);
      return e;
    };
    const point = (x,z) => [innerWidth*(.5+x/(w*2)),innerHeight*(.5+z/(h*2))];
    const [left, top] = point(-a.hx,-a.hz);
    const [right,bottom] = point(a.hx,a.hz);
    add('', 'left:'+left+'px;top:'+top+'px;width:'+(right-left)+'px;height:'+(bottom-top)+'px;border:1px solid #a3a496;box-sizing:border-box');
    add('BLACKTIDE', 'left:26px;top:76px;font-size:24px;font-weight:800;letter-spacing:1.3px');
    add('ISLAND', 'left:26px;top:105px;font-size:24px;font-weight:800;letter-spacing:1.3px');
    add('160 × 128 m', 'left:26px;top:150px;font-size:15px;color:#a5b9c6');
    add('Battle Royale', 'left:26px;top:174px;font-size:15px;color:#a5b9c6');
    for (const c of r.chests) {
      const [x,y] = point(c.position.x,c.position.z);
      add('', 'left:'+x+'px;top:'+y+'px;width:8px;height:8px;border:1px solid #3b290f;border-radius:50%;background:#f2c464;transform:translate(-50%,-50%);box-shadow:0 0 4px #1e170b');
    }
    for (const [name,x,z] of [['Shipwreck',-45,-38],['Container Docks',46,-42],['Village',-44,34],['Quarry',48,33],['Central Fort',0,-2]]) {
      const [sx,sy] = point(x,z);
      add(name, 'left:'+sx+'px;top:'+sy+'px;transform:translate(-50%,-50%);font-size:15px;font-weight:650;padding:5px 9px;border-radius:4px;background:#14212bea;border:1px solid #677c86;white-space:nowrap');
    }
    add('●', 'left:26px;bottom:116px;color:#f2c464;font-size:15px');
    add('Loot chest', 'left:46px;bottom:116px;color:#c1d1dc;font-size:15px');
    add('■', 'left:26px;bottom:91px;color:#718355;font-size:14px');
    add('Hill', 'left:46px;bottom:91px;color:#c1d1dc;font-size:15px');
    add('↑  N', 'right:36px;top:76px;font-size:21px;font-weight:700;letter-spacing:2px');
    add('20 m', 'right:37px;bottom:112px;font-size:14px;color:#c1d1dc');
    add('', 'right:37px;bottom:96px;width:'+(20*innerHeight/(2*h))+'px;height:6px;border:1px solid #c1d1dc;border-top:0');
    R.renderFrame();
  });
  await page.screenshot({path:'C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/can/outputs/blacktide-overhead.png'});
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.close();
}
