// The paper target: a simple silhouette with bullseye rings on centre mass.
// One shape definition is used both to draw the texture and to decide hits, so what you
// see is exactly what counts. Units: metres, origin = bullseye centre (the aim point),
// +x right, +y up.

export const TARGET = {
  board: { x0: -0.35, x1: 0.35, y0: -0.70, y1: 0.50 },  // paper sheet
  head: { cx: 0, cy: 0.33, r: 0.11 },
  neck: { x0: -0.06, x1: 0.06, y0: 0.14, y1: 0.26 },
  torso: { x0: -0.24, x1: 0.24, y0: -0.62, y1: 0.18, r: 0.08 },  // rounded rectangle
  rings: [0.20, 0.15, 0.10, 0.05, 0.02],                          // bullseye radii
};

function inRoundRect(x, y, b) {
  if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return false;
  const r = b.r || 0;
  // Distance into the corner squares; outside the quarter circle = outside the shape.
  const cx = x < b.x0 + r ? b.x0 + r : (x > b.x1 - r ? b.x1 - r : x);
  const cy = y < b.y0 + r ? b.y0 + r : (y > b.y1 - r ? b.y1 - r : y);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// True if (x, y) in target coordinates is on the silhouette.
export function hitsSilhouette(x, y) {
  const h = TARGET.head;
  const dx = x - h.cx, dy = y - h.cy;
  if (dx * dx + dy * dy <= h.r * h.r) return true;
  return inRoundRect(x, y, TARGET.neck) || inRoundRect(x, y, TARGET.torso);
}

// Draw the target onto a canvas for use as a texture. Returns the canvas.
export function drawTargetCanvas(pxPerMetre = 800) {
  const b = TARGET.board;
  const W = Math.round((b.x1 - b.x0) * pxPerMetre);
  const H = Math.round((b.y1 - b.y0) * pxPerMetre);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const X = (x) => (x - b.x0) * pxPerMetre;
  const Y = (y) => (b.y1 - y) * pxPerMetre;
  const S = (m) => m * pxPerMetre;

  g.fillStyle = '#e9e2cf';           // buff paper
  g.fillRect(0, 0, W, H);

  // Silhouette
  g.fillStyle = '#2f4a6b';
  const t = TARGET.torso;
  g.beginPath();
  g.roundRect(X(t.x0), Y(t.y1), S(t.x1 - t.x0), S(t.y1 - t.y0), S(t.r));
  g.fill();
  const n = TARGET.neck;
  g.fillRect(X(n.x0), Y(n.y1), S(n.x1 - n.x0), S(n.y1 - n.y0));
  const h = TARGET.head;
  g.beginPath(); g.arc(X(h.cx), Y(h.cy), S(h.r), 0, Math.PI * 2); g.fill();

  // Bullseye rings
  g.lineWidth = Math.max(2, S(0.004));
  TARGET.rings.forEach((r, i) => {
    g.beginPath();
    g.arc(X(0), Y(0), S(r), 0, Math.PI * 2);
    g.fillStyle = i % 2 === 0 ? '#e9e2cf' : '#2f4a6b';
    g.fill();
    g.strokeStyle = '#121a24';
    g.stroke();
  });
  g.fillStyle = '#c4362b';
  g.beginPath(); g.arc(X(0), Y(0), S(TARGET.rings[TARGET.rings.length - 1]), 0, Math.PI * 2); g.fill();

  // Head ring and scoring numbers
  g.strokeStyle = '#e9e2cf';
  g.beginPath(); g.arc(X(h.cx), Y(h.cy), S(0.05), 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#121a24';
  g.font = 'bold ' + Math.round(S(0.025)) + 'px sans-serif';
  g.textAlign = 'center';
  const labels = ['6', '7', '8', '9'];
  for (let i = 0; i < 4; i++) {
    const r0 = TARGET.rings[i], r1 = TARGET.rings[i + 1];
    g.fillStyle = i % 2 === 0 ? '#2f4a6b' : '#e9e2cf';
    g.fillText(labels[i], X(0), Y((r0 + r1) / 2) + S(0.009));
  }
  // Grid ticks every 10 cm along the edges, useful when reading a spray.
  g.fillStyle = '#7b7564';
  for (let x = Math.ceil(b.x0 * 10) / 10; x <= b.x1 + 1e-9; x += 0.1) {
    g.fillRect(X(x) - 1, 0, 2, S(0.02));
    g.fillRect(X(x) - 1, H - S(0.02), 2, S(0.02));
  }
  for (let y = Math.ceil(b.y0 * 10) / 10; y <= b.y1 + 1e-9; y += 0.1) {
    g.fillRect(0, Y(y) - 1, S(0.02), 2);
    g.fillRect(W - S(0.02), Y(y) - 1, S(0.02), 2);
  }
  g.strokeStyle = '#7b7564';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, W - 3, H - 3);
  return cv;
}
