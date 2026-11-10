// Original sound-pack authoring tool. Uses existing external Playwright, no project dependency.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { startServer } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const output = resolve(process.argv[2] || 'work/audio-pack');
mkdirSync(join(output, 'clips'), { recursive: true });
const server = await startServer(8153);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
let rendered;
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8153/tests/unit.html');
  rendered = await page.evaluate(async () => {
    const { createAcoustics, MATERIALS } =
      await import('/js/audio/acoustics.js?v=m8-audio-1');
    const { Sfx } = await import('/js/audio/sfx.js?v=m8-audio-1');
    const acoustic = await createAcoustics();
    const guns = (await (await fetch('/data/guns.json')).json()).guns;
    const tones = [
      ...new Set([...guns.map((g) => g.tone ?? 0.5), 0.02, 0.05, 0.15]),
    ].sort((a, b) => a - b);
    const profiles = {},
      jobs = [];
    for (const tone of tones)
      for (let variant = 0; variant < 3; variant++)
        jobs.push({
          key: 'shot:' + tone.toFixed(3),
          variant,
          kind: 'shot',
          tone,
        });
    for (let material = 1; material < MATERIALS.length; material++) {
      acoustic.e.ma_mix(1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, material);
      const f = acoustic.f;
      const profile = {
        material: MATERIALS[material],
        hz: f[10],
        q: f[11],
        duration: f[12],
        ring: f[13],
      };
      profiles[profile.material] = profile;
      for (let variant = 0; variant < 3; variant++)
        jobs.push({
          key: 'step:' + profile.material,
          variant,
          kind: 'step',
          profile,
        });
    }
    for (const kind of [
      'knife',
      'zap',
      'crack',
      'jam',
      'radio',
      'click',
      'reload',
      'vault',
      'switch',
      'wire',
    ])
      for (let variant = 0; variant < 2; variant++)
        jobs.push({ key: kind, variant, kind });
    const clips = [];
    const originalRandom = Math.random;
    for (let index = 0; index < jobs.length; index++) {
      const job = jobs[index],
        context = new OfflineAudioContext(1, 48000, 48000),
        sfx = new Sfx(acoustic);
      sfx._setup(context);
      // Bake the source once, without panning, master volume or the live limiter.
      sfx.master.disconnect();
      sfx.master.gain.value = 1;
      sfx.master.connect(context.destination);
      Object.defineProperty(context, 'createStereoPanner', {
        value: undefined,
      });
      let seed = (0x6a09e667 + index * 0x9e3779b9) >>> 0;
      Math.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      if (job.kind === 'shot') sfx.shot(job.tone, 1);
      else if (job.kind === 'step') sfx.step(1, 0, 0, job.profile);
      else sfx[job.kind === 'switch' ? 'weaponSwitch' : job.kind](1);
      Math.random = originalRandom;
      for (const voice of sfx.voices) voice.input.gain.value = 1;
      const data = (await context.startRendering()).getChannelData(0);
      let last = 0,
        peak = 0;
      for (let i = 0; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i]));
        if (Math.abs(data[i]) > 1e-6) last = i;
      }
      if (!peak) throw Error('Silent source ' + job.key);
      const frames = Math.min(data.length, last + 257),
        gain = peak / 0.98,
        pcm = new Uint8Array(frames * 2),
        view = new DataView(pcm.buffer);
      for (let i = 0; i < frames; i++)
        view.setInt16(
          i * 2,
          Math.round(Math.max(-1, Math.min(1, data[i] / gain)) * 32767),
          true,
        );
      let binary = '';
      for (let i = 0; i < pcm.length; i += 8192)
        binary += String.fromCharCode(...pcm.subarray(i, i + 8192));
      clips.push({
        id: job.key + ':' + job.variant,
        key: job.key,
        variant: job.variant,
        frames,
        gain,
        data: btoa(binary),
      });
    }
    return { clips, profiles, renderer: navigator.userAgent };
  });
} finally {
  await browser.close();
  server.close();
}
const source = createHash('sha256');
for (const file of ['js/audio/sfx.js', 'rust/m8_audio/src/lib.rs'])
  source.update(readFileSync(file));
const manifest = {
  version: 1,
  name: 'Recoil Range original audio pack',
  sampleRate: 48000,
  channels: 1,
  format: 'pcm_s16le',
  license:
    'Original synthesized Recoil Range sounds; no third-party recordings.',
  sourceSha256: source.digest('hex'),
  profiles: rendered.profiles,
  clips: [],
};
const payload = [];
let offset = 0;
function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF');
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(48000, 24);
  h.writeUInt32LE(96000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
for (const clip of rendered.clips) {
  const pcm = Buffer.from(clip.data, 'base64'),
    { data, ...metadata } = clip;
  manifest.clips.push({ ...metadata, offset });
  payload.push(pcm);
  offset += pcm.length;
  writeFileSync(
    join(output, 'clips', clip.id.replaceAll(':', '_') + '.wav'),
    wav(pcm),
  );
}
const json = Buffer.from(JSON.stringify(manifest)),
  head = Buffer.alloc(16),
  padding = Buffer.alloc((4 - (json.length % 4)) % 4);
head.write('RRAUDIO1');
head.writeUInt32LE(json.length, 8);
head.writeUInt32LE(offset, 12);
const pack = Buffer.concat([head, json, padding, ...payload]);
writeFileSync(join(output, 'recoil-range-audio-v1.rra'), pack);
writeFileSync(
  join(output, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
writeFileSync(
  join(output, 'build.json'),
  JSON.stringify(
    {
      bytes: pack.length,
      clips: manifest.clips.length,
      sha256: createHash('sha256').update(pack).digest('hex'),
      renderer: rendered.renderer,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Built ${manifest.clips.length} original clips, ${pack.length} bytes: ${output}`,
);
