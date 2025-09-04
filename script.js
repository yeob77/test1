(() => {
  'use strict';

  // ===== IndexedDB Setup =====
  const DB_NAME = 'ColoringBookDB';
  const DB_VERSION = 2;
  const STORE_NAME = 'templates';
  const TEMPLATES_PER_PAGE = 12; // Number of templates to display per page
  let db;

  function openColoringDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        db = event.target.result;
        let objectStore;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'name' });
        } else {
          objectStore = request.transaction.objectStore(STORE_NAME);
        }
        if (!objectStore.indexNames.contains('category')) {
          objectStore.createIndex('category', 'category', { unique: false });
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

  function addTemplateToDB(name, dataUrl, category = '기본') { // Kept local default param
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ name: name, data: dataUrl, category: category });
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  function getTemplatesFromDB(category = 'all') {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      let request;
      if (category === 'all') {
        request = store.getAll();
      } else {
        const index = store.index('category');
        request = index.getAll(category);
      }
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

  const ids = [ // Combined local and remote IDs
    // Gallery View
    'templateSelect', 'changeTemplateBtn', 'tplFile', 'tplImportBtn', 'urlInput', 'urlImportBtn',
    'tplCategory', 'prevTemplatePageBtn', 'nextTemplatePageBtn', 'templatePageInfo',
    'templateCategoryButtons', 'templateGallery', 'saveBtn', 'loadBtn', 'downloadBtn',
    'clearPaintBtn', 'wipeAllBtn',

    // Drawing View
    'toolBrush', 'toolBucket', 'toolEraser', 'toolPan', 'size', 'color', 'opacity', 'brushBar',
    'patternBar', 'bucketPattern', 'childColorPalette', 'undoBtn', 'redoBtn',
    'sidebarToggleBtn',

    // Settings View
    'modeToggleBtn', 'zoomInBtn', 'zoomOutBtn', 'resetViewBtn', 'resetBtn',

    // Global
    'status', 'base', 'paint', 'templateModal', 'modalImage', 'closeButton', 'loadTemplateFromModalBtn',
    'navGalleryBtn', 'navDrawingBtn', 'navSettingsBtn' // New navigation buttons
  ];
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
    currentBaseImage: null, // NEW: To store the loaded image object
    scale: 1,
    panX: 0,
    panY: 0,
    undo: [],
    redo: [],
    maxUndo: 25,
    isChildMode: false,
    currentPage: 1, // Current page for template gallery
    currentCategory: 'all', // Current selected category for gallery
    currentView: 'galleryView' // New: Current active view
  };

  function setStatus(t) {
    statusEl.textContent = '상태: ' + t;
  }

  function showView(viewId) {
    const views = document.querySelectorAll('.view');
    views.forEach(view => {
      view.classList.remove('active');
    });
    document.getElementById(viewId).classList.add('active');
    state.currentView = viewId;

    // Update active state of navigation buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    if (viewId === 'galleryView') {
      el.navGalleryBtn.classList.add('active');
    } else if (viewId === 'drawingView') {
      el.navDrawingBtn.classList.add('active');
      // Call resize after the view is visible and rendered to ensure correct size
      setTimeout(() => {
        resizeCanvases();
      }, 10);
    } else if (viewId === 'settingsView') {
      el.navSettingsBtn.classList.add('active');
    }
  }

  // ===== NEW: Transform & Drawing Logic (Refactored) =====

  function applyViewTransform() {
    // const dpr = paint.width / paint.getBoundingClientRect().width; // dpr is no longer needed here
    const cssPanX = state.panX; // panX is now in CSS pixels
    const cssPanY = state.panY; // panY is now in CSS pixels
    const transform = `translate(${cssPanX}px, ${cssPanY}px) scale(${state.scale})`;
    [base, paint].forEach(cv => {
      cv.style.transformOrigin = '0 0';
      cv.style.transform = transform;
    });
  }

  function redrawPaintCanvas() {
      pctx.save();
      pctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
      pctx.clearRect(0, 0, paint.width, paint.height); // Clear full canvas
      // Apply pan and scale from state (all in CSS pixels)
      pctx.translate(state.panX, state.panY);
      pctx.scale(state.scale, state.scale);

      const lastSnapshot = state.undo[state.undo.length - 1];
      if (lastSnapshot) {
        // putImageData is not affected by transform, so we need to draw it to a temp canvas
        // and then draw that temp canvas, or handle the inverse transform.
        // For now, let's assume snapshots are taken in the base (untransformed) coordinate system.
        // If not, this will need further adjustment.
        pctx.putImageData(lastSnapshot, 0, 0);
      }
      pctx.restore();
  }

  function redrawBaseCanvas() {
      bctx.save();
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, base.width, base.height);
      bctx.fillStyle = '#fff';
      bctx.fillRect(0, 0, base.width, base.height);

      if (state.currentBaseImage) {
          const img = state.currentBaseImage;
          const W = base.width;
          const H = base.height;
          const s = Math.min(W / img.width, H / img.height);
          const dw = img.width * s;
          const dh = img.height * s;
          const dx = (W - dw) / 2;
          const dy = (H - dh) / 2;
          bctx.drawImage(img, dx, dy, dw, dh);
      } else {
          drawBaseContent();
      }
      bctx.restore();
  }
  
  function resizeCanvases() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const box = base.parentElement.getBoundingClientRect();
    const cssW = Math.max(600, box.width);
    const cssH = Math.max(400, box.height);
    [base, paint].forEach(cv => {
      cv.style.width = cssW + 'px';
      cv.style.height = cssH + 'px';
      cv.width = Math.round(cssW * dpr); // Keep dpr for canvas internal resolution
      cv.height = Math.round(cssH * dpr); // Keep dpr for canvas internal resolution
    });
    
    state.scale = 1;
    state.panX = 0;
    state.panY = 0;
    applyViewTransform();

    state.undo = [];
    state.redo = [];
    
    redrawBaseCanvas();
    
    pctx.save();
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, paint.width, paint.height);
    pctx.restore();
    snapshot();
  }

  function drawBaseContent() {
    const W = base.width;
    const H = base.height;
    const dpr = paint.width / base.getBoundingClientRect().width;
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
    state.currentBaseImage = img; // Store the loaded image object
    state.template = 'custom'; // Mark that we are using a custom image
    redrawBaseCanvas(); // Redraw the base canvas with the new image

    if (clearPaint) {
      pctx.clearRect(0, 0, paint.width, paint.height);
      snapshot();
    }
  }

  // ===== Undo/Redo =====
  function snapshot() {
    try {
      const W = paint.width, H = paint.height;
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
    redrawPaintCanvas();
    setStatus('되돌리기');
  }

  function redo() {
    if (!state.redo.length) return;
    const nextState = state.redo.pop();
    state.undo.push(nextState);
    redrawPaintCanvas();
    setStatus('다시하기');
  }

  // ===== Coords (Refactored) =====
  function canvasPos(e) {
    const r = base.getBoundingClientRect();
    const dpr = paint.width / r.width;

    const screenX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const screenY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const cssX = screenX - r.left;
    const cssY = screenY - r.top;

    // Reverse the CSS transform to find the logical position in CSS pixels
    const logicalCssX = (cssX - state.panX) / state.scale;
    const logicalCssY = (cssY - state.panY) / state.scale;

    // Convert to canvas resolution pixels for drawing
    return { x: logicalCssX * dpr, y: logicalCssY * dpr };
  }

  function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function getTouchCenter(touches, r) {
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2 - r.left,
        y: (touches[0].clientY + touches[1].clientY) / 2 - r.top,
    };
  }

  // ===== Patterns =====
  let _patternCache = null;
  let _patternKey = '';

  function makePatternTile(kind, color, base = 48) {
    // const dpr = Math.max(1, window.devicePixelRatio || 1); // dpr is no longer needed here
    const s = base; // Use base directly as size, assuming CSS pixels
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const g = c.getContext('2d');
    g.clearRect(0, 0, s, s);
    g.fillStyle = color; g.strokeStyle = color;
    g.lineWidth = 3; // Removed dpr scaling

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
    lastX = x; lastY = y;
    pctx.save();
    pctx.beginPath(); pctx.moveTo(x, y);
    pctx.lineCap = 'round'; pctx.lineJoin = 'round';
    
    if (state.tool === 'eraser') {
        pctx.globalCompositeOperation = 'destination-out';
        pctx.globalAlpha = 1; // Eraser should always be fully opaque
    } else {
        pctx.globalCompositeOperation = 'source-over';
        pctx.globalAlpha = state.opacity; // Apply opacity for all other tools
    }
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
    const dx = x - lastX, dy = y - lastY;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, state.size * dpr * 0.45);
    const usePat = state.pattern !== 'none';
    const strokeStyle = usePat ? ensurePattern() : state.color;
    const fillStyle = strokeStyle;
    pctx.lineWidth = state.size * dpr;

    switch (state.brush) {
      case 'pen':
        pctx.strokeStyle = strokeStyle;
        pctx.lineTo(x, y); pctx.stroke();
        break;
      case 'marker':
        pctx.save(); pctx.globalAlpha = 0.6;
        pctx.strokeStyle = strokeStyle;
        pctx.lineWidth = state.size * dpr * 1.2;
        pctx.lineTo(x, y); pctx.stroke();
        pctx.restore();
        break;
      case 'calligraphy':
        for (let i = 0; i <= dist; i += step) {
          const px = lastX + dx * (i / dist), py = lastY + dy * (i / dist);
          pctx.save();
          const ang = Math.atan2(dy, dx) - Math.PI / 6;
          pctx.translate(px, py); pctx.rotate(ang);
          pctx.beginPath(); pctx.fillStyle = fillStyle;
          pctx.ellipse(0, 0, state.size * dpr * 0.8, state.size * dpr * 0.35, 0, 0, Math.PI * 2);
          pctx.fill(); pctx.restore();
        }
        break;
      case 'crayon':
        for (let i = 0; i <= dist; i += step) {
          const px = lastX + dx * (i / dist), py = lastY + dy * (i / dist);
          for (let k = 0; k < 6; k++) {
            const jx = (Math.random() - 0.5) * state.size * dpr * 0.4;
            const jy = (Math.random() - 0.5) * state.size * dpr * 0.4;
            pctx.save(); pctx.globalAlpha = 0.35;
            pctx.fillStyle = fillStyle;
            pctx.beginPath();
            pctx.arc(px + jx, py + jy, Math.max(1, state.size * dpr * 0.12), 0, Math.PI * 2);
            pctx.fill(); pctx.restore();
          }
        }
        break;
      case 'neon':
        for (let i = 0; i <= dist; i += step) {
          const px = lastX + dx * (i / dist), py = lastY + dy * (i / dist);
          pctx.save(); pctx.fillStyle = fillStyle;
          pctx.shadowBlur = Math.max(6, state.size * dpr);
          pctx.shadowColor = state.color;
          pctx.beginPath();
          pctx.arc(px, py, state.size * dpr * 0.45, 0, Math.PI * 2);
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

  // ===== Bucket Fill =====
  function bucketFill(sx, sy) {
    const W = paint.width, H = paint.height;
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const t = tmp.getContext('2d');
    t.drawImage(base, 0, 0, W, H);
    t.drawImage(paint, 0, 0, W, H);
    const flat = t.getImageData(0, 0, W, H);
    const fd = flat.data;
    const i0 = (sy * W + sx) * 4;
    const target = [fd[i0], fd[i0 + 1], fd[i0 + 2], fd[i0 + 3]];
    const isBoundary = (i) => (fd[i] + fd[i + 1] + fd[i + 2]) < 80 && fd[i + 3] > 30;
    const tol = 120; // Significantly increased tolerance for anti-aliased lines to eliminate white margins
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
    pctx.putImageData(pd, 0, 0);
    snapshot();
  }

  // ===== Pointer Events (Refactored) =====
  function attachPointer() {
    let panStart = { x: 0, y: 0 };
    let initialPan = { x: 0, y: 0 };
    let lastTouchDistance = 0;
    let pinchCenter = { x: 0, y: 0 };

    function onPointerDown(e) {
      if (e.touches && e.touches.length === 2) {
        e.preventDefault();
        const r = base.getBoundingClientRect();
        lastTouchDistance = getTouchDistance(e.touches);
        pinchCenter = getTouchCenter(e.touches, r);
        return;
      }

      const p = canvasPos(e);
      if (state.tool === 'pan') {
        panning = true;
        panStart.x = ('touches' in e ? e.touches[0].clientX : e.clientX);
        panStart.y = ('touches' in e ? e.touches[0].clientY : e.clientY);
        initialPan.x = state.panX;
        initialPan.y = state.panY;
        return;
      }

      if (state.tool === 'bucket') {
        bucketFill(p.x | 0, p.y | 0);
      } else {
        beginStroke(p.x, p.y);
      }
    }

    function onPointerMove(e) {
      if (e.touches && e.touches.length === 2) {
        e.preventDefault();
        const r = base.getBoundingClientRect();
        const newTouchDistance = getTouchDistance(e.touches);
        const scaleFactor = newTouchDistance / lastTouchDistance;
        const newScale = Math.max(0.2, Math.min(state.scale * scaleFactor, 10));
        // const dpr = paint.width / r.width; // dpr is no longer needed here
        
        const currentPinchCenter = getTouchCenter(e.touches, r);
        const pcX = currentPinchCenter.x; // Pinch center in CSS pixels
        const pcY = currentPinchCenter.y; // Pinch center in CSS pixels

        // Calculate new pan based on keeping pinch center stationary
        const newPanX = pcX * (1 - newScale / state.scale) + state.panX * (newScale / state.scale);
        const newPanY = pcY * (1 - newScale / state.scale) + state.panY * (newScale / state.scale);

        // Adjust pan based on movement of pinch center
        const deltaX = (currentPinchCenter.x - pinchCenter.x); // in CSS pixels
        const deltaY = (currentPinchCenter.y - pinchCenter.y); // in CSS pixels

        state.panX = newPanX + deltaX;
        state.panY = newPanY + deltaY;
        state.scale = newScale;

        lastTouchDistance = newTouchDistance;
        pinchCenter = currentPinchCenter;
        applyViewTransform();
        return;
      }

      if (panning) {
        e.preventDefault();
        // const dpr = paint.width / paint.getBoundingClientRect().width; // dpr is no longer needed here
        const dx = ('touches' in e ? e.touches[0].clientX : e.clientX) - panStart.x;
        const dy = ('touches' in e ? e.touches[0].clientY : e.clientY) - panStart.y;
        state.panX = initialPan.x + dx; // in CSS pixels
        state.panY = initialPan.y + dy; // in CSS pixels
        applyViewTransform();
        return;
      }

      if (!drawing) return;
      e.preventDefault();
      const p = canvasPos(e);
      strokeTo(p.x, p.y);
    }

    function onPointerUp() {
      lastTouchDistance = 0;
      panning = false;
      if (drawing) {
        endStroke();
      }
    }

    function handleWheel(e) {
      e.preventDefault();
      const r = base.getBoundingClientRect();
      // const dpr = paint.width / r.width; // dpr is no longer needed here
      const mouseX = (e.clientX - r.left); // in CSS pixels
      const mouseY = (e.clientY - r.top); // in CSS pixels

      const scaleAmount = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.max(0.2, Math.min(state.scale * scaleAmount, 10));

      const dx = (mouseX - state.panX) * (newScale / state.scale - 1);
      const dy = (mouseY - state.panY) * (newScale / state.scale - 1);

      state.panX -= dx;
      state.panY -= dy;
      state.scale = newScale;

      applyViewTransform();
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
  const brushes = [
    { id: 'pen', label: '펜', icon: '🖊️' }, 
    { id: 'marker', label: '마커', icon: '🖍️' }, 
    { id: 'calligraphy', label: '캘리', icon: '✒️' }, 
    { id: 'crayon', label: '크레용', icon: '✏️' }, 
    { id: 'neon', label: '네온', icon: '✨' }
  ];
  const patterns = [
    { id: 'none', label: '단색', icon: '⬜️' }, 
    { id: 'dots', label: '도트', icon: '🔵' }, 
    { id: 'stripes', label: '줄무늬', icon: '💈' }, 
    { id: 'star', label: '별', icon: '⭐' }, 
    { id: 'heart', label: '하트', icon: '❤️' }
  ];

  function buildBrushBar() {
    el.brushBar.innerHTML = '';
    brushes.forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = state.isChildMode ? b.icon : b.label;
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
      btn.textContent = state.isChildMode ? p.icon : p.label;
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
    ['toolBrush', 'toolBucket', 'toolEraser', 'toolPan'].forEach(id => {
      const toolEl = $(id);
      if (toolEl) toolEl.classList.remove('active');
    });
    const activeToolEl = $('tool' + (state.tool.charAt(0).toUpperCase() + state.tool.slice(1)));
    if (activeToolEl) activeToolEl.classList.add('active');
  }

  function applyUIMode() {
    // Toggle body class for CSS visibility rules
    document.body.classList.toggle('child-mode', state.isChildMode);

    // Update mode toggle button text
    el.modeToggleBtn.textContent = state.isChildMode ? '성인 모드' : '어린이 모드';

    // Update button text/icons for static buttons
    document.querySelectorAll('[data-adult-text]').forEach(btn => {
      if (state.isChildMode) {
        btn.textContent = btn.dataset.childIcon;
      } else {
        btn.textContent = btn.dataset.adultText;
      }
    });

    // Re-build dynamic toolbars
    buildBrushBar();
    buildPatternBar();

    // Manage color picker visibility and child color palette
    if (state.isChildMode) {
      el.color.parentElement.style.display = 'none'; // Hide adult color input row
      el.childColorPalette.style.display = 'grid'; // Show child color palette
      // Ensure current color is reflected in child palette
      updateChildColorSwatchActive();
    } else {
      el.color.parentElement.style.display = 'flex'; // Show adult color input row
      el.childColorPalette.style.display = 'none'; // Hide child color palette
    }
  }

  const childColors = [
    '#FF0000', '#FFA500', '#FFFF00', '#008000', '#0000FF', '#4B0082', '#EE82EE', // Rainbow
    '#FFC0CB', '#800000', '#00FFFF', '#FFD700', '#C0C0C0', '#000000', '#FFFFFF'  // Pastels, dark, light
  ];

  function buildChildColorPalette() {
    el.childColorPalette.innerHTML = '';
    childColors.forEach(color => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = color;
      swatch.dataset.color = color;
      swatch.onclick = () => {
        state.color = color;
        updateChildColorSwatchActive();
      };
      el.childColorPalette.appendChild(swatch);
    });
  }

  function updateChildColorSwatchActive() {
    el.childColorPalette.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.classList.toggle('active', swatch.dataset.color === state.color);
    });
  }

  function hasAnyPaint() {
    const W = paint.width, H = paint.height;
    const d = pctx.getImageData(0, 0, W, H).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 0) return true;
    }
    return false;
  }

  // ===== Event Listeners =====
  el.size.oninput = () => state.size = parseInt(el.size.value, 10) || 1;
  el.opacity.oninput = () => state.opacity = parseFloat(el.opacity.value) || 1; // NEW
  el.color.oninput = () => {
    if (!state.isChildMode) { // Only allow adult color input in adult mode
      state.color = el.color.value;
      _patternKey = '';
    }
  };
  el.modeToggleBtn.onclick = () => {
    state.isChildMode = !state.isChildMode;
    localStorage.setItem('isChildMode', state.isChildMode); // Save preference
    applyUIMode();
  };
  el.toolBrush.onclick = () => { state.tool = 'brush'; applyToolActive(); setStatus('툴: 브러시'); };
  el.toolBucket.onclick = () => { state.tool = 'bucket'; applyToolActive(); setStatus('툴: 채우기'); };
  el.toolEraser.onclick = () => { state.tool = 'eraser'; applyToolActive(); setStatus('툴: 지우개'); };
  el.toolPan.onclick = () => { state.tool = 'pan'; applyToolActive(); setStatus('툴: 이동'); };
  el.undoBtn.onclick = undo;
  el.redoBtn.onclick = redo;
  el.resetBtn.onclick = () => location.reload();

  el.prevTemplatePageBtn.onclick = () => {
    state.currentPage--;
    renderTemplateGallery();
  };

  el.nextTemplatePageBtn.onclick = () => {
    state.currentPage++;
    renderTemplateGallery();
  };

  const TEMPLATE_CATEGORIES = [
    { id: 'all', label: '모두', icon: '🌐' },
    { id: 'uncategorized', label: '미분류', icon: '❓' },
    { id: 'animals', label: '동물', icon: '🐾' },
    { id: 'nature', label: '자연', icon: '🌳' },
    { id: 'objects', label: '사물', icon: '💡' },
    { id: 'abstract', label: '추상', icon: '🌀' }
  ];

  function buildCategoryButtons() {
    el.templateCategoryButtons.innerHTML = '';
    TEMPLATE_CATEGORIES.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pbtn' + (state.currentCategory === cat.id ? ' active' : '');
      btn.textContent = cat.icon; // Child-friendly icon
      btn.title = cat.label; // Adult-friendly tooltip
      btn.dataset.categoryId = cat.id;
      btn.onclick = () => {
        state.currentCategory = cat.id;
        state.currentPage = 1; // Reset to first page when category changes
        renderTemplateGallery();
        // Update active class for category buttons
        el.templateCategoryButtons.querySelectorAll('.pbtn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        setStatus(`카테고리: ${cat.label}`);
      };
      el.templateCategoryButtons.appendChild(btn);
    });
  };

  el.zoomInBtn.onclick = () => {
    const r = base.getBoundingClientRect();
    const dpr = paint.width / r.width;
    const centerX = r.width / 2 * dpr;
    const centerY = r.height / 2 * dpr;
    const newScale = Math.min(10, state.scale * 1.2);
    const dx = (centerX - state.panX) * (newScale / state.scale - 1);
    const dy = (centerY - state.panY) * (newScale / state.scale - 1);
    state.panX -= dx;
    state.panY -= dy;
    state.scale = newScale;
    applyViewTransform();
  };
  el.zoomOutBtn.onclick = () => {
    const r = base.getBoundingClientRect();
    const dpr = paint.width / r.width;
    const centerX = r.width / 2 * dpr;
    const centerY = r.height / 2 * dpr;
    const newScale = Math.max(0.2, state.scale / 1.2);
    const dx = (centerX - state.panX) * (newScale / state.scale - 1);
    const dy = (centerY - state.panY) * (newScale / state.scale - 1);
    state.panX -= dx;
    state.panY -= dy;
    state.scale = newScale;
    applyViewTransform();
  };
  el.resetViewBtn.onclick = () => {
    state.scale = 1;
    state.panX = 0;
    state.panY = 0;
    applyViewTransform();
  };

  el.clearPaintBtn.onclick = () => { snapshot(); pctx.clearRect(0, 0, paint.width, paint.height); setStatus('채색만 지움(도안 유지)'); };
  el.wipeAllBtn.onclick = () => { if (!confirm('정말 전체 삭제(도안 포함)할까요?')) return; bctx.clearRect(0, 0, base.width, base.height); pctx.clearRect(0, 0, paint.width, paint.height); snapshot(); setStatus('전체 삭제 완료'); };
  el.saveBtn.onclick = () => { const W = base.width, H = base.height; const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; const t = tmp.getContext('2d'); t.drawImage(base, 0, 0, W, H); t.drawImage(paint, 0, 0, W, H); const url = tmp.toDataURL('image/png'); localStorage.setItem('coloring.save', url); setStatus('저장 완료'); };
  el.loadBtn.onclick = () => { const url = localStorage.getItem('coloring.save'); if (!url) { setStatus('저장본 없음'); return; } const img = new Image(); img.onload = () => { const W = base.width, H = base.height; bctx.clearRect(0, 0, W, H); pctx.clearRect(0, 0, paint.width, paint.height); bctx.drawImage(img, 0, 0, W, H); snapshot(); setStatus('불러오기 완료(합성본을 도안으로 올림)'); }; img.src = url; };
  el.downloadBtn.onclick = () => { const W = base.width; const H = base.height; const tempCanvas = document.createElement('canvas'); tempCanvas.width = W; tempCanvas.height = H; const tempCtx = tempCanvas.getContext('2d'); tempCtx.fillStyle = '#fff'; tempCtx.fillRect(0, 0, W, H); tempCtx.drawImage(base, 0, 0); tempCtx.drawImage(paint, 0, 0); const link = document.createElement('a'); link.download = 'coloring-art.png'; link.href = tempCanvas.toDataURL('image/png'); link.click(); setStatus('이미지 다운로드 시작'); };
  el.tplImportBtn.onclick = () => el.tplFile.click();
  el.tplFile.onchange = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = async () => { const img = new Image(); img.onload = async () => { const templateName = f.name.split('.').slice(0, -1).join('.') || 'untitled';
        const selectedCategory = el.tplCategory.value; // Get selected category from remote's new select
        try {
          await addTemplateToDB(templateName, r.result, selectedCategory); // Pass category
          setStatus('도안 저장 완료: ' + templateName);
          await renderTemplateGallery();
          const hadPaint = hasAnyPaint();
          const clearPaint = hadPaint ? confirm('새 도안을 불러옵니다. 현재 채색을 지울까요?\n확인=지움 / 취소=유지') : false;
          importTemplate(img, clearPaint);
          setStatus('도안 불러오기 완료' + (clearPaint ? ' (채색 삭제)' : ' (채색 유지)'));
          showView('drawingView'); // Switch to drawing view
        } catch (error) {
          console.error('Failed to save template to DB:', error);
          setStatus('도안 저장 실패');
        } }; img.src = r.result; }; r.readAsDataURL(f); };

  async function importImageFromUrl(url) {
    if (!url) {
        setStatus('URL을 입력해주세요.');
        return;
    }
    setStatus('URL에서 도안 불러오는 중...');
    try {
        const response = await fetch(url); // Reverted from proxy
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onload = async () => {
            const img = new Image();
            img.onload = async () => {
                const templateName = url.substring(url.lastIndexOf('/') + 1).split('?')[0].split('#')[0] || 'untitled_url'; // Extract name from URL, remove query/hash
                const category = el.tplCategory.value; // Use remote's new select for category
                try {
                    await addTemplateToDB(templateName, reader.result, category);
                    setStatus('도안 저장 완료: ' + templateName + ' (카테고리: ' + category + ')');
                    await renderTemplateGallery();
                    const hadPaint = hasAnyPaint();
                    const clearPaint = hadPaint ? confirm('새 도안을 불러옵니다. 현재 채색을 지울까요?\n확인=지움 / 취소=유지') : false;
                    importTemplate(img, clearPaint);
                    setStatus('도안 불러오기 완료' + (clearPaint ? ' (채색 삭제)' : ' (채색 유지)'));
                    showView('drawingView'); // Switch to drawing view
                } catch (error) {
                    console.error('Failed to save template to DB:', error);
                    setStatus('도안 저장 실패');
                }
            };
            img.onerror = () => {
                setStatus('이미지 로드 실패: 유효한 이미지 URL이 아닙니다.');
                console.error('Image load error from URL:', url);
            };
            img.src = reader.result;
        };
        reader.onerror = (error) => {
            setStatus('파일 읽기 오류');
            console.error('FileReader error:', error);
        };
        reader.readAsDataURL(blob);
    } catch (error) {
        setStatus('도안 불러오기 실패: ' + error.message);
        console.error('Failed to fetch image from URL:', error);
    }
  }

  el.urlImportBtn.onclick = () => {
    const url = el.urlInput.value.trim();
    importImageFromUrl(url);
  };
  
  el.changeTemplateBtn.onclick = () => {
    const hadPaint = hasAnyPaint();
    const clearPaint = hadPaint ? confirm('도안을 변경합니다. 현재 채색을 지울까요?\n확인=지움 / 취소=유지') : false;
    
    state.currentBaseImage = null; // Clear any custom loaded image
    state.template = el.templateSelect.value;
    
    state.scale = 1;
    state.panX = 0;
    state.panY = 0;
    applyViewTransform();
    redrawBaseCanvas(); 
    
    if (clearPaint) {
      pctx.clearRect(0, 0, paint.width, paint.height);
    }
    
    state.undo = [];
    state.redo = [];
    snapshot();

    setStatus('도안 변경: ' + state.template + (clearPaint ? ' (채색 삭제)' : ' (채색 유지)'));
    showView('drawingView'); // Switch to drawing view
  };

  async function renderTemplateGallery() { // Adopted remote's renderTemplateGallery
    console.log('renderTemplateGallery started.');
    el.templateGallery.innerHTML = '';
    try {
      const allTemplates = await getTemplatesFromDB();
      console.log('All templates fetched:', allTemplates.length);
      const filteredTemplates = state.currentCategory === 'all'
        ? allTemplates
        : allTemplates.filter(tpl => tpl.category === state.currentCategory);
      console.log('Filtered templates:', filteredTemplates.length);

      const totalPages = Math.ceil(filteredTemplates.length / TEMPLATES_PER_PAGE);
      state.currentPage = Math.max(1, Math.min(state.currentPage, totalPages || 1)); // Ensure current page is valid

      el.templatePageInfo.textContent = `${state.currentPage} / ${totalPages || 1}`;
      el.prevTemplatePageBtn.disabled = state.currentPage === 1;
      el.nextTemplatePageBtn.disabled = state.currentPage === (totalPages || 1);

      if (filteredTemplates.length === 0) {
        el.templateGallery.innerHTML = '<div style="text-align:center; padding:10px; font-size:0.9em; color:#aaa;">저장된 도안이 없습니다.</div>';
        console.log('No templates to display.');
        return;
      }

      const startIndex = (state.currentPage - 1) * TEMPLATES_PER_PAGE;
      const endIndex = startIndex + TEMPLATES_PER_PAGE;
      const templatesToDisplay = filteredTemplates.slice(startIndex, endIndex);
      console.log('Templates to display on current page:', templatesToDisplay.length);

      templatesToDisplay.forEach(tpl => {
        console.log('Rendering template:', tpl.name);
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
          e.stopPropagation();
          if (confirm(`'${tpl.name}' 도안을 삭제하시겠습니까?`)) {
            try {
              await deleteTemplateFromDB(tpl.name);
              setStatus(`'${tpl.name}' 도안 삭제 완료`);
              renderTemplateGallery();
            } catch (error) {
              console.error('Failed to delete template:', error);
              setStatus('도안 삭제 실패');
            }
          }
        };
        item.appendChild(deleteBtn);
        item.onclick = () => {
          // Open modal for large view
          showModal(tpl.data);
        };
        el.templateGallery.appendChild(item);
      });
    } catch (error) {
      console.error('Failed to load templates from DB:', error);
      setStatus('도안 불러오기 실패');
    }
  }

  // ===== Modal Functions =====
  function showModal(imageUrl) {
    console.log('showModal called with image:', imageUrl ? imageUrl.substring(0, 50) + '...' : 'null');
    el.modalImage.src = imageUrl;
    el.templateModal.style.display = 'flex'; // Use flex to show and center
  }

  function hideModal() {
    console.log('hideModal called.');
    el.templateModal.style.display = 'none';
    el.modalImage.src = ''; // Clear image source
  }


  // ===== Boot =====
  async function boot() {
    console.log('Boot function started.');
    try {
      await openColoringDB();
      console.log('IndexedDB opened.');
      setStatus('데이터베이스 준비 완료');
    } catch (error) {
      setStatus('데이터베이스 오류');
      console.error('Failed to open IndexedDB:', error);
      return;
    }

    buildBrushBar();
    buildPatternBar();
    buildChildColorPalette(); // NEW: Build child color palette
    buildCategoryButtons(); // NEW: Build category buttons
    applyToolActive();
    attachPointer();
    window.addEventListener('resize', resizeCanvases);

    // Attach navigation button listeners
    el.navGalleryBtn.onclick = () => showView('galleryView');
    el.navDrawingBtn.onclick = () => showView('drawingView');
    el.navSettingsBtn.onclick = () => showView('settingsView');

    // Sidebar toggle logic
    const drawingView = document.getElementById('drawingView');
    if (el.sidebarToggleBtn && drawingView) {
      el.sidebarToggleBtn.onclick = () => {
        drawingView.classList.toggle('sidebar-collapsed');
        // Wait for the CSS transition to finish before resizing the canvas
        setTimeout(() => {
          resizeCanvases();
        }, 300); // Should match the transition duration in CSS
      };
    }

    resizeCanvases();

    // Load child mode preference
    const savedChildMode = localStorage.getItem('isChildMode');
    if (savedChildMode !== null) {
      state.isChildMode = savedChildMode === 'true';
    }
    applyUIMode(); // NEW: Apply UI mode on initial load

    // Modal event listeners
    el.closeButton.onclick = hideModal;
    window.onclick = (event) => {
      if (event.target === el.templateModal) {
        hideModal();
      }
    };
    window.onkeydown = (event) => {
      if (event.key === 'Escape') {
        hideModal();
      }
    };

    // NEW: Load button in modal
    el.loadTemplateFromModalBtn.onclick = () => {
      const imageUrl = el.modalImage.src;
      if (imageUrl) {
        const imgToLoad = new Image();
        imgToLoad.onload = () => {
          const hadPaint = hasAnyPaint();
          const clearPaint = hadPaint ? confirm('새 도안을 불러옵니다. 현재 채색을 지울까요?\n확인=지움 / 취소=유지') : false;
          importTemplate(imgToLoad, clearPaint);
          setStatus('도안 불러오기 완료' + (clearPaint ? ' (채색 삭제)' : ' (채색 유지)'));
          hideModal(); // Hide modal after loading
          showView('drawingView'); // Switch to drawing view
        };
        imgToLoad.src = imageUrl;
      }
    };

    await renderTemplateGallery();

    // Removed el.categoryFilter.onchange as it's replaced by buildCategoryButtons
    // el.categoryFilter.onchange = () => {
    //   renderTemplateGallery(el.categoryFilter.value);
    // };

    // Show the initial view
    showView(state.currentView);

    setStatus('준비완료');
  }

  boot();

})();