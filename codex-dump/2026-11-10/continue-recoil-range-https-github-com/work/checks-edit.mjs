import fs from 'node:fs';
const edit=(p,fn)=>fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));
edit('tools/build-hd.mjs',s=>s.replace("const only = process.argv.includes('--manifest')", "if (process.argv.includes('--surfaces')) { await import('./hd/soldier.mjs'); await import('./build-pack-surfaces.mjs'); }\n\nconst only = (process.argv.includes('--manifest') || process.argv.includes('--surfaces'))"));
edit('package.json',s=>{const p=JSON.parse(s);p.scripts['test:enhanced-pack']='node tests/pack-assets.mjs && node tests/pack-integration.mjs';p.scripts['build:enhanced-surfaces']='node tools/build-hd.mjs --surfaces';return JSON.stringify(p,null,2)+'\n';});
edit('.github/workflows/m7-controls.yml',s=>s.replace("      - 'packs/audio/**'", "      - 'packs/audio/**'\n      - 'hd/**'\n      - 'js/render/**'\n      - 'js/scene/**'")+`      - name: Check Enhanced Graphics integration
        run: NODE_PATH="$RUNNER_TEMP/recoil-range-test-tools/node_modules" npm run test:enhanced-pack
`);
