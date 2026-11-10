// Loads the Rust game core (wasm/recoil_core.wasm, built from rust/core by
// tools/build-wasm.sh) and hands out its functions. No generated glue: the core exports plain
// C-style functions and one shared buffer of 64-bit floats.
//
//   await initCore()   in the browser, once, before the first match (fetches the .wasm)
//   core()             the loaded core; in Node it loads the file on first use
//
// The instance is kept on globalThis so every copy of this module (the cache-busting ?v=
// stamp makes separate module instances) shares one core.
const KEY = '__recoilCore';
const ABI = 1;
let pending = null;

function bind(instance) {
  const e = instance.exports;
  if (e.rc_abi() !== ABI) throw new Error('wasm/recoil_core.wasm is out of date (interface ' + e.rc_abi() + ', the game expects ' + ABI + '). Run tools/build-wasm.sh, or press Ctrl+F5.');
  const c = {
    e, ptr: e.rc_buf(), len: e.rc_buf_len(), _f: null,
    // The shared buffer as a Float64Array (re-made if the wasm memory grew).
    get f() { if (!this._f || this._f.buffer !== e.memory.buffer) this._f = new Float64Array(e.memory.buffer, this.ptr, this.len); return this._f; },
    // Worlds are freed when their JavaScript owner is collected, as a backstop to dispose().
    reg: typeof FinalizationRegistry === 'function' ? new FinalizationRegistry((id) => e.rc_world_free(id)) : null,
  };
  globalThis[KEY] = c;
  return c;
}
const wasmUrl = () => { const u = new URL('../../wasm/recoil_core.wasm', import.meta.url); u.search = new URL(import.meta.url).search; return u; };
const inNode = () => typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof process.getBuiltinModule === 'function';

export const coreSupported = () => typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
export const coreLoaded = () => !!globalThis[KEY];

export async function initCore() {
  if (globalThis[KEY]) return globalThis[KEY];
  if (inNode()) return core();
  if (!coreSupported()) throw new Error('This browser has WebAssembly turned off, and the match modes need it.');
  if (!pending) {
    pending = (async () => {
      const res = await fetch(wasmUrl(), { cache: 'no-cache' });
      if (!res.ok) throw new Error('wasm/recoil_core.wasm: ' + res.status);
      const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
      return bind(instance);
    })();
    pending.catch(() => { pending = null; });
  }
  return pending;
}

export function core() {
  const c = globalThis[KEY];
  if (c) return c;
  if (inNode()) {
    const bytes = process.getBuiltinModule('node:fs').readFileSync(new URL('../../wasm/recoil_core.wasm', import.meta.url));
    return bind(new WebAssembly.Instance(new WebAssembly.Module(bytes), {}));
  }
  throw new Error('The game core is not loaded yet (await initCore() first).');
}
