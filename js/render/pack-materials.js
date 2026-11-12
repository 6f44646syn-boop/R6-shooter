// Enhanced Graphics pack v5: physically based map materials (hd/mat/<name>-{albedo,normal,orm}.webp,
// baked by tools/build-materials.mjs). On High and Ultra, a map's simple textured materials are
// swapped for MeshStandardMaterial with a colour map, a normal map and an occlusion / roughness /
// metalness map, keeping each mesh's tiling and vertex colours. Low and Standard are untouched.
// Only the materials the current map uses are loaded. Texture sizes: Ultra as baked (2048 for the
// big surfaces), High half that, so integrated graphics keep their memory.
import * as THREE from '../../vendor/three/three.module.min.js?v=e5abbf7-mwd96xd4';
import { HDPack } from './hd-pack.js?v=e5abbf7-mwd96xd4';
import { maxMode } from './quality.js?v=e5abbf7-mwd96xd4';

export const packMats = { revision: 0, lightActive: false };
const sets = new Map();          // name|quality -> Promise<{ map, normal, orm }>
HDPack.onChange(() => { if (!HDPack.ready) { for (const p of sets.values()) p.then((s) => s && Object.values(s).forEach((t) => t.dispose())).catch(() => {}); sets.clear(); packMats.revision++; } });

// Names of the materials this pack has (from its manifest).
export function packMaterialNames() {
  const m = HDPack.ready && HDPack.installed;
  if (!m || !Array.isArray(m.files)) return new Set();
  const out = new Set();
  for (const f of m.files) { const r = /^mat\/([A-Za-z0-9]+)-albedo\.webp$/.exec(f.path); if (r) out.add(r[1]); }
  return out;
}

async function texture(path, quality, color) {
  const bytes = await HDPack.file(path);
  if (!bytes) throw Error('missing ' + path);
  const blob = new Blob([bytes], { type: 'image/webp' });
  let bmp = await createImageBitmap(blob, { imageOrientation: 'flipY', colorSpaceConversion: 'none' });
  if (quality !== 'ultra' && quality !== 'max' && bmp.width > 256) {
    const w = Math.max(256, bmp.width >> 1), h = Math.max(128, bmp.height >> 1);
    const small = await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    bmp.close(); bmp = small;
  }
  const t = new THREE.Texture(bmp);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.flipY = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}
function loadSet(name, quality) {
  const key = name + '|' + quality;
  if (!sets.has(key)) {
    // Max: the 4K version of a large surface when the pack has one
    const k4 = quality === 'max' && (HDPack.installed.files || []).some((f) => f.path === 'mat/' + name + '-albedo-4k.webp') ? '-4k' : '';
    const p = Promise.all([texture('mat/' + name + '-albedo' + k4 + '.webp', quality, true), texture('mat/' + name + '-normal' + k4 + '.webp', quality, false), texture('mat/' + name + '-orm' + k4 + '.webp', quality, false)])
      .then(([map, normal, orm]) => ({ map, normal, orm }));
    p.catch(() => sets.delete(key));
    sets.set(key, p);
  }
  return sets.get(key);
}

/* ---------- baked sky light (hd/light/<map>.rrl, tools/build-light.mjs) ---------- */
const volumes = new Map();     // map id -> Promise<{ tex, min, size } | null>
export function loadLightVolume(id) {
  if (!id || !HDPack.ready) return Promise.resolve(null);
  if (!volumes.has(id)) {
    const p = (async () => {
      const bytes = await HDPack.file('light/' + id + '.rrl').catch(() => null);
      if (!bytes) return null;
      const raw = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      const len = raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24);
      const h = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + len)));
      const data = raw.slice(4 + len), [nx, ny, nz] = h.n;
      if (h.v !== 2 || data.length !== nx * ny * nz * 2) throw Error('light volume ' + id + ': bad size');
      const tex = new THREE.Data3DTexture(data, nx, ny, nz);
      tex.format = THREE.RGFormat; tex.type = THREE.UnsignedByteType;
      tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
      tex.unpackAlignment = 1; tex.needsUpdate = true;
      return { tex, min: new THREE.Vector3(...h.min), cell: h.cell, n: new THREE.Vector3(nx, ny, nz) };
    })();
    p.catch(() => volumes.delete(id));
    volumes.set(id, p);
  }
  return volumes.get(id);
}
HDPack.onChange(() => { if (!HDPack.ready) { for (const p of volumes.values()) p.then((v) => v && v.tex.dispose()).catch(() => {}); volumes.clear(); } });
// Indirect light (sky, bounce, reflections) times the baked sky light at this point: shaded
// rooms, dark corners, light at doorways. Works on Standard and Lambert materials.
export function useLightVolume(mat, vol) {
  if (!vol || mat.userData.vol === vol) return;
  mat.userData.vol = vol;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uVol = { value: vol.tex }; sh.uniforms.uVolMin = { value: vol.min }; sh.uniforms.uVolN = { value: vol.n }; sh.uniforms.uVolCell = { value: vol.cell };
    sh.vertexShader = 'varying vec3 vVolP;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 vp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nvp = instanceMatrix * vp;\n#endif\nvVolP = (modelMatrix * vp).xyz; }');
    sh.fragmentShader = 'uniform highp sampler3D uVol; uniform vec3 uVolMin, uVolN; uniform float uVolCell; varying vec3 vVolP;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>',
      '{ vec3 vc = ((vVolP - uVolMin) / uVolCell + 0.5) / uVolN; vec2 vol = texture(uVol, vc).rg;\n irradiance = irradiance * vol.r + vol.g * vec3(1.0, 0.86, 0.68) * 0.85;   // darker rooms: the lamps (light-pool.js) do the rest\n iblIrradiance *= max(vol.r, vol.g * 0.5);\n#ifdef RE_IndirectSpecular\n radiance *= max(vol.r, vol.g * 0.35);\n#endif\n}\n#include <lights_fragment_end>');
  };
  mat.customProgramCacheKey = () => 'rrvol';
  mat.needsUpdate = true;
}

// A soft sky for reflections (the match maps have no environment map of their own).
let ENV = null;
export function envMap(renderer) {
  if (ENV) return ENV;
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'varying vec3 vP; void main() { float y = normalize(vP).y; vec3 c = y > 0. ? mix(vec3(.75, .8, .85), vec3(.35, .5, .75), pow(y, .6)) : mix(vec3(.45, .42, .38), vec3(.2, .19, .17), pow(-y, .5)); gl_FragColor = vec4(c, 1.); }',
  }));
  scene.add(sky);
  const pm = new THREE.PMREMGenerator(renderer);
  ENV = pm.fromScene(scene, 0.02).texture;
  pm.dispose(); sky.geometry.dispose(); sky.material.dispose();
  return ENV;
}

function place(src, base) {
  const t = src.clone();
  t.repeat.copy(base.repeat); t.offset.copy(base.offset); t.rotation = base.rotation; t.center.copy(base.center);
  t.anisotropy = base.anisotropy > 1 ? base.anisotropy : 4;
  t.userData.own = true;
  return t;
}

// root: the map's meshes. Resolves when the swap (or the revert) is done. Safe to call again on
// every graphics change; a stale call (the map was replaced meanwhile) changes nothing.
function revertMesh(o) {
  const m = o.material, u = o.userData;
  for (const t of [m.map, m.normalMap, m.aoMap, m.roughnessMap, m.metalnessMap]) if (t && t.userData.own) t.dispose();
  m.dispose(); o.material = u.packLo; delete u.packLo;
}
// Put the original materials back now (before something else swaps materials, e.g. the Battle
// arena's own quality tiers).
export function revertPackMaterials(root) { if (root) root.traverse((o) => { if (o.isMesh && o.userData.packLo) revertMesh(o); }); }
// opt.light: the map id whose baked light to use (match maps).
export async function applyPackMaterials(roots, quality, renderer, opt = {}) {
  if (quality === 'ultra' && maxMode.on) quality = 'max';
  const list = [].concat(roots).filter(Boolean);
  const high = quality === 'high' || quality === 'ultra' || quality === 'max';
  // only the latest call for these roots applies: an older one still loading (the player switched
  // graphics again) must not swap pack materials in after it
  const key = list[0], req = key ? (key.userData.packMatReq = (key.userData.packMatReq || 0) + 1) : 0;
  const stale = () => !!key && key.userData.packMatReq !== req;
  const names = high ? packMaterialNames() : new Set();
  const meshes = [];
  for (const root of list) root.traverse((o) => { if (o.isMesh && !o.userData.ownMaterial) meshes.push(o); });
  // revert first (quality changed, or the pack was removed)
  for (const o of meshes) { const u = o.userData; if (u.packLo && (!high || u.packQuality !== quality || u.packRev !== packMats.revision)) revertMesh(o); }
  packMats.lightActive = false;
  if (!names.size) return 0;
  const vol = opt.light ? await loadLightVolume(opt.light).catch(() => null) : null;
  if (stale()) return 0;
  const wanted = new Map();
  for (const o of meshes) {
    if (o.userData.packLo) continue;
    const m = o.material, b = m && (m.userData.packBase || m.map), name = b && b.userData.surface;   // (packBase: the earlier pack's surface swap)
    if (name && names.has(name) && (m.isMeshLambertMaterial || m.isMeshStandardMaterial)) { if (!wanted.has(name)) wanted.set(name, []); wanted.get(name).push(o); }
  }
  const loaded = new Map();
  await Promise.all([...wanted.keys()].map(async (n) => { try { loaded.set(n, await loadSet(n, quality)); } catch (e) { console.warn('pack material ' + n, e); } }));
  if (stale()) return 0;
  const env = envMap(renderer);
  const aniso = Math.min(quality === 'max' ? 16 : quality === 'ultra' ? 8 : 4, renderer.capabilities.getMaxAnisotropy());
  let n = 0;
  for (const [name, objs] of wanted) {
    const s = loaded.get(name);
    if (!s) continue;
    for (const o of objs) {
      if (o.userData.packLo || !o.parent) continue;
      const lo = o.material, base = lo.userData.packBase || lo.map;
      const mat = new THREE.MeshStandardMaterial({
        map: place(s.map, base), normalMap: place(s.normal, base), aoMap: place(s.orm, base), roughnessMap: place(s.orm, base), metalnessMap: place(s.orm, base),
        roughness: 1, metalness: 1, aoMapIntensity: 1, envMap: env, envMapIntensity: 0.3,
        color: lo.color ? lo.color.clone() : new THREE.Color(1, 1, 1), vertexColors: !!lo.vertexColors,
        transparent: lo.transparent, opacity: lo.opacity, side: lo.side,
        polygonOffset: lo.polygonOffset, polygonOffsetFactor: lo.polygonOffsetFactor, polygonOffsetUnits: lo.polygonOffsetUnits,
      });
      for (const t of [mat.map, mat.normalMap, mat.aoMap, mat.roughnessMap, mat.metalnessMap]) t.anisotropy = aniso;
      if (vol) useLightVolume(mat, vol);
      o.material = mat;
      o.userData.packLo = lo; o.userData.packQuality = quality; o.userData.packRev = packMats.revision;
      n++;
    }
  }
  packMats.lightActive = !!vol && n > 0;
  return n;
}
