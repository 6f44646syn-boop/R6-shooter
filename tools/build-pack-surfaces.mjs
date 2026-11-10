// Bake sharper versions of the existing authored map patterns; add restrained material grain.
// Uses external Playwright only, never a shipped dependency.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer } from './serve.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=await startServer(8154), browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM||undefined});
const root=new URL('../hd/materials/',import.meta.url);mkdirSync(root,{recursive:true});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:8154/tests/unit.html');
 for(const name of ['concrete','wood','metal','house','tiles','carpet','stone','deck'])for(const size of [512,1024]){
 const data=await page.evaluate(async({name,size})=>{
  const {bakeMapSurface}=await import('/js/modes/look.js?v=m6-integration');
  const t=bakeMapSurface(name,8),cv=document.createElement('canvas');cv.width=cv.height=size;
  const g=cv.getContext('2d');g.drawImage(t.image,0,0,size,size);t.dispose();
  const im=g.getImageData(0,0,size,size),d=im.data;let seed=9173;
  const wood=name==='wood'||name==='deck';
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   const u=x/size,v=y/size,grain=wood? Math.sin(u*804.2477+Math.sin(v*25.1327)*2+Math.sin(v*6.28318)*3)*2.7 : name==='metal'?Math.sin(v*1608.495)*1.7:name==='carpet'?Math.sin(u*3216.99)*Math.cos(v*3216.99)*2.2:0;
   const noise=(seed/4294967296-.5)*(name==='house'?2:5),i=(y*size+x)*4;
   for(let c=0;c<3;c++)d[i+c]=Math.max(0,Math.min(255,d[i+c]+grain+noise));
  }
  g.putImageData(im,0,0);return cv.toDataURL('image/png').split(',')[1];
 },{name,size});writeFileSync(new URL(`${name}-${size}.png`,root),Buffer.from(data,'base64'));
 }
 writeFileSync(new URL('finish.json',root),JSON.stringify({version:1,grain:0.014,roughnessVariation:0.045,paintMetalReduction:0.12,wear:0.85})+'\n');
}finally{await browser.close();server.close();}
console.log('Authored 16 map surfaces and bounded finish parameters');
