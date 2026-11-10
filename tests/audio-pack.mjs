import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseAudioPack } from '../js/audio/audio-pack.js';
const bytes = readFileSync(
  new URL('../packs/audio/recoil-range-audio-v1.rra', import.meta.url),
);
const parsed = parseAudioPack(bytes),
  m = parsed.manifest;
let count = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  count++;
  console.log('PASS ' + name);
};
check(
  'download pack has 83 mono 48 kHz clips',
  m.clips.length === 83 && m.channels === 1 && m.sampleRate === 48000,
);
const source = createHash('sha256');
for (const p of ['js/audio/sfx.js', 'rust/m8_audio/src/lib.rs'])
  source.update(readFileSync(new URL('../' + p, import.meta.url)));
check(
  'pack was baked from the current sound source',
  m.sourceSha256 === source.digest('hex'),
);
const guns = JSON.parse(
  readFileSync(new URL('../data/guns.json', import.meta.url)),
).guns;
check(
  'all current weapon tones are present',
  guns.every((g) =>
    m.clips.some((c) => c.key === 'shot:' + (g.tone ?? 0.5).toFixed(3)),
  ),
);
check(
  'every supported ground material has three variants',
  [
    'concrete',
    'wood',
    'metal',
    'carpet',
    'snow',
    'soil',
    'stone',
    'tile',
  ].every((k) => m.clips.filter((c) => c.key === 'step:' + k).length === 3),
);
check(
  'M4 barbed-wire bank is included',
  m.clips.filter((c) => c.key === 'wire').length === 2,
);
const samples = (c) =>
  parsed.bytes.subarray(
    parsed.payloadAt + c.offset,
    parsed.payloadAt + c.offset + c.frames * 2,
  );
check(
  'shot and step variants contain different source samples',
  ['shot:0.500', 'step:wood', 'step:metal'].every(
    (k) =>
      new Set(
        m.clips
          .filter((c) => c.key === k)
          .map((c) => createHash('sha256').update(samples(c)).digest('hex')),
      ).size === 3,
  ),
);
function repack(manifest) {
  const json = Buffer.from(JSON.stringify(manifest)),
    header = Buffer.alloc(16),
    padding = Buffer.alloc((4 - (json.length % 4)) % 4),
    pcm = bytes.subarray(parsed.payloadAt);
  header.write('RRAUDIO1');
  header.writeUInt32LE(json.length, 8);
  header.writeUInt32LE(pcm.length, 12);
  return Buffer.concat([header, json, padding, pcm]);
}
const corruptions = [
  ['truncation', () => bytes.subarray(0, bytes.length - 1)],
  [
    'wrong signature',
    () => {
      const b = Buffer.from(bytes);
      b[0] = 0;
      return b;
    },
  ],
  [
    'duplicate identifiers',
    () => {
      const v = structuredClone(m);
      v.clips[1].id = v.clips[0].id;
      return repack(v);
    },
  ],
  [
    'overlapping PCM',
    () => {
      const v = structuredClone(m);
      v.clips[1].offset = v.clips[0].offset;
      return repack(v);
    },
  ],
  [
    'out-of-bounds PCM',
    () => {
      const v = structuredClone(m);
      v.clips[0].frames = 96001;
      return repack(v);
    },
  ],
  ['unsupported format', () => repack({ ...m, sampleRate: 960000 })],
  [
    'non-finite gain',
    () => {
      const v = structuredClone(m);
      v.clips[0].gain = null;
      return repack(v);
    },
  ],
];
for (const [name, build] of corruptions) {
  assert.throws(() => parseAudioPack(build()));
  check('rejects ' + name, true);
}
const sums = readFileSync(
  new URL('../packs/audio/SHA256SUMS', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n');
for (const line of sums) {
  const [hash, name] = line.split(/\s+/, 2);
  const file = readFileSync(new URL('../packs/audio/' + name, import.meta.url));
  assert.equal(createHash('sha256').update(file).digest('hex'), hash);
}
check(
  'download archive and runtime file match published checksums',
  sums.length === 2,
);
console.log(`${count} optional audio pack checks passed`);
