// Build the Weapon Skins pack (skinpack/) from a zip or folder of skin pictures with a MANIFEST.csv
// (weapon_slot, weapon, skin_id, skin_name, rarity, ..., relative_path): each picture is one catalogue skin
// on one gun, copied to skinpack/<slot>/<id>.webp, and skinpack/manifest.json lists every file with its
// size and SHA-256 (the game checks each download; js/render/hd-pack.js).
//   node tools/build-skin-pack.mjs <zip-or-folder>     replace the pack's pictures
//   node tools/build-skin-pack.mjs --manifest          only rewrite the manifest
// Bump PACK_VERSION when the pictures change, so players with the pack are offered the update.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PACK_VERSION = 3;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'skinpack');
const { skinById, skinFits, PACK_SIZE } = await import(pathToFileURL(join(ROOT, 'js/core/skins.js')).href);
const src = process.argv[2];

if (src !== '--manifest') {
  if (!src || !existsSync(src)) { console.error('usage: node tools/build-skin-pack.mjs <zip-or-folder> | --manifest'); process.exit(1); }
  let dir = src;
  if (statSync(src).isFile()) {        // Windows' own tar reads zip files
    dir = mkdtempSync(join(tmpdir(), 'skinpack-'));
    execFileSync(process.platform === 'win32' ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar', ['-xf', resolve(src), '-C', dir], { stdio: 'inherit' });
  }
  const find = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return f === 'MANIFEST.csv' ? [p] : statSync(p).isDirectory() ? find(p) : []; });
  const csv = find(dir)[0];
  if (!csv) { console.error('no MANIFEST.csv in ' + src); process.exit(1); }
  const [head, ...rows] = readFileSync(csv, 'utf8').trim().split(/\r?\n/).map((l) => l.split(','));
  const col = (n) => head.indexOf(n);
  const problems = [], seen = new Set(), take = [];
  // webp width and height from its header
  const dim = (b) => { const t = b.toString('ascii', 12, 16); if (t === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]; if (t === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; } return t === 'VP8 ' ? [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff] : null; };
  for (const r of rows) {
    const slot = +r[col('weapon_slot')], id = +r[col('skin_id')], rel = r[r.length - 1], file = join(dirname(csv), rel), s = skinById(id);
    const bad = (why) => problems.push(`${rel}: ${why}`);
    if (s?.rarity === 'blackice') continue;          // Black Ices are drawn by the game, not from a picture
    if (!existsSync(file)) { bad('missing'); continue; }
    if (!s || s.rarity === 'legendary' || s.art || id >= 1000) { bad(`skin ${id} is not a catalogue skin that takes a picture`); continue; }
    if (!skinFits(id, slot)) { bad(`${s.name} does not fit gun ${slot}`); continue; }
    if (seen.has(slot + '/' + id)) { bad('duplicate'); continue; }
    const b = readFileSync(file), d = dim(b);
    if (!d || d[0] !== PACK_SIZE[slot][0] || d[1] !== PACK_SIZE[slot][1]) { bad(`size ${d} (gun ${slot} pictures are ${PACK_SIZE[slot]}: the fit in js/core/skins.js assumes it)`); continue; }
    seen.add(slot + '/' + id); take.push([slot, id, b]);
  }
  console.log(`${rows.length} rows, ${take.length} pictures, ${problems.length} problems`);
  if (problems.length) { console.log(problems.slice(0, 40).join('\n')); process.exit(2); }
  rmSync(OUT, { recursive: true, force: true });
  for (const [slot, id, b] of take) { mkdirSync(join(OUT, String(slot)), { recursive: true }); writeFileSync(join(OUT, `${slot}/${id}.webp`), b); }
  if (dir !== src) rmSync(dir, { recursive: true, force: true });
}

// manifest: every file with its size and SHA-256
const files = [];
for (const slot of readdirSync(OUT).filter((f) => statSync(join(OUT, f)).isDirectory()).sort((a, b) => a - b))
  for (const f of readdirSync(join(OUT, slot)).sort((a, b) => parseInt(a) - parseInt(b))) {
    const b = readFileSync(join(OUT, slot, f));
    files.push({ path: `${slot}/${f}`, size: b.length, sha256: createHash('sha256').update(b).digest('hex') });
  }
const manifest = { name: 'Recoil Range Weapon Skins', version: PACK_VERSION, files, total: files.reduce((s, f) => s + f.size, 0) };
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log('manifest:', files.length, 'files,', (manifest.total / 1048576).toFixed(2), 'MB');
