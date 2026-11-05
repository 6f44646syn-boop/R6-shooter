// Recoil Range entry point: wires input, camera, scene, HUD and the frame loop together.
import * as THREE from '../vendor/three/three.module.min.js';
import { Look, PITCH_LIMIT } from './core/look.js';
import { PointerLock } from './core/pointer-lock.js';
import { loadSettings, saveSettings, DISTANCES } from './core/settings.js';
import { degPerCount, verticalFovDeg, zoomedFovDeg } from './core/sensitivity.js';
import { Weapon } from './core/weapon.js';
import { RecoilEngine } from './core/recoil.js';
import { loadGameData } from './core/guns.js';
import { randomSeed } from './core/prng.js';
import { Range, EYE_HEIGHT } from './scene/range.js';
import { hitsSilhouette } from './scene/target.js';
import { Viewmodel } from './scene/viewmodel.js';
import { MovingDot, DOT_RADIUS } from './scene/mover.js';
import { Sfx } from './audio/sfx.js';
import { DebugHud } from './ui/debug-hud.js';
import { drawCrosshair } from './ui/crosshair.js';
import { Hud } from './ui/hud.js';
import { MagPlot } from './ui/plot.js';
import { SettingsUI } from './ui/settings-ui.js';

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);


/* ---------- iframe check: Google Sites' sandbox blocks pointer lock and fullscreen ---------- */
// Inside a frame we lead with "Open in a full tab". Some frames do allow mouse capture, so
// "Play here" boots the game in place; if capture is refused, the menu says so.
let embedded = false;
try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
if (embedded) {
  $('menu').hidden = true;
  $('embedded').hidden = false;
  $('open-tab').href = location.href;
  $('play-here').addEventListener('click', () => {
    $('embedded').hidden = true;
    $('menu').hidden = false;
    loadGameData().then(boot);
  }, { once: true });
} else {
  loadGameData().then(boot);
}

function boot(data) {
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
  const mover = new MovingDot(range.wallGroup);
  mover.speed = settings.moverSpeed;
  const sfx = new Sfx();
  sfx.setVolume(settings.volume);

  const look = new Look();
  const debug = new DebugHud($('debug'));
  debug.setVisible(settings.debugHud);
  const hud = new Hud($);
  const plot = new MagPlot($('plot'));
  const weapon = new Weapon();
  const recoil = new RecoilEngine();
  const params = new URLSearchParams(location.search);
  const testMode = params.has('test');

  if (data.errors.length || data.warnings.length) {
    const el = $('data-errors');
    el.textContent = (data.errors.length ? 'Gun data problems (see the browser console):\n' + data.errors.join('\n') : '') +
      (data.warnings.length ? (data.errors.length ? '\n' : '') + 'Warnings:\n' + data.warnings.join('\n') : '');
    el.hidden = false;
  }
  if (!data.guns.length) {
    $('start-btn').disabled = true;
    $('start-btn').textContent = 'No valid guns';
    return;
  }

  const state = {
    ads: false, fovH: settings.hipFov, fovV: 60,
    shots: 0, hits: 0,
    gun: null, gunIndex: 0, seed: 0,
  };
  const offset = [0, 0];     // current recoil offset [yaw, pitch] for the camera
  const bulletOff = [0, 0];  // recoil offset of the bullet being fired

  // ADS multiplier for an optic: user override from settings, else data/optics.json.
  function opticMultiplier(zoom) {
    const o = settings.opticOverrides[String(zoom)];
    if (o !== undefined) return o;
    const row = data.optics.find((r) => r.zoom === zoom);
    return row ? row.adsMultiplier : 1;
  }

  // Shots of the current magazine relative to the aim point, for the plot.
  const mag = { xy: new Float64Array(2 * 1000), n: 0, shots: 0, hits: 0 };

  // Sensitivity: hip = base deg/count * gun hip multiplier;
  //              ADS = base deg/count * optic multiplier * gun ADS multiplier.
  function baseDpc() { return degPerCount(settings.dpi, settings.cm360); }
  function currentDpc() {
    const g = state.gun;
    return state.ads ? baseDpc() * opticMultiplier(g.optic) * g.adsMultiplier : baseDpc() * g.hipMultiplier;
  }

  // Fixed seed from settings or ?seed=, otherwise a new random seed per magazine.
  function magazineSeed() {
    const forced = params.get('seed') ?? settings.fixedSeed;
    return forced !== '' && forced !== null && Number.isFinite(Number(forced)) ? Number(forced) >>> 0 : randomSeed();
  }
  function newMagazine() {
    state.seed = magazineSeed();
    recoil.newMagazine(state.seed);
  }

  function selectGun(index) {
    if (index < 0 || index >= data.guns.length) return;
    const gun = data.guns[index];
    state.gun = gun;
    state.gunIndex = index;
    weapon.setGun(gun);
    recoil.setGun(gun);
    viewmodel.setGun(gun, index);
    newMagazine();
    mag.n = mag.shots = mag.hits = 0;
    hud.setGun(gun, index, gun.optic.toFixed(1) + 'x');
    updateFov();
    renderLoadout();
    if (settings.gunIndex !== index) { settings.gunIndex = index; saveSettings(settings); }
  }
  hud.setDistance(range.distance);

  /* ---------- pointer lock ---------- */
  const notice = $('notice');
  const lock = new PointerLock(canvas, {
    onChange(locked) {
      $('menu').hidden = locked;
      if (locked) $('lock-hint').hidden = true;
      else { weapon.releaseTrigger(); setAds(false); settingsUI.refresh(); }
    },
    onRetry() {
      // Usually Chrome refusing a re-lock straight after Esc. Stay quiet; the next click retries.
      const h = $('lock-hint');
      h.textContent = embedded
        ? 'Click again to resume. If the mouse never locks, this frame blocks mouse capture: open the page in its own tab.'
        : 'Click again to resume.';
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
      settingsUI.refresh();
      return;
    }
    if (!lock.locked) return;
    if (c === 'KeyZ' && settings.debugHud) look.reset();
    else if (c === 'KeyR') { if (weapon.startReload(clockNow())) { finishMagazine(); sfx.reload(); } }
    else if (c === 'KeyC') clearRange();
    else if (c === 'KeyM') { settings.movingTarget = !settings.movingTarget; saveSettings(settings); applyMover(); }
    else if (/^Digit[0-9]$/.test(c)) selectGun((Number(c.slice(5)) + 9) % 10); // 1->0 ... 0->9
    else if (c === 'KeyQ' || c === 'KeyE') {
      const i = DISTANCES.indexOf(range.distance) + (c === 'KeyE' ? 1 : -1);
      if (i >= 0 && i < DISTANCES.length) setDistance(DISTANCES[i]);
    }
  });

  function setDistance(d) {
    range.setDistance(d);
    settings.distance = d;
    hud.setDistance(d, settings.movingTarget);
    saveSettings(settings);
  }

  // Loadout grid in the menu: one button per slot (keys 1-9, 0).
  const loadoutEl = $('loadout');
  const slotButtons = data.guns.map((g, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot';
    b.setAttribute('role', 'listitem');
    const add = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; b.append(s); };
    add('slot-key', i < 10 ? String((i + 1) % 10) : '-');
    add('slot-name', g.name);
    add('slot-meta', g.model + ' \u00b7 ' + g.rpm + ' rpm \u00b7 ' + g.magSize + ' rnd \u00b7 ' + g.optic.toFixed(1) + 'x');
    if (g.placeholder) add('slot-ph', 'PLACEHOLDER RECOIL');
    b.addEventListener('click', () => { selectGun(i); settingsUI.refresh(); });
    loadoutEl.append(b);
    return b;
  });
  function renderLoadout() {
    slotButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === state.gunIndex)));
  }

  function applyMover() {
    mover.speed = settings.moverSpeed;
    if (mover.enabled !== settings.movingTarget) {
      mover.setEnabled(settings.movingTarget, clockNow());
      range.paper.visible = !settings.movingTarget;
      mag.n = mag.shots = mag.hits = 0; // don't mix paper and moving shots in one plot
    }
    hud.setDistance(range.distance, settings.movingTarget);
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
    // The bullet leaves through the crosshair: aim + the recoil offset at the shot time.
    recoil.fire(t, bulletOff);
    const yaw = look.yaw + bulletOff[0];
    const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, look.pitch + bulletOff[1]));
    state.shots++;
    mag.shots++;
    if (range.raycastWall(yaw, pitch, hit)) {
      range.holes.add(hit.x, hit.y);
      let tx, ty, onTarget;
      if (mover.enabled) {
        // Relative to the dot centre at the exact shot time.
        tx = hit.x - mover.xAt(t); ty = hit.y - EYE_HEIGHT;
        onTarget = tx * tx + ty * ty <= DOT_RADIUS * DOT_RADIUS;
      } else {
        tx = hit.x; ty = hit.y - EYE_HEIGHT; // target coordinates: aim point at the origin
        onTarget = hitsSilhouette(tx, ty);
      }
      if (onTarget) { state.hits++; mag.hits++; }
      if (mag.n < mag.xy.length / 2) { mag.xy[mag.n * 2] = tx; mag.xy[mag.n * 2 + 1] = ty; mag.n++; }
    }
    if (!testMode) sfx.shot(state.gun.tone);
    viewmodel.shot();
  }

  // Called when a magazine runs dry or a reload starts: draw that magazine's plot.
  function finishMagazine() {
    if (mag.shots === 0) return;
    plot.draw(mag.xy, mag.n, mag.shots, mag.hits, state.gun.name, range.distance, mover.enabled ? DOT_RADIUS : 0);
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
    if (!state.gun) return;
    state.fovH = state.ads ? zoomedFovDeg(settings.hipFov, state.gun.optic) : settings.hipFov;
    state.fovV = verticalFovDeg(state.fovH, camera.aspect);
    camera.fov = state.fovV;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  selectGun(Math.min(settings.gunIndex, data.guns.length - 1));
  resize();
  drawCrosshair($('crosshair'), settings.crosshair);

  /* ---------- settings panel ---------- */
  const settingsUI = new SettingsUI($('settings-root'), {
    settings, guns: data.guns, optics: data.optics, opticMultiplier,
    getState: () => state,
    onChange(key) {
      const all = key === 'all';
      if (all || key === 'scale') resize();
      if (all || key === 'fov') updateFov();
      if (all || key === 'crosshair') drawCrosshair($('crosshair'), settings.crosshair);
      if (all || key === 'holes') range.holes.setSize(settings.holeSizeCm / 100);
      if (all || key === 'volume') sfx.setVolume(settings.volume);
      if (all || key === 'debug') debug.setVisible(settings.debugHud);
      if (all || key === 'gun') selectGun(Math.min(settings.gunIndex, data.guns.length - 1));
      if (all || key === 'distance') setDistance(settings.distance);
      if (all || key === 'mover') applyMover();
      if (key === 'seed') newMagazine(); // takes effect from the current magazine
    },
  });

  /* ---------- frame loop ---------- */
  // In ?test mode the clock is driven by the test script (window.__range.step), so firing and
  // recoil can be checked deterministically without real time or pointer lock.
  let manualClock = false, manualT = 0;
  function clockNow() { return manualClock ? manualT : performance.now() / 1000; }

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
    if (ev === 'reloaded') { sfx.reload(); newMagazine(); }

    // View = aim + recoil offset (view punch), so the crosshair visibly climbs.
    recoil.offsetAt(t, offset);
    const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, look.pitch + offset[1]));
    camera.rotation.y = -(look.yaw + offset[0]) * DEG;   // three.js: positive Y rotation turns left
    camera.rotation.x = pitch * DEG;
    mover.update(t);
    viewmodel.update(dt, settings.showViewmodel && !state.ads);
    hud.setAmmo(weapon.ammo, state.gun.magSize, weapon.reloading);
    hud.setStats(state.shots, state.hits);
    reloadBar(weapon.reloading ? weapon.reloadProgress : -1);
  }

  const reloadEl = $('reload-bar'), reloadFill = reloadEl.firstElementChild;
  let reloadShown = -2;
  function reloadBar(p) {
    const q = p < 0 ? -1 : Math.round(p * 50) / 50;
    if (q === reloadShown) return;
    reloadShown = q;
    reloadEl.hidden = q < 0;
    if (q >= 0) reloadFill.style.width = (q * 100) + '%';
  }

  // Ring of CPU frame costs (update + render submit), read by the frame-time test.
  const cpuMs = new Float32Array(600);
  let cpuIdx = 0, prevFrameMs = 0;

  function frame(nowMs) {
    requestAnimationFrame(frame);
    const c0 = performance.now();
    if (!manualClock) update(clockNow());
    renderer.render(scene, camera);
    cpuMs[cpuIdx++ % cpuMs.length] = performance.now() - c0;
    if (prevFrameMs) debug.recordFrame(nowMs - prevFrameMs);
    prevFrameMs = nowMs;
    if (debug.visible) {
      info.dpc = currentDpc(); info.ads = state.ads; info.raw = lock.raw;
      info.fovH = state.fovH; info.fovV = state.fovV;
      info.recoilYaw = offset[0]; info.recoilPitch = offset[1];
      info.shotIndex = recoil.shotIndex; info.seed = state.seed;
      info.renderW = renderW; info.renderH = renderH;
      info.calls = renderer.info.render.calls; info.tris = renderer.info.render.triangles;
      debug.update(nowMs, info);
    }
  }
  requestAnimationFrame(frame);
  applyMover();

  /* ---------- test hooks (only with ?test in the URL) ---------- */
  if (testMode) {
    window.__range = {
      ready: true,
      guns: data.guns,
      manual(on) { manualClock = on; manualT = performance.now() / 1000; prevT = manualT; },
      // Advance the manual clock in fixed frame steps, running the game update each step.
      step(seconds, fps = 60) {
        const dt = 1 / fps;
        const n = Math.round(seconds * fps);
        for (let i = 0; i < n; i++) { manualT += dt; update(manualT); }
      },
      selectGun, setDistance, clear: clearRange,
      setMover(on, speed) { settings.movingTarget = on; if (speed) settings.moverSpeed = speed; applyMover(); },
      dotX: (t) => mover.xAt(t),
      setAim(yaw, pitch) { look.setAngles(yaw, pitch); },
      applyCounts(dx, dy) { return look.apply(dx, dy, currentDpc()); },
      setAds,
      dpc: currentDpc,
      look: () => ({ yaw: look.yaw, pitch: look.pitch, unwrappedYaw: look.unwrappedYaw, countsX: look.countsX, discarded: look.discarded }),
      trigger(down) { if (down) weapon.pressTrigger(clockNow()); else weapon.releaseTrigger(); },
      reload() { if (weapon.startReload(clockNow())) finishMagazine(); },
      holes() {
        const h = range.holes, out = [];
        const start = h.count < 300 ? 0 : h.next;
        for (let i = 0; i < h.count; i++) { const k = (start + i) % 300; out.push([h.xy[k * 2], h.xy[k * 2 + 1]]); }
        return out;
      },
      state: () => ({ ammo: weapon.ammo, shots: state.shots, hits: state.hits, seed: state.seed, gun: state.gun.id,
        shotIndex: recoil.shotIndex, offset: [offset[0], offset[1]], distance: range.distance, fovH: state.fovH }),
      offsetAt(t) { return recoil.offsetAt(t, [0, 0]); },
      now: () => manualT,
      cpuFrameMs: () => Array.from(cpuMs.subarray(0, Math.min(cpuIdx, cpuMs.length))),
      renderInfo: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, w: renderW, h: renderH }),
    };
  }
}
