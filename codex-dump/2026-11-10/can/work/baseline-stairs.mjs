// Headless Chrome test runner (dev only).
//   node tests/run.mjs            unit tests + magazine simulation + frame-time check
//
// Needs Playwright with a Chromium build available to Node. Playwright is NOT a dependency of
// the site: the published folder never loads it. If it is not installed globally, run
// `npm i -D playwright` in a scratch folder or use your own Chrome via PLAYWRIGHT_CHROMIUM.
import { createRequire } from 'node:module';
import { startServer } from 'file:///C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/continue-recoil-range-https-github-com/work/m6-baseline/tools/serve.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Playwright is not installed. See the comment at the top of tests/run.mjs.'); process.exit(2); }

const PORT = 8197;
const BASE = 'http://127.0.0.1:' + PORT + '/';
const EYE = 1.6;
let failures = 0;
const ok = (name) => console.log('  PASS ' + name);
const fail = (name, msg) => { failures++; console.log('  FAIL ' + name + '\n       ' + msg); };
function check(name, cond, msg) { cond ? ok(name) : fail(name, msg); }

const server = await startServer(PORT);
const browser = await chromium.launch({
  args: ['--js-flags=--expose-gc', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
});

async function openPage(path, viewport = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport });
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE)) external.push(r.url()); });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  if (path.startsWith('index')) { await page.waitForFunction(() => window.__range?.ready); await page.locator('[data-first-profile=mouse]').click(); }
  return { page, errors, external };
}

try { for(let trial=0;trial<8;trial++){
  /* ---------- stairs, upper floors, falling, vaulting and the Bomb boundary, played ---------- */
  console.log('\nMatch modes: stairs, upper floors, falling, vaulting, defenders kept inside (played with the keys)');
  {
    const { page, errors } = await openPage('index.html?test');
    await page.waitForFunction(() => window.__range && window.__range.ready);
    const ph = await page.evaluate(async () => {
      const R = window.__range, out = {};
      R.manual(true); R.setGraphics('standard');
      const prefs = (mode, map, side = 'attack') => ({ map: { tdm: 'casino', ctf: 'yard', bomb: 'ranch', [mode]: map }, seed: 3, side, op: { tdm: 'glitch', ctf: 'dash', bomb: side === 'attack' ? 'pace' : 'kamai' }, abilities: { tdm: false, ctf: false, bomb: true } });
      const yawTo = (dx, dz) => Math.atan2(dx, -dz) * 180 / Math.PI;
      const park = (G) => { for (const a of G.m.actors) if (a !== G.me) a.brain = null; G.me.protectUntil = 1e9; };
      const put = (G, x, z, y, yaw) => { const f = G.h.f; f.x = x; f.z = z; f.y = y; f.vx = f.vy = f.vz = 0; G.h.camY = y; G.h.vault = null; G.me.x = x; G.me.z = z; G.me.y = y; G.h.look.setAngles(yaw, 0); };
      // Walk the player along the game's own path with W held (sprinting), turning at each corner.
      const walk = (G, to, secs, fps) => {
        const f = G.h.f; let t = 0, top = f.y;
        G.key('ShiftLeft', true);
        while (t < secs && !(Math.hypot(to[0] - f.x, to[1] - f.z) < 0.5 && Math.abs(f.y - to[2]) < 0.5)) {
          const path = G.map.path(f.x, f.z, to[0], to[1], f.y, to[2]);
          // a vault on the way: face it and press C (as a player does)
          if (path[0] && path[0][3] === 1 && path[1] && Math.hypot(path[0][0] - f.x, path[0][1] - f.z) < 0.45) {
            const ex = path[1][0] - f.x, ez = path[1][1] - f.z, ax = Math.abs(ex) > Math.abs(ez);
            G.h.look.setAngles(yawTo(ax ? Math.sign(ex) : 0, ax ? 0 : Math.sign(ez)), 0);
            G.key('KeyW', false); G.key('KeyC', true); R.step(0.1, fps); G.key('KeyC', false); R.step(0.6, fps); t += 0.7; continue;
          }
          const wp = path.find((p) => Math.hypot(p[0] - f.x, p[1] - f.z) > 0.35) || to;
          G.h.look.setAngles(yawTo(wp[0] - f.x, wp[1] - f.z), 0);
          G.key('KeyW', true); R.step(0.1, fps); t += 0.1;
          top = Math.max(top, f.y);
        }
        G.key('KeyW', false); G.key('ShiftLeft', false); R.step(0.3, fps);
        return { t: +t.toFixed(1), x: f.x, y: f.y, z: f.z, top, there: Math.hypot(to[0] - f.x, to[1] - f.z) < 0.6 && Math.abs(f.y - to[2]) < 0.5 };
      };
      /* Team Deathmatch on Jesse's Casino: up to the top floor and down again */
      await R.modeStart('tdm', prefs('tdm', 'casino'));
      let G = R.modeGame(); park(G);
      // the upper floor: the level above 2.5 m with the most places on it
      const N = G.map.nodes, lv = new Map(); for (const n of N) if (n[2] > 2.5) lv.set(n[2], (lv.get(n[2]) || 0) + 1);
      const topY = [...lv.entries()].sort((p, q) => q[1] - p[1])[0][0], up = N.filter((n) => n[2] === topY)[0], down = N.filter((n) => n[2] === 0).sort((a, b) => Math.hypot(b[0] - up[0], b[1] - up[1]) - Math.hypot(a[0] - up[0], a[1] - up[1]))[0];
      const start = [G.h.f.x, G.h.f.z, G.h.f.y];
      out.topY = topY; out.levels = new Set(N.map((n) => n[2])).size;
      out.climb = walk(G, up, 60, 60);
      out.camUp = +(G.h.camera.position.y - G.h.f.y).toFixed(2); out.simY = G.me.y;
      // a bot standing up here is drawn up here
      const bot = G.m.actors.find((a) => a !== G.me && a.alive); bot.x = up[0] + 1; bot.z = up[1]; bot.y = topY; R.step(0.1, 60); R.renderFrame();
      out.botDrawnAt = +G.fig.get(bot.id).group.position.y.toFixed(2);
      // crouch (Space) and aim on the upper floor
      G.key('Space', true); R.step(0.6, 60); out.crouchUp = +G.h.f.crouch.toFixed(2); out.crouchY = G.h.f.y; G.key('Space', false); R.step(0.4, 60);
      // walk off the edge: find a side where the floor ends, walk off it, land
      out.fall = null;
      for (let k = 0; k < 400 && !out.fall; k++) {
        const n = N.filter((q) => q[2] === topY)[k]; if (!n) break;
        for (const ang of [0, 90, 180, 270]) {
          const dx = Math.sin(ang * Math.PI / 180), dz = -Math.cos(ang * Math.PI / 180);
          let d = 0; while (d < 6 && G.map.groundAt(n[0] + dx * d, n[1] + dz * d, topY) > topY - 0.5 && G.map.free(n[0] + dx * d, n[1] + dz * d, 0.32, topY)) d += 0.25;
          if (d >= 6 || !G.map.free(n[0] + dx * (d + 0.5), n[1] + dz * (d + 0.5), 0.32, topY) || G.map.groundAt(n[0] + dx * (d + 0.5), n[1] + dz * (d + 0.5), topY) > topY - 2) continue;      // a wall, a rail or a step down: not a drop
          put(G, n[0], n[1], topY, ang);
          let air = false, lowest = topY;
          G.key('KeyW', true);
          for (let i = 0; i < 40; i++) { R.step(0.1, 60); if (G.h.f.vy < -0.5) air = true; lowest = Math.min(lowest, G.h.f.y); }
          G.key('KeyW', false); R.step(0.5, 60);
          if (air) { out.fall = { from: topY, air, y: G.h.f.y, lowest, vy: G.h.f.vy, onGround: Math.abs(G.map.groundAt(G.h.f.x, G.h.f.z, G.h.f.y) - G.h.f.y) < 1e-6, alive: G.me.alive }; break; }
        }
      }
      out.descend = walk(G, down, 60, 15);
      /* vaulting (C): over low cover in Team Deathmatch on Container Yard */
      await R.modeStart('tdm', prefs('tdm', 'containers'));
      G = R.modeGame(); park(G);
      out.vault = null;
      for (const b of G.map.solids) {
        if (out.vault || b.minY > 0.05 || b.maxY < 0.8 || b.maxY > 1.3 || b.kind === 'edge') continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = (b.minX + b.maxX) / 2 - dx * ((b.maxX - b.minX) / 2 + 0.5), z = (b.minZ + b.maxZ) / 2 - dz * ((b.maxZ - b.minZ) / 2 + 0.5);
          if (!G.map.free(x, z, 0.32, 0) || G.map.groundAt(x, z, 0) > 0.01) continue;
          const v = G.map.vaultTarget(x, 0, z, dx, dz);
          if (!v || v.y > 0.05) continue;                         // over it, to the far side
          put(G, x, z, 0, yawTo(dx, dz)); R.step(0.2, 60);
          G.key('KeyC', true); R.step(0.1, 60); const mid = !!G.h.vault; let peak = 0;
          for (let i = 0; i < 12; i++) { R.step(0.05, 60); peak = Math.max(peak, G.h.f.y); }
          G.key('KeyC', false); R.step(0.3, 60);
          out.vault = { h: b.maxY, mid, peak: +peak.toFixed(2), crossed: (G.h.f.x - x) * dx + (G.h.f.z - z) * dz, want: (v.x - x) * dx + (v.z - z) * dz, y: G.h.f.y, sim: Math.hypot(G.me.x - G.h.f.x, G.me.z - G.h.f.z) };
          break;
        }
      }
      // C in the open does nothing; a tall wall is not climbed
      put(G, G.map.nodes[0][0], G.map.nodes[0][1], G.map.nodes[0][2], 0);
      const tall = G.map.solids.find((b) => b.kind === 'edge' && b.minX > 0);
      put(G, tall.minX - 0.5, 0.3, 0, 90); R.step(0.2, 60); G.key('KeyC', true); R.step(0.4, 60); G.key('KeyC', false);
      out.noVaultWall = !G.h.vault && G.h.f.x < tall.minX;
      /* Bomb on Ranch as a defender: the opened west door and a breached outside wall */
      await R.modeStart('bomb', prefs('bomb', 'ranch', 'defend'));
      G = R.modeGame(); park(G);
      out.defender = !G.m.rules.isAttacker(G.me);
      const door = G.map.panels.find((q) => q.kind === 'door' && !q.win && q.box.minX < -27.9 && q.box.maxX > -28.1);
      G.map.hurtDoor(door, 999);
      const dz0 = (door.box.minZ + door.box.maxZ) / 2;
      const push = (x, z, yaw, secs, fps) => { put(G, x, z, 0, yaw); G.key('KeyW', true); G.key('ShiftLeft', true); let far = 1e9; for (let i = 0; i < secs * 10; i++) { R.step(0.1, fps); far = Math.min(far, G.h.f.x); } G.key('KeyW', false); G.key('ShiftLeft', false); return far; };
      out.doorOpen = !door.alive;
      out.defOut = [push(-26.5, dz0, 270, 2, 60), push(-26.5, dz0, 270, 2, 10)];
      R.step(0.05, 60);
      out.warn = G.hud.banner.hidden ? '' : G.hud.banner.textContent;
      // back in the middle of the house the warning goes away
      put(G, -15, 7, 0, 0); R.step(2, 60);
      out.warnInside = G.hud.banner.hidden ? '' : G.hud.banner.textContent;
      // a breached soft wall in the west outside wall (x = -28, z 9..12) and the window (z 5..7) broken open
      const softN = G.map.panels.filter((q) => (q.kind === 'soft' || q.win) && q.box.minX < -27.9 && q.box.maxX > -28.1);
      for (const q of softN) G.map.breakPanel(q);
      out.defOutSoft = -1e9;
      for (const q of softN) { const sz = (q.box.minZ + q.box.maxZ) / 2; put(G, -26.6, sz, 0, 270); G.key('KeyW', true); G.key('ShiftLeft', true); for (let i = 0; i < 20; i++) { R.step(0.1, 15); out.defOutSoft = Math.max(out.defOutSoft, -G.h.f.x); } G.key('KeyW', false); G.key('ShiftLeft', false); G.key('KeyC', true); R.step(0.6, 15); G.key('KeyC', false); R.step(0.3, 15); out.defOutSoft = Math.max(out.defOutSoft, -G.h.f.x); }
      out.softBroken = softN.length; out.defOutSoft = -out.defOutSoft;
      // defender bots too: one sent outside comes no farther than the wall line
      const db = G.m.actors.find((a) => a !== G.me && !G.m.rules.isAttacker(a));
      db.x = -26.5; db.z = dz0; db.y = 0; let botFar = 1e9; for (let i = 0; i < 120; i++) { G.m.moveActor(db, -5.6, 0, 1 / 60); G.m.step(); botFar = Math.min(botFar, db.x); }
      out.botOut = botFar;
      /* the same door as an attacker: out you go */
      await R.modeStart('bomb', prefs('bomb', 'ranch', 'attack'));
      G = R.modeGame(); park(G);
      while (G.m.rules.phase === 'prep') R.step(1, 60);
      const door2 = G.map.panels.find((q) => q.kind === 'door' && !q.win && q.box.minX < -27.9 && q.box.maxX > -28.1);
      G.map.hurtDoor(door2, 999);
      put(G, -26.5, dz0, 0, 270); G.key('KeyW', true); R.step(2, 60); G.key('KeyW', false);
      out.attOut = G.h.f.x; out.attWarn = G.hud.banner.hidden ? '' : G.hud.banner.textContent;
      R.battleLeave();
      /* Battle: the same stairs with the same body */
      R.battleStart({ opponent: 'bots', bots: 1, level: 'easy', kills: 99, map: 'casino' });
      const B = R.battle(), h = B.humans[0]; const spawn = [h.f.x,h.f.z,h.f.y];
      for (const b of B.bots) { b.update = () => {}; b.f.x = 18; b.f.z = 12; }
      h.f.protectUntil = 1e9; R.step(0.2, 60);
      const A = B.arena, topB = topY, goal = up;        // the same top-floor spot as in Team Deathmatch
      let tB = 0;
      while (tB < 60 && !(Math.hypot(goal[0] - h.f.x, goal[1] - h.f.z) < 0.6 && Math.abs(h.f.y - topB) < 0.5)) {
        const path = A.findPath(h.f.x, h.f.z, goal[0], goal[1], h.f.y, topB);
        if (path[0] && path[0][3] === 1 && path[1] && Math.hypot(path[0][0] - h.f.x, path[0][1] - h.f.z) < 0.45) {
          const ex = path[1][0] - h.f.x, ez = path[1][1] - h.f.z, ax = Math.abs(ex) > Math.abs(ez);
          h.look.setAngles(yawTo(ax ? Math.sign(ex) : 0, ax ? 0 : Math.sign(ez)), 0); B.key('KeyW', false); B.key('KeyC', true); R.step(0.1, 30); B.key('KeyC', false); R.step(0.6, 30); tB += 0.7; continue;
        }
        const wp = path.find((p) => Math.hypot(p[0] - h.f.x, p[1] - h.f.z) > 0.35) || goal;
        h.look.setAngles(yawTo(wp[0] - h.f.x, wp[1] - h.f.z), 0); B.key('KeyW', true); R.step(0.1, 30); tB += 0.1;
      }
      B.key('KeyW', false);
      out.battleTop = { want: topB, y: h.f.y, spawn, t: +tB.toFixed(1) };
      out.sameTop = A.nodeAt(up[0], up[1], topY) >= 0;
      R.battleLeave();
      return out;
    });
    check('Casino in Team Deathmatch has its upper floors (' + ph.levels + ' levels, the top one ' + ph.topY + ' m up)', ph.levels > 5 && ph.topY > 2.5, JSON.stringify(ph));
    check('you walk up the stairs to the top floor with W held (' + ph.climb.t + ' s; feet at ' + ph.climb.y.toFixed(2) + ' m)', ph.climb.there && Math.abs(ph.climb.y - ph.topY) < 0.01 && Math.abs(ph.simY - ph.topY) < 0.01, JSON.stringify(ph.climb));
    check('the camera is at eye height above the floor you stand on (' + ph.camUp + ' m)', ph.camUp > 1.4 && ph.camUp < 1.7, String(ph.camUp));
    check('a bot upstairs is drawn upstairs', Math.abs(ph.botDrawnAt - ph.topY) < 0.01, String(ph.botDrawnAt));
    check('crouching works on the upper floor (Space)', ph.crouchUp > 0.9 && Math.abs(ph.crouchY - ph.topY) < 0.01, JSON.stringify([ph.crouchUp, ph.crouchY]));
    check('walking off the edge you fall and land on your feet below (from ' + (ph.fall && ph.fall.from) + ' m to ' + (ph.fall && ph.fall.y.toFixed(2)) + ' m)', !!ph.fall && ph.fall.air && ph.fall.y < ph.fall.from - 1 && ph.fall.y >= 0 && ph.fall.onGround && ph.fall.vy === 0 && ph.fall.alive, JSON.stringify(ph.fall));
    check('and you walk back down to the ground floor at 15 FPS (' + ph.descend.t + ' s)', ph.descend.there && Math.abs(ph.descend.y) < 0.01, JSON.stringify(ph.descend));
    check('C vaults over low cover in a match mode (a ' + (ph.vault && ph.vault.h.toFixed(2)) + ' m obstacle; feet up to ' + (ph.vault && ph.vault.peak) + ' m)', !!ph.vault && ph.vault.mid && ph.vault.peak > ph.vault.h && Math.abs(ph.vault.crossed - ph.vault.want) < 0.3 && Math.abs(ph.vault.y) < 0.01 && ph.vault.sim < 0.3, JSON.stringify(ph.vault));
    check('C at a full-height wall does nothing', ph.noVaultWall);
    check('Bomb defender: sprinting out of an opened outside door stops at the wall line, at 60 and 10 FPS (x ' + ph.defOut.map((v) => v.toFixed(2)).join(', ') + ')', ph.defender && ph.doorOpen && ph.defOut.every((x) => x >= -28.001), JSON.stringify(ph.defOut));
    check('a quiet warning shows there ("' + ph.warn + '") and goes away inside', /inside the building/.test(ph.warn) && ph.warnInside === '', JSON.stringify([ph.warn, ph.warnInside]));
    check('a breached outside wall or an opened window (sprinting at it, then C to vault) does not let a defender out either (x ' + ph.defOutSoft.toFixed(2) + ')', ph.softBroken > 2 && ph.defOutSoft >= -28.001, JSON.stringify([ph.softBroken, ph.defOutSoft]));
    check('defender bots are held at the same line (x ' + ph.botOut.toFixed(2) + ')', ph.botOut >= -28.001, String(ph.botOut));
    check('an attacker walks out of the same door freely, with no warning (x ' + ph.attOut.toFixed(2) + ')', ph.attOut < -30 && ph.attWarn === '', JSON.stringify([ph.attOut, ph.attWarn]));
    console.log(JSON.stringify(ph.battleTop));
    check('Battle uses the same body on the same stairs: up to the Casino top floor (' + ph.battleTop.t + ' s)', ph.sameTop && Math.abs(ph.battleTop.y - ph.battleTop.want) < 0.01, JSON.stringify(ph.battleTop));
    check('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }
} } finally { await browser.close(); server.close(); }
