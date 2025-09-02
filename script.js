(() => {
  'use strict';

  // ===== IndexedDB Setup =====
  const DB_NAME = 'ColoringBookDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'templates';
  let db;

  function openColoringDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'name' });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.errorCode);
        reject('IndexedDB error');
      };
    });
  }

  function addTemplateToDB(name, dataUrl) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ name: name, data: dataUrl });

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  function getTemplatesFromDB() {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  function deleteTemplateFromDB(name) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(name);

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  // ===== DOM Elements =====
  const $ = id => document.getElementById(id);
  const statusEl = $('status');
  const base = $('base');
  const paint = $('paint');
  const bctx = base.getContext('2d', { willReadFrequently: true });
  const pctx = paint.getContext('2d', { willReadFrequently: true });

  const ids = ['clearPaintBtn', 'wipeAllBtn', 'saveBtn', 'loadBtn', 'downloadBtn', 'size', 'color', 'toolBrush', 'toolBucket', 'toolEraser', 'toolPan', 'zoomInBtn', 'zoomOutBtn', 'resetViewBtn', 'undoBtn', 'redoBtn', 'resetBtn', 'tplFile', 'tplImportBtn', 'templateSelect', 'changeTemplateBtn', 'brushBar', 'patternBar', 'bucketPattern', 'templateGallery'];
  const el = {};
  ids.forEach(i => el[i] = $(i));

  // ===== State =====
  let drawing = false;
  let panning = false;
  let lastX = 0;
  let lastY = 0;
  const state = {
    tool: 'brush',
    size: parseInt(el.size.value, 10),
    color: el.color.value,
    brush: 'pen',
    pattern: 'none',
    bucketPattern: true,
    template: 'flower',
    scale: 1,
    panX: 0,
    panY: 0,
    undo: [],
    redo: [],
    maxUndo: 25
  };

  function setStatus(t) {
    statusEl.textContent = '상태: ' + t;
  }

  // ===== Canvas & Drawing Logic =====

  function resizeCanvases() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const box = base.parentElement.getBoundingClientRect();
    const cssW = Math.max(600, box.width);
    const cssH = Math.max(400, box.height);
    [base, paint].forEach(cv => {
      cv.style.width = cssW + 'px';
      cv.style.height = cssH + 'px';
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
    });
    state.scale = 1;
    state.panX = 0;
    state.panY = 0;

    // Clear undo/redo history on resize
    state.undo = [];
    state.redo = [];
    
    redrawAll();
    // Take a new initial snapshot after resize and redraw
    pctx.save();
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, paint.width, paint.height);
    pctx.restore();
    snapshot();
  }

  function applyTransform(ctx) {
    ctx.setTransform(state.scale, 0, 0, state.scale, state.panX, state.panY);
  }

  

  function redrawAll() {
    // Save context state
    bctx.save();
    pctx.save();

    // Reset transforms and clear canvases
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, base.width, base.height);
    pctx.clearRect(0, 0, paint.width, paint.height);

    // Draw white background on base canvas (untransformed)
    bctx.fillStyle = '#fff';
    bctx.fillRect(0, 0, base.width, base.height);

    // Apply pan/zoom transforms
    applyTransform(bctx);
    applyTransform(pctx);

    // Redraw content
    drawBaseContent();
    const lastSnapshot = state.undo[state.undo.length - 1];
    if (lastSnapshot) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = lastSnapshot.width;
        tempCanvas.height = lastSnapshot.height;
        tempCanvas.getContext('2d').putImageData(lastSnapshot, 0, 0);
        pctx.drawImage(tempCanvas, 0, 0);
    }

    // Restore context state
    bctx.restore();
    pctx.restore();
  }

  function drawBaseContent() {
    const W = base.width;
    const H = base.height;
    const dpr = paint.width / W;
    bctx.strokeStyle = '#000';
    bctx.lineWidth = 4 * dpr;
    bctx.lineCap = 'round';
    bctx.lineJoin = 'round';
    const name = state.template;
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
  }

  function importTemplate(img, clearPaint) {
    const W = base.width,
      H = base.height;
    bctx.clearRect(0, 0, W, H);
    bctx.fillStyle = '#fff';
    bctx.fillRect(0, 0, W, H);
    const s = Math.min(W / img.width, H / img.height);
    const dw = img.width * s,
      dh = img.height * s;
    const dx = (W - dw) / 2,
      dy = (H - dh) / 2;
    bctx.drawImage(img, dx, dy, dw, dh);
    if (clearPaint) {
      pctx.clearRect(0, 0, paint.width, paint.height);
      snapshot();
    }
  }

  // ===== Undo/Redo =====
  function snapshot() {
    try {
      const W = paint.width,
        H = paint.height;
      const img = pctx.getImageData(0, 0, W, H);
      state.undo.push(img);
      if (state.undo.length > state.maxUndo) {
        state.undo.shift();
      }
      state.redo = [];
    } catch (e) {
      console.error("Snapshot failed:", e);
    }
  }

  function undo() {
    if (state.undo.length <= 1) return;
    const lastState = state.undo.pop();
    state.redo.push(lastState);
    redrawAll();
    setStatus('되돌리기');
  }

  function redo() {
    if (!state.redo.length) return;
    const nextState = state.redo.pop();
    state.undo.push(nextState);
    redrawAll();
    setStatus('다시하기');
  }

  // ===== Coords =====
  function canvasPos(e) {
    const r = paint.getBoundingClientRect();
    const dpr = paint.width / r.width;
    const screenX = (('touches' in e ? e.touches[0].clientX : e.clientX) - r.left);
    const screenY = (('touches' in e ? e.touches[0].clientY : e.clientY) - r.top);
    const canvasX = (screenX * dpr - state.panX) / state.scale;
    const canvasY = (screenY * dpr - state.panY) / state.scale;
    return { x: Math.round(canvasX), y: Math.round(canvasY) };
  }

  function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function getTouchCenter(touches, r, dpr) {
    const screenX1 = (touches[0].clientX - r.left) * dpr;
    const screenY1 = (touches[0].clientY - r.top) * dpr;
    const screenX2 = (touches[1].clientX - r.left) * dpr;
    const screenY2 = (touches[1].clientY - r.top) * dpr;
    return {
        x: (screenX1 + screenX2) / 2,
        y: (screenY1 + screenY2) / 2,
    };
  }

  // ===== Patterns =====
  let _patternCache = null;
  let _patternKey = '';

  function makePatternTile(kind, color, base = 48) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const s = Math.round(base * dpr);
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const g = c.getContext('2d');
    g.clearRect(0, 0, s, s);
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineWidth = 3 * dpr;

    function star(cx, cy, R, r, sp) {
      let rot = Math.PI / 2 * 3;
      g.beginPath();
      g.moveTo(cx, cy - R);
      for (let i = 0; i < sp; i++) {
        let x = cx + Math.cos(rot) * R;
        let y = cy + Math.sin(rot) * R;
        g.lineTo(x, y);
        rot += Math.PI / sp;
        x = cx + Math.cos(rot) * r;
        y = cy + Math.sin(rot) * r; // Fixed: Math.sin
        g.lineTo(x, y);
        rot += Math.PI / sp;
      }
      g.closePath();
    }

    function heart(cx, cy, r) {
      g.beginPath();
      g.moveTo(cx, cy + r * 0.6);
      g.bezierCurveTo(cx + r, cy + r * 0.1, cx + r * 0.9, cy - r * 0.6, cx, cy - r * 0.2);
      g.bezierCurveTo(cx - r * 0.9, cy - r * 0.6, cx - r, cy + r * 0.1, cx, cy + r * 0.6);
      g.closePath();
    }

    if (kind === 'dots') {
      for (let y = 8 * dpr; y < s; y += 16 * dpr) {
        for (let x = 8 * dpr; x < s; x += 16 * dpr) {
          g.beginPath();
          g.arc(x, y, 3 * dpr, 0, Math.PI * 2);
          g.fill();
        }
      }
    } else if (kind === 'stripes') {
      for (let x = 0; x < s; x += 8 * dpr) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + s, s);
        g.stroke();
      }
    } else if (kind === 'star') {
      star(s * 0.5, s * 0.5, 10 * dpr, 4 * dpr, 5);
      g.fill();
      star(10 * dpr, 10 * dpr, 5 * dpr, 2 * dpr, 5);
      g.fill();
      star(s - 10 * dpr, 12 * dpr, 5 * dpr, 2 * dpr, 5);
      g.fill();
    } else if (kind === 'heart') {
      heart(s * 0.4, s * 0.4, 16 * dpr);
      g.fill();
      heart(s * 0.75, s * 0.7, 10 * dpr);
      g.fill();
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

  // ===== Drawing =====
  function beginStroke(x, y) {
    drawing = true;
    lastX = x;
    lastY = y;
    pctx.save();
    pctx.beginPath();
    pctx.moveTo(x, y);
    pctx.lineCap = 'round';
    pctx.lineJoin = 'round';
    pctx.globalCompositeOperation = (state.tool === 'eraser') ? 'destination-out' : 'source-over';
  }

  function endStroke() {
    if (!drawing) return;
    drawing = false;
    pctx.restore();
    snapshot();
  }

  function strokeTo(x, y) {
    if (!drawing) return;
    const dpr = paint.width / paint.getBoundingClientRect().width;
    const dx = x - lastX;
    const dy = y - lastY;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, state.size * 0.45);
    const usePat = state.pattern !== 'none';
    const strokeStyle = usePat ? ensurePattern() : state.color;
    const fillStyle = strokeStyle;
    pctx.lineWidth = state.size * dpr / state.scale;

    switch (state.brush) {
      case 'pen':
        pctx.strokeStyle = strokeStyle;
        pctx.lineTo(x, y);
        pctx.stroke();
        break;
      case 'marker':
        pctx.save();
        pctx.globalAlpha = 0.6;
        pctx.strokeStyle = strokeStyle;
        pctx.lineWidth = state.size * dpr * 1.2;
        pctx.lineTo(x, y);
        pctx.stroke();
        pctx.restore();
        break;
      case 'calligraphy':
        for (let i = 0; i <= dist; i += step) {
          const px = lastX + dx * (i / dist);
          const py = lastY + dy * (i / dist);
          pctx.save();
          const ang = Math.atan2(dy, dx) - Math.PI / 6;
          pctx.translate(px, py);
          pctx.rotate(ang);
          pctx.beginPath();
          pctx.fillStyle = fillStyle;
          pctx.ellipse(0, 0, state.size * dpr * 0.8, state.size * dpr * 0.35, 0, 0, Math.PI * 2);
          pctx.fill();
          pctx.restore();
        }
        break;
      case 'crayon':
        for (let i = 0; i <= dist; i += step) {
          const px = lastX + dx * (i / dist);
          const py = lastY + dy * (i / dist);
          for (let k = 0; k < 6; k++) {
            const jx = (Math.random() - 0.5) * state.size * dpr * 0.4;
            const jy = (Math.random() - 0.5) * state.size * dpr * 0.4;
            pctx.save();
            pctx.globalAlpha = 0.35;
            pctx.fillStyle = fillStyle;
            pctx.beginPath();
            pctx.arc(px + jx, py + jy, Math.max(1, state.size * dpr * 0.12), 0, Math.PI * 2);
            pctx.fill();
            pctx.restore();
          }
        }
        break;
      case 'neon':
        for (let i = 0; i <= dist; i += step) {
          const px = lastX + dx * (i / dist);
          const py = lastY + dy * (i / dist);
          pctx.save();
          pctx.fillStyle = fillStyle;
          pctx.shadowBlur = Math.max(6, state.size * dpr);
          pctx.shadowColor = state.color;
          pctx.beginPath();
          pctx.arc(px, py, state.size * dpr * 0.45, 0, Math.PI * 2);
          pctx.fill();
          pctx.restore();
        }
        break;
    }
    lastX = x;
    lastY = y;
  }

  // ===== Bucket Fill =====
  function colorDist(a, b) {
    const dr = a[0] - b[0],
      dg = a[1] - b[1],
      db = a[2] - b[2];
    return Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db);
  }

  function hexToRGB(hex) {
    const v = hex.replace('#', '');
    const n = parseInt(v, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }

  function bucketFill(sx, sy) {
    const W = paint.width,
      H = paint.height;
    const tmp = document.createElement('canvas');
    tmp.width = W;
    tmp.height = H;
    const t = tmp.getContext('2d');
    t.drawImage(base, 0, 0, W, H);
    t.drawImage(paint, 0, 0, W, H);
    const flat = t.getImageData(0, 0, W, H);
    const fd = flat.data;
    const i0 = (sy * W + sx) * 4;
    const target = [fd[i0], fd[i0 + 1], fd[i0 + 2], fd[i0 + 3]];
    const isBoundary = (i) => {
      const sum = fd[i] + fd[i + 1] + fd[i + 2];
      return sum < 80 && fd[i + 3] > 30;
    };
    const tol = 28;
    const match = (i) => !isBoundary(i) && colorDist([fd[i], fd[i + 1], fd[i + 2], fd[i + 3]], target) <= tol;
    const mask = new Uint8Array(W * H);
    const stack = [
      [sx, sy]
    ];
    while (stack.length) {
      const [x0, y0] = stack.pop();
      let x = x0;
      while (x >= 0 && !mask[y0 * W + x] && match((y0 * W + x) * 4)) {
        x--;
      }
      x++;
      let up = false,
        down = false;
      while (x < W && !mask[y0 * W + x] && match((y0 * W + x) * 4)) {
        mask[y0 * W + x] = 1;
        if (!up && y0 > 0 && match(((y0 - 1) * W + x) * 4)) {
          stack.push([x, y0 - 1]);
          up = true;
        } else if (up && y0 > 0 && !match(((y0 - 1) * W + x) * 4)) {
          up = false;
        }
        if (!down && y0 < H - 1 && match(((y0 + 1) * W + x) * 4)) {
          stack.push([x, y0 + 1]);
          down = true;
        } else if (down && y0 < H - 1 && !match(((y0 + 1) * W + x) * 4)) {
          down = false;
        }
        x++;
      }
    }
    const pd = pctx.getImageData(0, 0, W, H);
    const pdat = pd.data;
    if (state.bucketPattern && state.pattern !== 'none') {
      const tile = makePatternTile(state.pattern, state.color, 48);
      const td = tile.getContext('2d').getImageData(0, 0, tile.width, tile.height).data;
      const TW = tile.width,
        TH = tile.height;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (mask[y * W + x]) {
            const j = (y * W + x) * 4;
            const ti = ((y % TH) * TW + (x % TW)) * 4;
            pdat[j] = td[ti];
            pdat[j + 1] = td[ti + 1];
            pdat[j + 2] = td[ti + 2];
            pdat[j + 3] = td[ti + 3];
          }
        }
      }
    } else {
      const [R, G, B] = hexToRGB(state.color);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (mask[y * W + x]) {
            const j = (y * W + x) * 4;
            pdat[j] = R;
            pdat[j + 1] = G;
            pdat[j + 2] = B;
            pdat[j + 3] = 255;
          }
        }
      }
    }
    pctx.putImageData(pd, 0, 0);
    snapshot();
  }

  // ===== Pointer Events =====
  function attachPointer() {
    let panStart = { x: 0, y: 0 };
    let initialPan = { x: 0, y: 0 };
    let lastTouchDistance = 0;

    function onPointerDown(e) {
      const r = paint.getBoundingClientRect();
      const dpr = paint.width / r.width;

      if (e.touches && e.touches.length === 2) {
        e.preventDefault();
        lastTouchDistance = getTouchDistance(e.touches);
        return;
      }

      const screenX = ('touches' in e ? e.touches[0].clientX : e.clientX) - r.left;
      const screenY = ('touches' in e ? e.touches[0].clientY : e.clientY) - r.top;

      if (state.tool === 'pan') {
        panning = true;
        panStart.x = screenX;
        panStart.y = screenY;
        initialPan.x = state.panX;
        initialPan.y = state.panY;
        return;
      }

      const p = canvasPos(e);
      if (state.tool === 'bucket') {
        bucketFill(p.x | 0, p.y | 0);
      } else {
        beginStroke(p.x, p.y);
      }
    }

    function onPointerMove(e) {
      const r = paint.getBoundingClientRect();
      const dpr = paint.width / r.width;

      if (e.touches && e.touches.length === 2) {
        e.preventDefault();
        const newTouchDistance = getTouchDistance(e.touches);
        const scaleFactor = newTouchDistance / lastTouchDistance;
        const newScale = Math.max(0.2, Math.min(state.scale * scaleFactor, 10));

        const center = getTouchCenter(e.touches, r, dpr);

        state.panX = center.x - (center.x - state.panX) * (newScale / state.scale);
        state.panY = center.y - (center.y - state.panY) * (newScale / state.scale);
        state.scale = newScale;

        lastTouchDistance = newTouchDistance;
        redrawAll();
        return;
      }

      const screenX = ('touches' in e ? e.touches[0].clientX : e.clientX) - r.left;
      const screenY = ('touches' in e ? e.touches[0].clientY : e.clientY) - r.top;

      if (panning) {
        e.preventDefault();
        const dx = screenX - panStart.x;
        const dy = screenY - panStart.y;
        state.panX = initialPan.x + dx * dpr;
        state.panY = initialPan.y + dy * dpr;
        redrawAll();
        return;
      }

      if (!drawing) return;
      e.preventDefault();
      const p = canvasPos(e);
      if (state.tool === 'eraser') {
        pctx.globalCompositeOperation = 'destination-out';
        pctx.lineWidth = state.size * dpr / state.scale;
        pctx.lineCap = 'round';
        pctx.lineTo(p.x, p.y);
        pctx.stroke();
        lastX = p.x;
        lastY = p.y;
      } else {
        strokeTo(p.x, p.y);
      }
    }

    function onPointerUp() {
      lastTouchDistance = 0;
      if (panning) {
        panning = false;
      }
      if (drawing) {
        endStroke();
      }
    }

    function handleWheel(e) {
      e.preventDefault();
      const r = paint.getBoundingClientRect();
      const dpr = paint.width / r.width;
      const mouseX = (e.clientX - r.left) * dpr;
      const mouseY = (e.clientY - r.top) * dpr;

      const scaleAmount = 1.1;
      let newScale;
      if (e.deltaY < 0) {
        newScale = state.scale * scaleAmount;
      } else {
        newScale = state.scale / scaleAmount;
      }
      newScale = Math.max(0.2, Math.min(newScale, 10));

      state.panX = mouseX - (mouseX - state.panX) * (newScale / state.scale);
      state.panY = mouseY - (mouseY - state.panY) * (newScale / state.scale);
      state.scale = newScale;

      redrawAll();
    }

    paint.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    paint.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp, { passive: false });

    paint.addEventListener('wheel', handleWheel, { passive: false });
  }

  // ===== UI wiring =====
  const brushes = [{ id: 'pen', label: '펜' }, { id: 'marker', label: '마커' }, { id: 'calligraphy', label: '캘리' }, { id: 'crayon', label: '크레용' }, { id: 'neon', label: '네온' }];
  const patterns = [{ id: 'none', label: '단색' }, { id: 'dots', label: '도트' }, { id: 'stripes', label: '줄무늬' }, { id: 'star', label: '별' }, { id: 'heart', label: '하트' }];

  function buildBrushBar() {
    el.brushBar.innerHTML = '';
    brushes.forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      btn.className = 'pbtn' + (state.brush === b.id ? ' active' : '');
      btn.onclick = () => {
        state.brush = b.id;
        [...el.brushBar.children].forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        setStatus('브러시: ' + b.label);
      };
      el.brushBar.appendChild(btn);
    });
  }

  function buildPatternBar() {
    el.patternBar.innerHTML = '';
    patterns.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = p.label;
      btn.className = 'pbtn' + (state.pattern === p.id ? ' active' : '');
      btn.onclick = () => {
        state.pattern = p.id;
        _patternKey = '';
        [...el.patternBar.children].forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        setStatus('패턴: ' + p.label);
      };
      el.patternBar.appendChild(btn);
    });
  }

  function applyToolActive() {
    ['toolBrush', 'toolBucket', 'toolEraser', 'toolPan'].forEach(id => $(id).classList.remove('active'));
    $('tool' + (state.tool.charAt(0).toUpperCase() + state.tool.slice(1))).classList.add('active');
  }

  function hasAnyPaint() {
    const W = paint.width,
      H = paint.height;
    const d = pctx.getImageData(0, 0, W, H).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 0) return true;
    }
    return false;
  }

  // ===== Event Listeners =====
  el.size.oninput = () => state.size = parseInt(el.size.value, 10) || 1;
  el.color.oninput = () => {
    state.color = el.color.value;
    _patternKey = '';
  };
  el.toolBrush.onclick = () => {
    state.tool = 'brush';
    applyToolActive();
    setStatus('툴: 브러시');
  };
  el.toolBucket.onclick = () => {
    state.tool = 'bucket';
    applyToolActive();
    setStatus('툴: 채우기');
  };
  el.toolEraser.onclick = () => {
    state.tool = 'eraser';
    applyToolActive();
    setStatus('툴: 지우개');
  };
  el.toolPan.onclick = () => {
    state.tool = 'pan';
    applyToolActive();
    setStatus('툴: 이동');
  };
  el.undoBtn.onclick = undo;
  el.redoBtn.onclick = redo;
  el.resetBtn.onclick = () => location.reload();

  el.zoomInBtn.onclick = () => {
    const newScale = Math.min(10, state.scale * 1.2);
    state.scale = newScale;
    redrawAll();
  };
  el.zoomOutBtn.onclick = () => {
    const newScale = Math.max(0.2, state.scale / 1.2);
    state.scale = newScale;
    redrawAll();
  };
  el.resetViewBtn.onclick = () => {
    state.scale = 1;
    state.panX = 0;
    state.panY = 0;
    redrawAll();
  };

  el.clearPaintBtn.onclick = () => {
    pctx.clearRect(0, 0, paint.width, paint.height);
    snapshot();
    setStatus('채색만 지움(도안 유지)');
  };
  el.wipeAllBtn.onclick = () => {
    if (!confirm('정말 전체 삭제(도안 포함)할까요?')) return;
    bctx.clearRect(0, 0, base.width, base.height);
    pctx.clearRect(0, 0, paint.width, paint.height);
    setStatus('전체 삭제 완료');
  };

  el.saveBtn.onclick = () => {
    const W = base.width,
      H = base.height;
    const tmp = document.createElement('canvas');
    tmp.width = W;
    tmp.height = H;
    const t = tmp.getContext('2d');
    t.drawImage(base, 0, 0, W, H);
    t.drawImage(paint, 0, 0, W, H);
    const url = tmp.toDataURL('image/png');
    localStorage.setItem('coloring.save', url);
    setStatus('저장 완료');
  };
  el.loadBtn.onclick = () => {
    const url = localStorage.getItem('coloring.save');
    if (!url) {
      setStatus('저장본 없음');
      return;
    }
    const img = new Image();
    img.onload = () => {
      const W = base.width,
        H = base.height;
      bctx.clearRect(0, 0, W, H);
      pctx.clearRect(0, 0, paint.width, paint.height);
      bctx.drawImage(img, 0, 0, W, H);
      snapshot();
      setStatus('불러오기 완료(합성본을 도안으로 올림)');
    };
    img.src = url;
  };

  el.downloadBtn.onclick = () => {
    const W = base.width;
    const H = base.height;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = W;
    tempCanvas.height = H;
    const tempCtx = tempCanvas.getContext('2d');

    // Draw the layers, ensuring the background is white
    tempCtx.fillStyle = '#fff';
    tempCtx.fillRect(0, 0, W, H);
    tempCtx.drawImage(base, 0, 0);
    tempCtx.drawImage(paint, 0, 0);

    // Trigger download
    const link = document.createElement('a');
    link.download = 'coloring-art.png';
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
    setStatus('이미지 다운로드 시작');
  };

  el.tplImportBtn.onclick = () => el.tplFile.click();
  el.tplFile.onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => { // Make it async to use await
      const img = new Image();
      img.onload = async () => { // Make it async to use await
        const templateName = f.name.split('.').slice(0, -1).join('.') || 'untitled'; // Use filename as name
        try {
          await addTemplateToDB(templateName, r.result); // Save to IndexedDB
          setStatus('도안 저장 완료: ' + templateName);
          await renderTemplateGallery(); // Re-render gallery after saving
          // Optionally, load the newly imported template
          const hadPaint = hasAnyPaint();
          const clearPaint = hadPaint ? confirm('새 도안을 불러옵니다. 현재 채색을 지울까요?\n확인=지움 / 취소=유지') : false;
          importTemplate(img, clearPaint);
          setStatus('도안 불러오기 완료' + (clearPaint ? ' (채색 삭제)' : ' (채색 유지)'));
        } catch (error) {
          console.error('Failed to save template to DB:', error);
          setStatus('도안 저장 실패');
        }
      };
      img.src = r.result;
    };
    r.readAsDataURL(f);
  };
  el.changeTemplateBtn.onclick = () => {
    const hadPaint = hasAnyPaint();
    const clearPaint = hadPaint ? confirm('도안을 변경합니다. 현재 채색을 지울까요?\n확인=지움 / 취소=유지') : false;
    state.template = el.templateSelect.value;
    if (clearPaint) {
      pctx.clearRect(0, 0, paint.width, paint.height);
      snapshot();
    }
    
    // Clear undo/redo history on template change
    state.undo = [];
    state.redo = [];

    state.scale = 1;
    state.panX = 0;
    state.panY = 0;

    redrawAll(); 
    // Take a new initial snapshot after template change and redraw
    pctx.save();
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, paint.width, paint.height);
    pctx.restore();
    snapshot();

    setStatus('도안 변경: ' + state.template + (clearPaint ? ' (채색 삭제)' : ' (채색 유지)'));
  };


  async function renderTemplateGallery() {
    el.templateGallery.innerHTML = ''; // Clear existing gallery
    try {
      const templates = await getTemplatesFromDB();
      if (templates.length === 0) {
        el.templateGallery.innerHTML = '<div style="text-align:center; padding:10px; font-size:0.9em; color:#aaa;">저장된 도안이 없습니다.</div>';
        return;
      }
      templates.forEach(tpl => {
        const item = document.createElement('div');
        item.className = 'template-item';
        item.dataset.name = tpl.name;

        const img = document.createElement('img');
        img.src = tpl.data;
        img.alt = tpl.name;
        item.appendChild(img);

        const nameSpan = document.createElement('span');
        nameSpan.textContent = tpl.name;
        item.appendChild(nameSpan);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = 'X';
        deleteBtn.onclick = async (e) => {
          e.stopPropagation(); // Prevent item click
          if (confirm(`'${tpl.name}' 도안을 삭제하시겠습니까?`)) {
            try {
              await deleteTemplateFromDB(tpl.name);
              setStatus(`'${tpl.name}' 도안 삭제 완료`);
              renderTemplateGallery(); // Re-render gallery
            } catch (error) {
              console.error('Failed to delete template:', error);
              setStatus('도안 삭제 실패');
            }
          }
        };
        item.appendChild(deleteBtn);

        item.onclick = () => {
          // Remove active class from all items
          [...el.templateGallery.children].forEach(child => child.classList.remove('active'));
          item.classList.add('active'); // Add active class to clicked item

          const hadPaint = hasAnyPaint();
          const clearPaint = hadPaint ? confirm('새 도안을 불러옵니다. 현재 채색을 지울까요?\n확인=지움 / 취소=유지') : false;
          const imgToLoad = new Image();
          imgToLoad.onload = () => {
            importTemplate(imgToLoad, clearPaint);
            setStatus('도안 불러오기 완료: ' + tpl.name + (clearPaint ? ' (채색 삭제)' : ' (채색 유지)'));
          };
          imgToLoad.src = tpl.data;
        };
        el.templateGallery.appendChild(item);
      });
    } catch (error) {
      console.error('Failed to load templates from DB:', error);
      setStatus('도안 불러오기 실패');
    }
  }

  // ===== Boot =====
  async function boot() { // Make boot async
    try {
      await openColoringDB(); // Open DB first
      setStatus('데이터베이스 준비 완료');
    } catch (error) {
      setStatus('데이터베이스 오류');
      console.error('Failed to open IndexedDB:', error);
      return;
    }

    // Setup UI and event handlers
    buildBrushBar();
    buildPatternBar();
    attachPointer();
    window.addEventListener('resize', resizeCanvases);

    // Set initial canvas size and draw for the first time
    resizeCanvases();

    // Create the initial blank snapshot AFTER the first draw
    pctx.save();
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, paint.width, paint.height);
    pctx.restore();
    snapshot();

    await renderTemplateGallery(); // Render gallery after DB is ready

    setStatus('준비완료');
  }

  boot();

})();