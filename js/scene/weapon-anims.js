// Keyframed weapon animations from the Enhanced Graphics pack (hd/anims/weapons.json, built by
// tools/hd/anims.mjs). Used by WeaponRig on High / Ultra with the pack's detailed guns; Low and
// Standard keep the procedural animations. The clips use normalised time, played over the same
// durations as before, so they change how reloads, draws and inspects look, never their timing.
import { HDPack } from '../render/hd-pack.js?v=189fea0-mwc1zla2';

export const packAnims = { set: null, revision: 0 };
const CLIPS = ['reload', 'reloadEmpty', 'draw', 'inspect'];
const ANCHORS = ['rest', 'mag', 'magBottom', 'port', 'pouch'];
const WIDTH = { root: 7, hand: 8, mag: 8, bolt: 2, events: 2 };

// Checks a clip set; returns it ready to play (keys sorted) or throws with the reason.
export function validateAnims(j) {
  if (!j || j.format !== 'recoil-range-anims' || j.version !== 1 || !j.styles || !j.styles.default) throw Error('not a version 1 animation set');
  for (const [sn, st] of Object.entries(j.styles)) {
    for (const cn of CLIPS) {
      const c = st[cn];
      if (!c) throw Error(sn + '.' + cn + ': missing');
      for (const [tn, keys] of Object.entries(c)) {
        if (!WIDTH[tn]) throw Error(sn + '.' + cn + ': unknown track ' + tn);
        if (!Array.isArray(keys) || !keys.length) throw Error(sn + '.' + cn + '.' + tn + ': no keys');
        let last = -1;
        for (const k of keys) {
          if (!Array.isArray(k) || k.length !== WIDTH[tn] || !(k[0] >= 0 && k[0] <= 1) || k[0] < last) throw Error(sn + '.' + cn + '.' + tn + ': bad key ' + JSON.stringify(k));
          last = k[0];
          if (tn === 'hand' && !ANCHORS.includes(k[1])) throw Error(sn + '.' + cn + '.hand: unknown anchor ' + k[1]);
          if (tn !== 'events') for (let i = tn === 'hand' ? 2 : 1; i < k.length; i++) if (!Number.isFinite(k[i])) throw Error(sn + '.' + cn + '.' + tn + ': not a number');
        }
      }
    }
  }
  return j;
}

export async function loadPackAnims() {
  if (!HDPack.ready) return;
  try {
    const b = await HDPack.file('anims/weapons.json');
    packAnims.set = b ? validateAnims(JSON.parse(new TextDecoder().decode(b))) : null;
  } catch (e) { console.warn('pack animations', e); packAnims.set = null; }
  packAnims.revision++;
}
HDPack.onChange(() => { if (!HDPack.ready && packAnims.set) { packAnims.set = null; packAnims.revision++; } });

export const styleFor = (type) => (packAnims.set && packAnims.set.styles[packAnims.set.types[type]]) || (packAnims.set && packAnims.set.styles.default);

// Catmull-Rom through the keys of one numeric column, at time t (keys sorted by t).
function spline(keys, col, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][col];
  if (t >= keys[n - 1][0]) return keys[n - 1][col];
  let i = 0;
  while (i < n - 2 && keys[i + 1][0] < t) i++;
  const k1 = keys[i], k2 = keys[i + 1];
  const k0 = keys[Math.max(0, i - 1)], k3 = keys[Math.min(n - 1, i + 2)];
  const span = k2[0] - k1[0];
  if (span <= 1e-6) return k2[col];
  const u = (t - k1[0]) / span;
  // Tangents scaled to this segment's length (non-uniform key spacing), clamped at the ends.
  const m1 = k1 === k0 ? 0 : (k2[col] - k0[col]) / (k2[0] - k0[0]) * span;
  const m2 = k3 === k2 ? 0 : (k3[col] - k1[col]) / (k3[0] - k1[0]) * span;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * k1[col] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * k2[col] + (u3 - u2) * m2;
}
// Visibility (and other steps): the value of the last key at or before t.
function step(keys, col, t) {
  let v = keys[0][col];
  for (const k of keys) { if (k[0] <= t) v = k[col]; else break; }
  return v;
}

// Hand keys are relative to anchors measured on the model. They are resolved once per clip and
// model into plain gun-space keys ('mag' follows the magazine's own animation at that key).
const resolved = new WeakMap();
function handKeys(clip, an) {
  let per = resolved.get(clip);
  if (!per) resolved.set(clip, (per = new Map()));
  const id = an.id;
  let keys = per.get(id);
  if (keys) return keys;
  keys = clip.hand.map((k) => {
    const t = k[0];
    let base;
    if (k[1] === 'mag' || k[1] === 'magBottom') {
      const m = clip.mag;
      const off = m ? [spline(m, 1, t), spline(m, 2, t), spline(m, 3, t)] : [0, 0, 0];
      const a = k[1] === 'mag' ? an.mag : an.magBottom;
      base = [a[0] + off[0], a[1] + off[1], a[2] + off[2]];
    } else base = an[k[1]];
    return [t, base[0] + k[2], base[1] + k[3], base[2] + k[4], k[5], k[6], k[7]];
  });
  per.set(id, keys);
  return keys;
}

// Samples a clip at progress p (0..1). an: the model's anchors { id, rest, mag, magBottom, port,
// pouch } (gun space). Writes into out: { root: [x,y,z,p,yw,r] | null, hand: [x,y,z,rx,ry,rz] |
// null, mag: [x,y,z,rx,ry,rz,vis] | null, bolt: number }.
export function sampleClip(clip, p, an, out) {
  out.root = out.hand = out.mag = null; out.bolt = 0;
  if (clip.root) { const r = out._r || (out._r = new Array(6)); for (let i = 0; i < 6; i++) r[i] = spline(clip.root, i + 1, p); out.root = r; }
  if (clip.mag) { const m = out._m || (out._m = new Array(7)); for (let i = 0; i < 6; i++) m[i] = spline(clip.mag, i + 1, p); m[6] = step(clip.mag, 7, p); out.mag = m; }
  if (clip.hand && an) { const keys = handKeys(clip, an), h = out._h || (out._h = new Array(6)); for (let i = 0; i < 6; i++) h[i] = spline(keys, i + 1, p); out.hand = h; }
  if (clip.bolt) out.bolt = Math.max(0, spline(clip.bolt, 1, p));
  return out;
}
// Events crossed going from progress a to b (a < b).
export function eventsBetween(clip, a, b) {
  const out = [];
  if (clip.events) for (const [t, name] of clip.events) if (t > a && t <= b) out.push(name);
  return out;
}
