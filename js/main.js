// Recoil Range entry point: wires input, camera, scene, HUD and the frame loop together.
import * as THREE from '../vendor/three/three.module.min.js?v=c8418c9-mw475w2y';
import { Look, PITCH_LIMIT } from './core/look.js?v=c8418c9-mw475w2y';
import { Player } from './core/player.js?v=c8418c9-mw475w2y';
import { PointerLock } from './core/pointer-lock.js?v=c8418c9-mw475w2y';
import { loadSettings, saveSettings, DISTANCES } from './core/settings.js?v=c8418c9-mw475w2y';
import { degPerCount, horizontalFovDeg, zoomedFovDeg, focalRatio } from './core/sensitivity.js?v=c8418c9-mw475w2y';
import { Weapon } from './core/weapon.js?v=c8418c9-mw475w2y';
import { RecoilEngine } from './core/recoil.js?v=c8418c9-mw475w2y';
import { loadGameData } from './core/guns.js?v=c8418c9-mw475w2y';
import { randomSeed } from './core/prng.js?v=c8418c9-mw475w2y';
import { Range, EYE_HEIGHT } from './scene/range.js?v=c8418c9-mw475w2y';
import { RING_STEP } from './scene/range-tex.js?v=c8418c9-mw475w2y';
import { WeaponRig, setUltraTexSize, skinName } from './scene/viewmodel.js?v=c8418c9-mw475w2y';
import { LensPost } from './render/lens-post.js?v=c8418c9-mw475w2y';
import { reticleTextures } from './ui/reticle-tex.js?v=c8418c9-mw475w2y';
import { DOT_POINTS } from './scene/dots.js?v=c8418c9-mw475w2y';
import { Sfx } from './audio/sfx.js?v=c8418c9-mw475w2y';
import { DebugHud } from './ui/debug-hud.js?v=c8418c9-mw475w2y';
import { drawCrosshair } from './ui/crosshair.js?v=c8418c9-mw475w2y';
import { Hud } from './ui/hud.js?v=c8418c9-mw475w2y';
import { MagPlot } from './ui/plot.js?v=c8418c9-mw475w2y';
import { SettingsUI } from './ui/settings-ui.js?v=c8418c9-mw475w2y';
import { sensKeys, zoomKey } from './core/optics.js?v=c8418c9-mw475w2y';

// Sens table rows: the magnifications listed in data/sens.json plus any used by a sight.
function sensRows(catalogue, sens) {
  const keys = new Set([...sens.magnifications.map((m) => m.key), ...sensKeys(catalogue)]);
  return [...keys].sort((a, b) => parseFloat(a) - parseFloat(b));
}
import { RETICLE_COLORS, drawScope, drawBackdrop } from './ui/scope.js?v=c8418c9-mw475w2y';
import { Battle } from './battle/battle.js?v=c8418c9-mw475w2y';
import { createJoinRequest, acceptJoin } from './net/link.js?v=c8418c9-mw475w2y';

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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.antialias, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); // devicePixelRatio capped at 1
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
  camera.rotation.order = 'YXZ'; // yaw around world Y first, then pitch: standard FPS camera
  camera.position.set(0, EYE_HEIGHT, 0);
  const player = new Player();
  scene.add(camera);             // so the viewmodel (a camera child) renders

  const range = new Range(scene);
  range.setDistance(settings.distance);
  range.holes.setSize(settings.holeSizeCm / 100);
  renderer.info.autoReset = false; // several passes per frame; reset once per frame
  const rig = new WeaponRig(renderer);
  // Graphics quality: high swaps the range to textured PBR with shadows and tone mapping, and
  // the gun to textured PBR lit by the same sky. Standard is the original fast look.
  const gunShading = () => (settings.graphics === 'low' ? 'fast' : settings.graphics === 'standard' ? settings.weaponShading : settings.graphics);
  // Software rendering in the tests cannot bake 4096 maps quickly; real graphics cards can.
  if (new URLSearchParams(location.search).has('test')) { Range.ULTRA_TEX = 512; setUltraTexSize(512); }
  function applyGraphics() {
    range.setGraphics(settings.graphics, renderer);
    if (range.env) rig.setHighEnv(range.env);
    rig.setShading(gunShading());
  }
  applyGraphics();
  const post = new LensPost(renderer, { samples: settings.antialias && renderer.capabilities.isWebGL2 ? 4 : 0 });
  const dots = range.dots;
  const sfx = new Sfx();
  sfx.setVolume(settings.volume);

  const look = new Look();
  const debug = new DebugHud($('debug'));
  debug.setVisible(settings.debugHud);
  const hud = new Hud($);
  const plot = new MagPlot($('plot'));
  const weapon = new Weapon();
  weapon.reloadSpeed = settings.reloadSpeed;
  const recoil = new RecoilEngine();
  recoil.aimScale = settings.aimRecoil;
  recoil.aimSmooth = settings.aimSmooth;
  const params = new URLSearchParams(location.search);
  const testMode = params.has('test');
  const catalogue = data.catalogue;
  let settingsUI = null; // created further down

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
    ads: false, fovH: 90, fovV: settings.fov,
    shots: 0, hits: 0, headshots: 0, score: 0,
    gun: null, gunIndex: 0, seed: 0,
    optic: null,   // selected sight (resolved catalogue entry)
    adsP: 0,       // ADS blend progress, linear 0 = hip, 1 = fully aimed
    adsE: 0,       // eased ADS blend (drives FOV, sensitivity and the weapon raise)
    adsFov: 83,    // vertical FOV when fully aimed with this sight
  };
  const offset = [0, 0];     // current recoil offset [yaw, pitch] for the camera
  const bulletOff = [0, 0];  // recoil offset of the bullet being fired

  // ADS multiplier for a magnification key ("2.5x"): browser override from Settings, else
  // data/sens.json, else a placeholder of the 1.0x value divided by the zoom.
  function opticMultiplier(key) {
    const o = settings.opticOverrides[key];
    if (o !== undefined) return o;
    const f = data.sens.ads[key];
    if (f !== undefined) return f;
    return key === '1.0x' ? 1 : opticMultiplier('1.0x') / parseFloat(key);
  }
  function isPlaceholder(key) {
    return settings.opticOverrides[key] === undefined && data.sens.ads[key] === undefined;
  }

  // Shots of the current magazine relative to the aim point, for the plot.
  const mag = { xy: new Float64Array(2 * 1000), n: 0, shots: 0, hits: 0 };

  // Sensitivity: hip = base deg/count * gun hip multiplier;
  //              ADS = base deg/count * optic multiplier * gun ADS multiplier.
  function baseDpc() { return degPerCount(settings.dpi, settings.cm360); }
  // Sensitivity follows the FOV (data/sens.json model): the multiplier moves from hip to the
  // aimed value by exactly as much as the FOV has moved (in tan-space). Fully aimed, it is
  // the aimed multiplier from adsCm360; at hip it is the hip multiplier.
  function fovProgress() {
    const tHip = Math.tan(settings.fov * DEG / 2), tAds = Math.tan(state.adsFov * DEG / 2);
    if (Math.abs(tHip - tAds) < 1e-9) return state.adsE;
    return Math.min(1, Math.max(0, (tHip - Math.tan(state.fovV * DEG / 2)) / (tHip - tAds)));
  }
  // Two models (Settings > Aimed sensitivity):
  //  focal: focal-length scaling. Sensitivity = hip x focalRatio(current FOV), recomputed every
  //         frame from the FOV actually on screen, so it eases in lockstep with the zoom and a
  //         given mouse movement moves the view the same distance on screen at the crosshair
  //         (monitor distance 0%), hip or fully aimed. The gun's own multipliers still apply.
  //  game:  your game's aimed multipliers (sens.json adsCm360), blended by the FOV progress.
  function currentDpc() {
    const g = state.gun;
    if (settings.adsSens === 'focal') {
      const gm = g.hipMultiplier + (g.adsMultiplier - g.hipMultiplier) * fovProgress();
      return baseDpc() * gm * focalRatio(state.fovV, settings.fov, settings.mdm);
    }
    const hip = g.hipMultiplier, ads = opticMultiplier(state.optic.sensKey) * g.adsMultiplier;
    return baseDpc() * (hip + (ads - hip) * fovProgress());
  }
  // Aimed multiplier for a sight (fully aimed), for the Settings readout.
  function aimedMultiplier(optic) {
    if (settings.adsSens === 'focal') return focalRatio(adsVFov(optic), settings.fov, settings.mdm) * state.gun.adsMultiplier;
    return opticMultiplier(optic.sensKey) * state.gun.adsMultiplier;
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
    newMagazine();
    mag.n = mag.shots = mag.hits = 0;
    renderLoadout();
    setOptic(savedOptic(gun), false);
    if (settings.gunIndex !== index) { settings.gunIndex = index; saveSettings(settings); }
  }
  hud.setDistance(range.distance);

  /* ---------- sights ---------- */
  // The chosen sight is saved per slot ("scope:<gun id>"). A saved id that the gun no longer
  // allows falls back to the gun's defaultOptic.
  function savedOptic(gun) {
    let id = null;
    try { id = localStorage.getItem('scope:' + gun.id); } catch (e) { id = null; }
    return gun.optics.includes(id) ? id : gun.defaultOptic;
  }
  function setOptic(id, save = true) {
    const gun = state.gun;
    if (!gun.optics.includes(id)) return;
    state.optic = catalogue.byId.get(id);
    if (save) { try { localStorage.setItem('scope:' + gun.id, id); } catch (e) { /* ignore */ } }
    recoil.setScale(gun.opticRecoilScale[id] || 1); // sprayPath is only scaled when the data says so
    rig.setGun(gun, state.gunIndex, state.optic);
    hud.setGun(gun, state.gunIndex, state.optic.label, settings.graphics === 'ultra' ? skinName(state.gunIndex) : '');
    renderSightRow();
    updateFov();
    if (settingsUI) settingsUI.refreshDerived();
  }
  function cycleOptic(d) {
    const l = state.gun.optics;
    setOptic(l[(l.indexOf(state.optic.id) + d + l.length) % l.length]);
  }

  // "Sight" row in the loadout panel: the slot's allowed sights, grouped, with previews.
  const sightRow = $('sight-row');
  let sightRowFor = '';
  const sightButtons = new Map();
  function renderSightRow(force) {
    const gun = state.gun;
    const color = RETICLE_COLORS[settings.reticleColor];
    if (force || sightRowFor !== gun.id + color) {
      sightRowFor = gun.id + color;
      sightRow.textContent = '';
      sightButtons.clear();
      for (const [gid, grp] of Object.entries(catalogue.groups)) {
        const ids = gun.optics.filter((id) => catalogue.byId.get(id).group === gid);
        if (!ids.length) continue;
        const box = document.createElement('div');
        box.className = 'sight-group';
        const h = document.createElement('h3');
        h.textContent = grp.label + ' \u00b7 ' + grp.zoom.toFixed(1) + 'x';
        const list = document.createElement('div');
        list.className = 'sight-list';
        for (const id of ids) {
          const o = catalogue.byId.get(id);
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'sight';
          const cv = document.createElement('canvas');
          cv.width = 128; cv.height = 72;
          const g = cv.getContext('2d');
          drawBackdrop(g, 128, 72);
          // Zoom the preview so the housing fills the tile (same drawing code, just magnified).
          const hs = o.housing, k = Math.min(3, 0.8 / Math.max(hs.h + 2 * hs.bezel, (hs.w + 2 * hs.bezel) * 72 / 128));
          g.setTransform(k, 0, 0, k, 64 * (1 - k), 36 * (1 - k));
          drawScope(g, 128, 72, o, color);
          g.setTransform(1, 0, 0, 1, 0, 0);
          const label = document.createElement('span');
          label.textContent = o.label;
          b.append(cv, label);
          b.addEventListener('click', () => setOptic(id));
          list.append(b);
          sightButtons.set(id, b);
        }
        box.append(h, list);
        sightRow.append(box);
      }
    }
    for (const [id, b] of sightButtons) b.setAttribute('aria-pressed', String(id === state.optic.id));
    $('sight-note').textContent = (gun.opticsVerified ? '' : 'Sight list not yet checked in game. ') + '[ and ] switch sights while not aiming.';
  }

  // F4 sight gallery: every sight rendered by the real pipeline (3D sight + lens pass) at
  // 1920x1080 in three states: hip, fully aimed, and mid-recoil (kicked back, view punched up,
  // muzzle flash on the lens). Then shrunk into the grid.
  function setRenderSize(w, h) {
    renderW = w; renderH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    post.setSize(w, h);
    rig.setAspect(w / h, h);
    updateFov();
  }
  function toggleGallery(show) {
    const el = $('gallery');
    const open = show !== undefined ? show : el.hidden;
    el.hidden = !open;
    if (!open) return;
    const grid = $('gallery-grid');
    grid.textContent = '';
    const saved = { optic: state.optic, ads: state.ads, adsP: state.adsP, adsE: state.adsE, lastShotT, frameT,
      rx: camera.rotation.x, ry: camera.rotation.y };
    setRenderSize(1920, 1080);
    const modes = [['hip', 'Hip'], ['ads', 'Aimed'], ['recoil', 'Mid-recoil']];
    for (const o of catalogue.optics) {
      const fig = document.createElement('figure');
      const row = document.createElement('div');
      row.className = 'gal-row';
      for (const [mode, label] of modes) {
        state.optic = o;
        rig.setGun(state.gun, state.gunIndex, o);
        state.ads = mode !== 'hip';
        state.adsP = state.adsE = mode === 'hip' ? 0 : 1;
        updateFov();
        rig.sx = rig.sy = rig.vx = rig.vy = rig.vz = rig.vp = 0;
        rig.kz = mode === 'recoil' ? 0.009 : 0;
        rig.kp = mode === 'recoil' ? 0.02 : 0;
        camera.rotation.set(mode === 'recoil' ? 1.5 * DEG : 0, 0, 0);
        frameT = 10; lastShotT = mode === 'recoil' ? 10 - 0.02 : -1;
        rig.drawT = 1; rig.reloadP = -1;
        rig.update(0, state.adsE, 0);
        renderFrame();
        const box = document.createElement('div');
        const cv = document.createElement('canvas');
        cv.width = 480; cv.height = 270;
        cv.getContext('2d').drawImage(renderer.domElement, 0, 0, 480, 270);
        const cap = document.createElement('span');
        cap.textContent = label;
        box.append(cv, cap);
        row.append(box);
      }
      const title = document.createElement('figcaption');
      title.textContent = o.id + ' · ' + o.label + ' · ' + o.zoom.toFixed(1) + 'x · ' + catalogue.groups[o.group].label +
        ' · aimed vFOV ' + adsVFov(o).toFixed(1) + '°';
      fig.append(title, row);
      grid.append(fig);
    }
    Object.assign(state, { optic: saved.optic, ads: saved.ads, adsP: saved.adsP, adsE: saved.adsE });
    lastShotT = saved.lastShotT; frameT = saved.frameT;
    camera.rotation.x = saved.rx; camera.rotation.y = saved.ry;
    rig.setGun(state.gun, state.gunIndex, state.optic);
    resize();
  }
  $('gallery-close').addEventListener('click', () => toggleGallery(false));

  /* ---------- pointer lock ---------- */
  const notice = $('notice');
  const lock = new PointerLock(canvas, {
    onChange(locked) {
      if (battle && battle.active) {
        if (locked) { battle.resume(clockNow()); $('menu').hidden = true; }
        else { battle.pause(); $('menu').hidden = battle.over; settingsUI.refresh(); }
        if (locked) $('lock-hint').hidden = true;
        return;
      }
      $('menu').hidden = locked;
      if (locked) $('lock-hint').hidden = true;
      else { weapon.releaseTrigger(); setAds(false); player.releaseKeys(); player.crouched = false; settingsUI.refresh(); }
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
    if (battle && battle.active) { battle.mouseMove(e.movementX, e.movementY); return; }
    // Siege-style: vertical sensitivity scales pitch; aim assist may slow the aim near a target.
    const dpc = currentDpc() * assistSlow;
    if (look.apply(e.movementX, e.movementY, dpc, dpc * settings.sensV / settings.sensH) && state.adsP > 0) {
      // Scope sway: the housing lags behind the turn (degrees -> screen pixels).
      const pxPerDeg = window.innerHeight / state.fovV;
      rig.nudge(e.movementX * dpc * pxPerDeg, e.movementY * dpc * pxPerDeg);
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!lock.locked) return;
    if (battle && battle.active) { if (e.button >= 3) e.preventDefault(); battle.mouseButton(e.button, true); return; }
    if (e.button === 0) {
      if (weapon.ammo === 0 && !weapon.reloading) sfx.click();
      weapon.pressTrigger(e.timeStamp / 1000);
    } else if (e.button === 2) setAds(true);
    else if (e.button === 3) { e.preventDefault(); player.leanL = true; }   // mouse back button: lean left
    else if (e.button === 4) { e.preventDefault(); player.leanR = true; }   // mouse forward button: lean right
  });
  document.addEventListener('mouseup', (e) => {
    if (battle && battle.active) { battle.mouseButton(e.button, false); return; }
    if (e.button === 0) weapon.releaseTrigger();
    else if (e.button === 2) setAds(false);
    else if (e.button === 3) { e.preventDefault(); player.leanL = false; }
    else if (e.button === 4) { e.preventDefault(); player.leanR = false; }
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Ease-out both ways: aiming in, e = 1 - (1 - p)^3; aiming out, e = p^3 on the way back
  // (fast first, slow landing at hip). Switching direction mid-way remaps p so e is continuous.
  // Snappy: an ease-out curve (fast start, heavy visual change on frame one, quick settle)
  // drives the zoom, gun raise, lens effects and crosshair fade, in both directions. Going
  // in e = 1 - (1 - p)^3; going out e = p^3 on the way back. Switching direction half way
  // remaps p so nothing jumps.
  const easeOut = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
  function adsEase(p, aimingIn) { return aimingIn ? easeOut(p) : 1 - easeOut(1 - p); }
  function setAds(on) {
    if (state.ads === on) return;
    const e = state.adsE;
    state.ads = on;
    if (on) rig.cancelInspect();
    state.adsP = on ? 1 - Math.cbrt(1 - e) : Math.cbrt(e);
    updateFov();
  }

  /* ---------- keys ---------- */
  document.addEventListener('keyup', (e) => {
    const c = e.code;
    if (battle && battle.active) { if (battle.key(c, false)) e.preventDefault(); return; }
    if (c === 'KeyW' || c === 'KeyA' || c === 'KeyS' || c === 'KeyD') player.keys[c[3].toLowerCase()] = false;
    else if (c === 'ShiftLeft' || c === 'ShiftRight') player.sprint = false;
    else if (c === 'KeyQ') player.leanL = false;
    else if (c === 'KeyE') player.leanR = false;
    else if (c === 'Space') { player.crouched = false; hud.setDistance(range.distance, targetLabel()); }
  });
  window.addEventListener('blur', () => { player.releaseKeys(); player.crouched = false; });
  document.addEventListener('keydown', (e) => {
    if (e.repeat && e.code !== 'KeyR') return;
    const c = e.code;
    if (c === 'F4') { e.preventDefault(); toggleGallery(); return; }
    if (c === 'Escape' && !$('gallery').hidden) { toggleGallery(false); return; }
    if (c === 'F3') {
      e.preventDefault();
      settings.debugHud = !settings.debugHud;
      debug.setVisible(settings.debugHud);
      saveSettings(settings);
      settingsUI.refresh();
      return;
    }
    if (!lock.locked && !testMode) return;
    if (battle && battle.active) { if (battle.key(c, true)) e.preventDefault(); return; }
    if (c === 'KeyW' || c === 'KeyA' || c === 'KeyS' || c === 'KeyD') { player.keys[c[3].toLowerCase()] = true; return; }
    if (c === 'ShiftLeft' || c === 'ShiftRight') { player.sprint = true; return; }
    if (c === 'KeyQ') { player.leanL = true; return; }   // hold to lean left
    if (c === 'KeyE') { player.leanR = true; return; }   // hold to lean right
    // Hold Space to crouch (released in keyup).
    if (c === 'Space') { e.preventDefault(); player.crouched = true; hud.setDistance(range.distance, targetLabel()); return; }
    if (c === 'KeyX') { player.reset(); return; }
    if (c === 'KeyZ' && settings.debugHud) look.reset();
    else if (c === 'KeyR') { if (weapon.startReload(clockNow())) { finishMagazine(); sfx.reload(); } }
    else if (c === 'KeyC') clearRange();
    else if (c === 'KeyI' && !state.ads) rig.inspect();
    else if ((c === 'BracketLeft' || c === 'BracketRight') && !state.ads) cycleOptic(c === 'BracketLeft' ? -1 : 1);
    else if (c === 'KeyM') {
      // Cycle: dummy -> paper -> red dots (still) -> red dots (moving) -> dummy
      if (settings.targetMode === 'dummy') settings.targetMode = 'paper';
      else if (settings.targetMode === 'paper') { settings.targetMode = 'dots'; settings.dotMoving = false; }
      else if (!settings.dotMoving) settings.dotMoving = true;
      else settings.targetMode = 'dummy';
      saveSettings(settings); applyTarget(); settingsUI.refresh();
    }
    else if (/^Digit[0-9]$/.test(c)) selectGun((Number(c.slice(5)) + 9) % 10); // 1->0 ... 0->9
    else if (c === 'Minus' || c === 'NumpadSubtract' || c === 'Equal' || c === 'NumpadAdd') {
      const i = DISTANCES.indexOf(range.distance) + (c === 'Equal' || c === 'NumpadAdd' ? 1 : -1);
      if (i >= 0 && i < DISTANCES.length) setDistance(DISTANCES[i]);
    }
  });

  function setDistance(d) {
    range.setDistance(d);
    settings.distance = d;
    hud.setDistance(d, targetLabel());
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
    add('slot-meta', (g.side ? g.side + ' \u00b7 ' : '') + g.model + ' \u00b7 ' + g.rpm + ' rpm \u00b7 ' + g.magSize + ' rnd \u00b7 ' + g.optics.length + ' sights');
    if (g.damage !== null) add('slot-meta', 'damage ' + g.damage);
    if (g.placeholder) add('slot-ph', 'PLACEHOLDER RECOIL');
    else add('slot-ph measured', 'MEASURED SPRAY' + (g.placeholderFields.length ? ' \u00b7 ' + g.placeholderFields.length + ' placeholder values' : ''));
    b.title = g.placeholder ? 'Invented test pattern' : 'Spray measured at ' + g.measuredAtVFov + '\u00b0 vertical FOV.' +
      (g.placeholderFields.length ? ' Still placeholders: ' + g.placeholderFields.join(', ') + '.' : '');
    b.addEventListener('click', () => { selectGun(i); settingsUI.refresh(); });
    loadoutEl.append(b);
    return b;
  });
  function renderLoadout() {
    slotButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === state.gunIndex)));
  }

  function targetLabel() {
    const m = settings.targetMode;
    const t = m === 'dummy' ? 'dummy' : m === 'paper' ? 'paper target' : settings.dotCount + ' red dot' + (settings.dotCount > 1 ? 's' : '') + (settings.dotMoving ? ', moving' : '');
    range.setBoardLabel(t, m);
    return (player.crouched ? 'crouched \u00b7 ' : '') + t;
  }
  // Show the dummy or lay out the red dots (new random spots each time, or ?seed= for tests).
  let dotSeed = 1;
  function applyTarget() {
    const dotsMode = settings.targetMode === 'dots';
    range.dummy.visible = settings.targetMode === 'dummy';
    range.paper.visible = settings.targetMode === 'paper';
    dots.setVisible(dotsMode);
    if (dotsMode) {
      dotSeed = params.get('seed') !== null ? Number(params.get('seed')) >>> 0 : randomSeed();
      dots.configure({ count: settings.dotCount, radius: settings.dotSizeCm / 200, moving: settings.dotMoving, speed: settings.dotSpeed }, clockNow(), dotSeed);
    }
    mag.n = mag.shots = mag.hits = 0; // don't mix target types in one plot
    hud.setDistance(range.distance, targetLabel());
  }

  // C or the Clear button: every bullet hole and all shot data (counters, score, headshots,
  // the magazine plot and the recorded shot positions). The spray restarts at bullet 1.
  function clearRange() {
    range.holes.clear();
    state.shots = state.hits = state.headshots = state.score = 0;
    mag.n = mag.shots = mag.hits = 0;
    shotPtsN = 0;
    recoil.shotIndex = 0;
    $('hud-plot').hidden = true;
  }
  $('clear-btn').addEventListener('click', () => { clearRange(); flashNotice('Cleared all bullet holes and shot data.'); });
  let noticeTimer = 0;
  function flashNotice(text, ms = 2500) {
    const n = $('menu-note');
    n.textContent = text;
    n.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { n.hidden = true; }, ms);
  }

  /* ---------- firing ---------- */
  const hit = { kind: null, zone: null, planeOk: false, plane: [0, 0], p: [0, 0, 0], n: [0, 0, 1] };
  // Every shot's crossing of the target plane, relative to the aim point (for tests).
  const shotPts = new Float64Array(2 * 2000);
  let shotPtsN = 0;
  function fireShot(t) {
    // The bullet leaves through the crosshair: aim + the recoil offset at the shot time.
    recoil.aimed = state.ads;
    recoil.fire(t, bulletOff);
    const yaw = look.yaw + bulletOff[0];
    const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, look.pitch + bulletOff[1]));
    state.shots++;
    mag.shots++;
    const kind = range.raycast(yaw, pitch, hit, player.ex, player.ey, player.ez);
    // Spent casing: ejected to the right, landing a little in front of you.
    range.addCasing(Math.max(-1.6, Math.min(1.6, player.x + 0.25 + Math.random() * 0.6)), Math.min(-0.1, player.z - 0.1 - Math.random() * 0.45));
    let onTarget = false, dotHit = -1;
    if (hit.planeOk) {
      // Plot coordinates: where the bullet crosses the target plane, relative to the aim
      // point (the dummy's head centre), or to the nearest red dot in dots mode.
      let tx = hit.plane[0], ty = hit.plane[1];
      if (shotPtsN < shotPts.length / 2) { shotPts[shotPtsN * 2] = tx; shotPts[shotPtsN * 2 + 1] = ty; shotPtsN++; }
      if (dots.visible) {
        const py = ty + EYE_HEIGHT;
        dotHit = dots.hitTest(tx, py, t);
        let best = -1, bd = Infinity;
        for (let i = 0; i < dots.count; i++) {
          const d = Math.hypot(tx - dots.xAt(i, t), py - dots.y[i]);
          if (d < bd) { bd = d; best = i; }
        }
        const ref = dotHit >= 0 ? dotHit : best;
        tx -= dots.xAt(ref, t); ty = py - dots.y[ref];
        if (dotHit >= 0) { onTarget = true; state.score += DOT_POINTS; dots.pop(dotHit, t); }
      } else if (kind === 'dummy') {
        onTarget = true;
        if (hit.zone === 'head') state.headshots++;
      } else if (kind === 'paper') {
        // Ring score: 10 inside the first ring, 1 in the tenth, 0 on the card outside them.
        onTarget = true;
        const ring = Math.ceil(Math.hypot(tx, ty) / RING_STEP);
        state.score += ring >= 1 && ring <= 10 ? 11 - ring : (ring === 0 ? 10 : 0);
      }
      if (mag.n < mag.xy.length / 2) { mag.xy[mag.n * 2] = tx; mag.xy[mag.n * 2 + 1] = ty; mag.n++; }
    }
    if (onTarget) { state.hits++; mag.hits++; }
    // A popped dot stops the bullet; anything else leaves a hole where it landed.
    if (kind && dotHit < 0) range.holes.add(hit.p[0], hit.p[1], hit.p[2], hit.n[0], hit.n[1], hit.n[2]);
    if (!testMode) sfx.shot(state.gun.tone);
    rig.kick();
    lastShotT = t;   // muzzle flash on the lens
  }

  // Called when a magazine runs dry or a reload starts: draw that magazine's plot.
  function finishMagazine() {
    if (mag.shots === 0) return;
    plot.draw(mag.xy, mag.n, mag.shots, mag.hits, state.gun.name + ' \u00b7 ' + state.optic.id, range.distance, dots.visible ? dots.radius : 0, range.paper.visible ? RING_STEP : 0);
    $('hud-plot').hidden = false;
    mag.n = mag.shots = mag.hits = 0;
  }

  /* ---------- resize / FOV ---------- */
  let renderW = 0, renderH = 0;
  function resize() {
    // Auto: the screen's own sharpness (devicePixelRatio, 1x to 2x). Above 1 = supersampling.
    // Ultra (graphics card) supersamples at least 150% on Auto so the fine detail resolves.
    // Low draws at plain 100% even on a high-DPI screen.
    const s = settings.renderScale || (settings.graphics === 'low' ? 1 : Math.min(2, Math.max(settings.graphics === 'ultra' ? 1.5 : 1, window.devicePixelRatio || 1)));
    renderW = Math.max(1, Math.round(window.innerWidth * s));
    renderH = Math.max(1, Math.round(window.innerHeight * s));
    renderer.setSize(renderW, renderH, false);
    camera.aspect = renderW / renderH;
    post.setSize(renderW, renderH);
    rig.setAspect(renderW / renderH, renderH);
    updateFov();
  }
  // Aimed vertical FOV = hip FOV * data/sens.json model.adsVFovMultipliers[magnification]
  // (1.0x 0.9, 2.5x 0.42). A magnification without a value uses 2 * atan(tan(hip / 2) / zoom).
  // The FOV eases between hip and aimed in tan-space.
  function adsVFov(optic) {
    const m = data.sens.model.adsVFovMultipliers[zoomKey(optic.zoom)];
    return m !== undefined ? settings.fov * m : zoomedFovDeg(settings.fov, optic.zoom);
  }
  // The FOV setting is VERTICAL (like the game's slider), so the vertical angle is fixed and
  // the horizontal one follows the window's aspect ratio. Zoom divides tan() of either one.
  function updateFov() {
    if (!state.gun || !state.optic) return;
    state.adsFov = adsVFov(state.optic);
    const tHip = Math.tan(settings.fov * DEG / 2), tAds = Math.tan(state.adsFov * DEG / 2);
    state.fovV = 2 * Math.atan(tHip + (tAds - tHip) * state.adsE) / DEG;
    state.fovH = horizontalFovDeg(state.fovV, camera.aspect);
    camera.fov = state.fovV;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  selectGun(Math.min(settings.gunIndex, data.guns.length - 1));
  resize();
  drawCrosshair($('crosshair'), settings.crosshair);

  /* ---------- settings panel ---------- */
  settingsUI = new SettingsUI($('settings-root'), {
    settings, guns: data.guns, sensKeys: sensRows(catalogue, data.sens), sensFile: data.sens.ads, aimedMultiplier,
    gameSliders: Object.fromEntries(data.sens.magnifications.map((m) => [m.key, m.slider])), gameSens: data.sens.game, opticMultiplier, isPlaceholder,
    getState: () => state,
    onChange(key) {
      const all = key === 'all';
      if (all || key === 'scale') resize();
      if (all || key === 'fov') updateFov();
      if (all || key === 'crosshair') drawCrosshair($('crosshair'), settings.crosshair);
      if (all || key === 'holes') range.holes.setSize(settings.holeSizeCm / 100);
      if (all || key === 'reload') weapon.reloadSpeed = settings.reloadSpeed;
      if (all || key === 'shading' || key === 'graphics') { applyGraphics(); rig.setGun(state.gun, state.gunIndex, state.optic); hud.setGun(state.gun, state.gunIndex, state.optic.label, settings.graphics === 'ultra' ? skinName(state.gunIndex) : ''); resize(); }
      // Battle in progress: after the range (which sets the shared gun shading), rebuild its view.
      if (battle && battle.active && (all || key === 'shading' || key === 'graphics' || key === 'reticle')) battle.refreshGraphics();
      if (key === 'sens' || key === 'assist') { /* read live each mouse event */ }
      if (all || key === 'recoil') { recoil.aimScale = settings.aimRecoil; recoil.aimSmooth = settings.aimSmooth; }
      if (all || key === 'volume') sfx.setVolume(settings.volume);
      if (all || key === 'debug') debug.setVisible(settings.debugHud);
      if (all || key === 'gun') selectGun(Math.min(settings.gunIndex, data.guns.length - 1));
      if (all || key === 'distance') setDistance(settings.distance);
      if (all || key === 'target') applyTarget();
      if (all || key === 'reticle') renderSightRow(true);
      if (key === 'seed') newMagazine(); // takes effect from the current magazine
    },
  });

  /* ---------- battle mode ---------- */
  var netInit = false;   // the network lobby below is ready (var: readable before its line)
  // Created on first use (it builds its own arena and weapon models).
  let battle = null;
  const bEl = (id) => $(id);
  {
    const p2 = bEl('b-p2gun');
    data.guns.forEach((g, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = (i + 1) % 10 + '  ' + g.name; p2.append(o); });
    const B = settings.battle;
    bEl('b-opp').value = B.opponent; bEl('b-bots').value = String(B.bots); bEl('b-level').value = B.level;
    bEl('b-kills').value = String(B.kills); p2.value = String(Math.min(B.p2Gun, data.guns.length - 1));
    const sync = () => {
      Object.assign(settings.battle, { opponent: bEl('b-opp').value, bots: Number(bEl('b-bots').value), level: bEl('b-level').value, kills: Number(bEl('b-kills').value), p2Gun: Number(p2.value) });
      bEl('b-p2gun-field').hidden = settings.battle.opponent !== 'p2';
      bEl('net-panel').hidden = settings.battle.opponent !== 'net';
      saveSettings(settings);
      if (netInit) netUi();
    };
    for (const id of ['b-opp', 'b-bots', 'b-level', 'b-kills', 'b-p2gun']) bEl(id).addEventListener('change', sync);
    sync();
  }
  function battleDeps() {
    return {
      renderer, settings, guns: data.guns, sfx,
      opticFor: (g) => catalogue.byId.get(savedOptic(g)), adsVFov, baseDpc, now: clockNow,
      slotOf: (g) => data.guns.indexOf(g), onEnd: () => lock.exit(), hudRoot: $('app'),
      onNetLost: (msg) => { netReset(); leaveBattle(); netStatus(msg, 'bad'); },
    };
  }
  function startBattle() {
    const B = settings.battle;
    if (B.opponent === 'bots' && B.bots < 1) { flashNotice('Choose at least one bot.'); return; }
    if (B.opponent === 'net') {
      if (net.role === 'client') { flashNotice('Only the host can start a network battle.'); return; }
      if (net.role !== 'host' || (!net.peers.length && B.bots < 1)) { flashNotice('Host a game and connect at least one player (or add bots) first.'); return; }
    }
    if (!battle) {
      battle = new Battle(battleDeps());
      battle.hud.again.addEventListener('click', () => { startBattle(); });
      battle.hud.leave.addEventListener('click', leaveBattle);
    }
    weapon.releaseTrigger(); setAds(false); player.releaseKeys();
    try {
      battle.start({ opponent: B.opponent, bots: B.bots, level: B.level, killsToWin: B.kills, p1Gun: state.gun, p2Gun: data.guns[Math.min(B.p2Gun, data.guns.length - 1)],
        hostName: 'Host', remotes: B.opponent === 'net' ? net.peers.map((e) => ({ link: e.link, name: e.name, gunIndex: e.gunIndex })) : [] });
    } catch (err) {
      // Usually a half-updated page (old files still cached): say so instead of doing nothing.
      console.error(err);
      if (battle) battle.stop();
      flashNotice('Could not start the battle (' + (err && err.message || err) + '). Press Ctrl+F5 to load the latest version.', 9000);
      return;
    }
    $('hud').hidden = true;
    $('start-btn').textContent = 'Resume battle';
    $('battle-leave').hidden = false;
    $('battle-btn').textContent = 'Restart battle';
    if (!testMode) startLock();
  }
  function leaveBattle() {
    if (!battle) return;
    battle.stop();
    $('hud').hidden = false;
    $('start-btn').textContent = 'Click to start';
    $('battle-leave').hidden = true;
    $('battle-btn').textContent = 'Start battle';
    $('menu').hidden = lock.locked;
    if (netInit) netUi();
    applyGraphics();
    rig.setGun(state.gun, state.gunIndex, state.optic);
    resize();
  }
  $('battle-btn').addEventListener('click', startBattle);

  /* ---------- network lobby (join codes, no server) ---------- */
  const net = { role: null, peers: [], request: null, link: null };
  function netStatus(text, kind = '') { const e = $('net-status'); e.textContent = text; e.className = 'small ' + kind; }
  function netUi() {
    $('net-host-box').hidden = net.role !== 'host';
    $('net-join-box').hidden = net.role !== 'client';
    $('net-host').hidden = $('net-join').hidden = !!net.role;
    $('net-reset').hidden = !net.role;
    $('net-players').textContent = net.peers.length ? net.peers.map((e) => e.name + ' (' + data.guns[e.gunIndex].name + ')').join(', ') : 'none yet';
    const waiting = settings.battle.opponent === 'net' && net.role === 'client';
    $('battle-btn').disabled = waiting && !(battle && battle.active);
    if (waiting && !(battle && battle.active)) $('battle-btn').textContent = net.link ? 'Waiting for the host to start' : 'Only the host starts the battle';
  }
  function netReset() {
    for (const e of net.peers) e.link.close();
    if (net.link) net.link.close();
    if (net.request) net.request.cancel();
    net.role = null; net.peers = []; net.request = null; net.link = null;
    for (const id of ['net-in-h', 'net-out-h', 'net-in-j', 'net-out-j']) $(id).value = '';
    $('net-reply-box').hidden = true;
    $('battle-btn').disabled = false;
    netUi();
  }
  const copy = async (id) => {
    const t = $(id);
    try { await navigator.clipboard.writeText(t.value); netStatus('Copied.', 'ok'); }
    catch (e) { t.select(); netStatus('Press Ctrl+C to copy the selected code.'); }
  };
  $('net-copy-h').addEventListener('click', () => copy('net-out-h'));
  $('net-copy-j').addEventListener('click', () => copy('net-out-j'));
  $('net-reset').addEventListener('click', () => { if (battle && battle.active && battle.net) leaveBattle(); netReset(); netStatus('Disconnected.'); });

  // Host
  $('net-host').addEventListener('click', () => { net.role = 'host'; netUi(); netStatus('Ask each player to press "Join a game" and send you their join code.'); });
  $('net-accept').addEventListener('click', async () => {
    const code = $('net-in-h').value.trim();
    if (!code) { netStatus('Paste a join code first.', 'bad'); return; }
    try {
      netStatus('Making the reply code...');
      const acc = await acceptJoin(code);
      $('net-out-h').value = acc.code;
      $('net-reply-box').hidden = false;
      $('net-in-h').value = '';
      netStatus('Send the reply code back. Waiting for them to connect...');
      acc.link.then((link) => {
        const entry = { link, name: 'Player ' + (net.peers.length + 2), gunIndex: 0 };
        net.peers.push(entry);
        link.onmessage = (m) => {
          if (m.k === 'hello') { entry.gunIndex = Math.min(data.guns.length - 1, Math.max(0, m.gun | 0)); netUi(); return; }
          if (battle && battle.active && battle.net) battle.onNet(link, m);
        };
        link.onclose = () => {
          net.peers.splice(net.peers.indexOf(entry), 1);
          if (battle && battle.active && battle.net) battle.onLinkClosed(link);
          netUi(); netStatus(entry.name + ' disconnected.', 'bad');
        };
        netUi(); netStatus(entry.name + ' connected.', 'ok');
        $('net-reply-box').hidden = true;
      }).catch((err) => netStatus(err.message, 'bad'));
    } catch (err) { netStatus(err.message, 'bad'); }
  });

  // Joiner
  $('net-join').addEventListener('click', async () => {
    net.role = 'client'; netUi();
    try {
      netStatus('Making your join code...');
      net.request = await createJoinRequest();
      $('net-out-j').value = net.request.code;
      netStatus('Send the join code to the host, then paste their reply code below.');
    } catch (err) { netStatus(err.message, 'bad'); }
  });
  $('net-connect').addEventListener('click', async () => {
    if (!net.request) return;
    try {
      netStatus('Connecting...');
      const link = await net.request.finish($('net-in-j').value.trim());
      net.request = null; net.link = link;
      link.send({ k: 'hello', gun: state.gunIndex });
      link.onmessage = (m) => {
        if (m.k === 'start') { startClientBattle(m); return; }
        if (m.k === 'stopped') { if (battle && battle.active) { leaveBattle(); netStatus('The host ended the match. Still connected: wait for the next one.', 'ok'); } return; }
        if (battle && battle.active && battle.net) battle.onNet(link, m);
      };
      link.onclose = () => {
        if (battle && battle.active && battle.net) battle.onLinkClosed(link);
        else { netReset(); netStatus('Disconnected from the host.', 'bad'); }
      };
      netUi(); netStatus('Connected. Waiting for the host to start the battle.', 'ok');
    } catch (err) { netStatus(err.message, 'bad'); }
  });
  netInit = true;
  netUi();
  function startClientBattle(m) {
    if (!battle) {
      battle = new Battle(battleDeps());
      battle.hud.again.addEventListener('click', () => { startBattle(); });
      battle.hud.leave.addEventListener('click', leaveBattle);
    }
    weapon.releaseTrigger(); setAds(false); player.releaseKeys();
    battle.startClient(m, net.link);
    $('hud').hidden = true;
    $('start-btn').textContent = 'Join the battle';
    $('battle-leave').hidden = false;
    netUi();
    if (!lock.locked) { $('menu').hidden = false; flashNotice('The battle has started: click "Join the battle".', 6000); }
  }
  $('battle-leave').addEventListener('click', leaveBattle);

  /* ---------- frame loop ---------- */
  // In ?test mode the clock is driven by the test script (window.__range.step), so firing and
  // recoil can be checked deterministically without real time or pointer lock.
  let manualClock = false, manualT = 0;
  function clockNow() { return manualClock ? manualT : performance.now() / 1000; }

  const info = {
    look, dpc: 0, ads: false, raw: false, fovH: 0, fovV: 0, recoilYaw: 0, recoilPitch: 0,
    shotIndex: 0, seed: '-', optic: '-', zoom: 1, sensKey: '-', adsFov: 0, adsCm360: 0, lens: '-', renderW: 0, renderH: 0, calls: 0, tris: 0,
  };
  let prevT = clockNow();

  function update(t) {
    if (battle && battle.active) { prevT = t; battle.update(t); return; }
    const dt = Math.min(0.1, Math.max(0, t - prevT));
    prevT = t;
    const ammoBefore = weapon.ammo;
    const ev = weapon.update(t, fireShot);
    if (weapon.ammo === 0 && ammoBefore > 0) finishMagazine();
    if (ev === 'reloaded') { sfx.reload(); newMagazine(); }

    // View = aim + recoil offset (view punch), so the crosshair visibly climbs.
    recoil.offsetAt(t, offset);
    // No recovery (degPerSecond 0): once the spray is over, the recoil that is left becomes
    // part of the aim. The view does not move; the next spray starts from a clean offset.
    const gr = state.gun.recovery;
    if (gr.degPerSecond === 0 && (offset[0] !== 0 || offset[1] !== 0) &&
        t - recoil.lastShot > Math.max(state.gun.resetSeconds, recoil.easeDur)) {
      look.setAngles(look.yaw + offset[0], look.pitch + offset[1]);
      recoil.clearOffset();
      offset[0] = offset[1] = 0;
    }
    const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, look.pitch + offset[1]));
    camera.rotation.y = -(look.yaw + offset[0]) * DEG;   // three.js: positive Y rotation turns left
    camera.rotation.x = pitch * DEG;
    // Movement: WASD in a small box behind the firing line, Space crouches.
    player.update(dt, look.yaw, state.ads);
    camera.position.set(player.ex, player.ey, player.ez);
    camera.rotation.z = -player.roll * DEG;   // lean tilt (positive roll = leaning right)
    aimAssist(dt, t);
    dots.update(t);

    // ADS blend: linear progress adsP, eased out in both directions into adsE.
    const target = state.ads ? 1 : 0;
    if (state.adsP !== target) {
      const step = dt / adsTime();
      state.adsP = target ? Math.min(1, state.adsP + step) : Math.max(0, state.adsP - step);
      state.adsE = adsEase(state.adsP, state.ads);
      updateFov();
    }
    // Weapon raise and springs; hip-fire keeps the crosshair, aiming uses the sight.
    const aimed = state.adsE >= 0.5;
    // Crosshair fades out over the first part of the raise instead of switching off.
    const xo = 1 - smooth(0, 0.45, state.adsE);
    if (xo !== crossOpacity) { crossOpacity = xo; crosshairEl.style.opacity = xo.toFixed(3); }
    // Gentle walking bob on the weapon (none when still or fully aimed).
    walkPhase += dt * 9 * Math.min(1, player.speed / 3);
    rig.bobY = Math.sin(walkPhase) * 0.004 * Math.min(1, player.speed / 3) * (1 - 0.8 * state.adsE);
    rig.animations = settings.animations;
    rig.reloadP = weapon.reloading ? weapon.reloadProgress : -1;
    rig.sprinting = player.sprinting;
    rig.update(dt, state.adsE, t);
    rig.root.visible = settings.showViewmodel || state.adsE > 0;
    if (crosshairEl.hidden !== (xo === 0)) crosshairEl.hidden = xo === 0;
    frameT = t;
    hud.setAmmo(weapon.ammo, state.gun.magSize, weapon.reloading);
    hud.setStats(state.shots, state.hits, state.headshots, dots.visible || range.paper.visible ? state.score : -1);
    reloadBar(weapon.reloading ? weapon.reloadProgress : -1);
  }

  // ADS ease time: gun.adsSeconds scaled into the model's 120-180 ms range, shortened by the
  // sight's adsSpeedBonus. (0.35 s guns: 158 ms magnified, 150 ms 1x, 143 ms iron.)
  function adsTime() {
    const [lo, hi] = data.sens.model.adsEaseSeconds;
    return Math.min(hi, Math.max(lo, state.gun.adsSeconds * 0.45 / (1 + state.optic.adsSpeedBonus)));
  }
  const crosshairEl = $('crosshair');
  let crossOpacity = 1;
  let walkPhase = 0;

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

  /* ---------- aim assist (Settings, 0 = off) ---------- */
  // Near a target (the dummy's head or chest, or a red dot), the aim is pulled gently towards
  // it and the mouse slows down a little. Both fade out with distance from the target and
  // scale with the slider; at 0 nothing happens. Frame-rate independent.
  let assistSlow = 1;
  const ASSIST_RADIUS = 2.5;   // degrees from the target where assist starts at 100%
  function aimAssist(dt, t) {
    assistSlow = 1;
    const s = settings.aimAssist;
    if (!(s > 0) || !lock.locked && !testMode) return;
    const R = ASSIST_RADIUS * (0.4 + 0.6 * s);
    const vy = look.yaw + offset[0], vp = look.pitch + offset[1];
    const ez = player.ez + range.distance;
    let best = null, bd = R;
    const consider = (x, y) => {
      const dx = x - player.ex, dy = y - player.ey;
      const ty = Math.atan2(dx, ez) / DEG, tp = Math.atan2(dy, Math.hypot(dx, ez)) / DEG;
      let ey = ty - vy; ey -= 360 * Math.round(ey / 360);
      const ep = tp - vp, d = Math.hypot(ey, ep);
      if (d < bd) { bd = d; best = [ey, ep]; }
    };
    if (dots.visible) for (let i = 0; i < dots.count; i++) consider(dots.xAt(i, t), dots.y[i]);
    else { consider(0, 1.6); consider(0, 1.15); }
    if (!best) return;
    const near = 1 - bd / R;                         // 1 on the target, 0 at the edge
    const pull = 1 - Math.exp(-dt * 2.5 * s * near); // slight: even at 100% only a nudge
    look.setAngles(look.yaw + best[0] * pull, look.pitch + best[1] * pull);
    assistSlow = 1 - 0.25 * s * near;
  }

  /* ---------- rendering: world + weapon, lens pass only while aiming ---------- */
  let lastShotT = -1, frameT = 0;
  const lensOff = { x: 0, y: 0, scale: 1 };
  const lensP = { cx: 0, cy: 0, hw: 0, hh: 0, corner: 0, round: true, mag: false, strength: 0, glareX: 0, glareY: 0,
    gunHalfW: 0, flash: 0, tint: [1, 1, 1], ret: null, retHalf: 1, retOn: 0, retX: 0, retY: 0, quality: 3 };
  const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  // Lens quality: setting, or auto (starts at 3 and steps down when frames are slow).
  let autoLevel = 3, qAcc = 0, qN = 0, qT0 = 0;
  // Low graphics: always the cheapest lens path (darkening and reticle only).
  function lensQuality() { return settings.graphics === 'low' ? 0 : settings.lensQuality === 'auto' ? autoLevel : Number(settings.lensQuality); }
  // Auto quality drop: average frame time over 20 ms for 2 s while aiming -> one level down.
  // Also steps down when aiming is clearly slower than hip-fire on this machine: the average
  // aimed frame is over 25% longer than the recent hip-fire average and misses ~58 fps.
  let hipMs = 0;
  let noLensDebug = false;   // test hook: aim without the lens pass, to measure its cost
  function watchQuality(nowMs, frameMs) {
    if (state.adsP <= 0 && frameMs > 0 && frameMs < 200) hipMs = hipMs ? hipMs + (frameMs - hipMs) * 0.05 : frameMs;
    if (settings.lensQuality !== 'auto' || state.adsP <= 0 || autoLevel === 0) { qAcc = qN = 0; qT0 = nowMs; return; }
    if (qN === 0) qT0 = nowMs;   // start a new 2 s window
    qAcc += frameMs; qN++;
    if (nowMs - qT0 >= 2000) {
      const avg = qN ? qAcc / qN : 0;
      if (avg > 20 || (hipMs > 0 && avg > hipMs * 1.25 && avg > 1000 / 58)) autoLevel--;
      qAcc = qN = 0; qT0 = nowMs;
    }
  }
  function renderFrame() {
    if (battle && battle.active) { battle.render(); return; }
    renderer.info.reset();
    if (state.adsP <= 0 || noLensDebug) { post.render(scene, camera, rig.scene, rig.camera, null); return; }
    const o = state.optic, hs = o.housing, H = renderH;
    rig.lensOffset(lensOff);
    const k = lensOff.scale;
    lensP.cx = renderW / 2 + lensOff.x;
    lensP.cy = renderH / 2 + lensOff.y;
    lensP.hw = hs.w / 2 * H * k;
    lensP.hh = hs.h / 2 * H * k;
    lensP.corner = (hs.radius || 0) * H * k;
    lensP.round = hs.shape === 'round';
    lensP.mag = o.zoom > 1;
    lensP.strength = smooth(0.15, 1, state.adsE);   // lens look fades in with the raise
    lensP.glareX = Math.sin(look.yaw * DEG * 2) * 0.08 * H;
    lensP.glareY = Math.sin(look.pitch * DEG * 3) * 0.08 * H;
    lensP.gunHalfW = lensP.hw * 0.75;
    lensP.flash = Math.max(0, 1 - (frameT - lastShotT) / 0.06);
    lensP.tint = lensP.mag ? [0.93, 1.0, 0.96] : [1, 1, 1];
    lensP.ret = reticleTextures(o, RETICLE_COLORS[settings.reticleColor], H);
    // Reticle is drawn at its full aimed size from the first frame, so the aim point is clearly
    // marked through the whole raise.
    lensP.retHalf = lensP.ret.half * (H / 1080);
    // Reticle: at full strength from the first frame of aiming, at the exact screen centre,
    // whatever the gun model is doing. Until the sight's glass arrives it is not masked by it.
    lensP.retOn = state.ads ? 1 : smooth(0.5, 1, state.adsE);
    lensP.retX = renderW / 2; lensP.retY = renderH / 2;
    lensP.quality = lensQuality();
    post.render(scene, camera, rig.scene, rig.camera, lensP);
  }

  function frame(nowMs) {
    requestAnimationFrame(frame);
    const c0 = performance.now();
    if (!manualClock) update(clockNow());
    renderFrame();
    if (prevFrameMs) watchQuality(nowMs, nowMs - prevFrameMs);
    cpuMs[cpuIdx++ % cpuMs.length] = performance.now() - c0;
    if (prevFrameMs) debug.recordFrame(nowMs - prevFrameMs);
    prevFrameMs = nowMs;
    if (debug.visible) {
      info.dpc = currentDpc(); info.ads = state.ads; info.raw = lock.raw;
      info.fovH = state.fovH; info.fovV = state.fovV;
      info.recoilYaw = offset[0]; info.recoilPitch = offset[1];
      info.shotIndex = recoil.shotIndex; info.seed = state.seed;
      info.optic = state.optic.id; info.zoom = state.optic.zoom; info.sensKey = state.optic.sensKey;
      info.adsFov = state.adsFov;
      info.adsCm360 = settings.cm360 / (opticMultiplier(state.optic.sensKey) * state.gun.adsMultiplier);
      info.lens = state.adsP > 0 ? 'on, quality ' + lensQuality() + (settings.lensQuality === 'auto' ? ' (auto)' : '') : 'off (hip)';
      info.renderW = renderW; info.renderH = renderH;
      info.calls = renderer.info.render.calls; info.tris = renderer.info.render.triangles;
      debug.update(nowMs, info);
    }
  }
  requestAnimationFrame(frame);
  applyTarget();

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
      selectGun, setDistance, clear: clearRange, setOptic, cycleOptic, toggleGallery,
      galleryCount: () => $('gallery-grid').children.length,
      sightRowCount: () => sightButtons.size,
      overlayVisible: () => state.adsP > 0,
      lensQuality, setAutoLevel(l) { autoLevel = l; }, renderFrame,
      setLensQuality(q) { settings.lensQuality = q; },
      toneMapping: () => renderer.toneMapping,
      _range: range,
      shadowCasters: () => (range.key.castShadow ? range.key.shadow.map ? 1 : 0 : 0),
      setGraphics(g) { settings.graphics = g; applyGraphics(); rig.setGun(state.gun, state.gunIndex, state.optic); },
      setAnimations(on) { settings.animations = on; },
      battleStart(o = {}) { Object.assign(settings.battle, o); startBattle(); return !!(battle && battle.active); },
      battleLeave: () => leaveBattle(),
      battle: () => battle,
      battleState: () => battle && ({ active: battle.active, over: battle.over, score: { ...battle.teamScore },
        fighters: battle.fighters.map((f) => ({ name: f.name, team: f.team, x: f.x, z: f.z, yaw: f.yaw, health: f.health, alive: f.alive, kills: f.kills, deaths: f.deaths, crouch: f.crouch })),
        holes: battle.arena.holes.count, calls: renderer.info.render.calls }),
      inspectAt(p) { rig.inspectHold = p; if (p < 0) rig.inspectT = -1; },
      setUltraTex(n) { Range.ULTRA_TEX = n; setUltraTexSize(n); },
      rig: () => ({ drawT: rig.drawT, magY: rig.current.userData.mag.position.y, magVisible: rig.current.userData.mag.visible,
        flash: rig.current.userData.flash.visible, brass: rig.brass.filter((b) => b.visible).length, boltZ: rig.boltZ }),
      setHipMs(ms) { hipMs = ms; },
      noLens(on) { noLensDebug = on; },
      move(keys) { Object.assign(player.keys, keys); },
      crouch(on) { player.crouched = on; },
      setSprint(on) { player.sprint = on; },
      lean: () => ({ ex: player.ex, ey: player.ey, ez: player.ez, roll: player.roll, lean: player.lean }),
      player: () => ({ x: player.x, z: player.z, eye: player.eye, crouched: player.crouched, speed: player.speed }),
      setSetting(k, v) { settings[k] = v; },
      setAimSmooth(on) { settings.aimSmooth = on; recoil.aimSmooth = on; },
      qualityTick(nowMs, frameMs) { watchQuality(nowMs, frameMs); },
      setTarget(mode, o = {}) { settings.targetMode = mode; Object.assign(settings, o); applyTarget(); },
      dots: () => ({ count: dots.count, radius: dots.radius, x: Array.from({ length: dots.count }, (_, i) => dots.xAt(i, manualClock ? manualT : clockNow())), y: Array.from(dots.y.subarray(0, dots.count)) }),
      dotX: (i, t) => dots.xAt(i, t),
      shotPoints() { const o = []; for (let i = 0; i < shotPtsN; i++) o.push([shotPts[i * 2], shotPts[i * 2 + 1]]); return o; },
      clearShotPoints() { shotPtsN = 0; },
      dummyVisible: () => range.dummy.visible,
      paperVisible: () => range.paper.visible,
      setAim(yaw, pitch) { look.setAngles(yaw, pitch); },
      applyCounts(dx, dy) { const d = currentDpc(); return look.apply(dx, dy, d, d * settings.sensV / settings.sensH); },
      setAds,
      dpc: currentDpc,
      look: () => ({ yaw: look.yaw, pitch: look.pitch, unwrappedYaw: look.unwrappedYaw, countsX: look.countsX, discarded: look.discarded }),
      trigger(down) { if (down) weapon.pressTrigger(clockNow()); else weapon.releaseTrigger(); },
      reload() { if (weapon.startReload(clockNow())) finishMagazine(); },
      holes() {
        const h = range.holes, out = [];
        const start = h.count < 300 ? 0 : h.next;
        for (let i = 0; i < h.count; i++) { const k = (start + i) % 300; out.push([h.data[k * 6], h.data[k * 6 + 1], h.data[k * 6 + 2]]); }
        return out;
      },
      state: () => ({ ammo: weapon.ammo, shots: state.shots, hits: state.hits, headshots: state.headshots, score: state.score, viewPitch: look.pitch + offset[1], viewYaw: look.yaw + offset[0], reloading: weapon.reloading, seed: state.seed, gun: state.gun.id,
        shotIndex: recoil.shotIndex, offset: [offset[0], offset[1]], distance: range.distance, fovH: state.fovH, fovV: state.fovV,
        optic: state.optic.id, zoom: state.optic.zoom, sensKey: state.optic.sensKey, adsP: state.adsP, adsE: state.adsE, adsFov: state.adsFov, fovV: state.fovV,
        adsTime: adsTime(), dpc: currentDpc(), placeholderSens: isPlaceholder(state.optic.sensKey) }),
      offsetAt(t) { return recoil.offsetAt(t, [0, 0]); },
      now: () => manualT,
      cpuFrameMs: () => Array.from(cpuMs.subarray(0, Math.min(cpuIdx, cpuMs.length))),
      lensParams: () => ({ retOn: lensP.retOn, retX: lensP.retX, retY: lensP.retY, w: renderW, h: renderH, strength: lensP.strength, camX: camera.position.x, camY: camera.position.y, camZ: camera.position.z }),
      renderInfo: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, w: renderW, h: renderH }),
    };
  }
}
