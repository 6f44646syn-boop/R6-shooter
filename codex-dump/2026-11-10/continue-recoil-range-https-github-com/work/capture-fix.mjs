import fs from 'node:fs';
const edit=(p,fn)=>fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));
edit('js/render/pack-art.js',s=>s.replace("new Blob([bytes], {type:'image/png'}))","new Blob([bytes], {type:'image/png'}), { imageOrientation: 'flipY' })"));
edit('js/scene/viewmodel.js',s=>s.replace("'|skin' + skin.id + '@'", "'|skin' + skin.id + ':' + (packArt.finish ? packArt.revision : 0) + '@'"));
edit('tools/compare-pack.mjs',s=>s.replace("const t=Date.now();",`await page.route('**/js/main.js*', async route => { const response=await route.fetch(); let body=await response.text(); body=body.replace('    perf.beginGpu();\\n    renderFrame();', '    if (window.__captureOnly) return;\\n    perf.beginGpu();\\n    renderFrame();'); await route.fulfill({response,body}); });
 const t=Date.now();`).replace("__range.setSetting('renderScale',1);", "__range.setUltraTex(2048);__range.setSetting('renderScale',1);").replace("__range.manual(true);", "__range.manual(true);window.__captureOnly=true;"));
edit('packs/audio/SHA256SUMS',s=>s.replace(/\r\n/g,'\n'));
