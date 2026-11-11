// Dev-only replay integration checks. Uses an externally installed Playwright.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from '../tools/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startServer(8158);
let browser, count = 0;
function check(name, condition, detail) { assert.ok(condition, name + ' ' + JSON.stringify(detail ?? '')); console.log('PASS ' + name); count++; }
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8158/index.html?test');
  await page.waitForFunction(() => window.__range?.ready);
  await page.locator('[data-first-profile=mouse]').click();
  const battle = await page.evaluate(async () => {
    const R = __range; R.manual(true);
    R.battleStart({ opponent: 'bots', bots: 1, level: 'easy', kills: 99, map: 'yard' });
    const B = R.battle(), h = B.humans[0], k = B.bots[0].f;
    B.bots[0].update = () => {};
    const { effectiveGun } = await import('/js/core/loadout.js' + new URL(document.querySelector('script[src*="js/main.js"]').src).search);
    const gun = effectiveGun(B.deps.guns[0], '4000');
    k.gun = gun; k.skin = 4; k.ads = 1; k.lean = 1;
    k.yaw = 179; B.rec = { frames: [], shots: [] }; B._record(10);
    k.yaw = -179; B._record(10.1);
    h.killerId = k.id; h.f.alive = false;
    B._startKillCam(10.1); B.kc.from = 10.05;
    // Live loadout changes must not rewrite history.
    k.gun = B.deps.guns[1]; k.skin = 173;
    B._killCam(10.1); B.render();
    const result = { roll: h.camera.rotation.z, fov: h.camera.fov,
      target: B.deps.adsVFov(B.puppet.optic), attach: B.puppet.gun.attach,
      skin: B.puppet.rig.forceSkin, yaw: -h.camera.rotation.y * 180 / Math.PI };
    let snapshot;
    const broadcast = B._broadcast;
    B._broadcast = message => { snapshot = message; };
    B._sendSnapshot(10.1); B._broadcast = broadcast;
    const row = snapshot.f.find(row => row[0] === k.id);
    result.sentLean = row[15]; result.sentOptic = row[16];
    row[15] = -0.75;
    B._clientMsg(snapshot); result.receivedLean = k.lean;
    row[15] = Infinity;
    B._clientMsg(snapshot); result.invalidLean = k.lean;
    const puppet = B.puppet, textures = [];
    for (let j = 0; j < 5; j++) {
      B._startKillCam(10.1); B.kc.from = 10.05; B._killCam(10.1); B.render();
      textures.push(B.deps.renderer.info.memory.textures);
    }
    result.reused = B.puppet === puppet; result.textures = textures;
    B.kc = null; B.rec = { frames: [], shots: [] };
    for (let j = 0; j < 600; j++) B._record(j / 60);
    result.frames = B.rec.frames.length;
    // Old Battle frames have ten entries and no loadout metadata.
    const old = B.rec.frames.slice(-2).map(f => ({t:f.t,d:f.d.map(a=>a.slice(0,10))}));
    B.rec = {frames:old,shots:[]}; B._startKillCam(old.at(-1).t); B.kc.from = old[0].t;
    B._killCam(old.at(-1).t); result.legacy = Number.isFinite(h.camera.fov);
    B.stop(); result.cleared = B.rec === null && B.kc === null;
    return result;
  });
  check('Battle replay reproduces ADS and right lean', battle.roll < -0.1 && Math.abs(battle.fov - battle.target) < 0.5, battle);
  check('Battle interpolates across the yaw wrap', Math.abs(Math.abs(battle.yaw) - 180) < 0.1, battle);
  check('Battle retains recorded attachment and skin', battle.attach === '4000' && battle.skin === 4, battle);
  check('existing snapshots carry view state and reject invalid lean', battle.sentLean === 1 && typeof battle.sentOptic === 'string' && battle.receivedLean === -0.75 && battle.invalidLean === 0, battle);
  check('five replays reuse one rig without texture growth', battle.reused && battle.textures.every(n => n === battle.textures[0]), battle);
  check('Battle keeps six seconds at 30 Hz and clears on stop', battle.frames <= 182 && battle.frames >= 179 && battle.cleared, battle);
  check('legacy Battle frames still play', battle.legacy);
  for (const mode of ['tdm','ctf','bomb']) {
    const result = await page.evaluate(async mode => {
      const R = __range;
      await R.modeStart(mode, {map:{tdm:'yard',ctf:'yard',bomb:'ranch'},teamSize:2,seed:3});
      const G = R.modeGame(), m = G.m, k = m.actors.find(a=>a !== G.me);
      const { effectiveGun } = await import('/js/core/loadout.js' + new URL(document.querySelector('script[src*="js/main.js"]').src).search);
      const gun = effectiveGun(G.deps.guns[0], '4000');
      k.gunData = gun; k.ads = 1; k.lean = 1;
      G.fig.get(k.id).skin = 4;
      G.rec = {frames:[],shots:[],hits:[]};
      m.t = 10; G._record(); m.t = 10.1; G._record();
      G.me.alive = false;
      G._startKc(k, {kind:'gun'}, 20); G.kc.from = 10.05;
      G._replay(20.3); G._camera(20.3); G.render();
      const result = {roll:G.kcCam.rotation.z,fov:G.kcCam.fov,target:G.deps.adsVFov(G.kcPuppet.optic),attach:G.kcPuppet.gun.attach};
      G._endKc();
      // Legacy seven-float match record.
      G.rec.frames = [10,10.1].map(t=>({t,s:new Float32Array(m.actors.flatMap(a=>[a.x,a.z,a.yaw,a.pitch,a.crouch,1,a.y]))}));
      G._startKc(k, {kind:'gun'}, 30); G.kc.from=10;
      G._replay(30.3); result.legacy=Number.isFinite(G.kcCam.fov); G._endKc();
      return result;
    }, mode);
    check(mode + ' replay reproduces ADS, lean and attachment', result.roll < -0.1 && Math.abs(result.fov-result.target) < 0.5 && result.attach === '4000', result);
    check(mode + ' legacy match frames still play', result.legacy);
  }
  const spec = await page.evaluate(async () => {
    const R = __range;
    await R.modeStart('bomb', {teamSize:3,seed:3,map:{bomb:'ranch'}});
    const game = R.modeGame(), me = game.me;
    for (const actor of game.m.actors) actor.brain = null;
    const mates = game.m.actors.filter(actor => actor.team === me.team && actor !== me);
    const enemy = game.m.actors.find(actor => actor.team !== me.team);
    me.alive = false; mates[0].ads = 1; mates[0].lean = 1;
    const now = game.prevT;
    game._camera(now, 0.016);
    const first = game.spectator === mates[0] && game.camOverride === game.spectatorCam
      && game.spectatorCam.rotation.z < -0.1
      && Math.abs(game.spectatorCam.fov - game.deps.adsVFov(game.kcPuppet.optic)) < 0.5;
    game.mouseButton(0,true); game._camera(now);
    const next = game.spectator === mates[1];
    game.mouseButton(2,true); game._camera(now);
    const previous = game.spectator === mates[0];
    game.key('Digit2',true); game._camera(now);
    const shortcut = game.spectator === mates[1];
    const followed = game.fig.get(mates[1].id), opponent = game.fig.get(enemy.id);
    followed.group.visible = opponent.group.visible = opponent.outline.visible = true;
    const sight = game.map.sight;
    game.map.sight = () => false;
    let hidden;
    try { game._drawSpectatorWorld(game.spectatorCam, () => { hidden = !followed.group.visible && !opponent.group.visible && !opponent.outline.visible; }); }
    finally { game.map.sight = sight; }
    const restored = followed.group.visible && opponent.group.visible && opponent.outline.visible;
    R.renderFrame();
    mates[1].alive = false; game._camera(now);
    const switched = game.spectator === mates[0];
    mates[0].alive = false; game._camera(now);
    const wiped = !game.spectator && !game.camOverride;
    me.alive = true; game._camera(now);
    const respawn = !game.spectator && game.spectatorId === null && !game.camOverride;
    return {first,next,previous,shortcut,hidden,restored,switched,wiped,respawn};
  });
  check('Bomb spectates teammate ADS and lean', spec.first, spec);
  check('Bomb spectating cycles both ways and accepts number keys', spec.next && spec.previous && spec.shortcut, spec);
  check('spectating hides the followed body and occluded enemy visuals during render', spec.hidden && spec.restored, spec);
  check('spectating recovers after teammate death, team wipe, and respawn', spec.switched && spec.wiped && spec.respawn, spec);
  check('no browser errors', errors.length === 0, errors);
  console.log(count + ' replay checks passed');
} finally { await browser?.close(); server.close(); }
