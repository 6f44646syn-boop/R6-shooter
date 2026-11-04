// Recoil Range entry point: wires input, camera, scene, HUD and the frame loop together.
import * as THREE from '../vendor/three/three.module.min.js';
import { Look, PITCH_LIMIT } from './core/look.js';
import { PointerLock } from './core/pointer-lock.js';
import { loadSettings, saveSettings, DISTANCES } from './core/settings.js';
import { degPerCount, verticalFovDeg, zoomedFovDeg } from './core/sensitivity.js';
import { Weapon } from './core/weapon.js';
import { Range, EYE_HEIGHT } from './scene/range.js';
import { hitsSilhouette } from './scene/target.js';
import { Viewmodel } from './scene/viewmodel.js';
import { Sfx } from './audio/sfx.js';
import { DebugHud } from './ui/debug-hud.js';
import { drawCrosshair } from './ui/crosshair.js';
import { Hud } from './ui/hud.js';
import { MagPlot } from './ui/plot.js';

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);

// Stage (b) stand-in until data/guns.json arrives.
const DEFAULT_GUN = {
  id: 'test', name: 'Test Rifle', rpm: 600, magSize: 30, reloadSeconds: 2.2, optic: 1,
  hipMultiplier: 1, adsMultiplier: 1, resetSeconds: 0.3, placeholder: true,
};

/* ---------- iframe check: Google Sites' sandbox blocks pointer lock and fullscreen ---------- */
let embedded = false;
try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
if (embedded) {
  $('menu').hidden = true;
  $('embedded').hidden = false;
  $('open-tab').href = location.href;
} else {
  boot();
}

function boot() {
  const settings = loadSettings();
  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); // devicePixelRatio capped at 1
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
  camera.rotation.order = 'YXZ'; // yaw around world Y first, then pitch: standard FPS camera
  camera.position.set(0, EYE_HEIGHT, 0);
  scene.add(camera);             // so the viewmodel (a camera child) renders

  const range = new Range(scene);
  range.setDistance(settings.distance);
  range.holes.setSize(settings.holeSizeCm / 100);
  const viewmodel = new Viewmodel(camera);
  const sfx = new Sfx();
  sfx.setVolume(settings.volume);

  const look = new Look();
  const debug = new DebugHud($('debug'));
  debug.setVisible(settings.debugHud);
  const hud = new Hud($);
  const plot = new MagPlot($('plot'));
  const weapon = new Weapon();

  const state = {
    ads: false, fovH: settings.hipFov, fovV: 60,
    shots: 0, hits: 0,
    gun: DEFAULT_GUN, gunIndex: 0,
  };

  // Shots of the current magazine relative to the aim point, for the plot.
  const mag = { xy: new Float64Array(2 * 1000), n: 0, shots: 0, hits: 0 };

  function hipDpc() { return degPerCount(settings.dpi, settings.cm360) * state.gun.hipMultiplier; }
  function currentDpc() { return hipDpc(); }

  function selectGun(gun, index) {
    state.gun = gun;
    state.gunIndex = index;
    weapon.setGun(gun);
    mag.n = mag.shots = mag.hits = 0;
    hud.setGun(gun, index, gun.optic.toFixed(1) + 'x');
  }
  selectGun(DEFAULT_GUN, 0);
  hud.setDistance(range.distance);

  /* ---------- pointer lock ---------- */
  const notice = $('notice');
  const lock = new PointerLock(canvas, {
    onChange(locked) {
      $('menu').hidden = locked;
      if (locked) $('lock-hint').hidden = true;
      else { weapon.releaseTrigger(); setAds(false); }
    },
    onRetry() {
      // Usually Chrome refusing a re-lock straight after Esc. Stay quiet; the next click retries.
      const h = $('lock-hint');
      h.textContent = 'Click again to resume.';
      h.hidden = false;
    },
    onUnsupported() {
      const h = $('lock-hint');
      h.textContent = 'This browser cannot capture the mouse (Pointer Lock is unavailable).';
      h.hidden = false;
    },
  });

  async function startLock() {
    sfx.unlock();
    const ok = await lock.request();
    if (ok) {
      notice.textContent = 'Raw input unavailable: Windows pointer settings may affect aim.';
      notice.hidden = lock.raw;
    }
  }
  $('start-btn').addEventListener('click', startLock);
  canvas.addEventListener('click', () => { if (!lock.locked) startLock(); });

  /* ---------- mouse look: every event, straight to yaw/pitch ---------- */
  document.addEventListener('mousemove', (e) => {
    if (!lock.locked) return;
    look.apply(e.movementX, e.movementY, currentDpc());
  });

  document.addEventListener('mousedown', (e) => {
    if (!lock.locked) return;
    if (e.button === 0) {
      if (weapon.ammo === 0 && !weapon.reloading) sfx.click();
      weapon.pressTrigger(e.timeStamp / 1000);
    } else if (e.button === 2) setAds(true);
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) weapon.releaseTrigger();
    else if (e.button === 2) setAds(false);
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  function setAds(on) {
    if (state.ads === on) return;
    state.ads = on;
    updateFov();
  }

  /* ---------- keys ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.repeat && e.code !== 'KeyR') return;
    const c = e.code;
    if (c === 'F3') {
      e.preventDefault();
      settings.debugHud = !settings.debugHud;
      debug.setVisible(settings.debugHud);
      saveSettings(settings);
      return;
    }
    if (!lock.locked) return;
    if (c === 'KeyZ' && settings.debugHud) look.reset();
    else if (c === 'KeyR') { if (weapon.startReload(clockNow())) { finishMagazine(); sfx.reload(); } }
    else if (c === 'KeyC') clearRange();
    else if (c === 'KeyQ' || c === 'KeyE') {
      const i = DISTANCES.indexOf(range.distance) + (c === 'KeyE' ? 1 : -1);
      if (i >= 0 && i < DISTANCES.length) setDistance(DISTANCES[i]);
    }
  });

  function setDistance(d) {
    range.setDistance(d);
    settings.distance = d;
    hud.setDistance(d);
    saveSettings(settings);
  }

  function clearRange() {
    range.holes.clear();
    state.shots = state.hits = 0;
    mag.n = mag.shots = mag.hits = 0;
    $('hud-plot').hidden = true;
  }

  /* ---------- firing ---------- */
  const hit = { x: 0, y: 0 };
  function fireShot(t) {
    const yaw = look.yaw, pitch = look.pitch;
    state.shots++;
    mag.shots++;
    if (range.raycastWall(yaw, pitch, hit)) {
      range.holes.add(hit.x, hit.y);
      const tx = hit.x, ty = hit.y - EYE_HEIGHT; // target coordinates: aim point at the origin
      const onTarget = hitsSilhouette(tx, ty);
      if (onTarget) { state.hits++; mag.hits++; }
      if (mag.n < mag.xy.length / 2) { mag.xy[mag.n * 2] = tx; mag.xy[mag.n * 2 + 1] = ty; mag.n++; }
    }
    sfx.shot(0.5);
    viewmodel.shot();
  }

  // Called when a magazine runs dry or a reload starts: draw that magazine's plot.
  function finishMagazine() {
    if (mag.shots === 0) return;
    plot.draw(mag.xy, mag.n, mag.shots, mag.hits, state.gun.name, range.distance);
    $('hud-plot').hidden = false;
    mag.n = mag.shots = mag.hits = 0;
  }

  /* ---------- resize / FOV ---------- */
  let renderW = 0, renderH = 0;
  function resize() {
    const s = settings.renderScale;
    renderW = Math.max(1, Math.round(window.innerWidth * s));
    renderH = Math.max(1, Math.round(window.innerHeight * s));
    renderer.setSize(renderW, renderH, false);
    camera.aspect = renderW / renderH;
    updateFov();
  }
  function updateFov() {
    state.fovH = state.ads ? zoomedFovDeg(settings.hipFov, state.gun.optic) : settings.hipFov;
    state.fovV = verticalFovDeg(state.fovH, camera.aspect);
    camera.fov = state.fovV;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  drawCrosshair($('crosshair'), settings.crosshair);

  /* ---------- frame loop ---------- */
  let clockOffset = 0;
  function clockNow() { return performance.now() / 1000 + clockOffset; }

  const info = {
    look, dpc: 0, ads: false, raw: false, fovH: 0, fovV: 0, recoilYaw: 0, recoilPitch: 0,
    shotIndex: 0, seed: '-', renderW: 0, renderH: 0, calls: 0, tris: 0,
  };
  let prevT = clockNow();

  function update(t) {
    const dt = Math.min(0.1, Math.max(0, t - prevT));
    prevT = t;
    const ammoBefore = weapon.ammo;
    const ev = weapon.update(t, fireShot);
    if (weapon.ammo === 0 && ammoBefore > 0) finishMagazine();
    if (ev === 'reloaded') sfx.reload();

    const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, look.pitch));
    camera.rotation.y = -look.yaw * DEG;   // three.js: positive Y rotation turns left
    camera.rotation.x = pitch * DEG;
    viewmodel.update(dt, settings.showViewmodel && !state.ads);
    hud.setAmmo(weapon.ammo, state.gun.magSize, weapon.reloading);
    hud.setStats(state.shots, state.hits);
    return dt;
  }

  function frame(nowMs) {
    requestAnimationFrame(frame);
    const dt = update(clockNow());
    renderer.render(scene, camera);
    debug.recordFrame(dt * 1000);
    if (debug.visible) {
      info.dpc = currentDpc(); info.ads = state.ads; info.raw = lock.raw;
      info.fovH = state.fovH; info.fovV = state.fovV;
      info.renderW = renderW; info.renderH = renderH;
      info.calls = renderer.info.render.calls; info.tris = renderer.info.render.triangles;
      debug.update(nowMs, info);
    }
  }
  requestAnimationFrame(frame);
}
