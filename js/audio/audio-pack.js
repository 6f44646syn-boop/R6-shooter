// Optional original sound assets. This module never fetches a pack automatically.
const MAGIC = 'RRAUDIO1';
const MAX_BYTES = 16 * 1024 * 1024,
  MAX_CLIPS = 128;
export function parseAudioPack(input) {
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : null;
  if (!bytes || bytes.length < 16 || bytes.length > MAX_BYTES)
    throw Error('Invalid audio pack size.');
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC)
    throw Error('Unsupported audio pack signature.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(8, true),
    payloadLength = view.getUint32(12, true);
  if (jsonLength < 2 || jsonLength > 65536)
    throw Error('Invalid audio pack manifest size.');
  const payloadAt = (16 + jsonLength + 3) & ~3;
  if (payloadAt + payloadLength !== bytes.length)
    throw Error('Truncated audio pack.');
  let manifest;
  try {
    manifest = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(16, 16 + jsonLength),
      ),
    );
  } catch {
    throw Error('Invalid audio pack manifest.');
  }
  if (
    manifest.version !== 1 ||
    manifest.channels !== 1 ||
    manifest.format !== 'pcm_s16le' ||
    manifest.sampleRate !== 48000 ||
    !Array.isArray(manifest.clips) ||
    !manifest.clips.length ||
    manifest.clips.length > MAX_CLIPS
  )
    throw Error('Unsupported audio pack format.');
  const ids = new Set(),
    ranges = [];
  for (const c of manifest.clips) {
    if (
      typeof c.id !== 'string' ||
      !/^[-a-zA-Z0-9:._]{1,96}$/.test(c.id) ||
      ids.has(c.id) ||
      typeof c.key !== 'string' ||
      !/^[-a-zA-Z0-9:._]{1,80}$/.test(c.key)
    )
      throw Error('Invalid or duplicate audio clip identifier.');
    if (
      !Number.isInteger(c.offset) ||
      c.offset < 0 ||
      c.offset % 2 ||
      !Number.isInteger(c.frames) ||
      c.frames < 1 ||
      c.frames > 96000 ||
      c.offset + c.frames * 2 > payloadLength ||
      !Number.isFinite(c.gain) ||
      c.gain <= 0 ||
      c.gain > 4
    )
      throw Error('Invalid audio clip bounds or gain.');
    ids.add(c.id);
    ranges.push([c.offset, c.offset + c.frames * 2]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i][0] < ranges[i - 1][1])
      throw Error('Overlapping audio clips.');
  if (manifest.profiles) {
    for (const [material, p] of Object.entries(manifest.profiles)) {
      if (
        !/^[a-z]{1,16}$/.test(material) ||
        !p ||
        !['hz', 'q', 'duration', 'ring'].every((k) => Number.isFinite(p[k])) ||
        p.hz < 20 ||
        p.hz > 20000 ||
        p.q <= 0 ||
        p.q > 20 ||
        p.duration <= 0 ||
        p.duration > 1 ||
        p.ring < 0 ||
        p.ring > 20000
      )
        throw Error('Invalid footstep profile metadata.');
    }
  }
  return { bytes, view, manifest, payloadAt };
}
export async function decodeAudioPack(input, context) {
  const p = parseAudioPack(input),
    banks = new Map();
  let count = 0;
  for (const c of p.manifest.clips) {
    const buffer = context.createBuffer(1, c.frames, p.manifest.sampleRate),
      out = buffer.getChannelData(0);
    for (let i = 0; i < c.frames; i++)
      out[i] =
        (p.view.getInt16(p.payloadAt + c.offset + i * 2, true) / 32767) *
        c.gain;
    if (!banks.has(c.key)) banks.set(c.key, []);
    banks.get(c.key).push(buffer);
    if (++count % 8 === 0)
      await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const next = new Map();
  return {
    manifest: p.manifest,
    byteLength: p.bytes.length,
    clipCount: p.manifest.clips.length,
    pick(key) {
      const bank = banks.get(key);
      if (!bank) return null;
      const index = next.get(key) || 0;
      next.set(key, (index + 1) % bank.length);
      return bank[index];
    },
    supportsStep(profile) {
      const expected = p.manifest.profiles?.[profile.material];
      return (
        !!expected &&
        ['hz', 'q', 'duration', 'ring'].every(
          (k) => Math.abs(expected[k] - profile[k]) < 1e-9,
        )
      );
    },
  };
}
