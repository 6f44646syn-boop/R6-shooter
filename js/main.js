import { loadPackArt } from './render/pack-art.js?v=bbc2366-mwdhu71j';
import { loadPackAnims } from './scene/weapon-anims.js?v=bbc2366-mwdhu71j';
import { packMats } from './render/pack-materials.js?v=bbc2366-mwdhu71j';
import { loadSkinSheets } from './render/skins2.js?v=bbc2366-mwdhu71j';
import { connectAudioPack } from './audio/pack-bridge.js?v=bbc2366-mwdhu71j';
import { initBombUtility, utilityFor } from './balance/bomb-utility.js?v=bbc2366-mwdhu71j';
import { createAcoustics } from './audio/acoustics.js?v=bbc2366-mwdhu71j';
import { createControls, attachRawInput } from './ui/m7-raw-input.js?v=bbc2366-mwdhu71j';
import { mountControls, mountFirstLaunch } from './ui/m7-menu.js?v=bbc2366-mwdhu71j';
// Recoil Range entry point: wires input, camera, scene, HUD and the frame loop together.
import * as THREE from '../vendor/three/three.module.min.js?v=bbc2366-mwdhu71j';
import { Look, PITCH_LIMIT } from './core/look.js?v=bbc2366-mwdhu71j';
import { Player } from './core/player.js?v=bbc2366-mwdhu71j';
import { PointerLock } from './core/pointer-lock.js?v=bbc2366-mwdhu71j';
import { loadSettings, saveSettings, DISTANCES } from './core/settings.js?v=bbc2366-mwdhu71j';
import { degPerCount, horizontalFovDeg, zoomedFovDeg, focalRatio } from './core/sensitivity.js?v=bbc2366-mwdhu71j';
import { Weapon } from './core/weapon.js?v=bbc2366-mwdhu71j';
import { RecoilEngine } from './core/recoil.js?v=bbc2366-mwdhu71j';
import { Spread } from './core/spread.js?v=bbc2366-mwdhu71j';
import { loadGameData } from './core/guns.js?v=bbc2366-mwdhu71j';
import { initLoadout, effectiveGun, sanitize, slotIn, baseOf, SLOTS as ATTACH_SLOTS, allowed as attachAllowed, measuredCode, describe as describeAttach, hint as attachHint } from './core/loadout.js?v=bbc2366-mwdhu71j';
import { randomSeed } from './core/prng.js?v=bbc2366-mwdhu71j';
import { Range, EYE_HEIGHT } from './scene/range.js?v=bbc2366-mwdhu71j';
import { RING_STEP } from './scene/range-tex.js?v=bbc2366-mwdhu71j';
import { Gamepad, padPanel } from './ui/gamepad.js?v=bbc2366-mwdhu71j';
import { WeaponRig, setUltraTexSize, skinName, setSkinResolver, setHiResSkins } from './scene/viewmodel.js?v=bbc2366-mwdhu71j';
import { LensPost } from './render/lens-post.js?v=bbc2366-mwdhu71j';
import { reticleTextures } from './ui/reticle-tex.js?v=bbc2366-mwdhu71j';
import { DOT_POINTS } from './scene/dots.js?v=bbc2366-mwdhu71j';
import { Voices } from './audio/voice.js?v=bbc2366-mwdhu71j';
import { ModeGame } from './modes/game.js?v=bbc2366-mwdhu71j';
import { Sfx } from './audio/sfx.js?v=bbc2366-mwdhu71j';
import { DebugHud } from './ui/debug-hud.js?v=bbc2366-mwdhu71j';
import { drawCrosshair } from './ui/crosshair.js?v=bbc2366-mwdhu71j';
import { Hud } from './ui/hud.js?v=bbc2366-mwdhu71j';
import { MagPlot } from './ui/plot.js?v=bbc2366-mwdhu71j';
import { SettingsUI } from './ui/settings-ui.js?v=bbc2366-mwdhu71j';
import { sensKeys, zoomKey } from './core/optics.js?v=bbc2366-mwdhu71j';

// Sens table rows: the magnifications listed in data/sens.json plus any used by a sight.
function sensRows(catalogue, sens) {
  const keys = new Set([...sens.magnifications.map((m) => m.key), ...sensKeys(catalogue)]);
  return [...keys].sort((a, b) => parseFloat(a) - parseFloat(b));
}
import { RETICLE_COLORS, drawScope, drawBackdrop } from './ui/scope.js?v=bbc2366-mwdhu71j';
import { Battle } from './battle/battle.js?v=bbc2366-mwdhu71j';
import { initCore, coreLoaded } from './wasm/core.js?v=bbc2366-mwdhu71j';
import { createJoinRequest, acceptJoin } from './net/link.js?v=bbc2366-mwdhu71j';
import { hostRelay, joinRelay, relayUrl, setRelayUrl, pingRelay, cleanCode, rankedGames, rankedReceipt } from './net/relay.js?v=bbc2366-mwdhu71j';
import { Profile, WIN_POINTS } from './core/profile.js?v=bbc2366-mwdhu71j';
import { skinFits, skinById } from './core/skins.js?v=bbc2366-mwdhu71j';
import { PackUI } from './ui/packs.js?v=bbc2366-mwdhu71j';
import { HDPack } from './render/hd-pack.js?v=bbc2366-mwdhu71j';
import { effectiveGraphics, needsPack, maxMode } from './render/quality.js?v=bbc2366-mwdhu71j';
import { GraphicsUI } from './ui/graphics-ui.js?v=bbc2366-mwdhu71j';
import { PerfHud } from './ui/perf-hud.js?v=bbc2366-mwdhu71j';
import { WorldPost } from './render/world-post.js?v=bbc2366-mwdhu71j';
import { rankOf, rankedSummary, ratingOf, rankedChange, validRankedTicket, verifyRankedResult } from './core/ranked.js?v=bbc2366-mwdhu71j';

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);


/* ---------- iframe check: Google Sites' sandbox blocks pointer lock and fullscreen ---------- */
// Inside a frame we lead with "Open in a full tab". Some frames do allow mouse capture, so
// "Play here" boots the game in place; if capture is refused, the menu says so.
// The game data and the Rust core (wasm) load together; the range still works without the core.
const loadAll = () => Promise.all([loadGameData(), initCore().catch((e) => { console.error(e); return null; })]).then(([d]) => d);
let embedded = false;
try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
if (embedded) {
  $('menu').hidden = true;
  $('embedded').hidden = false;
  $('open-tab').href = location.href;
  $('play-here').addEventListener('click', () => {
    $('embedded').hidden = true;
    $('menu').hidden = false;
    loadAll().then(boot).catch(e => { $('data-errors').hidden = false; $('data-errors').textContent = e.message; });
  }, { once: true });
} else {
  loadAll().then(boot).catch(e => { $('data-errors').hidden = false; $('data-errors').textContent = e.message; });
}

async function boot(data) {
  const [controls, acoustics] = await Promise.all([createControls(), createAcoustics(), initBombUtility(), initLoadout()]);
  // Controller: buttons fire the same actions as keys; in menus it moves the focus (js/ui/gamepad.js).
  const pad = new Gamepad(); let padT = 0;
  // The layer a controller moves through: an open dialog or pop-up, the armory, or the menu.
  const padLayer = () => document.querySelector('dialog[open]') || [...document.querySelectorAll('.pk-modal')].find((m) => !m.hidden) || ($('armory').hidden ? $('menu') : $('armory'));
  const padFocusables = () => [...padLayer().querySelectorAll('button, select, input, [tabindex="0"]')].filter((e) => !e.disabled && e.offsetParent !== null && e.tabIndex >= 0);
  const padHooks = {
    get playing() { return (lock.locked || testMode) && $('menu').hidden && $('armory').hidden && !document.querySelector('dialog[open]'); },
    onAction: (id, down) => controls.onAction(id, down),
    look: (degX, degY) => { const dpc = baseDpc(); lookBy(degX / dpc, degY / dpc); },
    start() { if (padHooks.playing) { if (lock.locked) lock.exit(); else lock.onChange(false); } else if (flow.inGame && !$('menu').hidden) startLock(); },
    menuMove(dir, sideways) {
      const a = document.activeElement;
      if (sideways && a?.tagName === 'SELECT') { a.selectedIndex = Math.max(0, Math.min(a.options.length - 1, a.selectedIndex + dir)); a.dispatchEvent(new Event('change', { bubbles: true })); return; }
      if (sideways && a?.type === 'range') { a.value = Number(a.value) + dir * Number(a.step || 1); a.dispatchEvent(new Event('input', { bubbles: true })); a.dispatchEvent(new Event('change', { bubbles: true })); return; }
      const list = padFocusables();
      if (!list.length) return;
      const i = list.indexOf(a);
      list[i < 0 ? 0 : (i + dir + list.length) % list.length].focus();
    },
    menuPress() {
      const a = document.activeElement;
      if (!a || a === document.body || !padLayer().contains(a)) { padFocusables()[0]?.focus(); return; }
      if (a.tagName !== 'SELECT') a.click();          // lists change with left / right
    },
    menuBack() {
      const layer = padLayer();
      if (layer === $('menu') && flow.page === 'pause') { startLock(); return; }
      const back = layer === $('armory') ? $('arm-back') : layer.matches('.pk-modal') ? [...layer.querySelectorAll('button')].filter((b) => b.offsetParent).at(-1)
        : layer.querySelector('.page:not([hidden]) .nav button, .page:not([hidden]) .back-btn');
      back?.click();
    },
  };
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
  // Your skins and points (localStorage + save code). The gun model asks it which skin a slot wears.
  const flow = { page: null, prev: 'mode', mode: 'range', inGame: false, armoryFrom: 'setup', setupFromPause: false, settingsOnly: false };
  const profile = new Profile();
  var packsUi = null;      // the Skins & packs panel (created further down; var: readable before then)
  let skinOverride = null;   // { slot, id }: a one-off render of a skin (pack reveal)
  // Your skin on the gun in a slot (what other players see), or null.
  const equippedSkin = (slot) => { const id = profile.equippedFor(slot); return id !== null && skinFits(id, slot) ? id : null; };
  setSkinResolver((slot) => {
    if (skinOverride && skinOverride.slot === slot) return skinOverride.id;
    const id = profile.equippedFor(slot); return id !== null && skinFits(id, slot) ? id : null;
  });
  const rig = new WeaponRig(renderer);
  // Graphics quality: high swaps the range to textured PBR with shadows and tone mapping, and
  // the gun to textured PBR lit by the same sky. Standard is the original fast look.
  // High and Ultra need the Enhanced Graphics pack; without it they run as Standard.
  const gfx = () => effectiveGraphics(settings);
  const gunShading = () => (gfx() === 'low' ? 'fast' : gfx() === 'standard' ? settings.weaponShading : gfx());
  // Software rendering in the tests cannot bake 4096 maps quickly; real graphics cards can.
  if (new URLSearchParams(location.search).has('test')) { Range.ULTRA_TEX = 512; setUltraTexSize(512); }
  function applyGraphics() {
    range.setGraphics(gfx(), renderer);
    if (range.env) rig.setHighEnv(range.env);
    rig.setShading(gunShading(), gfx());
    setHiResSkins(settings.hiResSkins);     // the callers rebuild the gun
  }
  applyGraphics();
  const post = new LensPost(renderer, { samples: settings.antialias && renderer.capabilities.isWebGL2 ? 4 : 0 });
  // World post-processing (High / Ultra: ambient occlusion, TAA, sharpening; any level:
  // upscaling when the world is drawn below the screen's resolution).
  const worldPost = new WorldPost(renderer);
  post.world = worldPost;
  function applyPost(worldScale) {
    const g = gfx(), enhanced = g === 'high' || g === 'ultra', webgl2 = renderer.capabilities.isWebGL2;
    // High: a map with the pack's baked sky light needs no screen-space occlusion (cheaper)
    const baked = g === 'high' && packMats.lightActive && cur() && cur().active;
    // Max: SSAO on top of the baked light, and its own passes (bloom, shafts, reflections, fog, grading)
    const max = enhanced && maxMode.on;
    const o = { ao: enhanced && (settings.ao || max) && !(baked && !max), taa: enhanced && settings.taa, sharpen: settings.sharpen, scale: worldScale, max };
    worldPost.set(o);
    // Low / Standard: only when upscaling (it costs a full-screen pass, which a school PC
    // feels); High / Ultra: whenever one of its effects is on.
    worldPost.on = webgl2 && !testNoPost && (worldScale < 0.999 ? g !== 'low' : enhanced && (o.ao || o.taa || o.sharpen > 0 || max));
  }
  let testNoPost = false;
  const dots = range.dots;
  const sfx = new Sfx(acoustics);
  const audioPack = connectAudioPack(HDPack, sfx);
  sfx.spatialAudio = settings.spatialAudio;
  const voices = new Voices();
  sfx.setVolume(settings.volume);

  const look = new Look();
  const debug = new DebugHud($('debug'));
  debug.setVisible(settings.debugHud);
  const perf = new PerfHud($('app'), renderer);
  perf.setVisible(settings.fpsCounter);
  const perfInfo = { w: 0, h: 0, scale: 1, calls: 0, tris: 0, target: 60, hz: 0 };
  const hud = new Hud($);
  const plot = new MagPlot($('plot'));
  const weapon = new Weapon();
  weapon.reloadSpeed = settings.reloadSpeed;
  const recoil = new RecoilEngine();
  recoil.aimScale = settings.aimRecoil;
  // Tests check the measured spray and exact hit spots: they start with hip spread off and
  // hip recoil at 1x (setHip turns them back on for the hip-fire tests).
  if (new URLSearchParams(location.search).has('test')) { settings.hipSpread = false; settings.hipRecoil = 1; settings.autoReload = false; }
  recoil.hipScale = settings.hipRecoil;
  const spread = new Spread();
  const spreadOff = [0, 0];
  recoil.aimSmooth = settings.aimSmooth;
  const params = new URLSearchParams(location.search);
  const testMode = params.has('test');
  const catalogue = data.catalogue;
  let settingsUI = null; // created further down
  let graphicsUI = null;  // the Graphics screen (further down)

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
    const gun = effectiveGun(data.guns[index], savedAttach(data.guns[index]));   // this player's attachments
    if (state.gun && baseOf(state.gun) !== baseOf(gun)) sfx.weaponSwitch();
    state.gun = gun;
    state.gunIndex = index;
    weapon.setGun(gun);
    recoil.setGun(gun);
    newMagazine();
    mag.n = mag.shots = mag.hits = 0;
    renderLoadout();
    if (packsUi) packsUi.refresh();
    if (typeof refreshArmory === 'function' && !$('armory').hidden) refreshArmory();
    setOptic(savedOptic(gun), false);
    if (settings.gunIndex !== index) { settings.gunIndex = index; saveSettings(settings); }
  }
  hud.setDistance(range.distance);

  /* ---------- attachments (Milestone 8, js/core/loadout.js) ---------- */
  // Saved per gun ("attach:<gun id>", four digits). No saved code = the measured loadout.
  function savedAttach(gun) {
    let c = null;
    try { c = localStorage.getItem('attach:' + gun.id); } catch (e) { c = null; }
    return sanitize(gun, c);
  }
  const attachMap = () => Object.fromEntries(data.guns.map((g) => [g.id, savedAttach(g)]));
  // Change one slot of the current gun: the new effective gun takes over (full magazine).
  function setAttach(slot, id) {
    const base = baseOf(state.gun), code = savedAttach(base).split('');
    code[slot] = String(id);
    const c = sanitize(base, code.join(''));
    try { localStorage.setItem('attach:' + base.id, c); } catch (e) { /* ignore */ }
    selectGun(state.gunIndex);
    if (battle && battle.active && flow.armoryFrom === 'pause') battle.changeGun(state.gun);
  }
  // Armory: one row of choices per slot; the dot marks what the gun's spray was measured with.
  function renderAttach() {
    const base = baseOf(state.gun), code = savedAttach(base), meas = measuredCode(base);
    const rows = ATTACH_SLOTS.map((sl, s) => {
      const row = document.createElement('div'); row.className = 'attach-slot';
      const lab = document.createElement('span'); lab.textContent = sl.name;
      const opts = document.createElement('div'); opts.className = 'attach-opts'; opts.setAttribute('role', 'group'); opts.setAttribute('aria-label', sl.name);
      sl.options.forEach((name, id) => {
        if (!attachAllowed(base, s, id)) return;
        const b = document.createElement('button'); b.type = 'button'; b.textContent = name;
        b.dataset.slot = s; b.dataset.id = id;
        b.setAttribute('aria-pressed', String(Number(code[s]) === id));
        if (Number(meas[s]) === id) b.dataset.measured = '';
        b.title = (attachHint(s, id) || 'Nothing fitted') + (Number(meas[s]) === id ? ' (as measured)' : '');
        b.addEventListener('click', () => setAttach(s, id));
        opts.append(b);
      });
      row.append(lab, opts);
      return row;
    });
    $('attach-rows').replaceChildren(...rows);
    const fx = describeAttach(base, code).map((d) => { const e = document.createElement('span'); e.className = d.better ? 'good' : 'bad'; e.textContent = d.label + ' ' + d.value; return e; });
    $('attach-fx').replaceChildren(...fx);
    $('attach-note').textContent = code === meas ? 'As measured: the spray is exactly the recorded one.' : 'Compared with the measured loadout (\u2022). The magazine plot and spray change to match.';
  }

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
    hud.setGun(gun, state.gunIndex, state.optic.label, skinName(state.gunIndex));
    renderSightRow();
    if (!$('armory').hidden) refreshArmory();
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
      if (locked) {
        $('menu').hidden = true; closeArmory(); $('lock-hint').hidden = true;
        $('start-btn').textContent = 'Resume';
        if (cur() && cur().active) cur().resume(clockNow());
        return;
      }
      controls.release();
      // Mouse released (Esc): the pause menu (or the end screen of a battle).
      if (cur() && cur().active) cur().pause();
      else { weapon.releaseTrigger(); setAds(false); player.releaseKeys(); player.crouched = false; }
      settingsUI.refresh();
      if ($('armory').hidden) { showPage(flow.inGame ? 'pause' : 'mode'); $('menu').hidden = !!(cur() && cur().active && cur().over); }
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
    void audioPack.sync();
    const ok = pad.recent() ? lock.holdVirtual() : await lock.request();   // a controller needs no mouse capture
    if (ok) {
      notice.textContent = 'Raw input unavailable: Windows pointer settings may affect aim.';
      notice.hidden = lock.raw;
    }
  }
  $('start-btn').addEventListener('click', startLock);
  // Clicking the game resumes it (not on the mode / weapon screens).
  // (not once the match is over: the shot that wins ends with a click on the game, and Play again needs the cursor)
  canvas.addEventListener('click', () => { if (!lock.locked && flow.inGame && $('armory').hidden && !cur()?.over) startLock(); });

  /* ---------- mouse look: every event, straight to yaw/pitch ---------- */
  document.addEventListener('mousemove', (e) => { if (lock.locked && !lock.virtual) lookBy(e.movementX, e.movementY); });
  // Mouse counts (or the controller's right stick turned into counts) to yaw / pitch.
  function lookBy(mx, my) {
    const ads = cur()?.active ? cur().h?.ads || cur().humans?.[0]?.ads : state.ads;
    const [dx,dy] = controls.look(mx,my,ads);
    if (cur() && cur().active) { cur().mouseMove(dx, dy); return; }
    // Siege-style: vertical sensitivity scales pitch; aim assist may slow the aim near a target.
    const dpc = currentDpc() * assistSlow;
    if (look.apply(dx, dy, dpc, dpc * settings.sensV / settings.sensH) && state.adsP > 0) {
      // Scope sway: the housing lags behind the turn (degrees -> screen pixels).
      const pxPerDeg = window.innerHeight / state.fovV;
      rig.nudge(dx * dpc * pxPerDeg, dy * dpc * pxPerDeg);
    }
  }

  function handleMouseDown(e) {
    if (!lock.locked && !testMode) return;
    if (cur() && cur().active) { if (e.button >= 3) e.preventDefault(); cur().mouseButton(e.button, true); return; }
    if (e.button === 0) {
      if (weapon.ammo === 0 && !weapon.reloading) sfx.click();
      weapon.pressTrigger(e.timeStamp / 1000);
    } else if (e.button === 2) setAds(true);
    else if (e.button === 3) { e.preventDefault(); player.leanL = true; }   // mouse back button: lean left
    else if (e.button === 4) { e.preventDefault(); player.leanR = true; }   // mouse forward button: lean right
  }
  function handleMouseUp(e) {
    if (cur() && cur().active) { cur().mouseButton(e.button, false); return; }
    if (e.button === 0) weapon.releaseTrigger();
    else if (e.button === 2) setAds(false);
    else if (e.button === 3) { e.preventDefault(); player.leanL = false; }
    else if (e.button === 4) { e.preventDefault(); player.leanR = false; }
  }
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
  function handleKeyUp(e) {
    const c = e.code;
    if (cur() && cur().active) { if (cur().key(c, false)) e.preventDefault(); return; }
    if (c === 'KeyW' || c === 'KeyA' || c === 'KeyS' || c === 'KeyD') player.keys[c[3].toLowerCase()] = false;
    else if (c === 'ShiftLeft' || c === 'ShiftRight') player.sprint = false;
    else if (c === 'KeyQ') player.leanL = false;
    else if (c === 'KeyE') player.leanR = false;
    else if (c === 'Space') { player.crouched = false; hud.setDistance(range.distance, targetLabel()); }
  }
  window.addEventListener('blur', () => { player.releaseKeys(); player.crouched = false; if(cur()?.active) cur().pause(); });
  function handleKeyDown(e) {
    if (e.repeat && e.code !== 'KeyR') return;
    const c = e.code;
    if (c === 'Escape' && lock.virtual) { lock.exit(); return; }       // controller play has no capture for Esc to end
    if (c === 'F4') { e.preventDefault(); toggleGallery(); return; }
    if (c === 'Escape' && !$('gallery').hidden) { toggleGallery(false); return; }
    if (c === 'Escape' && !$('armory').hidden) { $('arm-back').click(); return; }
    if (c === 'F3') {
      e.preventDefault();
      settings.debugHud = !settings.debugHud;
      debug.setVisible(settings.debugHud);
      saveSettings(settings);
      settingsUI.refresh();
      return;
    }
    if (!lock.locked && !testMode) return;
    if (cur() && cur().active) { if (cur().key(c, true)) e.preventDefault(); return; }
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
  }
  const actionKeys = {forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD',sprint:'ShiftLeft',crouch:'Space',leanLeft:'KeyQ',leanRight:'KeyE',ability:'OperatorAbility',interact:'Interact',reload:'KeyR',vault:'KeyC',grenade:'KeyG',knife:'KeyK',inspect:'KeyI',scoreboard:'Tab',recall:'KeyV',droneZap:'DroneZap',underbarrel:'KeyB',reset:'KeyX',target:'KeyM',zero:'KeyZ'};
  controls.onAction = (id,down) => {
    const event = {code:actionKeys[id],button:id==='fire'?0:2,timeStamp:performance.now(),preventDefault(){}};
    if(id==='fire'||id==='ads') (down?handleMouseDown:handleMouseUp)(event);
    else (down?handleKeyDown:handleKeyUp)(event);
  };
  // Only these fixed browser/debug/range shortcuts bypass the binding table.
  const auxiliary = /^(F3|F4|Escape|BracketLeft|BracketRight|Digit[0-9]|Minus|Equal|NumpadAdd|NumpadSubtract)$/;
  attachRawInput(controls,{enabled:()=>!document.querySelector('dialog[open]') && (lock.locked || testMode && $('menu').hidden && $('armory').hidden),onAux:(e,down)=>{if(auxiliary.test(e.code))(down?handleKeyDown:handleKeyUp)(e);}});
  document.addEventListener('keydown',e=>{if(!lock.locked && !$('menu').hidden && !document.querySelector('dialog[open]') && !e.target.closest('input,select,textarea') && /^(F3|F4|Escape)$/.test(e.code))handleKeyDown(e);});

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
    // Hip fire: plus a random spread (fades out as you aim; aimed fire is exactly the spray).
    if (settings.hipSpread && !state.ads) spread.shot(t, state.gun, player.speed > 0.5, player.crouched, state.adsE, Math.random, spreadOff);
    else spreadOff[0] = spreadOff[1] = 0;
    const yaw = look.yaw + bulletOff[0] + spreadOff[0];
    const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, look.pitch + bulletOff[1] + spreadOff[1]));
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
  // Dynamic resolution (render resolution on Auto): when frames take too long the picture is
  // drawn at a lower resolution, and sharpened back up when there is time to spare.
  let dynScale = 1, dynSum = 0, dynN = 0, dynFast = 0;
  // The target is the frame-rate setting, capped at the screen's refresh rate (measured from
  // the fastest frames: a 60 Hz screen never shows more than 60).
  let refreshHz = 0;
  const fastest = [];
  function fpsGoal() { return Math.min(settings.fpsTarget, refreshHz || 60); }
  function watchResolution(dtMs) {
    if (dtMs > 2 && dtMs < 100) {
      fastest.push(dtMs);
      if (fastest.length >= 120) { fastest.sort((a, b) => a - b); const hz = 1000 / fastest[12]; refreshHz = Math.max(refreshHz * 0.8, [60, 75, 90, 120, 144, 165, 240, 360].reduce((b, v) => (Math.abs(v - hz) < Math.abs(b - hz) ? v : b), 60)); fastest.length = 0; }
    }
    if (settings.renderScale || testMode || document.hidden || dtMs > 250) return;
    dynSum += dtMs; dynN++;
    if (dynSum < 1500) return;
    const avg = dynSum / dynN, budget = 1000 / fpsGoal();
    dynSum = 0; dynN = 0;
    let next = dynScale;
    if (avg > budget * 1.25) { next = Math.max(0.6, dynScale * (avg > budget * 1.8 ? 0.8 : 0.9)); dynFast = 0; }
    else if (avg < budget * 0.93 && dynScale < 1) { if (++dynFast >= 2) { next = Math.min(1, dynScale * 1.1); dynFast = 0; } }
    else dynFast = 0;
    if (Math.abs(next - dynScale) > 0.01) { dynScale = next; resize(); }
  }
  function resize() {
    // Auto: the screen's own sharpness (devicePixelRatio, 1x to 2x). Above 1 = supersampling.
    // Ultra (graphics card) supersamples at least 150% on Auto so the fine detail resolves.
    // Low draws at plain 100% even on a high-DPI screen.
    const auto = gfx() === 'low' ? 1 : Math.min(2, Math.max(gfx() === 'ultra' ? 1.5 : 1, window.devicePixelRatio || 1));
    let s = settings.renderScale || dynScale * auto, worldScale = 1;
    // Below 100% (the setting, or dynamic resolution) with WebGL 2: the screen stays at full
    // resolution and only the world is drawn smaller, then upscaled and sharpened, so the
    // gun, sight and HUD stay crisp.
    if (renderer.capabilities.isWebGL2 && gfx() !== 'low' && !testNoPost) {
      const base = settings.renderScale >= 1 ? settings.renderScale : settings.renderScale > 0 ? 1 : auto;
      worldScale = settings.renderScale > 0 && settings.renderScale < 1 ? settings.renderScale : settings.renderScale ? 1 : dynScale;
      s = base;
    }
    applyPost(worldScale);
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
    openGraphics: () => graphicsUI && graphicsUI.open(),
    onChange(key) {
      const all = key === 'all';
      if (all || key === 'scale') resize();
      if (all || key === 'fov') updateFov();
      if (all || key === 'crosshair') { drawCrosshair($('crosshair'), settings.crosshair); xhGap = -1; }
      if (all || key === 'holes') range.holes.setSize(settings.holeSizeCm / 100);
      if (all || key === 'reload') weapon.reloadSpeed = settings.reloadSpeed;
      if (all || key === 'shading' || key === 'graphics') {
        graphicsChanged();
        // High / Ultra picked without the Enhanced Graphics pack: offer the download.
        if (needsPack(settings.graphics) && !HDPack.ready && graphicsUI && !graphicsUI.isOpen && key === 'graphics') graphicsUI.open(settings.graphics);
        if (needsPack(settings.graphics) && HDPack.ready && !hdLoaded) loadHD();
      }
      if (all || key === 'perf') perf.setVisible(settings.fpsCounter);
      if (all || key === 'post') resize();
      // Battle in progress: after the range (which sets the shared gun shading), rebuild its view.
      if (cur() && cur().active && (all || key === 'shading' || key === 'graphics' || key === 'reticle')) cur().refreshGraphics();
      if (key === 'sens' || key === 'assist') { /* read live each mouse event */ }
      if (all || key === 'recoil') { recoil.aimScale = settings.aimRecoil; recoil.hipScale = settings.hipRecoil; recoil.aimSmooth = settings.aimSmooth; }
      if (all || key === 'volume' || key === 'audio') { sfx.setVolume(settings.volume); sfx.spatialAudio = settings.spatialAudio; }
      if (all || key === 'debug') debug.setVisible(settings.debugHud);
      if (all || key === 'gun') selectGun(Math.min(settings.gunIndex, data.guns.length - 1));
      if (all || key === 'distance') setDistance(settings.distance);
      if (all || key === 'target') applyTarget();
      if (all || key === 'reticle') renderSightRow(true);
      if (key === 'seed') newMagazine(); // takes effect from the current magazine
    },
  });

  /* ---------- skins & packs ---------- */
  const packs = new PackUI({
    root: $('packs-root'), app: $('app'), profile, renderer, sfx, guns: data.guns, shot: (id) => skinShot(id),
    gunIndex: () => state.gunIndex,
    onEquip(slot) {
      if (slot === state.gunIndex) { rig.setGun(state.gun, state.gunIndex, state.optic); hud.setGun(state.gun, state.gunIndex, state.optic.label, skinName(state.gunIndex)); }
      if (!$('armory').hidden) refreshArmory();
    },
  });

  packsUi = packs;
  packs.mountShop($('shop-root'));

  /* ---------- battle mode ---------- */
  var netInit = false;   // the network lobby below is ready (var: readable before its line)
  // Created on first use (it builds its own arena and weapon models).
  let battle = null;
  const bEl = (id) => $(id);
  {
    const B = settings.battle;
    if (B.opponent === 'p2') B.opponent = 'bots';          // split screen was removed
    bEl('b-bots').value = String(B.bots); bEl('b-level').value = B.level; bEl('b-kills').value = String(B.kills); bEl('b-map').value = B.map; bEl('b-time').value = B.night ? 'night' : 'day'; bEl('b-weather').value = B.weather; bEl('b-fog').value = B.fog ? 'on' : 'off'; bEl('b-voices').value = B.voices === false ? 'off' : 'on'; bEl('b-rank').value = B.ranked ? 'on' : 'off';
    const sync = () => {
      Object.assign(settings.battle, { bots: Number(bEl('b-bots').value), level: bEl('b-level').value, kills: Number(bEl('b-kills').value), map: bEl('b-map').value, night: bEl('b-time').value === 'night', weather: bEl('b-weather').value, fog: bEl('b-fog').value === 'on', voices: bEl('b-voices').value === 'on', ranked: bEl('b-rank').value === 'on' });
      saveSettings(settings);
      if (netInit) netUi();
    };
    for (const id of ['b-bots', 'b-level', 'b-kills', 'b-map', 'b-time', 'b-weather', 'b-fog', 'b-voices', 'b-rank']) bEl(id).addEventListener('change', sync);
    sync();
  }
  function battleDeps() {
    return {
      renderer, settings, controls, guns: data.guns, sfx, worldPost, onRanked: (c) => applyRankedChange(c), rating: () => profile.rating,
      opticFor: (g) => catalogue.byId.get(savedOptic(g)),
      opticById: (id, g) => catalogue.byId.get(g.optics.includes(id) ? id : g.defaultOptic), adsVFov, baseDpc, now: clockNow,
      slotOf: (g) => slotIn(data.guns, g), onEnd: () => lock.exit(), hudRoot: $('app'),
      skinOf: (g) => equippedSkin(slotIn(data.guns, g)),
      voice: voices,
      onPirateToken: () => profile.unlockBlackIce(),
      onNetLost: (msg) => { netReset(); leaveBattle(); netStatus(msg, 'bad'); },
      onPoints: (kind, head) => (kind === 'kill' ? profile.addKill(head) : profile.addPoints(WIN_POINTS)),
    };
  }
  // The Rust core (collision, stairs, pathfinding) loads with the page; if a battle is asked
  // for before it has arrived, start as soon as it does.
  function needCore(then) {
    if (coreLoaded()) return false;
    flashNotice('Loading the game engine...');
    initCore().then(then, (err) => flashNotice('Could not load the game engine (' + (err && err.message || err) + '). Press Ctrl+F5 to load the latest version.', 9000));
    return true;
  }
  function startBattle() {
    if (needCore(startBattle)) return;
    controls.release();
    const royale = flow.mode === 'royale';
    const B = royale ? { ...settings.battle, opponent: 'bots' } : settings.battle;
    if (!royale && B.opponent === 'bots' && B.bots < 1) { flashNotice('Choose at least one bot.'); return; }
    if (B.opponent === 'net') {
      if (net.role === 'client') { flashNotice('Only the host can start a network battle.'); return; }
      if (net.peers.some(peer => !peer.ready)) { flashNotice('Wait for everyone to finish joining.'); return; }
      if (net.role === 'host' && netMode() !== 'battle') {
        if (!net.peers.length) { flashNotice('Wait for at least one player to join first.'); return; }
        const mode = netMode(), ranked = mode === 'bomb' && $('net-ranked').checked;
        const peers = net.peers.map(e => ({ link: e.link, name: e.name, op: e.ops?.[mode], side: e.side,
          attach: e.attachMap, skin: e.skin, spectator: e.spectator, rating: e.rating }));
        net.hub?.ranked(null);
        startMode(mode, { ranked, net: { hostName: 'Host', rating: profile.rating, peers } }).then(() => netUi());
        return;
      }
      if (net.role !== 'host' || (!net.peers.length && B.bots < 1)) { flashNotice('Host a game and connect at least one player (or add bots) first.'); return; }
    }
    if (!battle) {
      battle = new Battle(battleDeps());
      battle.hud.again.addEventListener('click', () => { startBattle(); });
      battle.hud.leave.addEventListener('click', leaveBattleResults);
    }
    weapon.releaseTrigger(); setAds(false); player.releaseKeys();
    try {
      battle.start({ royale, ranked: !!B.ranked && !royale && B.opponent === 'bots' && B.bots > 0, opponent: B.opponent, bots: B.bots, level: B.level, killsToWin: B.kills, map: B.map, night: B.night, weather: B.weather, fog: B.fog, p1Gun: state.gun, p2Gun: data.guns[Math.min(B.p2Gun, data.guns.length - 1)],
        hostName: 'Host', spectators: B.opponent === 'net' ? net.peers.filter(e => e.spectator).map(e => e.link) : [],
        remotes: B.opponent === 'net' ? net.peers.filter(e => !e.spectator).map((e) => ({ link: e.link, name: e.name, gunIndex: e.gunIndex, attach: e.attach, skin: e.skin })) : [] });
    } catch (err) {
      // Usually a half-updated page (old files still cached): say so instead of doing nothing.
      console.error(err);
      if (battle) battle.stop();
      flashNotice('Could not start the battle (' + (err && err.message || err) + '). Press Ctrl+F5 to load the latest version.', 9000);
      return;
    }
    $('hud').hidden = true;
    flow.inGame = true;
    $('pause-title').textContent = royale ? 'Battle Royale paused' : 'Battle paused';
    if (royale && testMode) $('menu').hidden = true;
    if (!testMode) startLock();
  }
  // The match modes (Team Deathmatch, Capture the Flag, Bomb) run in their own game.
  let modeGame = null;
  const MATCH_MODES = ['tdm', 'ctf', 'bomb'];
  const cur = () => (modeGame && modeGame.active ? modeGame : battle);
  function leaveMode() {
    controls.release();
    if (!modeGame || !modeGame.active) return;
    modeGame.stop();
    $('hud').hidden = false;
    $('pause-title').textContent = 'Paused';
    applyGraphics();
    rig.setGun(state.gun, state.gunIndex, state.optic);
    resize();
  }
  function leaveBattle() {
    controls.release();
    if (modeGame && modeGame.active) { leaveMode(); return; }
    if (!battle) return;
    battle.stop();
    $('hud').hidden = false;
    $('pause-title').textContent = 'Paused';
    if (netInit) netUi();
    applyGraphics();
    rig.setGun(state.gun, state.gunIndex, state.optic);
    resize();
  }
  function leaveBattleResults() {
    const royale = !!battle?.royale;
    leaveBattle();
    if (royale) { flow.inGame = false; showPage('mode'); $('menu').hidden = false; }
  }
  $('battle-btn').addEventListener('click', startBattle);

  /* ---------- network lobby (join codes, no server) ---------- */
  let netVia = 'relay';
  try { if (localStorage.getItem('recoil-range-net-via') === 'lan') netVia = 'lan'; } catch (e) { /* storage blocked */ }
  const net = { role: null, peers: [], request: null, link: null, hub: null, busy: false };
  function netStatus(text, kind = '') { const e = $('net-status'); e.textContent = text; e.className = 'small ' + kind; }
  function netUi() {
    const relay = netVia === 'relay';
    $('net-via-relay').setAttribute('aria-checked', String(relay));
    $('net-via-lan').setAttribute('aria-checked', String(!relay));
    $('net-via-relay').disabled = $('net-via-lan').disabled = !!net.role;
    $('net-host-box').hidden = relay || net.role !== 'host';
    $('net-join-box').hidden = relay || net.role !== 'client';
    $('relay-host-box').hidden = !relay || net.role !== 'host' || !net.hub;
    $('relay-join-box').hidden = !relay || net.role !== 'client' || !!net.link;
    $('relay-code').textContent = net.hub ? net.hub.code : '....';
    $('net-note-relay').hidden = $('relay-cfg').hidden = !relay;
    $('net-note-lan').hidden = relay;
    $('net-host').hidden = $('net-join').hidden = !!net.role;
    $('net-game-box').hidden = net.role !== 'host';
    $('net-reset').hidden = !net.role;
    $('net-watch-field').hidden = net.role === 'host';
    $('net-watch').disabled = !!net.link || net.busy;
    $('net-rank-search').hidden = !relay || net.role === 'host' || !!net.link;
    $('net-rank-games').hidden = $('net-rank-search').hidden || !$('net-rank-games').children.length;
    rankedProfileUi();
    refreshRankedListing();
    if (!$('net-panel').hidden && rankPending.size) void refreshRankedReceipts();
    const names = net.peers.length ? net.peers.map(e => e.name + ' (' + (e.spectator ? 'spectator' : data.guns[e.gunIndex].name) + ')').join(', ') : 'none yet';
    $('net-players').textContent = names;
    $('relay-players').textContent = names;
    const waiting = settings.battle.opponent === 'net' && net.role === 'client';
    $('battle-btn').disabled = waiting && !(battle && battle.active);
    if (waiting && !(battle && battle.active)) $('battle-btn').textContent = net.link ? 'Waiting for the host to start' : 'Only the host starts the battle';
  }
  const rankPendingKey = 'recoilRange.rankedPending.v1';
  const rankPending = new Map();
  const hostedReceipts = new Map();
  let rankRefreshAt = 0;
  function restoreRankedTickets() {
    try {
      const saved = JSON.parse(localStorage.getItem(rankPendingKey) || '[]');
      for (const pending of saved.slice(0, 20)) {
        if (pending.expires > Date.now() && validRankedTicket(pending.ticket)) rankPending.set(pending.ticket.id, pending);
      }
    } catch { /* missing or invalid local data */ }
  }
  function saveRankedTickets() {
    try { localStorage.setItem(rankPendingKey, JSON.stringify([...rankPending.values()].slice(-20))); } catch { /* storage blocked */ }
  }
  function rememberRankedTicket(client) {
    const { ticket, id, link } = client;
    if (!validRankedTicket(ticket) || !ticket.roster.some(([actorId]) => actorId === id)) return;
    rankPending.set(ticket.id, { ticket, id, code: link.code, base: link.code ? relayUrl() : null, expires: Date.now() + 86_400_000 });
    saveRankedTickets();
  }
  async function applyRankedPacket(packet) {
    const id = packet.result?.id, pending = rankPending.get(id);
    if (!pending) return;
    const result = await verifyRankedResult(pending.ticket, packet);
    if (!result || rankPending.get(id) !== pending) return;
    const label = applyRankedChange(rankedChange(pending.ticket, result, pending.id));
    rankPending.delete(id); saveRankedTickets();
    if (label && modeGame?.over && modeGame.rankedClient?.ticket.id === id) modeGame.hud.endNote.textContent += ' ' + label;
  }
  function applyRankedChange(change) {
    const entry = profile.applyRanked(change);
    if (!entry) return '';
    netUi();
    net.link?.send({ k: 'rankProfile', rating: profile.rating });
    const label = rankOf(profile.rating) + ' · ' + profile.rating + ' Elo (' + (entry.delta > 0 ? '+' : '') + entry.delta + ')';
    netStatus(label, 'ok');
    return label;
  }
  async function refreshRankedReceipts() {
    if (Date.now() < rankRefreshAt) return;
    rankRefreshAt = Date.now() + 45_000;
    for (const [id, pending] of rankPending) {
      if (pending.expires <= Date.now()) { rankPending.delete(id); continue; }
      if (!pending.base || !pending.code) continue;
      try {
        const packet = await rankedReceipt(pending.base, pending.code, id);
        if (packet) await applyRankedPacket(packet);
      } catch { /* retry next time the lobby is opened */ }
    }
    saveRankedTickets();
  }
  restoreRankedTickets();
  function rankedProfileUi() {
    const crest = document.createElement('span');
    crest.className = 'rank-crest';
    crest.dataset.rank = rankOf(profile.rating).toLowerCase();
    crest.setAttribute('aria-hidden', 'true');
    $('net-rank-info').replaceChildren(crest, rankOf(profile.rating) + ' · ' + profile.rating + ' Elo · Stored on this profile');
    $('net-rank-history').replaceChildren(...profile.rankedHistory.map(entry => {
      const row = document.createElement('li');
      row.textContent = entry.outcome + ' · ' + (entry.delta > 0 ? '+' : '') + entry.delta + ' Elo';
      return row;
    }));
  }
  function refreshRankedListing() {
    if (!net.hub) return;
    const available = netMode() === 'bomb' && $('net-ranked').checked && !(cur()?.active && !cur().over);
    const players = [profile.rating, ...net.peers.filter(peer => !peer.spectator).map(peer => peer.rating)];
    const capacity = Math.min(8, 2 * Math.max(1, Math.min(5, modePrefs.teamSize | 0)));
    net.hub.ranked(available && net.peers.length < 7 && players.length < capacity ? { ...rankedSummary(players), players: players.length,
      capacity, map: modePrefs.map.bomb } : null);
  }
  function netReset() {
    if (net.hub) net.hub.close();             // first, so players hear "the host left" (not "removed")
    for (const e of net.peers) e.link.close();
    if (net.link) net.link.close();
    if (net.request) net.request.cancel();
    net.role = null; net.peers = []; net.request = null; net.link = null; net.hub = null;
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
  $('net-reset').addEventListener('click', async () => {
    const game = cur();
    if (game?.active && (game.net || game.netRole)) {
      if (game.rankedHost && !game.over) await game._finishRanked(game.me.team === 'A' ? 'B' : 'A', true);
      leaveBattle();
    }
    netReset(); netStatus('Disconnected.');
  });

  // Host: a player's link is open (direct or through the relay).
  function addPeer(link) {
    const entry = { link, name: 'Player ' + (net.peers.length + 2), gunIndex: 0, attach: null, skin: null };
    net.peers.push(entry);
    link.onmessage = (m) => {
      if (m.k === 'hello') {
        if (!entry.ready) {
          entry.ready = true;
          entry.spectator = m.spectator === true;
          entry.rating = ratingOf(m.rating);
        }
        entry.gunIndex = Math.min(data.guns.length - 1, Math.max(0, m.gun | 0)); entry.skin = Number.isInteger(m.skin) ? m.skin : null; entry.attach = typeof m.at === 'string' ? m.at.slice(0, 4) : null;
        // for the match modes: their operator per mode, Bomb side, and attachments per gun
        entry.ops = m.ops && typeof m.ops === 'object' ? Object.fromEntries(['tdm', 'ctf', 'bomb'].map((k) => [k, String(m.ops[k] || '').slice(0, 24)])) : {};
        entry.side = m.side === 'defend' ? 'defend' : m.side === 'attack' ? 'attack' : 'auto';
        entry.attachMap = m.atm && typeof m.atm === 'object' ? Object.fromEntries(Object.entries(m.atm).slice(0, 64).map(([k, v]) => [String(k).slice(0, 24), String(v).slice(0, 4)])) : null;
        if (Array.isArray(m.pendingRanked)) for (const id of m.pendingRanked.slice(0, 20)) {
          const packet = hostedReceipts.get(id);
          if (packet) link.send(packet);
        }
        netUi(); return;
      }
      if (m.k === 'rankProfile') { entry.rating = ratingOf(m.rating); netUi(); return; }
      if (modeGame && modeGame.active && modeGame.netRole === 'host') { modeGame.onNet(link, m); return; }
      if (battle && battle.active && battle.net) battle.onNet(link, m);
    };
    link.onclose = () => {
      const i = net.peers.indexOf(entry);
      if (i >= 0) net.peers.splice(i, 1);
      if (modeGame && modeGame.active && modeGame.netRole === 'host') modeGame.onLinkClosed(link);
      else if (battle && battle.active && battle.net) battle.onLinkClosed(link);
      netUi(); netStatus(entry.name + ' disconnected.', 'bad');
    };
    netUi(); netStatus(entry.name + ' connected.', 'ok');
  }
  // Joiner: connected to the host.
  function joined(link) {
    net.request = null; net.link = link;
    link.send({ k: 'hello', gun: state.gunIndex, at: state.gun.attach || null, skin: equippedSkin(state.gunIndex), ops: modePrefs.op, side: modePrefs.side, atm: attachMap(), rating: profile.rating, spectator: $('net-watch').value === 'spectator', pendingRanked: [...rankPending.keys()].slice(-20) });
    link.onmessage = (m) => {
      if (m.k === 'mrankResult') { void applyRankedPacket(m); return; }
      if (m.k === 'start') { startClientBattle(m); return; }
      if (m.k === 'mstart') { startClientMatch(m); return; }
      if (m.k === 'stopped') { if (cur() && cur().active) { leaveBattle(); flow.inGame = false; showPage('setup'); $('menu').hidden = false; netStatus('The host ended the match. Still connected: wait for the next one.', 'ok'); } return; }
      if (modeGame && modeGame.active && modeGame.netRole === 'client') { modeGame.onNet(link, m); return; }
      if (battle && battle.active && battle.net) battle.onNet(link, m);
    };
    link.onclose = () => {
      if (modeGame && modeGame.active && modeGame.netRole === 'client') { leaveMode(); flow.inGame = false; showPage('setup'); $('menu').hidden = false; netReset(); netStatus('The host left or the connection dropped.', 'bad'); return; }
      if (battle && battle.active && battle.net) battle.onLinkClosed(link);
      else { netReset(); netStatus(link.closeReason || 'Disconnected from the host.', 'bad'); }
    };
    netUi(); netStatus('Connected. Waiting for the host to start the battle.', 'ok');
  }
  function setVia(v) {
    if (net.role) return;
    netVia = v;
    try { localStorage.setItem('recoil-range-net-via', v); } catch (e) { /* storage blocked */ }
    netStatus(''); netUi();
  }
  $('net-via-relay').addEventListener('click', () => setVia('relay'));
  $('net-via-lan').addEventListener('click', () => setVia('lan'));
  $('relay-url').value = relayUrl();
  $('relay-save').addEventListener('click', async () => {
    const u = $('relay-url').value.trim();
    setRelayUrl(u);
    if (!u) { netStatus('Relay address cleared.'); return; }
    netStatus('Testing the relay...');
    try { await pingRelay(u); netStatus('Relay server OK.', 'ok'); }
    catch (err) { netStatus(err.message && !/fetch/i.test(err.message) ? err.message : 'Could not reach that relay. Check the address, or the network may block it.', 'bad'); }
  });
  $('relay-copy').addEventListener('click', async () => {
    if (!net.hub) return;
    try { await navigator.clipboard.writeText(net.hub.code); netStatus('Copied.', 'ok'); } catch (e) { netStatus('Code: ' + net.hub.code); }
  });
  async function relayHost() {
    if (net.busy) return;
    net.busy = true; net.role = 'host'; netUi();
    netStatus('Opening a game on the relay...');
    try {
      const hub = await hostRelay(relayUrl());
      if (net.role !== 'host') { hub.close(); return; }
      net.hub = hub;
      hub.onjoin = (link) => addPeer(link);
      hub.onlost = (msg) => {
        if (battle && battle.active && battle.net) leaveBattle();
        netReset(); netStatus('Lost the relay: ' + msg, 'bad');
      };
      netUi(); netStatus('Game open. Players press "Join a game" and type the code.', 'ok');
    } catch (err) { net.role = null; netUi(); netStatus(err.message, 'bad'); }
    finally { net.busy = false; }
  }
  async function relayJoin() {
    const code = cleanCode($('relay-in').value);
    if (net.busy || net.link) return;
    net.busy = true;
    netStatus('Joining ' + code + '...');
    try {
      const link = await joinRelay(relayUrl(), code);
      if (net.role !== 'client') { link.close(); return; }
      joined(link);
    } catch (err) { netStatus(err.message, 'bad'); }
    finally { net.busy = false; }
  }
  $('relay-connect').addEventListener('click', relayJoin);
  $('relay-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); relayJoin(); } });

  // Host
  $('net-host').addEventListener('click', () => {
    if (netVia === 'relay') { relayHost(); return; }
    net.role = 'host'; netUi(); netStatus('Ask each player to press "Join a game" and send you their join code.');
  });
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
        addPeer(link);
        $('net-reply-box').hidden = true;
      }).catch((err) => netStatus(err.message, 'bad'));
    } catch (err) { netStatus(err.message, 'bad'); }
  });

  // Joiner
  $('net-join').addEventListener('click', async () => {
    net.role = 'client'; netUi();
    if (netVia === 'relay') { netStatus('Type the game code from the host.'); $('relay-in').focus(); return; }
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
      joined(await net.request.finish($('net-in-j').value.trim()));
    } catch (err) { netStatus(err.message, 'bad'); }
  });
  netInit = true;
  netUi();
  // A network match (Team Deathmatch, Capture the Flag, Bomb) the host started.
  async function startClientMatch(m) {
    if (needCore(() => startClientMatch(m))) return;
    controls.release();
    if (battle && battle.active) leaveBattle();
    ensureModeGame();
    weapon.releaseTrigger(); setAds(false); player.releaseKeys();
    try { await modeGame.startClient(m, net.link); }
    catch (err) { console.error(err); flashNotice('Could not join the match (' + (err && err.message || err) + '). Press Ctrl+F5 to load the latest version.', 9000); return; }
    $('hud').hidden = true;
    flow.inGame = true;
    modeGame.hud.again.hidden = true;
    netUi();
    $('pause-title').textContent = 'The match has started';
    $('start-btn').disabled = false;
    $('start-btn').textContent = m.spectator ? 'Watch the match' : 'Join the match';
    if (!lock.locked) { closeArmory(); showPage('pause'); $('menu').hidden = false; }
  }
  function startClientBattle(m) {
    if (needCore(() => startClientBattle(m))) return;
    if (!battle) {
      battle = new Battle(battleDeps());
      battle.hud.again.addEventListener('click', () => { startBattle(); });
      battle.hud.leave.addEventListener('click', leaveBattleResults);
    }
    weapon.releaseTrigger(); setAds(false); player.releaseKeys();
    battle.startClient(m, net.link);
    $('hud').hidden = true;
    flow.inGame = true;
    netUi();
    $('pause-title').textContent = 'The battle has started';
    $('start-btn').disabled = false;
    $('start-btn').textContent = m.spectator ? 'Watch the battle' : 'Join the battle';
    if (!lock.locked) { closeArmory(); showPage('pause'); $('menu').hidden = false; }
  }

  /* ---------- menu flow: mode -> settings -> weapon -> deploy ---------- */
  function showPage(name) {
    if (flow.page !== name && ['mode', 'pause', 'setup'].includes(flow.page)) flow.prev = flow.page;
    flow.page = name;
    for (const p of document.querySelectorAll('#menu .page')) p.hidden = p.id !== 'page-' + name;
    // steps: 1 controls, 2 graphics (a dialog), 3 settings, 4 packs, 5 mode (and its match options), 6 weapon / operator
    const step = flow.inGame && name !== 'controls' ? 0 : name === 'controls' ? 1 : name === 'setup' && flow.settingsOnly || name === 'quick' ? 3 : name === 'shop' ? 4 : name === 'mode' || name === 'setup' && !flow.setupFromPause ? 5 : name === 'ops' ? 6 : 0;
    $('pause-loadout').hidden = MATCH_MODES.includes(flow.mode) || flow.mode === 'royale';
    $('clear-btn').hidden = flow.mode !== 'range';          // a range tool (and C is vault everywhere else)
    $('menu').querySelector('.steps').hidden = !step;
    for (const sp of $('menu').querySelectorAll('.steps button')) { sp.classList.toggle('on', Number(sp.dataset.step) === step); sp.classList.toggle('done', Number(sp.dataset.step) < step); }
    const names = { range: 'Shooting range', bots: 'Battle vs bots', royale: 'Battle Royale', net: 'Network battle', tdm: 'Team Deathmatch', ctf: 'Capture the Flag', bomb: 'Bomb' };
    $('menu-crumbs').textContent = name === 'mode' ? 'Choose a mode' : name === 'pause' ? names[flow.mode] + ' (paused)' :
      name === 'setup' ? (flow.settingsOnly ? 'Settings' : names[flow.mode] + ': match options') : name === 'ops' ? names[flow.mode] + ': operator' : name === 'packs' ? 'Skins' : name === 'shop' ? 'Packs' : name === 'quick' ? 'Quick setup' : 'Controls';
    document.querySelectorAll('[aria-label="Main menu"] button').forEach(b=>b.setAttribute('aria-current', b.id === ({mode:'go-play',pause:'go-play',setup:flow.settingsOnly ? 'go-settings' : 'go-play',controls:'go-controls',packs:'go-packs',shop:'go-shop'}[name]) ? 'page' : 'false'));
    $('mini-points').textContent = '(' + profile.points + ' points)';
    $('pause-points').textContent = '(' + profile.points + ' points)';
    $('shop-next').textContent = flow.inGame ? 'Back to the game' : 'Next: choose a mode';
    if (name === 'setup') {
      $('range-setup').hidden = flow.mode !== 'range';
      $('battle-setup').hidden = flow.mode === 'range' || MATCH_MODES.includes(flow.mode);
      $('b-kills-field').hidden = flow.mode === 'royale';
      $('b-map-field').hidden = flow.mode === 'royale';
      $('b-bots-field').hidden = flow.mode === 'royale';
      $('b-rank-field').hidden = flow.mode !== 'bots';
      $('royale-rules').hidden = flow.mode !== 'royale';
      $('modes-setup').hidden = !MATCH_MODES.includes(flow.mode);
      if (MATCH_MODES.includes(flow.mode)) modesUi();
      $('net-panel').hidden = flow.mode !== 'net';
      $('setup-title').textContent = flow.settingsOnly ? 'Settings' : names[flow.mode];
      selectSetupTab(flow.settingsOnly ? 1 : 0);
      $('setup-next').textContent = flow.settingsOnly ? (flow.inGame ? 'Done' : 'Next: packs') : flow.setupFromPause ? 'Back to the game' : flow.mode === 'royale' ? 'Deploy to Blacktide Island' : MATCH_MODES.includes(flow.mode) ? 'Next: choose your operator' : 'Next: choose your weapon';
      if (netInit) netUi();
    }
  }
  function chooseMode(m) {
    if (battle && battle.active) leaveBattle();
    controls.release();
    flow.mode = m; flow.inGame = false; flow.setupFromPause = false; flow.settingsOnly = false;
    if (modeGame && modeGame.active) leaveMode();
    if (m !== 'range' && m !== 'royale' && !MATCH_MODES.includes(m)) settings.battle.opponent = m;
    saveSettings(settings);
    showPage('setup');
  }
  for (const b of document.querySelectorAll('.mode-card')) b.addEventListener('click', () => chooseMode(b.dataset.mode));
  $('go-packs').addEventListener('click', () => showPage('packs'));
  for (const id of ['go-shop', 'pause-shop']) $(id).addEventListener('click', () => showPage('shop'));
  $('shop-skins').addEventListener('click', () => showPage('packs'));
  settingsUI.quick($('quick-root'));
  $('quick-next').addEventListener('click', () => showPage('shop'));
  $('quick-all').addEventListener('click', () => $('go-settings').click());
  $('quick-back').addEventListener('click', () => { flow.wizard = true; graphicsUI.open(); });
  $('shop-back').addEventListener('click', () => showPage(flow.inGame ? 'pause' : 'setup'));
  $('shop-next').addEventListener('click', () => showPage(flow.inGame ? 'pause' : 'mode'));
  $('go-controls').addEventListener('click', () => showPage('controls'));
  $('pause-packs').addEventListener('click', () => showPage('packs'));
  for (const b of document.querySelectorAll('.back-btn')) b.addEventListener('click', () => showPage(b.dataset.back === 'prev' ? (flow.prev || 'mode') : b.dataset.back));
  $('setup-back').addEventListener('click', () => showPage(flow.setupFromPause ? 'pause' : 'mode'));
  $('setup-next').addEventListener('click', () => {
    if (flow.settingsOnly) { flow.settingsOnly = false; showPage(flow.inGame ? 'pause' : 'shop'); return; }
    if (flow.setupFromPause) { flow.setupFromPause = false; showPage('pause'); }
    else if (flow.mode === 'royale') startBattle();
    else if (MATCH_MODES.includes(flow.mode)) { showPage('ops'); renderOps(); }
    else openArmory('setup');
  });
  $('pause-settings').addEventListener('click', () => { flow.settingsOnly = false; flow.setupFromPause = true; showPage('setup'); });
  $('pause-loadout').addEventListener('click', () => openArmory('pause'));
  $('pause-quit').addEventListener('click', () => { if (cur() && cur().active) leaveBattle(); flow.inGame = false; showPage('mode'); });

  /* ---------- match modes: settings and operator select ---------- */
  const MODE_DEFAULTS = { map: { tdm: 'containers', ctf: 'yard', bomb: 'ranch' }, abilities: { tdm: false, ctf: false, bomb: true }, op: { tdm: 'glitch', ctf: 'dash', bomb: 'pace' }, difficulty: 'normal', teamSize: 5, minutes: 10, prepTime: 30, headshot: 'lethal', side: 'attack' };
  let modePrefs;
  try { modePrefs = { ...MODE_DEFAULTS, ...JSON.parse(localStorage.getItem('recoilRange.modes') || '{}') }; } catch (e) { modePrefs = { ...MODE_DEFAULTS }; }
  for (const k of ['map', 'abilities', 'op']) modePrefs[k] = { ...MODE_DEFAULTS[k], ...(modePrefs[k] || {}) };
  const saveModePrefs = () => { try { localStorage.setItem('recoilRange.modes', JSON.stringify(modePrefs)); } catch (e) { /* storage blocked */ } };
  const MAP_NAMES = {
    yard: 'Yard (60 x 40 m, two flanks and a mid lane)', containers: 'Container Yard (Battle map)', winter: 'Winter Cabin (Battle map)',
    casino: "Jesse's Casino (Battle map, two floors)", school: 'School Basement (Battle map)',
    ranch: 'Ranch (a house with a loft; site: master bedroom)', embassy: 'Embassy (two storeys round a courtyard; site: archives)', workshop: 'Workshop (offices, catwalk, corridor; site: garage)',
  };
  // Network lobby (host): which game to play online, and its map. Team size, bot level,
  // abilities and time come from that mode's own settings.
  var netModeVal = (() => { try { return localStorage.getItem('recoil-range-net-mode') || 'battle'; } catch (e) { return 'battle'; } })();
  function netMode() { return ['battle', 'tdm', 'ctf', 'bomb'].includes(netModeVal) ? netModeVal : 'battle'; }
  function netGameUi() {
    const m = netMode(), P = modePrefs;
    $('net-mode').value = m;
    $('net-ranked-field').hidden = m !== 'bomb';
    $('net-map-field').hidden = m === 'battle';
    if (m !== 'battle') {
      const maps = m === 'bomb' ? ['ranch', 'embassy', 'workshop'] : ['containers', 'winter', 'casino', 'school', 'yard'];
      $('net-map').replaceChildren(...maps.map((id) => { const o = document.createElement('option'); o.value = id; o.textContent = MAP_NAMES[id]; return o; }));
      $('net-map').value = maps.includes(P.map[m]) ? P.map[m] : maps[0];
    }
    $('net-game-note').textContent = m === 'battle' ? 'Everyone for themselves on the Battle map above.' :
      m === 'bomb' && $('net-ranked').checked ? 'Local Elo. Up to 5v5, Normal bots, 30 s prep and standard abilities. The host confirms results.' :
      'Players join teams' + (m === 'bomb' ? ' (each on the side they chose in Bomb\'s setup, if there is room)' : '') + '; bots fill the empty places. Team size, bot level' + (m === 'bomb' ? ', preparation time' : ', time') + ' and abilities are the ones set for this mode in its own settings. Each player uses the operator they last picked for it.';
  }
  $('net-mode').addEventListener('change', () => { netModeVal = $('net-mode').value; try { localStorage.setItem('recoil-range-net-mode', netModeVal); } catch (e) { /* storage blocked */ } netGameUi(); refreshRankedListing(); });
  $('net-map').addEventListener('change', () => { modePrefs.map[netMode()] = $('net-map').value; saveModePrefs(); refreshRankedListing(); });
  $('net-ranked').addEventListener('change', () => { netGameUi(); refreshRankedListing(); });
  $('net-rank-search').addEventListener('click', async () => {
    const list = $('net-rank-games'), button = $('net-rank-search');
    button.disabled = true;
    try {
      const games = await rankedGames(relayUrl());
      list.replaceChildren(...games.map(game => {
        const join = document.createElement('button');
        join.type = 'button';
        join.textContent = (MAP_NAMES[game.map]?.split(' (')[0] || game.map) + ' · ' + game.average + ' Elo (' + game.low + '–' + game.high + ') · ' + game.players + '/' + game.capacity;
        join.addEventListener('click', () => {
          if (net.link || net.busy || net.role === 'host') return;
          net.role = 'client'; $('relay-in').value = game.code; netUi(); void relayJoin();
        });
        return join;
      }));
      list.hidden = games.length === 0;
      if (!games.length) netStatus('No ranked Bomb games are open.');
    } catch (error) { netStatus(error.message, 'bad'); }
    finally { button.disabled = false; }
  });
  netGameUi();
  function modesUi() {
    const m = flow.mode, P = modePrefs;
    const maps = m === 'bomb' ? ['ranch', 'embassy', 'workshop'] : ['containers', 'winter', 'casino', 'school', 'yard'];
    $('md-map').replaceChildren(...maps.map((id) => { const o = document.createElement('option'); o.value = id; o.textContent = MAP_NAMES[id]; return o; }));
    $('md-map').value = maps.includes(P.map[m]) ? P.map[m] : maps[0];
    $('md-diff').value = P.difficulty; $('md-rank').value = P.ranked ? 'on' : 'off'; $('md-size').value = String(P.teamSize); $('md-ab').value = P.abilities[m] ? 'on' : 'off';
    $('md-len').value = String(P.minutes); $('md-head').value = P.headshot;
    $('md-len').closest('label').hidden = m === 'bomb';
    $('md-prep').value = String(P.prepTime || 30); $('md-prep').closest('label').hidden = m !== 'bomb';
    $('md-note').textContent = m === 'tdm' ? 'First team to 40 kills, or the most kills when the time runs out. Respawn after 3 s. Tab: scoreboard.'
      : m === 'ctf' ? 'Take the enemy flag (walk over it) to your own stand while your flag is home. First to 3 captures; a tie after the time goes to the next capture. Tab: scoreboard.'
        : 'First to 4 rounds; sides swap after round 3. One life a round: ' + (P.prepTime || 30) + ' s to prepare (defenders reinforce walls and barricade with Interact, and lay barbed wire with the grenade action; attackers drone), ' + utilityFor('bomb').actionSeconds + ' s to plant (hold Interact for 5 s on the site). The bomb goes off after 40 s unless defused (hold Interact for 6 s).';
    if (P.ranked) $('md-note').textContent += ' Ranked: you are ' + rankOf(profile.rating) + ' · ' + profile.rating + ' Elo. Bots count as Easy 850, Normal 1050, Hard 1250, Terminator 1500. Leaving early is a loss.';
  }
  function readModes() {
    const m = flow.mode, P = modePrefs;
    P.map[m] = $('md-map').value; P.difficulty = $('md-diff').value; P.ranked = $('md-rank').value === 'on'; P.teamSize = Number($('md-size').value);
    P.abilities[m] = $('md-ab').value === 'on'; P.minutes = Number($('md-len').value); P.prepTime = Number($('md-prep').value) || 30; P.headshot = $('md-head').value;
    saveModePrefs();
  }
  for (const id of ['md-map', 'md-diff', 'md-rank', 'md-size', 'md-ab', 'md-len', 'md-prep', 'md-head']) $(id).addEventListener('change', readModes);
  $('md-rank').addEventListener('change', modesUi);
  let opsData = null, abilityData = null;
  async function renderOps() {
    if (!opsData) {
      try { [opsData, abilityData] = await Promise.all([fetch('data/ops.json').then((r) => r.json()), fetch('data/abilities.json').then((r) => r.json())]); }
      catch (e) { $('ops-note').textContent = 'Could not load the operators (' + e.message + '). Press Ctrl+F5.'; return; }
    }
    const m = flow.mode, P = modePrefs, bomb = m === 'bomb';
    $('ops-search').value = '';
    $('ops-side').hidden = !bomb;
    for (const b of document.querySelectorAll('#ops-side .seg-btn')) b.setAttribute('aria-checked', String(b.dataset.side === P.side));
    const allowed = bomb ? (P.side === 'attack' ? opsData.attackers : opsData.defenders) : [...opsData.attackers, ...opsData.defenders];
    if (!allowed.some((o) => o.id === P.op[m])) P.op[m] = allowed[0].id;
    const card = (op) => {
      const g = data.guns.find((x) => x.id === op.gun), ab = abilityData[op.ability] || {};
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'op-card' + (P.op[m] === op.id ? ' on' : '');
      if (bomb && !allowed.includes(op)) b.classList.add('other-side');
      const nm = document.createElement('b'); nm.textContent = op.name;
      const gn = document.createElement('span'); gn.className = 'small'; gn.textContent = (g ? g.name : op.gun) + ' · ' + (catalogue.byId.get(op.sight) || { label: op.sight }).label;
      const an = document.createElement('span'); an.className = 'op-ab'; an.textContent = ab.name || '';
      b.append(nm, gn, an);
      // in Bomb, picking an operator also picks that side
      b.addEventListener('click', () => { if (bomb) P.side = opsData.defenders.includes(op) ? 'defend' : 'attack'; P.op[m] = op.id; saveModePrefs(); renderOps(); });
      return b;
    };
    const group = (title, list) => { const g = document.createElement('div'); g.className = 'ops-group'; const h = document.createElement('h3'); h.textContent = title; const row = document.createElement('div'); row.className = 'ops-row'; row.append(...list.map(card)); g.append(h, row); return g; };
    $('ops-grid').replaceChildren(group('Attackers', opsData.attackers), group('Defenders', opsData.defenders));
    $('ops-note').textContent = (bomb ? 'Bomb: pick any operator; a defender puts you on defence, an attacker on attack. You are ' + (P.side === 'attack' ? 'attacking' : 'defending') + '. ' : 'Pick any operator. ') + 'Bots take the other places with random operators (no repeats in a team).' + (P.abilities[m] ? ' Abilities on: ' + controls.bindingLabel('ability') + ' uses yours.' : '');
  }
  for (const b of document.querySelectorAll('#ops-side .seg-btn')) b.addEventListener('click', () => { modePrefs.side = b.dataset.side; saveModePrefs(); renderOps(); });
  $('ops-back').addEventListener('click', () => showPage('setup'));
  $('ops-go').addEventListener('click', () => startMode());
  function ensureModeGame() {
    if (!modeGame) {
      modeGame = new ModeGame({
        onRanked: applyRankedChange,
        onRankedTicket: rememberRankedTicket,
        onRankedReceipt: packet => {
          hostedReceipts.set(packet.result.id, packet);
          if (hostedReceipts.size > 20) hostedReceipts.delete(hostedReceipts.keys().next().value);
          net.hub?.rankedReceipt(packet);
        },
        renderer, settings, controls, guns: data.guns, sfx, adsVFov, baseDpc, now: clockNow, slotOf: (g) => slotIn(data.guns, g), hudRoot: $('app'), worldPost,
        onEnd: () => lock.exit(), onPoints: (kind, head) => (kind === 'kill' ? profile.addKill(head) : profile.addPoints(WIN_POINTS)),
        skinOf: (g) => equippedSkin(slotIn(data.guns, g)),
        opticById: (id, g) => catalogue.byId.get(g.optics.includes(id) ? id : g.defaultOptic),
      });
      modeGame.hud.again.addEventListener('click', () => { if (modeGame.netRole === 'host') startBattle(); else startMode(); });
      modeGame.hud.leave.addEventListener('click', () => { const host = modeGame.netRole === 'host'; leaveMode(); flow.inGame = false; showPage(host || net.role ? 'setup' : 'mode'); $('menu').hidden = false; });
    }
  }
  // mode: tdm, ctf or bomb; extra.net: a network match hosted here ({ peers, hostName }).
  let modeStarting = false;
  async function startMode(mode = flow.mode, extra = {}) {
    if (modeStarting) return false;
    modeStarting = true;
    controls.release();
    const m = mode, P = modePrefs;
    if (battle && battle.active) leaveBattle();
    ensureModeGame();
    modeGame.hud.again.hidden = false;
    weapon.releaseTrigger(); setAds(false); player.releaseKeys();
    try {
      await modeGame.start({ mode: m, map: P.map[m], difficulty: P.difficulty, teamSize: P.teamSize, abilities: !!P.abilities[m], minutes: P.minutes, prepTime: P.prepTime, headshot: P.headshot, op: P.op[m], side: P.side, botRanked: !!P.ranked && !extra.net, botRating: profile.rating, attach: attachMap(), seed: testMode ? P.seed : undefined, ...extra });
    } catch (err) {
      console.error(err);
      flashNotice('Could not start the match (' + (err && err.message || err) + '). Press Ctrl+F5 to load the latest version.', 9000);
      return false;
    } finally { modeStarting = false; }
    $('hud').hidden = true;
    flow.inGame = true;
    $('pause-title').textContent = 'Match paused';
    if (!testMode) startLock(); else $('menu').hidden = true;
    return true;
  }

  // Weapon select: sights (left), the gun turning slowly in 3D (middle), skins (right).
  const previewRig = new WeaponRig(renderer);
  previewRig.noHands = true;
  previewRig.applyLights();
  previewRig.scene.background = new THREE.Color(0x232933);
  // Studio lights for the preview (on top of the rig's own; the cheap matcap shading ignores them).
  const pvKey = new THREE.DirectionalLight(0xffffff, 2.4); pvKey.position.set(0.6, 1.2, 1.6);
  const pvRim = new THREE.DirectionalLight(0x9fc4ff, 1.4); pvRim.position.set(-1.2, 0.6, -1);
  previewRig.scene.add(pvKey, pvRim);
  const previewPivot = new THREE.Group();
  previewRig.scene.add(previewPivot);
  previewPivot.add(previewRig.root);
  const previewCam = new THREE.PerspectiveCamera(28, 16 / 9, 0.05, 20);
  previewCam.position.set(0, 0.04, 1.25);
  function refreshArmory() {
    const g = state.gun;
    $('arm-name').textContent = g.name;
    $('arm-info').textContent = g.rpm + ' rpm · ' + g.magSize + ' rounds · ' + state.optic.label + (skinName(state.gunIndex) ? ' · ' + skinName(state.gunIndex) : '');
    previewRig.setGun(g, state.gunIndex, state.optic);
    framePreview();
    packs.renderArmorySkins($('arm-skins'), state.gunIndex);
    renderAttach();
    $('arm-skins-note').textContent = 'Skins you own that fit the ' + g.name + '. Get more from packs (Skins & packs).';
    $('arm-deploy').textContent = flow.armoryFrom === 'pause' ? 'Back to the game' : flow.mode === 'range' ? 'Deploy to the range' : 'Deploy to battle';
  }
  // Centre the preview model on the turning pivot (measured unrotated) and frame it.
  function framePreview() {
    previewRig.root.position.set(0, 0, 0);
    previewRig.root.quaternion.identity();
    previewPivot.rotation.set(0, 0, 0);
    previewPivot.updateMatrixWorld(true);
    // Visible parts only (the hidden muzzle flash would pull the centre forward).
    const box = new THREE.Box3();
    previewRig.current.traverseVisible((o) => { if (o.isMesh) box.union(new THREE.Box3().setFromObject(o)); });
    const c = box.getCenter(new THREE.Vector3());
    previewRig.root.position.copy(c).negate();
    const size = box.getSize(new THREE.Vector3());
    previewCam.position.set(0, 0.02, Math.max(0.7, Math.max(size.z, size.y * 2.2) * 2.5));
    previewCam.lookAt(0, 0, 0);
  }
  // A showcase picture of a skin on a gun (pack reveal).
  const SHOT_W = 768, SHOT_H = 432;
  // o (tests, showcase): { zoom (closer), yaw (turn), w (picture width) }.
  function skinShot(id, o = {}) {
    const def = skinById(id);
    if (!def) return '';
    const slot = skinFits(id, state.gunIndex) ? state.gunIndex : (def.guns ? def.guns[0] : state.gunIndex);
    const gun = data.guns[slot];
    skinOverride = { slot, id };
    try {
      previewRig.setGun(gun, slot, catalogue.byId.get(savedOptic(gun)));
      framePreview();
      if (o.zoom) previewCam.position.multiplyScalar(1 / o.zoom);
      previewPivot.rotation.set(0.14, -Math.PI / 2 + 0.38 + (o.yaw || 0), 0);
      previewRig.animateSkins(0, 0);
      // Draw on the game canvas and copy it straight away (as the sight gallery does): same
      // colours and tone mapping as the game. The next frame redraws the screen as usual.
      const r = renderer;
      r.setRenderTarget(null); r.setScissorTest(false); r.setViewport(0, 0, renderW, renderH); r.autoClear = true;
      const a = previewCam.aspect;
      previewCam.aspect = renderW / renderH; previewCam.updateProjectionMatrix();
      r.render(previewRig.scene, previewCam);
      r.autoClear = false;
      previewCam.aspect = a; previewCam.updateProjectionMatrix();
      // Crop the middle 16:9 of the frame where the gun is.
      const cw = Math.min(renderW, renderH * 16 / 9) * 0.6, ch = cw * 9 / 16;
      const ow = o.w || SHOT_W, oh = Math.round(ow * 9 / 16);
      const out = document.createElement('canvas'); out.width = ow; out.height = oh;
      out.getContext('2d').drawImage(r.domElement, (renderW - cw) / 2, (renderH - ch) / 2, cw, ch, 0, 0, ow, oh);
      return out.toDataURL();
    } catch (e) { console.error(e); return ''; }
    finally {
      skinOverride = null;
      if (!$('armory').hidden) refreshArmory();
    }
  }
  function openArmory(from) {
    controls.release();
    flow.armoryFrom = from;
    $('menu').hidden = true;
    $('armory').hidden = false;
    $('hud').hidden = true;
    if (battle && battle.hud) battle.hud.root.hidden = true;
    refreshArmory();
  }
  function closeArmory() {
    if ($('armory').hidden) return;
    $('armory').hidden = true;
    const inBattle = !!(battle && battle.active);
    $('hud').hidden = inBattle;
    if (battle && battle.hud) battle.hud.root.hidden = !inBattle;
  }
  $('arm-prev').addEventListener('click', () => selectGun((state.gunIndex + data.guns.length - 1) % data.guns.length));
  $('arm-next').addEventListener('click', () => selectGun((state.gunIndex + 1) % data.guns.length));
  $('arm-back').addEventListener('click', () => { closeArmory(); $('menu').hidden = false; showPage(flow.armoryFrom === 'pause' ? 'pause' : 'setup'); });
  $('arm-deploy').addEventListener('click', deploy);
  function deploy() {
    const fromPause = flow.armoryFrom === 'pause';
    closeArmory();
    if (fromPause) {
      // Changed weapon mid-game: in battle you respawn with it right away.
      if (battle && battle.active) battle.changeGun(state.gun);
      startLock();
      return;
    }
    if (flow.mode === 'range') {
      flow.inGame = true;
      $('pause-title').textContent = 'Paused';
      startLock();
    } else if (flow.mode === 'net' && net.role === 'client') {
      flow.inGame = false;
      showPage('pause'); $('menu').hidden = false;
      $('pause-title').textContent = net.link ? 'Waiting for the host to start the battle...' : 'Connect to a host first (Settings).';
      $('start-btn').disabled = true;
      $('start-btn').textContent = 'Waiting for the host';
      if (net.link) net.link.send({ k: 'hello', gun: state.gunIndex, at: state.gun.attach || null, skin: equippedSkin(state.gunIndex) });
    } else {
      startBattle();
      if (!(battle && battle.active)) { $('menu').hidden = false; showPage('setup'); }
    }
  }
  function renderPreview(t) {
    const r = renderer;
    r.setRenderTarget(null); r.setScissorTest(false); r.setViewport(0, 0, renderW, renderH); r.autoClear = true;
    const a = renderW / renderH;
    if (previewCam.aspect !== a) { previewCam.aspect = a; previewCam.updateProjectionMatrix(); }
    previewPivot.rotation.set(0.12, -Math.PI / 2 + Math.sin(t * 0.45) * 0.55, 0);   // right side towards you, turning slowly
    previewRig.animateSkins(t, 1);
    r.render(previewRig.scene, previewCam);
    r.autoClear = false;
  }
  mountControls($('controls-root'), controls, padPanel(pad));
  // First launch walks through the steps in order: controls, graphics, settings, then a mode and a weapon.
  mountFirstLaunch(controls, () => { if (!testMode || new URLSearchParams(location.search).has('wizard')) { flow.wizard = true; graphicsUI.open(); } });
  // The setup page shows either a mode's match options or every setting, never both.
  function selectSetupTab(i) { $('match-settings').hidden = i !== 0; $('all-settings').hidden = i !== 1; }
  $('go-graphics').addEventListener('click', () => graphicsUI.open());
  $('controls-next').addEventListener('click', () => { flow.wizard = !flow.inGame; graphicsUI.open(); });   // closing Graphics then goes on to Settings
  for (const b of $('menu').querySelectorAll('.steps button')) b.addEventListener('click', () => {
    const n = Number(b.dataset.step);
    if (n === 1) showPage('controls');
    else if (n === 2) graphicsUI.open();
    else if (n === 3) $('go-settings').click();
    else if (n === 4) showPage('shop');
    else if (n === 5) showPage('mode');
    else if (flow.page !== 'ops') { if (flow.page !== 'setup' || flow.settingsOnly) chooseMode(flow.mode || 'range'); $('setup-next').click(); }
  });
  $('go-settings').addEventListener('click', () => { flow.settingsOnly = true; flow.setupFromPause = flow.inGame; showPage('setup'); selectSetupTab(1); });
  $('go-play').addEventListener('click', () => showPage(flow.inGame ? 'pause' : 'mode'));
  const opSearch = $('ops-search');
  opSearch.addEventListener('input', () => { for (const card of $('ops-grid').querySelectorAll('.op-card')) card.hidden = !card.textContent.toLowerCase().includes(opSearch.value.toLowerCase()); });
  const weaponSearch = $('weapon-search');
  weaponSearch.addEventListener('input', () => { for (const card of slotButtons) card.hidden = !card.textContent.toLowerCase().includes(weaponSearch.value.toLowerCase()); });
  showPage('mode');

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
    if (cur() && cur().active) { prevT = t; cur().update(t); return; }
    const dt = Math.min(0.1, Math.max(0, t - prevT));
    prevT = t;
    const ammoBefore = weapon.ammo;
    const ev = weapon.update(t, fireShot);
    if (weapon.ammo === 0 && ammoBefore > 0) finishMagazine();
    if (ev === 'reloaded') { sfx.reload(); newMagazine(); }
    // Auto reload: an empty magazine reloads by itself.
    if (settings.autoReload && weapon.ammo === 0 && !weapon.reloading && weapon.startReload(t)) sfx.reload();

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
    sfx.observeSteps([{id:0,x:player.x,y:0,z:player.z,crouch:+player.crouched,alive:true,team:'range'}], camera, null, t, null, 0);
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
    // The crosshair opens up with the hip-fire spread (so you can see the cone).
    const cone = settings.hipSpread ? spread.cone(t, state.gun, player.speed > 0.5, player.crouched, state.adsE) : 0;
    const gapPx = Math.round(cone * (window.innerHeight / state.fovV) * 0.6);
    if (gapPx !== xhGap) { xhGap = gapPx; drawCrosshair(crosshairEl, { ...settings.crosshair, gap: settings.crosshair.gap + gapPx }); }
    if (xo !== crossOpacity) { crossOpacity = xo; crosshairEl.style.opacity = xo.toFixed(3); }
    // Gentle walking bob on the weapon (none when still or fully aimed).
    walkPhase += dt * 9 * Math.min(1, player.speed / 3);
    rig.bobY = Math.sin(walkPhase) * 0.004 * Math.min(1, player.speed / 3) * (1 - 0.8 * state.adsE);
    rig.animations = settings.animations;
    rig.reloadP = weapon.reloading ? weapon.reloadProgress : -1;
    rig.reloadEmpty = !!weapon.reloadEmpty;
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
  let xhGap = -1;
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
    const s = controls.e.mc_assist_allowed(+(flow.mode === 'range'), +(flow.mode === 'net')) ? settings.aimAssist : 0;
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
  function lensQuality() { return gfx() === 'low' ? 0 : settings.lensQuality === 'auto' ? autoLevel : Number(settings.lensQuality); }
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
    if (!$('armory').hidden) { renderPreview(clockNow()); return; }
    if (cur() && cur().active) { cur().render(); return; }
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
    pad.poll(Math.min(0.05, (nowMs - (padT || nowMs)) / 1000), padHooks); padT = nowMs;
    const c0 = performance.now();
    if (!manualClock) update(clockNow());
    perf.beginGpu();
    renderFrame();
    perf.endGpu();
    if (prevFrameMs) { watchQuality(nowMs, nowMs - prevFrameMs); watchResolution(nowMs - prevFrameMs); }
    cpuMs[cpuIdx++ % cpuMs.length] = performance.now() - c0;
    if (prevFrameMs) { debug.recordFrame(nowMs - prevFrameMs); perf.record(nowMs - prevFrameMs, performance.now() - c0); }
    prevFrameMs = nowMs;
    if (perf.visible) {
      perfInfo.w = renderW; perfInfo.h = renderH; perfInfo.scale = settings.renderScale || dynScale;
      perfInfo.calls = renderer.info.render.calls; perfInfo.tris = renderer.info.render.triangles;
      perfInfo.target = fpsGoal(); perfInfo.hz = refreshHz;
      perf.update(nowMs, perfInfo);
    }
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

  /* ---------- graphics screen and the Enhanced Graphics pack ---------- */
  function graphicsChanged() {
    applyGraphics();
    rig.rebuild();
    rig.setGun(state.gun, state.gunIndex, state.optic);
    hud.setGun(state.gun, state.gunIndex, state.optic.label, skinName(state.gunIndex));
    resize();
  }
  let hdLoaded = false;
  // Pack models into memory (only when High / Ultra is on), then rebuild what shows them.
  async function loadHD() {
    if (!HDPack.ready) return;
    await Promise.all([HDPack.loadGuns(), loadPackArt(), loadPackAnims(), loadSkinSheets()]);
    hdLoaded = true;
    graphicsChanged();
    if (cur() && cur().active) cur().refreshGraphics();
  }
  HDPack.onChange(() => { if (!HDPack.ready && hdLoaded) { hdLoaded = false; graphicsChanged(); if (cur() && cur().active) cur().refreshGraphics(); } });
  graphicsUI = new GraphicsUI($('app'), {
    settings,
    onClose: () => { if (flow.wizard) { flow.wizard = false; showPage('quick'); } },     // first launch: graphics, then the quick setup
    commit: (key) => { settingsUI.commit(key); settingsUI.refresh(); },
    onPackReady: async () => { if (needsPack(settings.graphics)) await loadHD(); else graphicsChanged(); },
  });
  HDPack.init().then(() => { if (HDPack.ready && needsPack(settings.graphics)) loadHD(); else if (needsPack(settings.graphics)) graphicsChanged(); });

  /* ---------- test hooks (only with ?test in the URL) ---------- */
  if (testMode) {
    window.__range = {
      ready: true,
      controls,
      audio: sfx,
      guns: data.guns,
      // Attachments (Milestone 8): set the current gun's code, read the effective gun.
      attach(code) { const b = baseOf(state.gun); try { localStorage.setItem('attach:' + b.id, sanitize(b, code)); } catch (e) { /* ignore */ } selectGun(state.gunIndex); return state.gun.attach || measuredCode(b); },
      gunNow: () => { const g = state.gun; return { id: g.id, attach: g.attach || null, base: !g.base, magSize: g.magSize, reloadSeconds: g.reloadSeconds, adsSeconds: g.adsSeconds, damage: g.damage, flash: g.flash ?? 1, suppressed: !!g.suppressed, last: g.sprayPath[g.sprayPath.length - 1] }; },
      openArmory: () => openArmory('setup'),
      reloadFrom(empty) { if (empty) weapon.ammo = 0; else weapon.ammo = Math.max(1, weapon.ammo - 5); return weapon.startReload(clockNow()); },
      packClip: () => { const u = rig.current && rig.current.userData; return { split: !!(u && u.support), hand: u && u.support ? u.support.position.toArray() : null, mag: u ? [...u.mag.position.toArray(), u.mag.rotation.x, u.mag.visible] : null, bolt: u ? u.bolt.position.z - u.boltZ : 0, clip: rig._reloadClip ? (rig._reloadClip.bolt ? 'empty' : 'tactical') : null }; },
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
      // The Enhanced Graphics pack (High / Ultra): install from the test server, load, rebuild.
      hdInstall: async () => { const ok = await HDPack.install(); if (ok) await loadHD(); return { ok, state: HDPack.state, error: HDPack.error, guns: hdLoaded }; },
      hdRemove: () => HDPack.remove(),
      audioPackState: () => ({ unlocked: !!sfx.ctx, clips: sfx.samplePack?.clipCount || 0 }),
      audioPackSync: () => { sfx.unlock(); return audioPack.sync(); },
      hdState: () => ({ state: HDPack.state, installed: HDPack.installed && HDPack.installed.version, ready: HDPack.ready, loaded: hdLoaded, effective: gfx() }),
      graphicsUI: () => graphicsUI, perfHud: () => perf, fpsGoal, refreshHz: () => refreshHz,
      rigHD: () => !!(rig.current && rig.current.userData.hd),
      worldPost: () => ({ on: worldPost.active, ...worldPost.o }),
      setPost(o) { Object.assign(settings, o); resize(); return { on: worldPost.active, ...worldPost.o }; },
      noPost(on) { testNoPost = on; resize(); },
      showAO(on) { worldPost.showAO = on; },
      setAnimations(on) { settings.animations = on; },
      profile: () => profile, packs: () => packs,
      rigObj: () => rig,
      skinShot: (id, o) => skinShot(id, o),
      shotDebug: () => ({ renderW, renderH, cw: canvas.width, ch: canvas.height, cam: previewCam.position.toArray(), fov: previewCam.fov, aspect: previewCam.aspect, root: previewRig.root.position.toArray(), box: (() => { const b = new THREE.Box3().setFromObject(previewRig.current); return [b.min.toArray(), b.max.toArray()]; })() }),
      battleStart(o = {}) { Object.assign(settings.battle, o); startBattle(); return !!(battle && battle.active); },
      battleLeave: () => leaveBattle(),
      renderer: () => renderer,
      modeStart: async (mode, o = {}) => { flow.mode = mode; Object.assign(modePrefs, o); return startMode(); },
      modePrefs: (o = {}) => Object.assign(modePrefs, o),
      netGame: (mode) => { netModeVal = mode; netGameUi(); return netMode(); },
      modeGame: () => modeGame,
      battleKey: (c, d) => !!(battle && battle.key(c, d)),
      battle: () => battle,
      battleState: () => battle && ({ active: battle.active, over: battle.over, score: { ...battle.teamScore },
        fighters: battle.fighters.map((f) => ({ name: f.name, team: f.team, x: f.x, z: f.z, yaw: f.yaw, health: f.health, alive: f.alive, kills: f.kills, deaths: f.deaths, crouch: f.crouch })),
        holes: battle.arena.holes.count, calls: renderer.info.render.calls }),
      inspectAt(p) { rig.inspectHold = p; if (p < 0) rig.inspectT = -1; },
      setUltraTex(n) { Range.ULTRA_TEX = n; setUltraTexSize(n); },
      rig: () => ({ drawT: rig.drawT, magY: rig.current.userData.mag.position.y, magVisible: rig.current.userData.mag.visible,
        flash: rig.current.userData.flash.visible, brass: rig.brass.filter((b) => b.visible).length, boltZ: rig.boltZ,
        skinKey: (() => { let k = ''; rig.current.traverse((o) => { k ||= o.material?.userData?.skinKey || ''; }); return k; })() }),
      setHipMs(ms) { hipMs = ms; },
      noLens(on) { noLensDebug = on; },
      move(keys) { Object.assign(player.keys, keys); },
      crouch(on) { player.crouched = on; },
      setSprint(on) { player.sprint = on; },
      lean: () => ({ ex: player.ex, ey: player.ey, ez: player.ez, roll: player.roll, lean: player.lean }),
      player: () => ({ x: player.x, z: player.z, eye: player.eye, crouched: player.crouched, speed: player.speed }),
      setSetting(k, v) { settings[k] = v; },
      setHip(on, scale) { settings.hipSpread = on; settings.hipRecoil = scale; recoil.hipScale = scale; spread.reset(); },
      spreadCone: () => spread.cone(manualT, state.gun, player.speed > 0.5, player.crouched, state.adsE),
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
