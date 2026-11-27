// Film mode (?film in the URL): F9 records 20 s of the game's canvas into the two CrazyGames
// preview videos, landscape 1920x1080 and portrait 1080x1620 (2:3, the middle of the frame),
// each opening on its cover (the title on the Forgeheart art). No sound, no cursor, no HUD
// (the HUD is HTML). The files download as preview-landscape.mp4 and preview-portrait.mp4.
const SECS = 20, COVER_SECS = 0.8;
const FONT = (n) => `900 ${n}px "Segoe UI Black","Segoe UI",system-ui,sans-serif`;

async function coverMaker() {
  const img = new Image(); img.src = new URL('../../docs/legendary-skins/04-forgeheart.png', import.meta.url).href; await img.decode();
  const s = document.createElement('canvas'); s.width = img.width; s.height = img.height;
  const sx = s.getContext('2d', { willReadFrequently: true }); sx.drawImage(img, 0, 0);
  const px = (x, y) => { const d = sx.getImageData(x, y, 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; };
  return (w, h, o) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, px(768, 6)); g.addColorStop(0.5, px(60, 512)); g.addColorStop(1, px(768, 1018));
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const pw = Math.round(img.width * o.scale), ph = Math.round(img.height * o.scale);
    const t = document.createElement('canvas'); t.width = pw; t.height = ph; const tx = t.getContext('2d'); tx.drawImage(img, 0, 0, pw, ph);
    if (o.featherY) {   // fade the art's top and bottom into the background
      tx.globalCompositeOperation = 'destination-in';
      const gv = tx.createLinearGradient(0, 0, 0, ph); gv.addColorStop(0, 'rgba(0,0,0,0)'); gv.addColorStop(o.featherY, '#000'); gv.addColorStop(1 - o.featherY, '#000'); gv.addColorStop(1, 'rgba(0,0,0,0)');
      tx.fillStyle = gv; tx.fillRect(0, 0, pw, ph);
    }
    x.drawImage(t, Math.round((w - pw) / 2), Math.round(o.y));
    x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = o.size * 0.25; x.shadowOffsetY = o.size * 0.04;
    x.font = FONT(o.size); x.letterSpacing = (-0.02 * o.size) + 'px';
    if (o.lines === 1) {
      const wa = x.measureText('RECOIL ').width, x0 = (w - wa - x.measureText('RANGE').width) / 2;
      x.fillStyle = '#f3efe3'; x.fillText('RECOIL ', x0, o.ty); x.fillStyle = '#e2524a'; x.fillText('RANGE', x0 + wa, o.ty);
    } else {
      x.textAlign = 'center'; x.fillStyle = '#f3efe3'; x.fillText('RECOIL', w / 2, o.ty); x.fillStyle = '#e2524a'; x.fillText('RANGE', w / 2, o.ty + o.size * 0.9);
    }
    return c;
  };
}

function save(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
}

let busy = false;
const badge = Object.assign(document.createElement('div'), { textContent: 'Film mode: press F9 to record 20 s' });
badge.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,.7);color:#fff;font:600 13px system-ui;pointer-events:none';
document.body.append(badge);

async function film() {
  if (busy) return; busy = true;
  try {
    const cover = await coverMaker();
    const game = document.getElementById('view');
    const vid = document.createElement('video'); vid.muted = true; vid.srcObject = game.captureStream(60); await vid.play();
    const outs = [
      { w: 1920, h: 1080, name: 'preview-landscape.mp4', cover: cover(1920, 1080, { scale: 1.25, y: -70, lines: 1, size: 150, ty: 200 }) },
      { w: 1080, h: 1620, name: 'preview-portrait.mp4', cover: cover(1080, 1620, { scale: 0.71, y: 972 - 0.71 * 492, featherY: 0.2, lines: 2, size: 200, ty: 405 }) },
    ];
    const type = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.640028') ? 'video/mp4;codecs=avc1.640028' : 'video/webm';
    for (const o of outs) {
      o.c = Object.assign(document.createElement('canvas'), { width: o.w, height: o.h }); o.x = o.c.getContext('2d');
      o.rec = new MediaRecorder(o.c.captureStream(30), { mimeType: type, videoBitsPerSecond: 12e6 });
      o.chunks = []; o.rec.ondataavailable = (e) => e.data.size && o.chunks.push(e.data);
    }
    const t0 = performance.now(); let raf = 0;
    const draw = () => {
      const t = (performance.now() - t0) / 1000, vw = vid.videoWidth, vh = vid.videoHeight;
      for (const o of outs) {
        if (t < COVER_SECS || !vw) { o.x.drawImage(o.cover, 0, 0); continue; }
        const s = Math.max(o.w / vw, o.h / vh), cw = o.w / s, ch = o.h / s;   // fill the frame, cropping the middle
        o.x.drawImage(vid, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, o.w, o.h);
      }
      badge.textContent = 'Recording ' + Math.max(0, Math.ceil(SECS - t)) + ' s';
      raf = requestAnimationFrame(draw);
    };
    draw(); for (const o of outs) o.rec.start(500);
    await new Promise((r) => setTimeout(r, SECS * 1000));
    await Promise.all(outs.map((o) => new Promise((r) => { o.rec.onstop = r; o.rec.stop(); })));
    cancelAnimationFrame(raf); vid.srcObject.getTracks().forEach((tr) => tr.stop());
    for (const o of outs) save(new Blob(o.chunks, { type: o.rec.mimeType }), type.startsWith('video/webm') ? o.name.replace('.mp4', '.webm') : o.name);
    badge.textContent = 'Saved 2 videos. F9 records again';
  } catch (e) {
    badge.textContent = 'Film mode error: ' + e.message;
  } finally { busy = false; }
}
addEventListener('keydown', (e) => { if (e.code === 'F9') { e.preventDefault(); film(); } }, true);
