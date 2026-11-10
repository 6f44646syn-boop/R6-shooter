// Joins the existing Enhanced Graphics lifecycle; owns no downloads or cache.
export function connectAudioPack(pack, sfx) {
  const path = 'audio/recoil-range-audio-v1.rra';
  let generation = 0, loaded = null, pending = null;
  const reset = () => { generation++; loaded = null; pending = null; sfx.removePack(); };
  async function sync() {
    const manifest = pack.ready && pack.installed;
    const file = manifest && manifest.files.find(f => f.path === path);
    if (!file) { reset(); return false; }
    if (!sfx.ctx) return false; // Only startLock's user gesture creates the AudioContext.
    if (loaded === file.sha256) return true;
    if (pending) return pending;
    const ticket = generation;
    pending = (async () => {
      try {
        const bytes = await pack.file(path);
        if (!bytes || ticket !== generation) return false;
        await sfx.installPack(bytes, () => ticket === generation && pack.ready);
        if (ticket !== generation) return false;
        loaded = file.sha256;
        return true;
      } catch { if (ticket === generation) sfx.removePack(); return false; }
      finally { if (ticket === generation) pending = null; }
    })();
    return pending;
  }
  const off = pack.onChange(() => { if (!pack.ready) reset(); else void sync(); });
  return { sync, dispose() { off(); reset(); } };
}
