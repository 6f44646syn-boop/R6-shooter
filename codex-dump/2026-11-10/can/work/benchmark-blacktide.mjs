import {createRequire} from 'node:module';
import {startServer} from 'file:///C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/continue-recoil-range-https-github-com/work/R6-shooter-battle-royale/tools/serve.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=await startServer(8175);
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto('http://127.0.0.1:8175/index.html?test');
  await page.waitForFunction(()=>window.__range?.ready);
  await page.locator('[data-first-profile=mouse]').click();
  await page.click('[data-mode=royale]');
  await page.evaluate(()=>{__range.manual(true);__range.setGraphics('high');let seed=147;Math.random=()=>((seed=Math.imul(1664525,seed)+1013904223>>>0)/4294967296);});
  await page.click('#setup-next');
  await page.waitForFunction(()=>__range.battle()?.royale);
  console.log(JSON.stringify(await page.evaluate(()=>{
    const R=__range,b=R.battle(),a=b.arena,r=b.royale,h=b.humans[0];
    const samples=[];
    for(let i=0;i<6;i++){const t=performance.now();R.step(1,60);samples.push((performance.now()-t)/60);}
    for (const [i,bot] of b.bots.entries()) {
      bot.update = () => {};
      Object.assign(bot.f,{x:65,z:-45+i,y:0,vx:0,vz:0});
    }
    Object.assign(h.f,{x:5.5,y:0,z:0,vx:0,vy:0,vz:0,alive:true});h.camY=0;h.look.setAngles(0,0);r.materials=2;R.step(.05);R.renderFrame();
    const calls=R.renderer().info.render.calls;
    const t=performance.now();r.build(h.f,0);const placeMs=performance.now()-t;
    if(!r.walls.length)throw Error('benchmark wall missing');
    const start=performance.now();r.damageWall(r.walls[0],200);const destroyMs=performance.now()-start;
    return {stepMs:samples,drawCalls:calls,placeMs,destroyMs};
  })));
} finally {await browser?.close();server.close();}
