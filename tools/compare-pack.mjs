// Repeatable paired capture: node tools/compare-pack.mjs <repo-root> <output-dir>
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
const root=resolve(process.argv[2]||'.'), out=resolve(process.argv[3]||'work/compare');mkdirSync(out,{recursive:true});
const {startServer}=await import(pathToFileURL(join(root,'tools/serve.mjs')));
const {chromium}=createRequire(import.meta.url)('playwright');
const server=await startServer(8156),browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM||undefined,args:['--js-flags=--expose-gc','--enable-precise-memory-info']});
const report={scenes:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/js/main.js*', async route => { const response=await route.fetch(); let body=await response.text(); body=body.replace('    perf.beginGpu();\n    renderFrame();', '    if (window.__captureOnly) return;\n    perf.beginGpu();\n    renderFrame();'); await route.fulfill({response,body}); });
 const t=Date.now();await page.goto('http://127.0.0.1:8156/index.html?test&seed=42');await page.waitForFunction(()=>window.__range?.ready);report.startupMs=Date.now()-t;await page.locator('[data-first-profile=mouse]').click();
 report.gpu=await page.evaluate(()=>{const gl=__range.renderer().getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
 const install=Date.now();report.install=await page.evaluate(()=>__range.hdInstall());report.installMs=Date.now()-install;
 await page.evaluate(()=>{__range.setUltraTex(2048);__range.setSetting('renderScale',1);__range.setGraphics('high');__range.setPost({ao:true,taa:false});__range.manual(true);window.__captureOnly=true;});
 for(const id of [4,173,192]){
  const url=await page.evaluate(id=>__range.skinShot(id,{w:1280,zoom:1.12}),id);if(url)writeFileSync(join(out,`skin-${id}.png`),Buffer.from(url.split(',')[1],'base64'));
 }
 for(const map of ['ranch','embassy','workshop'])for(const floor of ['ground','upper']){
  const result=await page.evaluate(async({map,floor})=>{
   const r=__range;await r.modeStart('bomb',{map:{bomb:map},seed:42,teamSize:2,side:'defend'});const m=r.modeGame();m.paused=true;
   const THREE=await import('/vendor/three/three.module.min.js?v=m6-integration');
   const rooms=m.map.data.callouts.filter(c=>c.floor&&(floor==='upper'?c.y>0:!c.y));const c=rooms[0]||m.map.data.callouts.find(c=>c.floor);
   const cam=new THREE.PerspectiveCamera(70,1280/720,.05,250);cam.position.set(c.x0+.8,(c.y||0)+1.6,c.z1-.8);cam.lookAt((c.x0+c.x1)/2,(c.y||0)+1.1,(c.z0+c.z1)/2);
   const renderer=r.renderer();const draw=()=>{renderer.info.reset();renderer.setRenderTarget(null);renderer.setViewport(0,0,1280,720);renderer.autoClear=true;m.deps.worldPost.draw(m.scene,cam);renderer.autoClear=false;};
   const warm=performance.now();draw();const warmupMs=performance.now()-warm;
   // Hide normal frame rendering while retaining requestAnimationFrame scheduling.
   const times=[],cpu=[];let last=performance.now();
   for(let i=0;i<150;i++){await new Promise(requestAnimationFrame);const now=performance.now();if(i>29)times.push(now-last);last=now;const a=performance.now();draw();if(i>29)cpu.push(performance.now()-a);}
   const textures=new Map();let vertices=0;const hash=[];
   m.lookGroup.traverse(o=>{const a=o.geometry?.attributes.position;if(a){vertices+=a.count;hash.push(...a.array);}for(const mat of o.material?[].concat(o.material):[]){for(const k of ['map','normalMap','bumpMap','roughnessMap']){const tx=mat[k];if(tx?.image)textures.set(tx.source,tx.image.width*tx.image.height*4*4/3);}}});
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Float32Array(hash)))).map(v=>v.toString(16).padStart(2,'0')).join('');
   draw();const screenshot=renderer.domElement.toDataURL();times.sort((a,b)=>a-b);cpu.sort((a,b)=>a-b);
   return {map,floor,room:c.name||c.id,position:cam.position.toArray(),warmupMs,frameMean:times.reduce((a,b)=>a+b,0)/times.length,frameP95:times[Math.floor(times.length*.95)],cpuMedian:cpu[Math.floor(cpu.length*.5)],calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory},textureBytes:[...textures.values()].reduce((a,b)=>a+b,0),mapVertices:vertices,mapHash:digest,screenshot};
  },{map,floor});
  writeFileSync(join(out,`${map}-${floor}.png`),Buffer.from(result.screenshot.split(',')[1],'base64'));delete result.screenshot;report.scenes.push(result);console.log(map,floor,result.frameMean.toFixed(2),result.calls);
 }
 report.repeatMemory=[];for(let i=0;i<4;i++){report.repeatMemory.push(await page.evaluate(async()=>{await __range.modeStart('bomb',{map:{bomb:'ranch'},seed:42,teamSize:2});__range.modeGame().paused=true;__range.renderFrame();globalThis.gc?.();return {...__range.renderer().info.memory,heap:performance.memory?.usedJSHeapSize};}));}
 // Close equipment study under identical lighting and camera, with no game hit-test changes.
 const soldier=await page.evaluate(async()=>{const T=await import('/vendor/three/three.module.min.js?v=m6-integration');const {Fighter}=await import('/js/battle/fighter.js?v=m6-integration');const f=new Fighter({color:0x5b8cff});f.setDetail?.('high');const scene=new T.Scene();scene.background=new T.Color(0x30353d);scene.add(new T.HemisphereLight(0xffffff,0x666666,2),f.group);const light=new T.DirectionalLight(0xffffff,3);light.position.set(2,3,4);scene.add(light);const cam=new T.PerspectiveCamera(35,1280/720,.01,10);cam.position.set(1,1.6,2.7);cam.lookAt(0,1.2,0);const r=__range.renderer();r.setRenderTarget(null);r.autoClear=true;r.render(scene,cam);const u=r.domElement.toDataURL();f.dispose();return u;});writeFileSync(join(out,'soldier.png'),Buffer.from(soldier.split(',')[1],'base64'));
}finally{writeFileSync(join(out,'metrics.json'),JSON.stringify(report,null,2));await browser.close();server.close();}
