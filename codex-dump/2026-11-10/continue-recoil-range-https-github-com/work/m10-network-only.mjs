// Headless Chrome test runner (dev only).
//   node tests/run.mjs            unit tests + magazine simulation + frame-time check
//
// Needs Playwright with a Chromium build available to Node. Playwright is NOT a dependency of
// the site: the published folder never loads it. If it is not installed globally, run
// `npm i -D playwright` in a scratch folder or use your own Chrome via PLAYWRIGHT_CHROMIUM.
import { createRequire } from 'node:module';
import { startServer } from 'file:///C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/continue-recoil-range-https-github-com/work/R6-shooter/tools/serve.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Playwright is not installed. See the comment at the top of tests/run.mjs.'); process.exit(2); }

const PORT = 8164;
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

try {
  // Network battle between two separate browser sessions (as two PCs would be): join codes,
  // positions both ways, shots both ways, kill feed, host ending the match.
  // Runs over direct join codes and, when a relay is running (RELAY=url, or wrangler dev on
  // port 8787 in relay/), over the relay with a game code.
  const RELAY = process.env.RELAY || 'http://127.0.0.1:8787';
  let relayUp = false;
  try { relayUp = /Recoil Range relay/.test(await (await fetch(RELAY + '/')).text()); } catch (e) { /* not running */ }
  if (!relayUp) console.log('\n(relay not running at ' + RELAY + ': skipping the relay network test; run "npx wrangler dev --port 8787" in relay/)');
  /* ---------- network matches (milestone 9): Team Deathmatch and Bomb online ---------- */
  {
    console.log('\nNetwork matches (two browser sessions, join codes): Team Deathmatch and Bomb');
    const A = await (await browser.newContext()).newPage({ viewport: { width: 960, height: 540 } });
    const B = await (await browser.newContext()).newPage({ viewport: { width: 960, height: 540 } });
    const nerr = [];
    for (const [n, p] of [['host', A], ['player', B]]) p.on('pageerror', (e) => nerr.push(n + ': ' + String(e.stack || e)));
    for (const p of [A, B]) { await p.goto(BASE + 'index.html?test', { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__range); }
    for (const p of [A, B]) { await p.locator('[data-first-profile=mouse]').click(); await p.evaluate(() => document.querySelector('.mode-card[data-mode=net]').click()); }
    for (const p of [A, B]) await p.click('#net-via-lan');
    // the player asks to defend in Bomb (their own Bomb setting)
    await B.evaluate(() => window.__range.modePrefs({ side: 'defend' }));
    await A.click('#net-host'); await B.click('#net-join');
    await B.waitForFunction(() => document.getElementById('net-out-j').value.startsWith('RR1-'));
    await A.fill('#net-in-h', await B.inputValue('#net-out-j')); await A.click('#net-accept');
    await A.waitForFunction(() => document.getElementById('net-out-h').value.startsWith('RR1-'));
    await B.fill('#net-in-j', await A.inputValue('#net-out-h')); await B.click('#net-connect');
    let connected = true;
    try { await B.waitForFunction(() => /Connected/.test(document.getElementById('net-status').textContent), null, { timeout: 25000 }); } catch (e) { connected = false; }
    check('two sessions connect for a network match', connected, await B.textContent('#net-status'));
    const gameBox = await A.evaluate(() => !document.getElementById('net-game-box').hidden && [...document.querySelectorAll('#net-mode option')].map((o) => o.value).join());
    check('the host can choose Battle, Team Deathmatch, Capture the Flag or Bomb', gameBox === 'battle,tdm,ctf,bomb', String(gameBox));
    if (connected) {
      const run = async (sec) => { for (let i = 0; i < sec * 20; i++) { await A.evaluate(() => window.__range.step(0.05, 60)); await B.evaluate(() => window.__range.step(0.05, 60)); await new Promise((r) => setTimeout(r, 5)); } };
      // Battle online: grenades (bug B11). The player throws; the host's simulation throws it and
      // both PCs see it fly and go off.
      await A.evaluate(() => { const R = window.__range; R.manual(true); R.setGraphics('standard'); R.netGame('battle'); R.battleStart({ opponent: 'net', bots: 0, level: 'easy', kills: 10 }); });
      await B.waitForFunction(() => window.__range.battle() && window.__range.battle().active, null, { timeout: 8000 });
      await B.evaluate(() => { window.__range.manual(true); document.getElementById('menu').hidden = true; });
      await run(1);
      await B.evaluate(() => { const Bt = window.__range.battle(), h = Bt.humans[0]; h.look.setAngles(0, 10); Bt.key('KeyG', true); });
      await run(0.4);
      const following = await B.evaluate(() => { const b = window.__range.battle(); return b.grenadeCam === b.grenadeView.camera; });
      await B.evaluate(() => window.__range.battle().key('KeyG', false));
      await run(0.1);
      check('Battle online: hold follows the confirmed throw and release restores first person', following && await B.evaluate(() => !window.__range.battle().grenadeCam));
      let both = [0, 0], blast = 0;
      for (let i = 0; i < 40; i++) {
        await run(0.1);
        const n = await Promise.all([A, B].map((p) => p.evaluate(() => window.__range.battle().nadesB.live.length)));
        both = [Math.max(both[0], n[0]), Math.max(both[1], n[1])];
        blast = Math.max(blast, await B.evaluate(() => (window.__range.battle().blasts || []).length));
      }
      const left = await B.evaluate(() => window.__range.battle().humans[0].f.nades);
      check('Battle online: a grenade from the player flies on both PCs and goes off on the player\'s PC too (B11 fixed)', both[0] >= 1 && both[1] >= 1 && blast >= 1 && left === 1, JSON.stringify({ both, blast, left }));
      await A.evaluate(() => {
        const battle = window.__range.battle(), thrower = battle.humans[0].f, target = battle.remotes[0].f;
        target.protectUntil = 0;
        const grenade = battle.nadesB.throw(thrower, 0, 0, battle.t);
        Object.assign(grenade, { x: target.x, y: target.y + 0.65, z: target.z, vx: 0, vy: 0, vz: 0, end: battle.t + 0.25 });
      });
      await run(0.55);
      const nadeReplay = await B.evaluate(() => { const battle = window.__range.battle(); return !!battle.kc?.grenade && battle.grenadeCam === battle.grenadeView.camera; });
      check('Battle online: a grenade death replays the host-confirmed projectile', nadeReplay);
      await A.evaluate(() => window.__range.battleLeave());
      await B.waitForFunction(() => !window.__range.battle().active, null, { timeout: 5000 }).catch(() => {});
      await A.evaluate(() => { const R = window.__range; R.manual(true); R.setGraphics('standard'); R.modePrefs({ teamSize: 3, map: { tdm: 'yard', ctf: 'yard', bomb: 'ranch' }, abilities: { tdm: false, ctf: false, bomb: true }, difficulty: 'easy', side: 'attack' }); R.netGame('tdm'); R.battleStart({ opponent: 'net' }); });
      await B.waitForFunction(() => window.__range.modeGame() && window.__range.modeGame().active && window.__range.modeGame().netRole === 'client', null, { timeout: 15000 });
      await B.evaluate(() => { window.__range.manual(true); document.getElementById('menu').hidden = true; });
      await run(1);
      const ro = await Promise.all([A, B].map((p) => p.evaluate(() => { const G = window.__range.modeGame(); return { role: G.netRole, actors: G.m.actors.map((a) => a.id + a.team + (a.human ? 'h' : 'b')).join(), me: G.me.id, remote: G.m.actors.filter((a) => a.remote !== null && a.remote !== undefined).map((a) => a.id) }; })));
      check('Team Deathmatch online: both PCs have the same roster (3 v 3, the player in a place of their own)', ro[0].actors === ro[1].actors && ro[0].actors.split(',').length === 6 && ro[0].remote.length === 1 && ro[0].remote[0] === ro[1].me && ro[0].me !== ro[1].me, JSON.stringify(ro));
      // park the bots on the host; the player stands at (-10, 0), an enemy bot at (-5, 0)
      const ids = await A.evaluate((pid) => {
        const G = window.__range.modeGame(), m = G.m, pl = m.actors.find((a) => a.id === pid);
        for (const a of m.actors) if (a.brain) a.brain = null;
        const foe = m.actors.find((a) => !a.human && a.team !== pl.team);
        for (const a of m.actors) if (!a.human) { a.x = 25; a.z = 15 - a.id; a.y = 0; }
        foe.x = -5; foe.z = 0; foe.y = 0; foe.protectUntil = 0; foe.alive = true; foe.hp = 100;
        G.h.respawn(25, -15, window.__range.now(), 0);
        return { foe: foe.id, pl: pid };
      }, ro[1].me);
      await B.evaluate(() => { const R = window.__range, G = R.modeGame(); G.h.respawn(-10, 0, R.now(), 0); G.me.protectUntil = 0; });
      await run(1);
      const pos = await A.evaluate((pid) => { const a = window.__range.modeGame().m.actors.find((x) => x.id === pid); return [a.x, a.z]; }, ids.pl);
      check('the host sees the player where the player\'s PC put them', Math.hypot(pos[0] + 10, pos[1]) < 0.6, JSON.stringify(pos));
      const seen = await B.evaluate((fid) => { const a = window.__range.modeGame().m.actors.find((x) => x.id === fid); return [a.x, a.z]; }, ids.foe);
      check('the player sees the host\'s bots where the host has them', Math.hypot(seen[0] + 5, seen[1]) < 0.6, JSON.stringify(seen));
      // the player fires at the bot: as the player sees it; the host checks and applies it
      for (let i = 0; i < 8; i++) {
        await B.evaluate(() => { const G = window.__range.modeGame(), me = G.me; G.o = [me.x, me.y + 1.6, me.z]; G.d = [1, -0.12, 0]; const n = Math.hypot(...G.d); G.d = G.d.map((v) => v / n); G._clientShot(me); });
        await run(0.15);
      }
      await run(0.5);
      const k = await Promise.all([A, B].map((p) => p.evaluate((fid) => { const G = window.__range.modeGame(); const a = G.m.actors.find((x) => x.id === fid); return { hp: a.hp, alive: a.alive, deaths: a.deaths, feed: G.feed.map((f) => f.k + '>' + f.v).join('|') }; }, ids.foe)));
      check('the player\'s shots kill the bot on the host; both PCs show it (feed: "You" on the player\'s PC)', k[0].deaths >= 1 && k[1].deaths >= 1 && /^You>/.test(k[1].feed) && !/^You>/.test(k[0].feed), JSON.stringify(k));
      // a grenade from the player: thrown by the host's simulation, seen flying and exploding on both
      await B.evaluate(() => { const G = window.__range.modeGame(); G.h.look.setAngles(90, -10); G.key('KeyG', true); });
      await run(0.4);
      const matchFollow = await B.evaluate(() => { const g = window.__range.modeGame(); return g.camOverride === g.grenadeView.camera; });
      await B.evaluate(() => window.__range.modeGame().key('KeyG', false));
      await run(0.1);
      check('Team Deathmatch online: hold follows the confirmed throw and release restores first person', matchFollow && await B.evaluate(() => { const g = window.__range.modeGame(); return g.camOverride !== g.grenadeView.camera; }));
      let flying = 0;
      for (let i = 0; i < 6; i++) { await run(0.1); flying = Math.max(flying, await B.evaluate(() => window.__range.modeGame().m.nades.live.length)); }
      await run(3);
      const booms = await B.evaluate(() => window.__range.modeGame().fx.length + (window.__range.modeGame().fx2 || []).length);
      check('a grenade thrown on the player\'s PC flies on the host and both see it', flying >= 1, 'flying ' + flying + ', effects ' + booms);
      await A.evaluate(pid => {
        const m = window.__range.modeGame().m, target = m.actors.find(actor => actor.id === pid);
        const thrower = m.actors.find(actor => actor.alive && actor.team !== target.team);
        target.protectUntil = 0;
        thrower.nades = 2; thrower.nadeAt = 0;
        const nade = m.nades.throw(thrower, 0, 0);
        Object.assign(nade, { x: target.x, y: target.y + 0.65, z: target.z, vx: 0, vy: 0, vz: 0, end: m.t + 0.35 });
      }, ids.pl);
      await run(1);
      const matchDeath = await B.evaluate(() => { const g = window.__range.modeGame(); return !!g.kc?.grenade && g.camOverride === g.grenadeView.camera; });
      check('Team Deathmatch online: a grenade death follows the host-confirmed trajectory', matchDeath);
      await A.evaluate(() => {
        const game = window.__range.modeGame();
        game.m.end(game.me.team, 'test');
      });
      await run(0.2);
      const matchFinale = await B.evaluate(() => {
        const game = window.__range.modeGame();
        const replay = game.hud.end.dataset.finale === 'replay' && !!game.kc?.final;
        game.hud.end.querySelector('.b-finale-replay button').click();
        return { replay, results: game.hud.end.dataset.finale === 'results', rows: game.hud.endTable.children.length,
          lineup: game.finale.lineup.children.length };
      });
      check('Team Deathmatch online: client sees the final kill, winning lineup and host leaderboard', matchFinale.replay && matchFinale.results && matchFinale.rows === 6 && matchFinale.lineup === 3, JSON.stringify(matchFinale));
      await A.evaluate(() => window.__range.modeGame().stop());
      await B.waitForFunction(() => !window.__range.modeGame().active, null, { timeout: 5000 }).catch(() => {});
      check('host leaving the match returns the player to the menu', await B.evaluate(() => !window.__range.modeGame().active));
      // Capture the Flag: the flags are where the host has them, on both PCs
      await A.evaluate(() => { const R = window.__range; R.netGame('ctf'); R.battleStart({ opponent: 'net' }); });
      await B.waitForFunction(() => window.__range.modeGame().active && window.__range.modeGame().netRole === 'client', null, { timeout: 15000 });
      await run(1);
      await A.evaluate(() => { const m = window.__range.modeGame().m; const f = m.rules.flags.B; f.state = 'dropped'; f.x = 3; f.z = 4; f.returnAt = m.t + 20; });
      await run(0.5);
      const flags = await Promise.all([A, B].map((p) => p.evaluate(() => { const r = window.__range.modeGame().m.rules; return [r.flags.B.state, r.flags.B.x, r.flags.B.z, r.flags.A.state].join(); })));
      check('Capture the Flag online: a dropped flag is where the host has it on the player\'s PC', flags[0] === flags[1] && flags[0] === 'dropped,3,4,home', JSON.stringify(flags));
      await A.evaluate(() => window.__range.modeGame().stop());
      await B.waitForFunction(() => !window.__range.modeGame().active, null, { timeout: 5000 }).catch(() => {});
      // Bomb: the player asked to defend; a door the host breaks is broken on the player's PC
      await A.evaluate(() => { const R = window.__range; R.netGame('bomb'); R.battleStart({ opponent: 'net' }); });
      await B.waitForFunction(() => window.__range.modeGame().active && window.__range.modeGame().netRole === 'client', null, { timeout: 15000 });
      await B.evaluate(() => { document.getElementById('menu').hidden = true; });
      await run(1);
      const bomb = await Promise.all([A, B].map((p) => p.evaluate(() => { const G = window.__range.modeGame(), m = G.m; return { side: m.rules.sideOf(G.me.team), phase: m.rules.phase, round: m.rules.round, roof: m.map.data.walls.some((w) => w.kind === 'roof') }; })));
      check('Bomb online: the player defends as asked, the host attacks; both are in round 1 prep', bomb[0].side === 'attack' && bomb[1].side === 'defend' && bomb[0].phase === 'prep' && bomb[1].phase === 'prep' && bomb[1].round === 1, JSON.stringify(bomb));
      const door = await A.evaluate(() => { const m = window.__range.modeGame().m; const i = m.map.panels.findIndex((p) => p.kind === 'door' && p.alive); m.map.breakPanel(m.map.panels[i]); return i; });
      await run(0.5);
      const broken = await B.evaluate((i) => !window.__range.modeGame().m.map.panels[i].alive && !window.__range.modeGame().m.map.panels[i].cells.some((c) => c.alive), door);
      check('a door broken on the host is broken on the player\'s PC (collision too)', broken, 'panel ' + door);
      // the player reinforces a wall: an action the host's simulation runs
      // the player (a defender, in prep) holds Interact at a soft wall: the host's simulation reinforces it
      const reinf = await A.evaluate(() => {
        const m = window.__range.modeGame().m, pl = m.actors.find((a) => a.remote !== null && a.remote !== undefined);
        for (const pn of m.map.panels) {
          if (pn.kind !== 'soft' || !pn.alive || pn.y0) continue;
          const b = pn.box, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
          for (const s of [1, -1]) {
            const x = cx + (pn.alongX ? 0 : 0.7 * s), z = cz + (pn.alongX ? 0.7 * s : 0);
            if (m.rules.keepIn(pl, x, z)[2] || !m.map.free(x, z, 0.35, 0)) continue;
            const yaw = pn.alongX ? (s > 0 ? 0 : 180) : (s > 0 ? -90 : 90);
            pl.x = x; pl.z = z; pl.y = 0; pl.yaw = yaw;
            return { x, z, yaw, i: pn.i };
          }
        }
        return null;
      });
      if (reinf) {
        await B.evaluate((r) => { const R = window.__range, G = R.modeGame(); G.h.respawn(r.x, r.z, R.now(), 0); G.h.look.setAngles(r.yaw, 0); }, reinf);
        await run(0.5);
        await B.evaluate(() => window.__range.modeGame().key('Interact', true));
        await run(3.2);
        await B.evaluate(() => window.__range.modeGame().key('Interact', false));
        await run(0.4);
        const kinds = await Promise.all([A, B].map((p) => p.evaluate((i) => window.__range.modeGame().m.map.panels[i].kind, reinf.i)));
        check('the player holds Interact at a wall: the host reinforces it and both PCs show it reinforced', kinds[0] === 'reinforced' && kinds[1] === 'reinforced', JSON.stringify(kinds));
      } else check('found a soft wall to reinforce from inside', false, 'none');
      await A.evaluate(() => {
        const game = window.__range.modeGame();
        const remote = game.m.actors.find(actor => actor.remote !== null && actor.remote !== undefined);
        game.m.kill(remote, game.me);
      });
      await run(0.6);
      const spectating = await B.evaluate(() => {
        const game = window.__range.modeGame();
        game.key('Space', true); game.key('Space', false);
        window.__range.step(0.1, 60); window.__range.renderFrame();
        return !game.me.alive && game.spectator?.team === game.me.team
          && game.spectator?.alive && game.camOverride === game.spectatorCam;
      });
      check('Bomb online: an eliminated player follows a living teammate in first person', spectating);
      check('no page errors in either session', nerr.length === 0, nerr.join('\n'));
      await A.evaluate(() => window.__range.modeGame().stop());
    }
    await A.close(); await B.close();
  }

  for (const via of relayUp ? ['lan', 'relay'] : ['lan']) {
    console.log('\nNetwork battle (two browser sessions, ' + (via === 'lan' ? 'join codes' : 'relay game code') + ')');
    const A = await (await browser.newContext()).newPage({ viewport: { width: 960, height: 540 } });
    const B = await (await browser.newContext()).newPage({ viewport: { width: 960, height: 540 } });
    const nerr = [];
    for (const [n, p] of [['host', A], ['player', B]]) p.on('pageerror', (e) => nerr.push(n + ': ' + String(e.stack || e)));
    for (const p of [A, B]) { await p.goto(BASE + 'index.html?test' + (via === 'relay' ? '&relay=' + encodeURIComponent(RELAY) : ''), { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__range); }
    for (const p of [A, B]) { await p.locator('[data-first-profile=mouse]').click(); await p.evaluate(() => document.querySelector('.mode-card[data-mode=net]').click()); }
    let connected = true, join = '';
    if (via === 'relay') {
      for (const p of [A, B]) await p.click('#net-via-relay');
      await B.click('#net-join');
      await B.fill('#relay-in', 'zzzz'); await B.click('#relay-connect');
      let refused = true;
      try { await B.waitForFunction(() => /No game with that code/.test(document.getElementById('net-status').textContent), null, { timeout: 8000 }); } catch (e) { refused = false; }
      check('a wrong game code is refused with a clear message', refused, await B.textContent('#net-status'));
      await A.click('#net-host');
      await A.waitForFunction(() => /^[A-Z2-9]{4}$/.test(document.getElementById('relay-code').textContent), null, { timeout: 8000 });
      join = await A.textContent('#relay-code');
      await B.fill('#relay-in', join.toLowerCase()); await B.click('#relay-connect');
      try {
        await B.waitForFunction(() => /Connected/.test(document.getElementById('net-status').textContent), null, { timeout: 8000 });
        await A.waitForFunction(() => /Player 2/.test(document.getElementById('relay-players').textContent), null, { timeout: 8000 });
      } catch (e) { connected = false; }
      check('the game code ' + join + ' connects two sessions through the relay', connected, await B.textContent('#net-status') + ' / ' + await A.textContent('#relay-players'));
    } else {
    for (const p of [A, B]) await p.click('#net-via-lan');
    await A.click('#net-host');
    await B.click('#net-join');
    await B.waitForFunction(() => document.getElementById('net-out-j').value.startsWith('RR1-'));
    join = await B.inputValue('#net-out-j');
    await A.fill('#net-in-h', join); await A.click('#net-accept');
    await A.waitForFunction(() => document.getElementById('net-out-h').value.startsWith('RR1-'));
    await B.fill('#net-in-j', await A.inputValue('#net-out-h')); await B.click('#net-connect');
    try { await B.waitForFunction(() => /Connected/.test(document.getElementById('net-status').textContent), null, { timeout: 25000 }); } catch (e) { connected = false; }
    check('join codes connect two sessions (code ' + join.length + ' characters)', connected, await B.textContent('#net-status'));
    }
    const lag = via === 'relay' ? 25 : 5;
    if (connected) {
      await A.evaluate(() => { const R = window.__range; R.manual(true); R.battleStart({ opponent: 'net', bots: 1, level: 'easy', kills: 10 }); });
      await B.waitForFunction(() => window.__range.battle() && window.__range.battle().active, null, { timeout: 5000 });
      await B.evaluate(() => window.__range.manual(true));
      const run = async (sec) => { for (let i = 0; i < sec * 20; i++) { await A.evaluate(() => window.__range.step(0.05, 60)); await B.evaluate(() => window.__range.step(0.05, 60)); await new Promise((r) => setTimeout(r, lag)); } };
      await run(1);
      await A.evaluate(() => { const Bt = window.__range.battle(); for (const b of Bt.bots) { b.update = () => {}; b.f.x = -16; b.f.z = -12; } const h = Bt.humans[0]; h.f.x = 16; h.f.z = 12; h.f.protectUntil = 0; });
      await B.evaluate(() => { const h = window.__range.battle().humans[0]; h.f.x = 16; h.f.z = 2; h.f.protectUntil = 0; });
      await run(0.6);
      const seen = {
        host: await A.evaluate(() => { const r = window.__range.battle().remotes[0].f; return [r.x, r.z]; }),
        player: await B.evaluate(() => window.__range.battle().proxies.map((q) => [q.f.name, Math.round(q.f.x), Math.round(q.f.z)])),
      };
      check('positions sync both ways (host sees the player, the player sees the host and the bot)',
        seen.host[0] === 16 && seen.host[1] === 2 && seen.player.some((p) => p[0] === 'Host' && p[1] === 16 && p[2] === 12) && seen.player.length === 2, JSON.stringify(seen));
      const tap = async (P, yaw) => {
        for (let k = 0; k < 8; k++) {
          await P.evaluate((yaw) => { const Bt = window.__range.battle(); Bt.humans[0].look.setAngles(yaw, Math.atan2(1.18 - 1.6, 10) * 180 / Math.PI); Bt.mouseButton(0, true); }, yaw);
          await run(0.05);
          await P.evaluate(() => window.__range.battle().mouseButton(0, false));
          await run(0.5);
        }
      };
      await tap(B, 180);                       // the player shoots the host
      const r1 = await A.evaluate(() => { const Bt = window.__range.battle(); return { hostDeaths: Bt.humans[0].f.deaths, playerKills: Bt.remotes[0].f.kills }; });
      const feed1 = await B.evaluate(() => window.__range.battle().hud.feed.textContent);
      check('the player on the other PC kills the host; the kill feed shows on both', r1.hostDeaths === 1 && r1.playerKills === 1 && /Player 2 › Host/.test(feed1), JSON.stringify(r1) + feed1);
      await run(3.5);
      await A.evaluate(() => { const Bt = window.__range.battle(); const h = Bt.humans[0]; h.f.x = 16; h.f.z = 12; h.f.protectUntil = 0; Bt.remotes[0].f.protectUntil = 0; });
      await B.evaluate(() => { const h = window.__range.battle().humans[0]; h.f.x = 16; h.f.z = 2; h.f.protectUntil = 0; });
      await run(0.3);
      await tap(A, 0);                          // the host shoots back
      const r2 = await B.evaluate(() => { const Bt = window.__range.battle(); return { myDeaths: Bt.fighters.find((f) => f.id === Bt.net.myId).deaths, kc: Bt.lastKillCam }; });
      check('the host kills the player; the player\'s PC shows its own death', r2.myDeaths >= 1, JSON.stringify(r2));
      check('the player\'s PC replays the host shooting them (kill cam with recorded shots)', r2.kc && r2.kc.killer === 'Host' && r2.kc.frames > 20 && r2.kc.shots >= 1, JSON.stringify(r2.kc));
      await A.evaluate(() => {
        const battle = window.__range.battle(), host = battle.humans[0].f, bot = battle.bots[0].f;
        battle.opts.killsToWin = battle.teamScore[host.team] + 1;
        bot.protectUntil = 0;
        battle._damage(bot, 500, host, 'head', battle.t);
      });
      await B.waitForFunction(() => window.__range.battle().hud.end.dataset.finale === 'replay');
      const finale = await B.evaluate(() => {
        const battle = window.__range.battle();
        const killer = battle.kc?.killer.name;
        battle.hud.end.querySelector('.b-finale-replay button').click();
        return { killer, results: battle.hud.end.dataset.finale === 'results',
          rows: battle.hud.endTable.children.length, lineup: battle.finale.lineup.children.length };
      });
      check('network Battle sends the final kill, winning lineup and leaderboard', finale.killer === 'Host' && finale.results && finale.rows === 3 && finale.lineup === 1, JSON.stringify(finale));
      await A.evaluate(() => window.__range.battleLeave());
      await run(0.3);
      const end = await B.evaluate(() => ({ active: window.__range.battle().active, status: document.getElementById('net-status').textContent }));
      check('host ending the match returns the player to the menu, still connected', !end.active && /Still connected/.test(end.status), JSON.stringify(end));
      if (via === 'relay') {
        await A.click('#net-reset');
        let told = true;
        try { await B.waitForFunction(() => /host left/i.test(document.getElementById('net-status').textContent), null, { timeout: 8000 }); } catch (e) { told = false; }
        check('when the host disconnects, the player is told', told, await B.textContent('#net-status'));
      }
    }
    check('no page errors in either session', nerr.length === 0, nerr.join('\n'));
    await A.close(); await B.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? '\n' + failures + ' FAILED' : '\nAll checks passed');
process.exit(failures ? 1 : 0);
