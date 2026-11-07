// The Legendary skin: a photo you choose, on any gun. The photo is kept only in this browser
// (localStorage), never in the game's files or save codes, and never sent to other players;
// they see a gold Legendary finish on your gun instead.
const KEY = 'recoilRange.legendPhoto.v1';
const SIZE = 512;
let canvas = null, url = null;
const listeners = new Set();

export function onLegendChange(fn) { listeners.add(fn); }
function changed() { for (const fn of listeners) fn(); }

// The photo as a data URL (for thumbnails), or null.
export function legendPhotoURL() {
  if (url === null) { try { url = localStorage.getItem(KEY) || ''; } catch (e) { url = ''; } }
  return url || null;
}
// A square canvas with the photo (or a gold placeholder): the skin texture draws from it.
export function legendCanvas() {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    drawPlaceholder();
    const u = legendPhotoURL();
    if (u) drawURL(u);
  }
  return canvas;
}
function drawPlaceholder() {
  const g = canvas.getContext('2d'), gr = g.createLinearGradient(0, 0, SIZE, SIZE);
  gr.addColorStop(0, '#5a3a08'); gr.addColorStop(0.5, '#ffd36a'); gr.addColorStop(1, '#7a4a0a');
  g.fillStyle = gr; g.fillRect(0, 0, SIZE, SIZE);
  g.fillStyle = 'rgba(40,24,4,0.7)'; g.font = 'bold 120px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('★', SIZE / 2, SIZE / 2);
}
function drawURL(u) {
  const img = new Image();
  img.onload = () => { canvas.getContext('2d').drawImage(img, 0, 0, SIZE, SIZE); changed(); };
  img.src = u;
}
// Use an image file: cropped to a square (centred, a little above the middle where faces
// usually are), scaled to 512 x 512, stored in this browser.
export function setLegendPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('Choose an image file.')); return; }
    const img = new Image(), src = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height), sx = (img.width - s) / 2, sy = Math.max(0, Math.min(img.height - s, (img.height - s) * 0.3));
      const c = document.createElement('canvas'); c.width = c.height = SIZE;
      c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
      URL.revokeObjectURL(src);
      const data = c.toDataURL('image/jpeg', 0.85);
      try { localStorage.setItem(KEY, data); } catch (e) { reject(new Error('The browser would not store the photo (storage full or blocked).')); return; }
      url = data;
      legendCanvas().getContext('2d').drawImage(c, 0, 0);
      changed();
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('That image could not be read.')); };
    img.src = src;
  });
}
export function clearLegendPhoto() {
  try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
  url = '';
  if (canvas) drawPlaceholder();
  changed();
}
