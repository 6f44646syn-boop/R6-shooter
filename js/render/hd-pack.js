// The Enhanced Graphics pack: optional detailed gun models (and later more), needed for
// High and Ultra graphics. The player starts the download; nothing is fetched until then.
// Files come from this site (hd/, listed in hd/manifest.json with sizes and SHA-256),
// are checked, and are kept in the browser's Cache Storage so the pack works offline and
// is not downloaded again. The pack has its own version, so it can be updated without the
// game, and removed to free the space.
//
// state: 'none' (not installed), 'downloading', 'installed', 'update' (installed, newer one
// on the site), 'unsupported' (this browser cannot store or unpack it), 'error'.
import { parseRRM } from './hd-mesh.js?v=b7bb65d-mwd0pp62';

const BASE = new URL('../../hd/', import.meta.url);
const CACHE = 'recoil-range-hd';
const KEY = 'recoilRange.hdPack.v1';         // { version, total, files } of the installed pack

const listeners = new Set();
let memory = null;                          // no Cache Storage: files kept for this visit only
const meshes = new Map();                   // gun name -> parsed mesh (promise)

function readInstalled() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
function writeInstalled(v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } }
const hasCaches = () => typeof caches !== 'undefined' && typeof caches.open === 'function';
const canUnpack = () => typeof DecompressionStream === 'function' && typeof crypto !== 'undefined' && !!crypto.subtle;

export const HDPack = {
  state: 'none',
  installed: null,          // manifest of the installed pack
  remote: null,             // manifest on the site (after check())
  progress: { done: 0, total: 0, file: '' },
  error: '',
  persistent: true,         // false: kept for this visit only (no Cache Storage here)

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  _emit() { for (const fn of listeners) { try { fn(this); } catch (e) { console.error(e); } } },
  get ready() { return this.state === 'installed' || this.state === 'update'; },
  // Bytes to download (the site's pack, or the installed one's size before a check).
  get size() { return (this.remote || this.installed || { total: 0 }).total; },

  // At boot: what is installed (no network).
  async init() {
    if (!canUnpack()) { this.state = 'unsupported'; this._emit(); return this; }
    this.persistent = hasCaches();
    const inst = readInstalled();
    if (inst && this.persistent) {
      // Make sure the files are still there (site data can be cleared separately).
      try {
        const c = await caches.open(CACHE);
        const missing = [];
        for (const f of inst.files) if (!(await c.match(new URL(f.path, BASE).href))) missing.push(f.path);
        if (missing.length) { writeInstalled(null); this.installed = null; this.state = 'none'; }
        else { this.installed = inst; this.state = 'installed'; }
      } catch (e) { this.state = 'none'; }
    }
    this._emit();
    return this;
  },

  // Read the site's manifest (a small same-site request) to learn the size and whether an
  // update is out. Called when the graphics screen opens, never on its own.
  async check() {
    if (this.state === 'unsupported') return this;
    try {
      const r = await fetch(new URL('manifest.json', BASE).href, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.remote = await r.json();
      if (this.installed && this.remote.version > this.installed.version && this.state === 'installed') this.state = 'update';
    } catch (e) { this.remote = null; }
    this._emit();
    return this;
  },

  // Download (or update) the pack. Every file's size and SHA-256 are checked before it is kept.
  async install() {
    if (this.state === 'unsupported' || this.state === 'downloading') return false;
    const prev = this.state;
    this.state = 'downloading'; this.error = '';
    this._emit();
    try {
      if (!this.remote) await this.check();
      if (!this.remote) throw new Error('Could not reach the pack list. Check your connection and try again.');
      this.state = 'downloading';
      const man = this.remote;
      this.progress = { done: 0, total: man.total, file: '' };
      const cache = this.persistent ? await caches.open(CACHE) : null;
      const store = memory || new Map();
      for (const f of man.files) {
        const url = new URL(f.path, BASE).href;
        this.progress.file = f.path;
        // Already have this exact file (an update that did not change it)?
        if (cache) {
          const have = await cache.match(url);
          if (have && have.headers.get('x-sha256') === f.sha256) { this.progress.done += f.size; this._emit(); continue; }
        }
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('Download failed (' + f.path + ': HTTP ' + r.status + ')');
        const reader = r.body.getReader(), parts = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value); got += value.length;
          this.progress.done += value.length;
          this._emit();
        }
        const buf = new Uint8Array(got);
        let o = 0;
        for (const p of parts) { buf.set(p, o); o += p.length; }
        if (got !== f.size) throw new Error('Download was cut short (' + f.path + ')');
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
        if (hash !== f.sha256) throw new Error('Download was damaged (' + f.path + '); try again.');
        if (cache) await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream', 'x-sha256': hash } }));
        else store.set(f.path, buf.buffer);
      }
      if (cache) {
        // Drop files an older pack had that this one does not.
        for (const req of await cache.keys()) if (!man.files.some((f) => new URL(f.path, BASE).href === req.url)) await cache.delete(req);
      } else memory = store;
      this.installed = { version: man.version, total: man.total, files: man.files };
      if (this.persistent) writeInstalled(this.installed);
      meshes.clear();
      this.state = 'installed';
      this._emit();
      return true;
    } catch (e) {
      this.error = e.message || String(e);
      this.state = prev === 'installed' || prev === 'update' ? prev : 'error';
      this._emit();
      return false;
    }
  },

  // Remove the pack and free the space (High / Ultra go back to needing it).
  async remove() {
    try { if (hasCaches()) await caches.delete(CACHE); } catch (e) { /* ignore */ }
    memory = null; meshes.clear();
    writeInstalled(null);
    this.installed = null;
    this.state = canUnpack() ? 'none' : 'unsupported';
    this._emit();
  },

  // A file of the installed pack, unpacked (ArrayBuffer), or null.
  async file(path) {
    if (!this.ready) return null;
    const entry = this.installed.files.find(f => f.path === path);
    if (!entry) return null;
    let data = null;
    if (memory && memory.has(path)) data = memory.get(path);
    else if (this.persistent) {
      const r = await (await caches.open(CACHE)).match(new URL(path, BASE).href);
      if (r) data = await r.arrayBuffer();
    }
    if (!data) return null;
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (data.byteLength !== entry.size || hash !== entry.sha256) throw new Error('Cached pack file damaged: ' + path);
    if (path.endsWith('.rrmz')) data = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return data;
  },

  // A gun model from the pack (parsed .rrm), or null if the pack has none for it.
  gun(name) { return this.model('guns/' + name + '.rrmz', name); },
  // Any model of the installed pack by its path (guns/<name>.rrmz, soldiers/soldier.rrmz).
  model(path, name = path) {
    if (!this.ready || !this.installed.files.some((f) => f.path === path)) return Promise.resolve(null);
    if (!meshes.has(name)) meshes.set(name, this.file(path).then((b) => (b ? parseRRM(b) : null)).catch((e) => { console.error('HD model ' + path, e); return null; }));
    return meshes.get(name);
  },
  // The parsed models already loaded (synchronous access for building a gun).
  loadedGun(name) { return loaded.get(name) || null; },
  // Load every gun model into memory (after install, or at boot when High / Ultra is on).
  async loadGuns() {
    if (!this.ready) return 0;
    // guns by model name; the soldier as 'soldier'
    const paths = this.installed.files.filter((f) => /^(guns|soldiers)\/.*\.rrmz$/.test(f.path)).map((f) => f.path);
    await Promise.all(paths.map(async (p) => { const n = p.split('/').pop().replace('.rrmz', ''); const g = await this.model(p, n); if (g) loaded.set(n, g); }));
    return loaded.size;
  },
};
const loaded = new Map();
HDPack.onChange(() => { if (!HDPack.ready) loaded.clear(); });
