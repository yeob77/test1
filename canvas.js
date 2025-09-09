import { state, el, showToast } from './ui.js';
import { createViewport } from './viewportFix.js';

let drawing = false;
let panning = false;
let lastX = 0;
let lastY = 0;

let pctx;
let bctx;
export let vp; // Declare and export viewport instance

export function initCanvas() {
  pctx = el.paint.getContext('2d', { willReadFrequently: true });
  bctx = el.base.getContext('2d', { willReadFrequently: true });
  vp = createViewport(el.paint, pctx, { initialScale: 1 }); // Initialize viewport for paint canvas
  // We might need another viewport for base canvas if it also needs panning/zooming independently
  // For now, let's assume base canvas is drawn relative to paint canvas's viewport
}



export function redrawPaintCanvas() {
  pctx.save();
  pctx.setTransform(1, 0, 0, 1, 0, 0); // Always reset to identity matrix before drawing
  pctx.clearRect(0, 0, el.paint.width, el.paint.height);
  vp.applyTransform(); // Apply viewport transform

  const lastSnapshot = state.undo[state.undo.length - 1];
  if (lastSnapshot) {
    pctx.putImageData(lastSnapshot, 0, 0);
  }
  pctx.restore();
}

export function render() {
  redrawBaseCanvas();
  redrawPaintCanvas();
}

export function redrawBaseCanvas() {
  bctx.save();
  bctx.setTransform(1, 0, 0, 1, 0, 0); // Always reset to identity matrix before drawing
  bctx.clearRect(0, 0, el.base.width, el.base.height);
  bctx.fillStyle = '#fff';
  bctx.fillRect(0, 0, el.base.width, el.base.height);
  vp.applyTransform(); // Apply viewport transform

  if (state.currentBaseImage) {
    const img = state.currentBaseImage;
    const W = el.base.width;
    const H = el.base.height;
    const s = Math.min(W / img.width, H / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    bctx.drawImage(img, dx, dy, dw, dh);
  } else {
    drawBaseContent(); // Call drawBaseContent here
  }
  bctx.restore(); // Restore transform after drawing base content
}

export function resizeCanvases() {
  vp.resizeToCss(); // Let viewportFix handle canvas resizing and initial transform
  
  // Reset undo/redo history on resize
  state.undo = [];
  state.redo = [];

  redrawBaseCanvas(); // Redraw base content after resize
  redrawPaintCanvas(); // Redraw paint content after resize
  snapshot(); // Take a new snapshot after resize
}



export function importTemplate(img, clearPaint) {
  state.currentBaseImage = img;
  state.template = 'custom';
  
  if (clearPaint) {
    pctx.clearRect(0, 0, el.paint.width, el.paint.height);
    snapshot();
  }
  render(); // Call render to redraw both canvases
}

function snapshot() {
  try {
    const W = el.paint.width, H = el.paint.height;
    // Prevent IndexSizeError if canvas dimensions are zero
    if (W === 0 || H === 0) {
      console.warn("Snapshot skipped: Canvas has zero width or height.");
      return;
    }
    vp.resetTransform(); // Reset transform before getting image data
    const img = pctx.getImageData(0, 0, W, H);
    vp.applyTransform(); // Re-apply transform after getting image data
    state.undo.push(img);
    if (state.undo.length > state.maxUndo) {
      state.undo.shift();
    }
    state.redo = [];
  } catch (e) {
    console.error("Snapshot failed:", e);
  }
}

export function undo() {
  if (state.undo.length <= 1) return;
  const lastState = state.undo.pop();
  state.redo.push(lastState);
  render(); // Call render to redraw both canvases
  showToast('되돌리기', 'info');
}

export function redo() {
  if (!state.redo.length) return;
  const nextState = state.redo.pop();
  state.undo.push(nextState);
  render(); // Call render to redraw both canvases
  showToast('다시하기', 'info');
}



export function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

export function getTouchCenter(touches, r) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2 - r.left,
    y: (touches[0].clientY + touches[1].clientY) / 2 - r.top,
  };
}

let _patternCache = null;
let _patternKey = '';

function makePatternTile(kind, color, base = 48) {
  const s = base;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const g = c.getContext('2d');
  g.clearRect(0, 0, s, s);
  g.fillStyle = color; g.strokeStyle = color;
  g.lineWidth = 3;

  function star(cx, cy, R, r, sp) {
    let rot = Math.PI / 2 * 3;
    g.beginPath(); g.moveTo(cx, cy - R);
    for (let i = 0; i < sp; i++) {
      let x = cx + Math.cos(rot) * R; let y = cy + Math.sin(rot) * R;
      g.lineTo(x, y); rot += Math.PI / sp;
      x = cx + Math.cos(rot) * r; y = cy + Math.sin(rot) * r;
      g.lineTo(x, y); rot += Math.PI / sp;
    }
    g.closePath();
  }

  function heart(cx, cy, r) {
    g.beginPath(); g.moveTo(cx, cy + r * 0.6);
    g.bezierCurveTo(cx + r, cy + r * 0.1, cx + r * 0.9, cy - r * 0.6, cx, cy - r * 0.2);
    g.bezierCurveTo(cx - r * 0.9, cy - r * 0.6, cx - r, cy + r * 0.1, cx, cy + r * 0.6);
    g.closePath();
  }

  if (kind === 'dots') {
    for (let y = 8; y < s; y += 16) for (let x = 8; x < s; x += 16) {
      g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
    }
  } else if (kind === 'stripes') {
    for (let x = 0; x < s; x += 8) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + s, s); g.stroke();
    }
  } else if (kind === 'star') {
    star(s * 0.5, s * 0.5, 10, 4, 5); g.fill();
    star(10, 10, 5, 2, 5); g.fill();
    star(s - 10, 12, 5, 2, 5); g.fill();
  } else if (kind === 'heart') {
    heart(s * 0.4, s * 0.4, 16); g.fill();
    heart(s * 0.75, s * 0.7, 10); g.fill();
  } else if (kind === 'glitter') {
    g.fillStyle = color;
    g.fillRect(0, 0, s, s);

    const numParticles = s * s / 20;
    for (let i = 0; i < numParticles; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const size = Math.random() * 2 + 0.5;
      const alpha = Math.random() * 0.5 + 0.5;

      g.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      g.beginPath();
      g.arc(x, y, size, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}

function ensurePattern() {
  const key = state.pattern + '|' + state.color;
  if (_patternKey !== key) {
    const tile = makePatternTile(state.pattern, state.color, 48);
    _patternCache = pctx.createPattern(tile, 'repeat');
    _patternKey = key;
  }
  return _patternCache;
}

export function beginStroke(x, y) {
  drawing = true;
  lastX = x; lastY = y;
  pctx.save();
  vp.applyTransform(); // Apply viewport transform before drawing
  pctx.beginPath(); pctx.moveTo(x, y);
  pctx.lineCap = 'round'; pctx.lineJoin = 'round';

  if (state.tool === 'eraser') {
    pctx.globalCompositeOperation = 'destination-out';
    pctx.globalAlpha = 1;
  } else {
    pctx.globalCompositeOperation = 'source-over';
    pctx.globalAlpha = state.opacity;
  }
}

export function endStroke() {
  if (!drawing) return;
  drawing = false;
  pctx.restore();
  vp.resetTransform(); // Reset transform after drawing
  snapshot();
}

export function strokeTo(x, y) {
  if (!drawing) return;
  const { scale } = vp.getState(); // Get current scale from viewport
  const dpr = el.paint.width / el.paint.getBoundingClientRect().width;
  const dx = x - lastX, dy = y - lastY;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(1, state.size * dpr * 0.45);
  const usePat = state.pattern !== 'none';
  const strokeStyle = usePat ? ensurePattern() : state.color;
  const fillStyle = strokeStyle;
  pctx.lineWidth = state.size * dpr / scale; // Adjust line width by scale

  if (state.tool === 'eraser') {
    pctx.globalAlpha = 1;
  } else {
    pctx.globalAlpha = state.opacity;
  }

  switch (state.brush) {
    case 'pen':
      pctx.strokeStyle = strokeStyle;
      pctx.lineTo(x, y); pctx.stroke();
      break;
    case 'marker':
      pctx.save();
      pctx.strokeStyle = strokeStyle;
      pctx.lineWidth = state.size * dpr * 1.2 / scale; // Adjust line width by scale
      pctx.lineTo(x, y); pctx.restore();
      break;
    case 'calligraphy':
      for (let i = 0; i <= dist; i += step) {
        const px = lastX + dx * (i / dist), py = lastY + dy * (i / dist);
        pctx.save();
        const ang = Math.atan2(dy, dx) - Math.PI / 6;
        // pctx.translate(px, py); // Removed, viewport handles transform
        // pctx.rotate(ang); // Removed, viewport handles transform
        pctx.beginPath(); pctx.fillStyle = fillStyle;
        pctx.ellipse(px, py, state.size * dpr * 0.8 / scale, state.size * dpr * 0.35 / scale, ang, 0, Math.PI * 2); // Adjust ellipse size by scale
        pctx.fill(); pctx.restore();
      }
      break;
    case 'crayon':
      for (let i = 0; i <= dist; i += step) {
        const px = lastX + dx * (i / dist), py = lastY + dy * (i / dist);
        for (let k = 0; k < 6; k++) {
          const jx = (Math.random() - 0.5) * state.size * dpr * 0.4 / scale; // Adjust jitter by scale
          const jy = (Math.random() - 0.5) * state.size * dpr * 0.4 / scale; // Adjust jitter by scale
          pctx.save();
          pctx.fillStyle = fillStyle;
          pctx.beginPath();
          pctx.arc(px + jx, py + jy, Math.max(1, state.size * dpr * 0.12 / scale), 0, Math.PI * 2); // Adjust arc size by scale
          pctx.fill(); pctx.restore();
        }
      }
      break;
    case 'neon':
      for (let i = 0; i <= dist; i += step) {
        const px = lastX + dx * (i / dist), py = lastY + dy * (i / dist);
        pctx.save(); pctx.fillStyle = fillStyle;
        pctx.shadowBlur = Math.max(6, state.size * dpr / scale); // Adjust shadow blur by scale
        pctx.shadowColor = state.color;
        pctx.beginPath();
        pctx.arc(px, py, state.size * dpr * 0.45 / scale, 0, Math.PI * 2); // Adjust arc size by scale
        pctx.fill(); pctx.restore();
      }
      break;
  }
  lastX = x; lastY = y;
}

function hexToRGB(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function colorDist(c1, c2) {
  return Math.sqrt(Math.pow(c1[0] - c2[0], 2) + Math.pow(c1[1] - c2[1], 2) + Math.pow(c1[2] - c2[2], 2));
}

export function bucketFill(sx, sy) {
  const W = el.paint.width, H = el.paint.height;
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const t = tmp.getContext('2d');
  
  // Apply viewport transform to temporary canvas for accurate drawing
  vp.resetTransform(); // Ensure temporary canvas is untransformed for drawing base/paint
  t.drawImage(el.base, 0, 0, W, H);
  t.drawImage(el.paint, 0, 0, W, H);
  vp.applyTransform(); // Restore viewport transform

  const flat = t.getImageData(0, 0, W, H);
  const fd = flat.data;
  const i0 = (sy * W + sx) * 4;
  const target = [fd[i0], fd[i0 + 1], fd[i0 + 2], fd[i0 + 3]];
  const isBoundary = (i) => (fd[i] + fd[i + 1] + fd[i + 2]) < 80 && fd[i + 3] > 30;
  const tol = 120;
  const match = (i) => !isBoundary(i) && colorDist([fd[i], fd[i + 1], fd[i + 2], fd[i + 3]], target) <= tol;
  const mask = new Uint8Array(W * H);
  const stack = [[sx, sy]];
  while (stack.length) {
    const [x0, y0] = stack.pop();
    let x = x0;
    while (x >= 0 && !mask[y0 * W + x] && match((y0 * W + x) * 4)) x--;
    x++;
    let up = false, down = false;
    while (x < W && !mask[y0 * W + x] && match((y0 * W + x) * 4)) {
      mask[y0 * W + x] = 1;
      if (!up && y0 > 0 && match(((y0 - 1) * W + x) * 4)) { stack.push([x, y0 - 1]); up = true; } 
      else if (up && y0 > 0 && !match(((y0 - 1) * W + x) * 4)) { up = false; }
      if (!down && y0 < H - 1 && match(((y0 + 1) * W + x) * 4)) { stack.push([x, y0 + 1]); down = true; } 
      else if (down && y0 < H - 1 && !match(((y0 + 1) * W + x) * 4)) { down = false; }
      x++;
    }
  }
  const pd = pctx.getImageData(0, 0, W, H);
  const pdat = pd.data;
  if (state.bucketPattern && state.pattern !== 'none') {
    const tile = makePatternTile(state.pattern, state.color, 48);
    const td = tile.getContext('2d').getImageData(0, 0, tile.width, tile.height).data;
    const TW = tile.width, TH = tile.height;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) {
      const j = (y * W + x) * 4, ti = ((y % TH) * TW + (x % TW)) * 4;
      pdat[j] = td[ti]; pdat[j + 1] = td[ti + 1]; pdat[j + 2] = td[ti + 2]; pdat[j + 3] = td[ti + 3];
    }
  } else {
    const [R, G, B] = hexToRGB(state.color);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) {
      const j = (y * W + x) * 4;
      pdat[j] = R; pdat[j + 1] = G; pdat[j + 2] = B; pdat[j + 3] = 255;
    }
  }
  vp.resetTransform(); // Reset transform before putting image data
  pctx.putImageData(pd, 0, 0);
  vp.applyTransform(); // Re-apply transform after putting image data
  snapshot();
}

function drawBaseContent() {
  const W = el.base.width;
  const H = el.base.height;
  const dpr = el.paint.width / el.base.getBoundingClientRect().width;
  bctx.strokeStyle = '#000';
  bctx.lineWidth = 4 * dpr / vp.getState().scale; // Adjust line width by scale
  bctx.lineCap = 'round';
  bctx.lineJoin = 'round';
  const name = state.template;

  bctx.save();
  vp.applyTransform(); // Apply viewport transform before drawing base content

  if (name === 'flower') {
    bctx.beginPath();
    bctx.arc(W * 0.5, H * 0.5, Math.min(W, H) * 0.09, 0, Math.PI * 2);
    bctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const x = W * 0.5 + Math.cos(a) * Math.min(W, H) * 0.25;
      const y = H * 0.5 + Math.sin(a) * Math.min(W, H) * 0.25;
      bctx.beginPath();
      bctx.ellipse(x, y, Math.min(W, H) * 0.07, Math.min(W, H) * 0.11, a, 0, Math.PI * 2);
      bctx.stroke();
    }
    bctx.beginPath();
    bctx.moveTo(W * 0.5, H * 0.5 + Math.min(W, H) * 0.1);
    bctx.lineTo(W * 0.5, H * 0.9);
    bctx.stroke();
  } else if (name === 'house') {
    const bw = Math.min(W, H) * 0.45;
    const bx = W * 0.5 - bw / 2;
    const by = H * 0.5;
    bctx.strokeRect(bx, by, bw, bw * 0.7);
    bctx.beginPath();
    bctx.moveTo(bx - 20, by);
    bctx.lineTo(W * 0.5, by - bw * 0.35);
    bctx.lineTo(bx + bw + 20, by);
    bctx.closePath();
    bctx.stroke();
    bctx.strokeRect(bx + bw * 0.25, by + bw * 0.2, bw * 0.2, bw * 0.2);
    bctx.strokeRect(bx + bw * 0.65, by + bw * 0.3, bw * 0.12, bw * 0.4);
  } else if (name === 'fish') {
    const rx = W * 0.48,
      ry = H * 0.5,
      rw = Math.min(W, H) * 0.36,
      rh = Math.min(W, H) * 0.2;
    bctx.beginPath();
    bctx.ellipse(rx, ry, rw, rh, 0, 0, Math.PI * 2);
    bctx.stroke();
    bctx.beginPath();
    bctx.moveTo(rx + rw, ry);
    bctx.lineTo(rx + rw + rh, ry - rh * 0.5);
    bctx.lineTo(rx + rw + rh, ry + rh * 0.5);
    bctx.closePath();
    bctx.stroke();
    bctx.beginPath();
    bctx.arc(rx - rw * 0.5, ry - rh * 0.25, rh * 0.12, 0, Math.PI * 2);
    bctx.stroke();
  }
  bctx.restore(); // Restore transform after drawing base content
}