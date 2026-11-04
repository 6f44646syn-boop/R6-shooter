// Recoil Range entry point: wires input, camera, scene, HUD and the frame loop together.
import * as THREE from '../vendor/three/three.module.min.js';
import { Look } from './core/look.js';
import { PointerLock } from './core/pointer-lock.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { degPerCount, verticalFovDeg, zoomedFovDeg } from './core/sensitivity.js';
import { DebugHud } from './ui/debug-hud.js';
import { drawCrosshair } from './ui/crosshair.js';

const DEG = Math.PI / 180;
const EYE_HEIGHT = 1.6;
const $ = (id) => document.getElementById(id);

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
  scene.background = new THREE.Color(0x1a1d22);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 200);
  camera.rotation.order = 'YXZ'; // yaw around world Y first, then pitch: standard FPS camera
  camera.position.set(0, EYE_HEIGHT, 0);

  // Temporary stage (a) scene: floor and a wall.
  scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x30302a, 1.2));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 40), new THREE.MeshLambertMaterial({ color: 0x4a4740 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  scene.add(new THREE.GridHelper(40, 40, 0x777777, 0x333333));
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), new THREE.MeshLambertMaterial({ color: 0x8a8378 }));
  wall.position.set(0, 2.5, -10);
  scene.add(wall);

  const look = new Look();
  const debug = new DebugHud($('debug'));
  debug.setVisible(settings.debugHud);

  const state = { ads: false, fovH: settings.hipFov, fovV: 60 };

  function hipDpc() { return degPerCount(settings.dpi, settings.cm360); }
  function currentDpc() { return hipDpc(); }

  /* ---------- pointer lock ---------- */
  const notice = $('notice');
  const lock = new PointerLock(canvas, {
    onChange(locked) {
      $('menu').hidden = locked;
      if (locked) $('lock-hint').hidden = true;
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

  document.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault();
      settings.debugHud = !settings.debugHud;
      debug.setVisible(settings.debugHud);
      saveSettings(settings);
    } else if (e.code === 'KeyZ' && settings.debugHud) {
      look.reset();
    }
  });

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
    state.fovH = state.ads ? zoomedFovDeg(settings.hipFov, 1) : settings.hipFov;
    state.fovV = verticalFovDeg(state.fovH, camera.aspect);
    camera.fov = state.fovV;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  drawCrosshair($('crosshair'), settings.crosshair);

  /* ---------- frame loop ---------- */
  const info = {
    look, dpc: 0, ads: false, raw: false, fovH: 0, fovV: 0, recoilYaw: 0, recoilPitch: 0,
    shotIndex: 0, seed: '-', renderW: 0, renderH: 0, calls: 0, tris: 0,
  };
  let prevMs = performance.now();
  function frame(nowMs) {
    requestAnimationFrame(frame);
    debug.recordFrame(nowMs - prevMs);
    prevMs = nowMs;

    camera.rotation.y = -look.yaw * DEG;   // three.js: positive Y rotation turns left
    camera.rotation.x = look.pitch * DEG;
    renderer.render(scene, camera);

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
