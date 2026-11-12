// Skin Lab (skin-lab.html): every skin on every gun it fits, drawn by the game's own weapon rig.
// Pick a gun and a skin, switch graphics, play the inspect; first person (with hands) or a studio
// view you can turn by dragging. Nothing here changes a profile: the skin is forced on the rig.
import * as THREE from '../../vendor/three/three.module.min.js?v=d062206-mwdh3x64';
import { WeaponRig, setUltraTexSize } from '../scene/viewmodel.js?v=d062206-mwdh3x64';
import { loadGameData } from '../core/guns.js?v=d062206-mwdh3x64';
import { CATALOGUE, RARITIES, RARITY, skinFits } from '../core/skins.js?v=d062206-mwdh3x64';

const $ = (id) => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem('skinLab.' + k); } catch { return null; } }, set(k, v) { try { localStorage.setItem('skinLab.' + k, v); } catch { /* blocked */ } } };

const canvas = $('lab-view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
setUltraTexSize(2048);                         // quick enough on a laptop; Ultra in the game bakes 4096

const data = await loadGameData();
const guns = data.guns, optic = (g) => data.catalogue.byId.get(g.defaultOptic);

// first person: the game's rig, hands on
const rig = new WeaponRig(renderer);
rig.setHighEnv(rig.env);
const bg = new THREE.Scene(); bg.background = new THREE.Color(0x1a1f27);
// studio: the same gun without hands, on a turntable you can drag
const studio = new WeaponRig(renderer);
studio.noHands = true; studio.reloadP = -1; studio.setHighEnv(studio.env);
studio.scene.background = new THREE.Color(0x1a1f27);
const sKey = new THREE.DirectionalLight(0xffffff, 2.4); sKey.position.set(0.6, 1.2, 1.6);
const sRim = new THREE.DirectionalLight(0x9fc4ff, 1.4); sRim.position.set(-1.2, 0.6, -1);
studio.scene.add(sKey, sRim);
const pivot = new THREE.Group(); studio.scene.add(pivot); pivot.add(studio.root);
const cam = new THREE.PerspectiveCamera(28, 16 / 9, 0.05, 20);

const S = { gun: Number(store.get('gun') ?? 1) || 0, skin: Number(store.get('skin') ?? 202), view: store.get('view') || 'studio', gfx: store.get('gfx') || 'high', rarity: 'all', yaw: -Math.PI / 2 + 0.4, pitch: 0.12 };
if (!guns[S.gun]) S.gun = 0;
if (!CATALOGUE[S.skin]) S.skin = 0;

function frame() {
  // centre the gun and back the camera off to fit it (as the armory preview does)
  studio.root.position.set(0, 0, 0); studio.root.quaternion.identity();
  pivot.rotation.set(0, 0, 0); pivot.updateMatrixWorld(true);
  const box = new THREE.Box3();
  studio.current.traverseVisible((o) => { if (o.isMesh) box.union(new THREE.Box3().setFromObject(o)); });
  studio.root.position.copy(box.getCenter(new THREE.Vector3())).negate();
  const size = box.getSize(new THREE.Vector3());
  cam.position.set(0, 0.02, Math.max(0.7, Math.max(size.z, size.y * 2.2) * 2.2));
  cam.lookAt(0, 0, 0);
}
function apply() {
  const g = guns[S.gun], gfx = S.gfx, mode = gfx === 'low' ? 'fast' : gfx === 'standard' ? 'fast' : gfx;
  for (const r of [rig, studio]) { r.setShading(mode, gfx); r.forceSkin = S.skin; r.rebuild(); r.setGun(g, S.gun, optic(g)); }
  renderer.shadowMap.enabled = false;
  frame();
  const sk = CATALOGUE[S.skin];
  $('lab-now').textContent = sk.name;
  $('lab-now-meta').textContent = RARITY[sk.rarity].name + ' · on the ' + g.name + (sk.guns ? ' · only for the ' + sk.guns.map((i) => guns[i]?.name).join(', ') : '');
  $('lab-now').style.setProperty('--rar', RARITY[sk.rarity].color);
  for (const [k, v] of Object.entries({ gun: S.gun, skin: S.skin, view: S.view, gfx: S.gfx })) store.set(k, v);
  renderList();
}

// controls
const gunSel = $('lab-gun');
gunSel.replaceChildren(...guns.map((g, i) => new Option(g.name, i)));
gunSel.value = S.gun;
gunSel.addEventListener('change', () => { S.gun = Number(gunSel.value); if (!skinFits(S.skin, S.gun)) S.skin = 0; apply(); });
for (const b of document.querySelectorAll('[data-gfx]')) b.addEventListener('click', () => { S.gfx = b.dataset.gfx; syncChips(); apply(); });
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => { S.view = b.dataset.view; syncChips(); });
$('lab-inspect').addEventListener('click', () => { (S.view === 'hands' ? rig : studio).inspect(); });
const rarSel = $('lab-rarity');
rarSel.replaceChildren(new Option('All rarities', 'all'), ...RARITIES.slice().reverse().map((r) => new Option(r.name, r.key)));
rarSel.addEventListener('change', () => { S.rarity = rarSel.value; renderList(); });
$('lab-fits').addEventListener('change', renderList);
$('lab-search').addEventListener('input', renderList);
function syncChips() {
  for (const b of document.querySelectorAll('[data-gfx]')) b.setAttribute('aria-pressed', String(b.dataset.gfx === S.gfx));
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === S.view));
}

// the skin list: Legendaries first, then by rarity
const ORDER = { legendary: 0, blackice: 1, epic: 2, rare: 3, common: 4 };
const all = CATALOGUE.slice().sort((a, b) => ORDER[a.rarity] - ORDER[b.rarity] || a.id - b.id);
function swatch(sk) {
  const c = (v) => 'rgb(' + v.map((x) => Math.round(255 * Math.pow(Math.min(1, x), 1 / 2.2))).join(',') + ')';
  return 'linear-gradient(135deg,' + c(sk.c[0]) + ' 0 30%,' + c(sk.c[1]) + ' 30% 55%,' + c(sk.c[2]) + ' 55% 78%,' + c(sk.c[3]) + ' 78%)';
}
function renderList() {
  const q = $('lab-search').value.trim().toLowerCase(), fits = $('lab-fits').checked;
  const shown = all.filter((sk) => (S.rarity === 'all' || sk.rarity === S.rarity) && (!fits || skinFits(sk.id, S.gun)) && (!q || sk.name.toLowerCase().includes(q)));
  $('lab-count').textContent = shown.length + ' of ' + all.length + ' skins';
  $('lab-list').replaceChildren(...shown.map((sk) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'skin'; b.setAttribute('aria-pressed', String(sk.id === S.skin));
    b.style.setProperty('--rar', RARITY[sk.rarity].color);
    const sw = document.createElement('span'); sw.className = 'sw';
    if (sk.art) sw.style.backgroundImage = 'url(' + sk.art + ')', sw.classList.add('art');
    else sw.style.background = swatch(sk);
    const name = document.createElement('span'); name.className = 'nm'; name.textContent = sk.name;
    const meta = document.createElement('span'); meta.className = 'mt';
    meta.textContent = RARITY[sk.rarity].name + (sk.guns ? ' · ' + sk.guns.map((i) => guns[i]?.name).join(', ') : '');
    b.append(sw, name, meta);
    b.addEventListener('click', () => {
      S.skin = sk.id;
      if (!skinFits(sk.id, S.gun)) { S.gun = sk.guns[0]; gunSel.value = S.gun; }    // a gun-only skin brings its gun
      apply();
    });
    return b;
  }));
}

// drag to turn (studio view)
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: S.yaw, pitch: S.pitch }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => { if (!drag) return; S.yaw = drag.yaw + (e.clientX - drag.x) * 0.008; S.pitch = Math.max(-0.8, Math.min(0.8, drag.pitch + (e.clientY - drag.y) * 0.006)); });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('dblclick', () => { (S.view === 'hands' ? rig : studio).inspect(); });
addEventListener('keydown', (e) => { if (e.code === 'KeyI' && !e.target.closest('input,select')) (S.view === 'hands' ? rig : studio).inspect(); });

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
  return [w, h];
}
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const t = now / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
  const [w, h] = resize();
  renderer.autoClear = true;
  if (S.view === 'hands') {
    rig.animations = true; rig.reloadP = -1; rig.sprinting = false; rig.bobY = 0;
    rig.update(dt, 0, t);
    rig.setAspect(w / h, h);
    renderer.render(bg, rig.camera);
    renderer.autoClear = false;
    renderer.render(rig.scene, rig.camera);
  } else {
    // the studio gun stays on its turntable: run the inspect's effects without the hand pose
    studio.animations = true;
    if (studio.inspectT >= 0) { studio.inspectT += dt / (studio.current.userData.inspectFx?.seconds ?? 3.2); if (studio.inspectT >= 1) studio.inspectT = -1; }
    studio.animateSkins(t, studio.inspectT >= 0 ? 1 : 0);
    if (cam.aspect !== w / h) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
    pivot.rotation.set(S.pitch, S.yaw, 0);
    renderer.render(studio.scene, cam);
  }
}
syncChips();
apply();
$('lab-status').hidden = true;
requestAnimationFrame(loop);
