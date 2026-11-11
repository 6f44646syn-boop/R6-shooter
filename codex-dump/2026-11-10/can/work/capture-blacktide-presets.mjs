import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from 'file:///C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/continue-recoil-range-https-github-com/work/R6-shooter-battle-royale/tools/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startServer(8176);
let browser;
try {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM });
  const page = await browser.newPage({viewport:{width:1400,height:870},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8176/index.html?test');
  await page.waitForFunction(()=>window.__range?.ready);
  await page.locator('[data-first-profile=mouse]').click();
  const installed = await page.evaluate(async () => __range.hdInstall());
  assert.ok(installed.ok,JSON.stringify(installed));
  await page.click('[data-mode=royale]');
  await page.evaluate(()=>__range.manual(true));
  await page.click('#setup-next');
  await page.waitForFunction(()=>__range.battle()?.royale);
  await page.evaluate(async () => {
    const {PerspectiveCamera} = await import('/vendor/three/three.module.min.js?v=9dd0f7b-mwbioun8');
    const R=__range,b=R.battle(),a=b.arena,renderer=R.renderer();
    const cam=new PerspectiveCamera(58,innerWidth/innerHeight,.05,200);
    cam.position.set(-35,6.3,55);
    cam.lookAt(-45,1.65,39);
    b.hud.root.hidden=true;
    for (const f of b.fighters) f.group.visible=false;
    b.royale.ring.visible=false;
    b.render=()=>{
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setViewport(0,0,renderer.domElement.width,renderer.domElement.height);
      renderer.autoClear=true;
      renderer.shadowMap.autoUpdate=false;
      renderer.render(a.scene,cam);
    };
  });
  const modes = [
    ['low','Low','Landmarks and trails'],
    ['standard','Standard','Grass and scattered stones'],
    ['high','High','Denser grass and wildflowers'],
    ['ultra','Ultra','Full ground detail'],
  ];
  const tiles=[];
  for (const [id,label,desc] of modes) {
    const info = await page.evaluate(q=>{
      const R=__range,b=R.battle();
      R.setGraphics(q);
      b.refreshGraphics();
      R.renderer().shadowMap.needsUpdate=true;
      R.renderFrame();
      return {preset:b.arena.quality,effective:R.hdState().effective,instances:b.arena.detailBatches.reduce((n,v)=>n+v.mesh.count,0)};
    },id);
    assert.equal(info.preset,id);
    assert.equal(info.effective,id);
    console.log(JSON.stringify(info));
    tiles.push({label,desc,png:(await page.screenshot()).toString('base64')});
  }
  await page.setViewportSize({width:1920,height:1280});
  await page.evaluate(async tiles=>{
    const board=document.createElement('canvas');
    board.width=1920;board.height=1280;
    board.style.cssText='position:fixed;inset:0;z-index:10000;width:1920px;height:1280px';
    const c=board.getContext('2d');
    c.fillStyle='#111b22';c.fillRect(0,0,1920,1280);
    c.fillStyle='#eaf2f6';c.font='700 30px Segoe UI';c.fillText('Blacktide Island',30,44);
    c.fillStyle='#a5bac7';c.font='18px Segoe UI';c.fillText('Graphics presets · same camera',30,73);
    await Promise.all(tiles.map(async ({label,desc,png},i)=>{
      const img=new Image();
      img.src='data:image/png;base64,'+png;
      await img.decode();
      const x=30+i%2*938,y=100+Math.floor(i/2)*586;
      c.drawImage(img,x,y,922,553);
      c.fillStyle='#16232de8';c.fillRect(x,y+507,922,46);
      c.fillStyle='#f3f7f9';c.font='700 20px Segoe UI';c.fillText(label,x+14,y+537);
      c.fillStyle='#bed0dc';c.font='17px Segoe UI';c.fillText(desc,x+143,y+536);
    }));
    document.body.append(board);
  },tiles);
  await page.screenshot({path:'C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/can/outputs/blacktide-graphics-presets.png'});
  assert.deepEqual(errors,[]);
} finally {await browser?.close();server.close();}
