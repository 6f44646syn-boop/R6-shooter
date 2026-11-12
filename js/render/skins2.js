// Enhanced Graphics pack v5: redrawn weapon skins. The pack's detail sheets (hd/skins/*.webp,
// tools/build-skin-atlas.mjs) and this shader redraw pack finishes on High, Ultra and Max, still
// baked on the GPU at the gun's skin size (up to 4096 px), so nothing per skin is downloaded.
//   woodland, blot  stacked hand-cut camo layers, each a little raised (paint thickness)
//   pixel           layered pixel camo at two block sizes
//   tiger           brushed stripes with dry-brush streaks and splatter
//   all             paint layers that catch light at their edges, dirt and fine scratches
//                   (more on Common, less on Epic), metallic flake on Epic, and a stencilled
//                   decal on many Rare and Epic skins; every skin places the sheets its own way
import * as THREE from '../../vendor/three/three.module.min.js?v=077023c-mwdg8dho';
import { HDPack } from './hd-pack.js?v=077023c-mwdg8dho';

export const skinSheets = { ready: false, rev: 0, tex: null };
const NAMES = ['camo', 'digital', 'tiger', 'grime', 'flake', 'decals'];
let pending = null;
export async function loadSkinSheets() {
  if (!HDPack.ready) return false;
  if (skinSheets.ready) return true;
  if (!pending) pending = (async () => {
    const tex = {};
    for (const n of NAMES) {
      const b = await HDPack.file('skins/' + n + '.webp');
      if (!b) throw Error('missing skins/' + n);
      const bmp = await createImageBitmap(new Blob([b], { type: 'image/webp' }), { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const t = new THREE.Texture(bmp);
      t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
      tex[n] = t;
    }
    skinSheets.tex = tex; skinSheets.ready = true; skinSheets.rev++;
    return true;
  })().catch((e) => { console.warn('skin sheets', e); pending = null; return false; });
  return pending;
}
HDPack.onChange(() => { if (!HDPack.ready && skinSheets.ready) { for (const t of Object.values(skinSheets.tex)) t.dispose(); skinSheets.tex = null; skinSheets.ready = false; skinSheets.rev++; pending = null; } });

export function skin2Uniforms(def) {
  const t = skinSheets.tex;
  return {
    tCamo: { value: t.camo }, tDigital: { value: t.digital }, tTiger: { value: t.tiger }, tGrime: { value: t.grime }, tFlake: { value: t.flake }, tDecals: { value: t.decals },
    uRarity: { value: { common: 0, rare: 1, epic: 2, blackice: 3, legendary: 2 }[def.rarity] ?? 0 },
    uSeedS: { value: (def.id % 1000) + 1 },
  };
}

// skinAt2(uv, col, m, g, h): the redrawn design. Uses skinAt() (the original designs) for the
// patterns it does not redraw, then finishes every skin the same way. h: paint height 0..1.
export const SKIN2_GLSL = /* glsl */`
uniform sampler2D tCamo, tDigital, tTiger, tGrime, tFlake, tDecals;
uniform float uRarity, uSeedS;
float h1s(float x) { return fract(sin(x * 91.3458) * 47453.5453); }
void skinAt2(vec2 uv, out vec3 col, out float m, out float g, out float h) {
  float S = max(1.0, floor(prm.x + 0.5));
  vec2 off = vec2(h1s(uSeedS), h1s(uSeedS + 3.1));
  // every skin turns the sheets its own quarter turn
  float rq = floor(h1s(uSeedS + 7.7) * 4.0);
  vec2 ru = rq < 1.0 ? uv : rq < 2.0 ? vec2(uv.y, 1.0 - uv.x) : rq < 3.0 ? 1.0 - uv : vec2(1.0 - uv.y, uv.x);
  vec2 su = ru * S + off;
  h = 0.5; g = 0.0; m = 0.0;
  if (pattern == 2 || pattern == 7) {
    // stacked camo: base c0, then c1, c2, c3 as three hand-cut layers, each 0.15 thicker
    vec3 L = texture2D(tCamo, su * (pattern == 7 ? 0.7 : 1.0)).rgb;
    if (pattern == 7) L = smoothstep(0.35, 0.65, texture2D(tCamo, su * 0.7 + 0.002).rgb * 0.5 + L * 0.5);
    col = c0; h = 0.4;
    col = mix(col, c1, L.r); h += 0.15 * L.r;
    col = mix(col, c2, L.g); h += 0.15 * L.g;
    col = mix(col, c3, L.b); h += 0.15 * L.b;
    m = L.b;
  } else if (pattern == 1) {
    vec3 D = texture2D(tDigital, su).rgb;
    col = c0; h = 0.45;
    col = mix(col, c1, D.r); h += 0.12 * D.r;
    col = mix(col, c3, D.b * 0.9); h += 0.08 * D.b;
    col = mix(col, c2, D.g); h += 0.12 * D.g;
    m = D.g;
  } else if (pattern == 3) {
    vec3 T = texture2D(tTiger, su).rgb;
    col = mix(c0, c1, T.r);
    col = mix(col, c1 * 1.25 + 0.03, T.g * 0.35);
    col = mix(col, c2, T.b * (1.0 - T.r) * 0.8);
    m = T.r; h = 0.45 + 0.2 * T.r + 0.05 * T.g;
  } else {
    skinAt(uv, col, m, g);
    h = 0.5 + m * 0.3 - g * 0.2;
  }
  // Rare gets a paint stencil. Epic gets a relief stamp with a polished inlaid edge.
  float pick = h1s(uSeedS + 11.0);
  float has = uRarity >= 1.0 ? step(0.25, pick) : step(0.8, pick);
  if (has > 0.5) {
    float cell = floor(h1s(uSeedS + 13.0) * 16.0);
    vec2 cp = vec2(mod(cell, 4.0), floor(cell / 4.0));
    vec2 dc = vec2(0.3 + 0.4 * h1s(uSeedS + 17.0), 0.3 + 0.4 * h1s(uSeedS + 19.0));
    float ds = 0.24;                         // decal size in tile units
    vec2 q = (fract(uv * S) - dc) / ds + 0.5;
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
      vec2 dd = texture2D(tDecals, (cp + q) / 4.0).rg;
      vec3 dcol = uRarity >= 2.0 ? c3 : (dot(col, vec3(0.3, 0.5, 0.2)) > 0.3 ? c0 * 0.6 : c3 * 1.1 + 0.05);
      col = mix(col, dcol, dd.r * 0.83);
      col = mix(col, c1, dd.g * 0.72);
      h += dd.r * (uRarity >= 2.0 ? 0.14 : 0.035);
      m = max(m, dd.r * 0.5);
    }
  }
  // Common paint shows grime and chips, Rare shows finer abrasion, Epic has a clean coat.
  vec3 gr = texture2D(tGrime, ru * 2.0 + off * 1.7).rgb;
  float dirtAmt = mix(0.37, 0.035, clamp(uRarity / 2.0, 0.0, 1.0));
  col *= 1.0 - (gr.r - 0.45) * dirtAmt;
  float scr = gr.g * mix(0.6, 0.2, clamp(uRarity / 2.0, 0.0, 1.0));
  col = mix(col, col * 1.27 + 0.028, scr);
  h -= scr * 0.04;
  // Epic: metallic flake under the lacquer
  if (uRarity > 1.5 && uRarity < 2.5) {
    vec3 fl = texture2D(tFlake, uv * S * 6.0 + off).rgb;
    col += fl.r * (0.045 + 0.24 * fl.g) * mix(c1, c3, 0.55);
    h += fl.r * fl.g * 0.042;
  }
  // fine orange peel in the paint (relief only)
  h += (texture2D(tGrime, uv * 9.0 + off).b - 0.5) * 0.03;
}
`;
