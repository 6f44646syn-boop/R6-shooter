import fs from 'node:fs';
const p='js/render/gpu-tex.js';let s=fs.readFileSync(p,'utf8');s=s.replace('r.x = clamp(r.x + finishRough * (0.5 + fbm(vUv, 128.0, 3)), 0.06, 1.0); r.y = clamp(r.y - finishMetal * m, 0.0, 1.0);', 'if (finishRough > 0.0) { r.x = clamp(r.x + finishRough * (0.5 + fbm(vUv, 128.0, 3)), 0.06, 1.0); r.y = clamp(r.y - finishMetal * m, 0.0, 1.0); }');fs.writeFileSync(p,s);
