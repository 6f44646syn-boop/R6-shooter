// Crosshair drawn on a small 2D canvas centred over the 3D view.
// The canvas has an even pixel size and sits at exactly 50%/50%, so its centre is the same
// point the camera's centre ray passes through (the middle of the viewport).

export function drawCrosshair(canvas, xh) {
  const pad = 4;
  const half = Math.ceil(xh.size + xh.gap + xh.thickness + pad);
  const size = half * 2; // even, so the centre falls on a pixel boundary like the viewport centre
  if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.style.marginLeft = -half + 'px';
  canvas.style.marginTop = -half + 'px';

  const g = canvas.getContext('2d');
  g.clearRect(0, 0, size, size);
  const c = half, t = xh.thickness, gap = xh.gap, len = xh.size;

  const shapes = []; // rectangles [x, y, w, h]
  const cross = (top) => {
    shapes.push([c + gap, c - t / 2, len, t]);          // right
    shapes.push([c - gap - len, c - t / 2, len, t]);    // left
    shapes.push([c - t / 2, c + gap, t, len]);          // down
    if (top) shapes.push([c - t / 2, c - gap - len, t, len]); // up
  };
  const dot = () => shapes.push([c - t / 2, c - t / 2, t, t]);

  switch (xh.style) {
    case 'dot': dot(); break;
    case 'cross-dot': cross(true); dot(); break;
    case 't': cross(false); break;
    case 'circle': break;
    default: cross(true);
  }

  if (xh.outline) {
    g.fillStyle = 'rgba(0,0,0,0.75)';
    for (const [x, y, w, h] of shapes) g.fillRect(x - 1, y - 1, w + 2, h + 2);
  }
  g.fillStyle = xh.color;
  for (const [x, y, w, h] of shapes) g.fillRect(x, y, w, h);

  if (xh.style === 'circle') {
    const r = Math.max(2, len);
    if (xh.outline) {
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.lineWidth = t + 2;
      g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
    }
    g.strokeStyle = xh.color;
    g.lineWidth = t;
    g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
    g.fillStyle = xh.color;
    g.fillRect(c - 1, c - 1, 2, 2);
  }
}
