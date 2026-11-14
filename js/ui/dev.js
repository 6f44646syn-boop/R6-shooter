// Dev mode: a password-gated console with a recorder. Ctrl+Shift+D or the small "Dev" button opens it.
// shortcut: the password check runs in the browser, so it keeps curious players out, not attackers; there is nothing server-side to protect.
import { SKIN_COUNT } from '../core/skins.js?v=ba75b4c-mwgabqbe';

const PASSWORD = '183535';
const KEEP = 20000;          // timeline entries kept while recording (oldest 4000 dropped when full)
const SLOW_FRAME_MS = 50;

const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...kids); return n; };

// api: { profile, settings, tools {get(), set(name, v), step()}, save(), locked() (true in ranked and online matches), canvas, weapons(), cur(), giveXp(n), env(), state() (plain objects for the report), perf() {gpuMs,w,h,scale,calls,tris,geoms,texs}, gl(), refreshHz(), audio() }
export function mountDev(root, api) {
  let errCount = 0;
  let unlocked = false; try { unlocked = sessionStorage.getItem('recoilRange.dev') === '1'; } catch (e) { /* ignore */ }
  let rec = false, t0 = 0, god = false, ammo = false, snapTimer = 0;
  const log = [];
  let lastSettings = '';

  const add = (kind, msg) => {
    if (!rec) return;
    if (/error|rejection/.test(kind)) { errCount++; badge.textContent = '● REC · ' + errCount + (errCount === 1 ? ' error' : ' errors'); }
    log.push([performance.now() - t0, kind, typeof msg === 'string' ? msg : JSON.stringify(msg)]);
    if (log.length > KEEP) log.splice(0, 4000);
  };

  /* ---------- UI ---------- */
  const out = el('pre', { className: 'dev-out' });
  const input = el('input', { type: 'text', className: 'dev-in', placeholder: 'type "help"', autocomplete: 'off', spellcheck: false });
  const recBtn = el('button', { type: 'button', textContent: 'Record: off' });
  const panel = el('div', { id: 'dev', hidden: true });
  const badge = el('button', { type: 'button', id: 'dev-rec', hidden: true, textContent: '● REC' });
  const openBtn = el('button', { type: 'button', className: 'dev-open', textContent: 'Dev' });
  const pw = el('input', { type: 'password', className: 'dev-in', placeholder: 'Dev password', autocomplete: 'off' });
  const gate = el('form', { className: 'dev-gate' }, pw, el('button', { type: 'submit', textContent: 'Unlock' }));
  const body = el('div', { className: 'dev-body' }, out, input);
  const copyBtn = el('button', { type: 'button', textContent: 'Copy report' });
  const clearBtn = el('button', { type: 'button', textContent: 'Clear' });
  const closeBtn = el('button', { type: 'button', textContent: '×', title: 'Close' });
  // Range tools. Each button's tooltip says what it changes; they only act on the shooting range, never in a match.
  const tog = (text, tip, onclick) => el('button', { type: 'button', className: 'dev-tog', textContent: text, title: tip, onclick });
  const bHit = tog('Hitboxes', 'Outlines the dummy\'s exact hit shapes: red = head, yellow = body, blue = limbs. They are the shapes the game uses to decide a hit.', () => { api.tools.set('hitboxes', !api.tools.get().hitboxes); refreshTools(); });
  const bRay = tog('Bullet lines', 'Draws each shot of the magazine: blue = the real bullet path from your eye, orange = from the gun\'s muzzle to where it landed. Press C to clear them.', () => { api.tools.set('rays', !api.tools.get().rays); refreshTools(); });
  const bSlow = tog('Slow-mo', 'Cycles the range speed: normal, 25%, 10%. Slows targets, firing and recoil so you can watch the spray pattern. Range only.', () => { const s = api.tools.get().scale; try { api.tools.set('scale', s === 1 ? 0.25 : s === 0.25 ? 0.1 : 1); } catch (e) { print('error: ' + e.message); } refreshTools(); });
  const bPause = tog('Pause', 'Freezes the range (targets, shots, recoil, animations) while you change settings. You can still look around. Range only.', () => { const s = api.tools.get().scale; try { api.tools.set('scale', s === 0 ? 1 : 0); } catch (e) { print('error: ' + e.message); } refreshTools(); });
  const bStep = tog('Step', 'While paused, moves the range forward one frame (1/60 s) so you can check a shot-by-shot pattern.', () => api.tools.step());
  const toolsRow = el('div', { className: 'dev-tools' }, bHit, bRay, bSlow, bPause, bStep);
  function refreshTools() {
    const t = api.tools.get();
    bHit.classList.toggle('on', t.hitboxes); bRay.classList.toggle('on', t.rays);
    bSlow.classList.toggle('on', t.scale > 0 && t.scale < 1); bSlow.textContent = 'Slow-mo' + (t.scale > 0 && t.scale < 1 ? ' ' + Math.round(t.scale * 100) + '%' : '');
    bPause.classList.toggle('on', t.scale === 0);
  }
  recBtn.title = 'Records fps, frame times, GPU and memory use, errors and your inputs until you stop it. "Copy report" then gives you all of it.';
  copyBtn.title = 'Copies the whole report (hardware, performance summary, timeline) to the clipboard.';
  clearBtn.title = 'Empties this window and the recording.';
  panel.append(el('div', { className: 'dev-head' }, el('b', { textContent: 'DEV' }), recBtn, copyBtn, clearBtn, closeBtn), toolsRow, gate, body);
  root.append(openBtn); document.body.append(panel, badge);

  const print = (s) => { out.textContent += s + '\n'; out.scrollTop = out.scrollHeight; };
  // Hidden mode: the Dev button and tools stay hidden until unlocked; F2 or Ctrl+Shift+D opens the password box.
  const sync = () => { gate.hidden = unlocked; body.hidden = !unlocked; recBtn.hidden = copyBtn.hidden = clearBtn.hidden = toolsRow.hidden = openBtn.hidden = !unlocked; recBtn.textContent = 'Record: ' + (rec ? 'ON' : 'off'); badge.hidden = !rec; };
  function open(v = panel.hidden) {
    panel.hidden = !v;
    if (v) { try { document.exitPointerLock(); } catch (e) { /* ignore */ } sync(); if (unlocked) refreshTools(); (unlocked ? input : pw).focus(); }
  }
  gate.addEventListener('submit', (e) => {
    e.preventDefault();
    if (pw.value === PASSWORD) { unlocked = true; try { sessionStorage.setItem('recoilRange.dev', '1'); } catch (x) { /* ignore */ } if (!out.textContent) print('Dev mode unlocked. Type "help".'); sync(); input.focus(); }
    else { pw.value = ''; pw.placeholder = 'Wrong password'; }
  });
  openBtn.onclick = () => open(true);
  badge.onclick = () => open(true);
  closeBtn.onclick = () => open(false);
  panel.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') open(false); });
  window.addEventListener('keydown', (e) => { if (e.code === 'F2' || (e.ctrlKey && e.shiftKey && e.code === 'KeyD')) { e.preventDefault(); open(); } }, true);

  /* ---------- recorder ---------- */
  // Everything here measures the real machine (GPU, heap, long tasks, power, input rate), which only the player's own browser can.
  const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
  let sec = [], secCpu = 0, secCpuMax = 0, secUpd = 0, secSlow = 0, mouseMoves = 0, longN = 0, longMs = 0;
  let allMs = [], slow = [], byWhere = {}, where = 'range', heap0 = 0, heapLast = 0, gcs = 0, scaleLast = 0, batt = null, lastVis = '';
  try { navigator.getBattery?.().then((b) => { batt = b; }); } catch (e) { /* ignore */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { longN++; longMs += e.duration; if (rec && e.duration > 100) add('long-task', Math.round(e.duration) + ' ms'); } }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* unsupported (Firefox, Safari) */ }
  const mb = (n) => Math.round(n / 1048576);
  function snap() {
    sec.sort((x, y) => x - y);
    const st = api.state(), P = api.perf(), A = api.audio(), H = performance.memory;
    where = st.where || where;
    const s = {
      fps: sec.length, p50: +pct(sec, 0.5).toFixed(1), p95: +pct(sec, 0.95).toFixed(1), p99: +pct(sec, 0.99).toFixed(1), max: Math.round(sec[sec.length - 1] || 0),
      cpuAvg: sec.length ? +(secCpu / sec.length).toFixed(2) : 0, cpuMax: +secCpuMax.toFixed(1), updAvg: sec.length ? +(secUpd / sec.length).toFixed(2) : 0, gpu: P.gpuMs >= 0 ? +P.gpuMs.toFixed(2) : undefined,
      slow: secSlow, longTasks: longN, longMs: Math.round(longMs), heapMB: H ? mb(H.usedJSHeapSize) : undefined, mouseHz: mouseMoves,
      res: P.w + 'x' + P.h, scale: +Number(P.scale).toFixed(2), calls: P.calls, tris: P.tris, geoms: P.geoms, texs: P.texs,
      audio: A ? A.state + ' lat ' + (A.out || A.base || 0).toFixed(3) : undefined, pads: (navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean).length : 0),
      bat: batt ? Math.round(batt.level * 100) + (batt.charging ? '% charging' : '%') : undefined, ...st,
    };
    if (H) { if (!heap0) heap0 = H.usedJSHeapSize; if (heapLast - H.usedJSHeapSize > 5 * 1048576) gcs++; heapLast = H.usedJSHeapSize; }
    if (scaleLast && s.scale !== scaleLast) add('render-scale', scaleLast + ' -> ' + s.scale + ' (' + s.res + ')');
    scaleLast = s.scale;
    sec = []; secCpu = secCpuMax = secUpd = secSlow = mouseMoves = 0; longN = 0; longMs = 0;
    add('snap', s);
    const cfg = JSON.stringify(api.settings);
    if (lastSettings && cfg !== lastSettings) {
      const a = JSON.parse(lastSettings), b = JSON.parse(cfg), d = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) d[k] = b[k];
      add('settings', d);
    }
    lastSettings = cfg;
  }
  function setRec(on) {
    if (on === rec) return;
    rec = on; clearInterval(snapTimer);
    if (on) {
      t0 = performance.now(); errCount = 0; badge.textContent = '● REC'; log.length = 0; sec = []; allMs = []; slow = []; byWhere = {}; secCpu = secCpuMax = secUpd = secSlow = mouseMoves = 0; longN = 0; longMs = 0; heap0 = heapLast = gcs = scaleLast = 0;
      lastSettings = JSON.stringify(api.settings); snapTimer = setInterval(snap, 1000); add('rec', 'started');
    }
    sync();
  }
  recBtn.onclick = () => setRec(!rec);

  for (const k of ['error', 'warn']) {
    const orig = console[k];
    console[k] = (...a) => { add('console.' + k, a.map((x) => (x && x.stack) || (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')); orig.apply(console, a); };
  }
  window.addEventListener('error', (e) => add('error', e.message + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', (e) => add('rejection', String((e.reason && e.reason.stack) || e.reason)));
  // Input: key codes and mouse buttons only (never what is typed into a text field).
  const typing = (e) => e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
  window.addEventListener('keydown', (e) => { if (rec && !e.repeat && !typing(e)) add('key', e.code + ' down'); }, true);
  window.addEventListener('keyup', (e) => { if (rec && !typing(e)) add('key', e.code + ' up'); }, true);
  window.addEventListener('mousedown', (e) => add('mouse', 'button ' + e.button + ' down'), true);
  window.addEventListener('mouseup', (e) => add('mouse', 'button ' + e.button + ' up'), true);
  window.addEventListener('mousemove', () => { if (rec) mouseMoves++; }, true);   // events per second = the mouse's real polling rate reaching the page
  document.addEventListener('visibilitychange', () => add('tab', document.visibilityState));
  window.addEventListener('resize', () => add('resize', innerWidth + 'x' + innerHeight + ' @' + devicePixelRatio + 'x'));
  document.addEventListener('fullscreenchange', () => add('fullscreen', String(!!document.fullscreenElement)));
  document.addEventListener('pointerlockchange', () => add('pointer-lock', String(!!document.pointerLockElement)));
  window.addEventListener('gamepadconnected', (e) => add('gamepad', 'connected ' + e.gamepad.id));
  window.addEventListener('gamepaddisconnected', (e) => add('gamepad', 'disconnected ' + e.gamepad.id));
  api.canvas.addEventListener('webglcontextlost', () => add('webgl', 'CONTEXT LOST'));
  api.canvas.addEventListener('webglcontextrestored', () => add('webgl', 'context restored'));

  /* ---------- report ---------- */
  const fmt = (ms) => { const s = ms / 1000; return String(Math.floor(s / 60)).padStart(2, '0') + ':' + (s % 60).toFixed(3).padStart(6, '0'); };
  function hardware() {
    const gl = api.gl(), x = gl.getExtension('WEBGL_debug_renderer_info'), c = navigator.connection, H = performance.memory;
    return {
      gpu: x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'hidden by the browser', gpuVendor: x ? gl.getParameter(x.UNMASKED_VENDOR_WEBGL) : undefined,
      webgl: gl.getParameter(gl.VERSION), maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), cores: navigator.hardwareConcurrency, ramGB: navigator.deviceMemory,
      refreshHz: api.refreshHz(), gpuTimer: api.perf().gpuMs >= 0, heapLimitMB: H ? mb(H.jsHeapSizeLimit) : undefined,
      network: c ? { type: c.effectiveType, downlinkMbps: c.downlink, rttMs: c.rtt } : undefined, touch: navigator.maxTouchPoints, colorDepth: screen.colorDepth,
    };
  }
  function summary() {
    const s = allMs.slice().sort((x, y) => x - y), n = s.length, avg = n ? s.reduce((x, y) => x + y, 0) / n : 0;
    const low1 = s.slice(Math.floor(n * 0.99)), low1avg = low1.length ? low1.reduce((x, y) => x + y, 0) / low1.length : 0;
    const L = ['--- performance summary ---', 'frames: ' + n + ', average ' + (avg ? (1000 / avg).toFixed(1) : 0) + ' fps (' + avg.toFixed(2) + ' ms)',
      'frame ms: p50 ' + pct(s, 0.5).toFixed(1) + ', p95 ' + pct(s, 0.95).toFixed(1) + ', p99 ' + pct(s, 0.99).toFixed(1) + ', worst ' + (s[n - 1] || 0).toFixed(0) + ' | 1% low ' + (low1avg ? (1000 / low1avg).toFixed(1) : 0) + ' fps',
      'hitches over ' + SLOW_FRAME_MS + ' ms: ' + slow.length, 'heap: ' + (heap0 ? mb(heap0) + ' -> ' + mb(heapLast) + ' MB, ' + gcs + ' garbage collections seen' : 'not available in this browser')];
    for (const [w, v] of Object.entries(byWhere)) L.push('  ' + w.padEnd(12) + v.n + ' frames, ' + (1000 * v.n / v.sum).toFixed(1) + ' fps avg, ' + v.slow + ' hitches');
    L.push('worst frames (time, ms, cpu, update, where, draw calls):');
    for (const w of slow.slice().sort((x, y) => y.ms - x.ms).slice(0, 10)) L.push('  ' + fmt(w.t) + '  ' + Math.round(w.ms) + ' ms  cpu ' + w.cpu.toFixed(1) + '  upd ' + w.upd.toFixed(1) + '  ' + w.where + '  ' + w.calls + ' calls');
    return L;
  }
  function report() {
    const P = api.profile, lines = [
      'RECOIL RANGE DEV REPORT',
      'made: ' + new Date().toString(),
      'recorded: ' + (log.length ? fmt(log[log.length - 1][0]) : '00:00.000') + ' (' + log.length + ' entries' + (rec ? ', still recording' : '') + ')',
      'agent: ' + navigator.userAgent,
      'screen: ' + screen.width + 'x' + screen.height + ' @' + devicePixelRatio + 'x, window ' + innerWidth + 'x' + innerHeight,
      'hardware: ' + JSON.stringify(hardware()),
      'env: ' + JSON.stringify(api.env()),
      'profile: ' + JSON.stringify({ points: P.points, owned: P.ownedCount, kills: P.kills, packs: P.packs, charms: P.charms, rating: P.rating }),
      'settings: ' + JSON.stringify(api.settings),
      'cheats: ' + JSON.stringify({ god, infiniteAmmo: ammo }),
      '', ...summary(),
      '', '--- timeline (mm:ss.mmm  kind  detail) ---',
    ];
    for (const [t, k, m] of log) lines.push(fmt(t) + '  ' + k.padEnd(14) + m);
    const errs = log.filter((e) => /error|rejection|warn|long-task|webgl/.test(e[1]));
    lines.push('', '--- errors, warnings and long tasks: ' + errs.length + ' ---');
    for (const [t, k, m] of errs) lines.push(fmt(t) + '  ' + k + '  ' + m);
    return lines.join('\n');
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    const ta = el('textarea', { value: text }); document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ } ta.remove(); return ok;
  }
  copyBtn.onclick = async () => { const ok = await copy(report()); print(ok ? 'Report copied (' + log.length + ' entries).' : 'Copy was blocked: type "report" and copy the text above.'); };
  clearBtn.onclick = () => { log.length = 0; out.textContent = ''; };

  /* ---------- commands ---------- */
  const num = (s) => { const n = Math.floor(Number(s)); if (!Number.isFinite(n) || n < 0) throw new Error('need a whole number, 0 or more'); return n; };
  const toggle = (cur, s) => (s === 'on' ? true : s === 'off' ? false : !cur);
  // Called every frame: infinite ammo refills the range gun and your gun in battles and matches. God mode is applied where damage is dealt (see godMode in main.js).
  function cheatTick() {
    if (api.locked()) { god = ammo = false; return; }
    if (ammo) for (const w of api.weapons()) if (!w.reloading) w.ammo = w.capacity;
  }
  const COMMANDS = {
    help: ['list the commands', () => Object.entries(COMMANDS).map(([k, v]) => k.padEnd(14) + v[0]).join('\n')],
    coins: ['coins N  add N points', (n) => { api.profile.addPoints(num(n)); return 'points: ' + api.profile.points; }, true],
    charms: ['charms N  add N charm drops', (n) => { api.profile.charms += num(n); api.profile._changed(); return 'charms: ' + api.profile.charms; }, true],
    xp: ['xp N  add N season XP', (n) => { api.giveXp(num(n)); return 'added ' + num(n) + ' XP'; }, true],
    skins: ['skins all  own every skin', (a) => { if (a !== 'all') throw new Error('usage: skins all'); for (let i = 0; i < SKIN_COUNT; i++) api.profile._own(i); api.profile._changed(); return 'owned: ' + api.profile.ownedCount; }, true],
    god: ['god [on|off]  no damage to you in battles and matches', (s) => { god = toggle(god, s); return 'god ' + (god ? 'on' : 'off'); }, true],
    ammo: ['ammo [on|off]  infinite ammo on the range, in battles and in matches', (s) => { ammo = toggle(ammo, s); return 'infinite ammo ' + (ammo ? 'on' : 'off'); }, true],
    rec: ['rec on|off|clear  recorder', (s) => { if (s === 'clear') { log.length = 0; return 'cleared'; } setRec(toggle(rec, s)); return 'record ' + (rec ? 'on' : 'off'); }],
    report: ['report  print the report here', () => report()],
    copy: ['copy  copy the report', async () => ((await copy(report())) ? 'copied' : 'copy blocked')],
    clear: ['clear  empty this window', () => { out.textContent = ''; return ''; }],
    set: ['set KEY VALUE  save a setting (JSON value), then reload the page', (k, ...v) => {
      if (!(k in api.settings)) throw new Error('no setting called ' + k);
      api.settings[k] = JSON.parse(v.join(' ')); api.save(); return k + ' = ' + JSON.stringify(api.settings[k]) + ' (saved, reload the page to apply)';
    }, true],
    hitbox: ['hitbox [on|off]  outline the dummy\'s hit shapes', (v) => { api.tools.set('hitboxes', toggle(api.tools.get().hitboxes, v)); refreshTools(); return 'hitboxes ' + (api.tools.get().hitboxes ? 'on' : 'off'); }],
    rays: ['rays [on|off]  draw each shot\'s path (eye and muzzle)', (v) => { api.tools.set('rays', toggle(api.tools.get().rays, v)); refreshTools(); return 'bullet lines ' + (api.tools.get().rays ? 'on' : 'off'); }],
    slow: ['slow [N|off]  range speed, e.g. slow 0.25 (0.05 to 1)', (v) => { const n = v === undefined ? 0.25 : v === 'off' ? 1 : Number(v); if (!(n >= 0.05 && n <= 1)) throw new Error('use a speed from 0.05 to 1, or off'); api.tools.set('scale', n); refreshTools(); return 'range speed ' + Math.round(n * 100) + '%'; }],
    pause: ['pause [on|off]  freeze the range', (v) => { api.tools.set('scale', toggle(api.tools.get().scale === 0, v) ? 0 : 1); refreshTools(); return api.tools.get().scale === 0 ? 'paused' : 'running'; }],
    step: ['step  one frame forward while paused', () => { api.tools.step(); return ''; }],
    stats: ['stats  live numbers right now (fps, GPU, memory, draw calls, state)', () => JSON.stringify({ ...api.state(), ...api.perf(), heapMB: performance.memory ? mb(performance.memory.usedJSHeapSize) : undefined, hw: hardware() }, null, 1)],
    bench: ['bench [seconds]  record while you play for N seconds (default 30, max 300), then print the summary', async (n = '30') => {
      if (rec) throw new Error('already recording: stop it first (rec off) or use report');
      const secs = Math.min(300, Math.max(5, num(n))); setRec(true); print('benchmarking for ' + secs + ' s: play normally, the result appears here');
      await new Promise((r) => setTimeout(r, secs * 1000)); setRec(false); return summary().join('\n');
    }],
    autorec: ['autorec on|off  start recording on its own whenever dev mode is unlocked in a tab', (s) => { let on = toggle(sessionStorage.getItem('recoilRange.devAuto') === '1', s); sessionStorage.setItem('recoilRange.devAuto', on ? '1' : '0'); if (on) setRec(true); return 'autorec ' + (on ? 'on' : 'off'); }],
    save: ['save  download the report as a text file', () => {
      const a = el('a', { href: URL.createObjectURL(new Blob([report()], { type: 'text/plain' })), download: 'recoil-range-report-' + Date.now() + '.txt' });
      document.body.append(a); a.click(); a.remove(); return 'saved (check your downloads)';
    }],
    js: ['js CODE  run JavaScript (dev.profile, dev.settings, dev.weapons, dev.game)', (...a) => {
      const dev = { profile: api.profile, settings: api.settings, weapons: api.weapons(), game: api.cur() };
      const r = new Function('dev', 'return (' + a.join(' ') + ')')(dev);
      return typeof r === 'object' ? JSON.stringify(r) : String(r);
    }, true],
  };
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const line = input.value.trim(); input.value = '';
    print('> ' + line); add('command', line);
    const [name, ...args] = line.split(/\s+/), c = COMMANDS[name.toLowerCase()];
    if (!c) { print('unknown command, type "help"'); return; }
    if (c[2] && api.locked()) { print('blocked: ranked and online matches are fair-play locked, so cheat commands are off until the match ends'); return; }
    try { const r = await c[1](...args); if (r) print(r); } catch (err) { print('error: ' + err.message); }
  });
  sync();
  try { if (unlocked && sessionStorage.getItem('recoilRange.devAuto') === '1') setRec(true); } catch (e) { /* ignore */ }

  return {
    note: (kind, msg) => add(kind, msg),
    god: () => god && !api.locked(),
    frame(ms, cpu = 0, upd = 0) {
      if (ammo) cheatTick();
      if (!rec) return;
      sec.push(ms); secCpu += cpu; secUpd += upd; if (cpu > secCpuMax) secCpuMax = cpu;
      if (allMs.length < 200000) allMs.push(ms);
      const w = byWhere[where] || (byWhere[where] = { n: 0, sum: 0, slow: 0 }); w.n++; w.sum += ms;
      if (ms > SLOW_FRAME_MS) {
        w.slow++; secSlow++;
        const P = api.perf(), t = performance.now() - t0;
        if (slow.length < 500) slow.push({ t, ms, cpu, upd, where, calls: P.calls });
        add('slow-frame', Math.round(ms) + ' ms (cpu ' + cpu.toFixed(1) + ', update ' + upd.toFixed(1) + ', gpu ' + (P.gpuMs >= 0 ? P.gpuMs.toFixed(1) : '?') + ', ' + where + ', ' + P.calls + ' calls)');
      }
    },
  };
}
