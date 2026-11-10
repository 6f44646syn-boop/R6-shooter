// Builds the Enhanced Graphics pack (hd/): detailed gun models with baked ambient occlusion
// and edge masks, compressed, plus the manifest the game downloads first.
//   node tools/build-hd.mjs            all guns
//   node tools/build-hd.mjs carbine ak  only these (the manifest is rewritten from what is on disk)
//   node tools/build-hd.mjs --manifest  only rewrite the manifest
// Files are gzipped .rrmz (not .gz, so no server sends them with a gzip transfer encoding,
// which would change the bytes the browser checks).
// The pack has its own version (PACK_VERSION): bump it when its content changes, so players
// who installed it are offered the update.
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { setDetail } from './hd/kit.mjs';
import { bake } from './hd/bake.mjs';
import { writeRRM } from './hd/format.mjs';
import { GUNS } from './hd/guns.mjs';

export const PACK_VERSION = 2;
const ROOT = new URL('../hd/', import.meta.url);
mkdirSync(new URL('guns/', ROOT), { recursive: true });

const only = process.argv.includes('--manifest') ? ['--none--'] : process.argv.slice(2);
const LODS = [
  { L: 0.012, R: 0.003, rays: 40, maxD: 0.06 },     // first person
  { L: 0.05, R: 0.006, rays: 20, maxD: 0.06 },      // carried by other players
];
for (const name of Object.keys(GUNS)) {
  if (only.length && !only.includes(name)) continue;
  const t0 = Date.now();
  const lods = [];
  let anchors = null;
  for (let l = 0; l < LODS.length; l++) {
    setDetail(l);
    const built = GUNS[name]();
    anchors = built.anchors;
    lods.push(bake(built.m, LODS[l]));
  }
  const raw = writeRRM(lods, { name, anchors });
  const gz = gzipSync(raw, { level: 9 });
  writeFileSync(new URL('guns/' + name + '.rrmz', ROOT), gz);
  const tris = lods.map((lod) => lod.reduce((s, p) => s + p.idx.length / 3, 0));
  console.log(name.padEnd(14), 'tris', tris.join(' / ').padEnd(16), 'raw', (raw.length / 1024).toFixed(0) + ' KB', 'gz', (gz.length / 1024).toFixed(0) + ' KB', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}

// Manifest: every file with its size and SHA-256 (the game checks each download).
mkdirSync(new URL('audio/', ROOT), { recursive: true });
writeFileSync(new URL('audio/recoil-range-audio-v1.rra', ROOT), readFileSync(new URL('../packs/audio/recoil-range-audio-v1.rra', import.meta.url)));
const files = [];
const paths = [];
function walk(dir = '') { for (const f of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) { const p = dir + f.name; if (f.isDirectory()) walk(p + '/'); else if (p !== 'manifest.json') paths.push(p); } }
walk();
for (const f of paths.sort()) {
  const b = readFileSync(new URL(f, ROOT));
  files.push({ path: f, size: b.length, sha256: createHash('sha256').update(b).digest('hex') });
}
const manifest = { name: 'Recoil Range Enhanced Graphics', version: PACK_VERSION, files, total: files.reduce((s, f) => s + f.size, 0) };
writeFileSync(new URL('manifest.json', ROOT), JSON.stringify(manifest, null, 1) + '\n');
console.log('manifest:', files.length, 'files,', (manifest.total / 1048576).toFixed(2), 'MB');
