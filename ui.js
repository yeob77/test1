import { openColoringDB, addTemplateToDB, getTemplatesFromDB, deleteTemplateFromDB } from './db.js';
import { initCanvas, resizeCanvases, undo, redo, applyViewTransform, importTemplate, bucketFill, beginStroke, endStroke, strokeTo, canvasPos, getTouchDistance, getTouchCenter, redrawBaseCanvas } from './canvas.js';

const TEMPLATES_PER_PAGE = 12; // Number of templates to display per page

const $ = id => document.getElementById(id);

const ids = [
  // Gallery View
  'tplFile', 'tplImportBtn', 'urlInput', 'urlImportBtn',
  'tplCategory', 'prevTemplatePageBtn', 'nextTemplatePageBtn', 'templatePageInfo',
  'templateCategoryButtons', 'templateGallery', 'saveBtn', 'loadBtn', 'downloadBtn',
  'resetBtn',

  // Drawing View
  'toolBrush', 'toolBucket', 'toolEraser', 'toolPan', 'size', 'color', 'opacity', 'brushBar',
  'patternBar', 'bucketPattern', 'childColorPalette', 'undoBtn', 'redoBtn',
  'sidebarToggleBtn', 'clearPaintBtn', 'wipeAllBtn',

  // Settings View
  'modeToggleBtn', 'zoomInBtn', 'zoomOutBtn', 'resetViewBtn',

  // Global
  'status', 'base', 'paint', 'templateModal', 'modalImage', 'closeButton', 'loadTemplateFromModalBtn',
  'navGalleryBtn', 'navDrawingBtn', 'navSettingsBtn',
  'toast-container', 'loading-overlay'
];
export const el = {};
ids.forEach(i => el[i] = $(i));

export const state = {
  tool: 'brush',
  size: parseInt(el.size.value, 10),
  color: el.color.value,
  opacity: 1,
  brush: 'pen',
  pattern: 'none',
  bucketPattern: true,
  currentBaseImage: null,
  scale: 1,
  panX: 0,
  panY: 0,
  undo: [],
  redo: [],
  maxUndo: 25,
  isChildMode: false,
  currentPage: 1,
  currentCategory: 'all',
  currentView: 'galleryView'
};

let _patternKey = '';

function setStatus(t) {
  el.status.textContent = '상태: ' + t;
}

export function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast-message ${type}`;
  toast.textContent = message;
  el['toast-container'].appendChild(toast);
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 3000);
}

export function showLoading() {
  el['loading-overlay'].classList.add('show');
}

export function hideLoading() {
  el['loading-overlay'].classList.remove('show');
}

function showView(viewId) {
  const views = document.querySelectorAll('.view');
  views.forEach(view => {
    view.classList.remove('active');
  });
  document.getElementById(viewId).classList.add('active');
  state.currentView = viewId;

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  if (viewId === 'galleryView') {
    el.navGalleryBtn.classList.add('active');
  } else if (viewId === 'drawingView') {
    el.navDrawingBtn.classList.add('active');
    setTimeout(() => {
      resizeCanvases();
    }, 10);
  } else if (viewId === 'settingsView') {
    el.navSettingsBtn.classList.add('active');
  }
}

function attachPointer() {
  let panning = false;
  let drawing = false;
  let panStart = { x: 0, y: 0 };
  let initialPan = { x: 0, y: 0 };
  let lastTouchDistance = 0;
  let pinchCenter = { x: 0, y: 0 };

  function onPointerDown(e) {
    if (e.touches && e.touches.length === 2) {
      e.preventDefault();
      const r = el.base.getBoundingClientRect();
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
      drawing = true;
      beginStroke(p.x, p.y);
    }
  }

  function onPointerMove(e) {
    if (e.touches && e.touches.length === 2) {
      e.preventDefault();
      const r = el.base.getBoundingClientRect();
      const newTouchDistance = getTouchDistance(e.touches);
      const scaleFactor = newTouchDistance / lastTouchDistance;
      const newScale = Math.max(0.2, Math.min(state.scale * scaleFactor, 10));
      
      const currentPinchCenter = getTouchCenter(e.touches, r);
      const pcX = currentPinchCenter.x;
      const pcY = currentPinchCenter.y;

      const newPanX = pcX * (1 - newScale / state.scale) + state.panX * (newScale / state.scale);
      const newPanY = pcY * (1 - newScale / state.scale) + state.panY * (newScale / state.scale);

      const deltaX = (currentPinchCenter.x - pinchCenter.x);
      const deltaY = (currentPinchCenter.y - pinchCenter.y);

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
      const dx = ('touches' in e ? e.touches[0].clientX : e.clientX) - panStart.x;
      const dy = ('touches' in e ? e.touches[0].clientY : e.clientY) - panStart.y;
      state.panX = initialPan.x + dx;
      state.panY = initialPan.y + dy;
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
      drawing = false;
      endStroke();
    }
  }

  function handleWheel(e) {
    e.preventDefault();
    const r = el.base.getBoundingClientRect();
    const mouseX = (e.clientX - r.left);
    const mouseY = (e.clientY - r.top);

    const scaleAmount = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.2, Math.min(state.scale * scaleAmount, 10));

    const dx = (mouseX - state.panX) * (newScale / state.scale - 1);
    const dy = (mouseY - state.panY) * (newScale / state.scale - 1);

    state.panX -= dx;
    state.panY -= dy;
    state.scale = newScale;

    applyViewTransform();
  }

  el.paint.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
  el.paint.addEventListener('touchstart', onPointerDown, { passive: false });
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp, { passive: false });
  el.paint.addEventListener('wheel', handleWheel, { passive: false });
}

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
  { id: 'heart', label: '하트', icon: '❤️' },
  { id: 'glitter', label: '반짝이', icon: '✨' }
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
      showToast('브러시: ' + b.label);
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
      showToast('패턴: ' + p.label);
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
  document.body.classList.toggle('child-mode', state.isChildMode);
  el.modeToggleBtn.textContent = state.isChildMode ? '성인 모드' : '어린이 모드';
  document.querySelectorAll('[data-adult-text]').forEach(btn => {
    if (state.isChildMode) {
      btn.textContent = btn.dataset.childIcon;
    } else {
      btn.textContent = btn.dataset.adultText;
    }
  });
  buildBrushBar();
  buildPatternBar();
  if (state.isChildMode) {
    el.color.parentElement.style.display = 'none';
    el.childColorPalette.style.display = 'grid';
    updateChildColorSwatchActive();
  } else {
    el.color.parentElement.style.display = 'flex';
    el.childColorPalette.style.display = 'none';
  }
}

const childColors = [
  '#FF0000', '#FFA500', '#FFFF00', '#008000', '#0000FF', '#4B0082', '#EE82EE',
  '#FFC0CB', '#800000', '#00FFFF', '#FFD700', '#C0C0C0', '#000000', '#FFFFFF'
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
  const W = el.paint.width, H = el.paint.height;
  const pctx = el.paint.getContext('2d', { willReadFrequently: true });
  const d = pctx.getImageData(0, 0, W, H).data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] > 0) return true;
  }
  return false;
}

el.size.oninput = () => state.size = parseInt(el.size.value, 10) || 1;
el.opacity.oninput = () => state.opacity = Math.sqrt(parseFloat(el.opacity.value) / 100);
el.color.oninput = () => {
  if (!state.isChildMode) {
    state.color = el.color.value;
    _patternKey = '';
  }
};
el.modeToggleBtn.onclick = () => {
  state.isChildMode = !state.isChildMode;
  localStorage.setItem('isChildMode', state.isChildMode);
  applyUIMode();
};
el.toolBrush.onclick = () => { state.tool = 'brush'; applyToolActive(); showToast('툴: 브러시'); };
el.toolBucket.onclick = () => { state.tool = 'bucket'; applyToolActive(); showToast('툴: 채우기'); };
el.toolEraser.onclick = () => {
  state.tool = 'eraser';
  applyToolActive();
  showToast('툴: 지우개');
  const pctx = el.paint.getContext('2d', { willReadFrequently: true });
  pctx.globalAlpha = 1;
};
el.toolPan.onclick = () => { state.tool = 'pan'; applyToolActive(); showToast('툴: 이동'); };
el.undoBtn.onclick = undo;
el.redoBtn.onclick = redo;

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
    btn.textContent = cat.icon;
    btn.title = cat.label;
    btn.dataset.categoryId = cat.id;
    btn.onclick = () => {
      state.currentCategory = cat.id;
      state.currentPage = 1;
      renderTemplateGallery();
      el.templateCategoryButtons.querySelectorAll('.pbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showToast(`카테고리: ${cat.label}`);
    };
    el.templateCategoryButtons.appendChild(btn);
  });
};

el.zoomInBtn.onclick = () => {
  const r = el.base.getBoundingClientRect();
  const dpr = el.paint.width / r.width;
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
  const r = el.base.getBoundingClientRect();
  const dpr = el.paint.width / r.width;
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

el.clearPaintBtn.onclick = () => { 
  const pctx = el.paint.getContext('2d', { willReadFrequently: true });
  pctx.clearRect(0, 0, el.paint.width, el.paint.height); 
  showToast('채색만 지움(도안 유지)'); 
};
el.wipeAllBtn.onclick = () => { 
  if (!confirm('정말 전체 삭제(도안 포함)할까요?')) return; 
  const bctx = el.base.getContext('2d', { willReadFrequently: true });
  const pctx = el.paint.getContext('2d', { willReadFrequently: true });
  bctx.clearRect(0, 0, el.base.width, el.base.height); 
  pctx.clearRect(0, 0, el.paint.width, el.paint.height); 
  showToast('전체 삭제 완료'); 
};
el.saveBtn.onclick = () => { 
  const W = el.base.width, H = el.base.height; 
  const tmp = document.createElement('canvas'); 
  tmp.width = W; tmp.height = H; 
  const t = tmp.getContext('2d'); 
  t.drawImage(el.base, 0, 0, W, H); 
  t.drawImage(el.paint, 0, 0, W, H); 
  const url = tmp.toDataURL('image/png'); 
  localStorage.setItem('coloring.save', url); 
  showToast('저장 완료'); 
};
el.loadBtn.onclick = () => { 
  const url = localStorage.getItem('coloring.save'); 
  if (!url) { showToast('저장본 없음', 'info'); return; } 
  const img = new Image(); 
  img.onload = () => {
    const W = el.base.width, H = el.base.height;
    const bctx = el.base.getContext('2d', { willReadFrequently: true });
    const pctx = el.paint.getContext('2d', { willReadFrequently: true });
    bctx.clearRect(0, 0, W, H); 
    pctx.clearRect(0, 0, el.paint.width, el.paint.height); 
    bctx.drawImage(img, 0, 0, W, H);
  bctx.drawImage(img, 0, 0, W, H);
    showToast('불러오기 완료(합성본을 도안으로 올림)');
  };
  img.src = url;
};
el.downloadBtn.onclick = () => { 
  const W = el.base.width; 
  const H = el.base.height; 
  const tempCanvas = document.createElement('canvas'); 
  tempCanvas.width = W; tempCanvas.height = H; 
  const tempCtx = tempCanvas.getContext('2d'); 
  tempCtx.fillStyle = '#fff'; 
  tempCtx.fillRect(0, 0, W, H); 
  tempCtx.drawImage(el.base, 0, 0); 
  tempCtx.drawImage(el.paint, 0, 0); 
  const link = document.createElement('a'); 
  link.download = 'coloring-art.png'; 
  link.href = tempCanvas.toDataURL('image/png'); 
  link.click(); 
  showToast('이미지 다운로드 시작'); 
};
el.tplImportBtn.onclick = () => el.tplFile.click();
el.tplFile.onchange = (e) => { 
  const f = e.target.files && e.target.files[0]; 
  if (!f) return; 
  const r = new FileReader(); 
  r.onload = async () => { 
    const img = new Image(); 
    img.onload = async () => { 
      const templateName = f.name.split('.').slice(0, -1).join('.') || 'untitled';
      const selectedCategory = el.tplCategory.value;
      try {
        await addTemplateToDB(templateName, r.result, selectedCategory);
        showToast('도안 저장 완료: ' + templateName);
        await renderTemplateGallery();
        const hadPaint = hasAnyPaint();
        const clearPaint = hadPaint ? confirm('새 도안을 불러옵니다. 현재 채색을 지울까요?\n확인=지움 / 취소=유지') : false;
        importTemplate(img, clearPaint);
        showToast('도안 불러오기 완료' + (clearPaint ? ' (채색 삭제)' : ' (채색 유지)'));
        showView('drawingView');
      } catch (error) {
        console.error('Failed to save template to DB:', error);
        showToast('도안 저장 실패', 'error');
      } 
    };
    img.src = r.result; 
  };
  r.readAsDataURL(f); 
};

async function importImageFromUrl(url) {
  if (!url) {
    showToast('URL을 입력해주세요.', 'warning');
    return;
  }
  showToast('URL에서 도안 불러오는 중...', 'info');
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    const reader = new FileReader();
    reader.onload = async () => {
      const img = new Image();
      img.onload = async () => {
        const templateName = url.substring(url.lastIndexOf('/') + 1).split('?')[0].split('#')[0] || 'untitled_url';
        const category = el.tplCategory.value;
        try {
          await addTemplateToDB(templateName, reader.result, category);
          showToast('도안 저장 완료: ' + templateName + ' (카테고리: ' + category + ')');
          await renderTemplateGallery();
          const hadPaint = hasAnyPaint();
          const clearPaint = hadPaint ? confirm('새 도안을 불러옵니다. 현재 채색을 지울까요?\n확인=지움 / 취소=유지') : false;
          importTemplate(img, clearPaint);
          showToast('도안 불러오기 완료' + (clearPaint ? ' (채색 삭제)' : ' (채색 유지)'));
          showView('drawingView');
        } catch (error) {
          console.error('Failed to save template to DB:', error);
          showToast('도안 저장 실패', 'error');
        }
      };
      img.onerror = () => {
        showToast('이미지 로드 실패: 유효한 이미지 URL이 아닙니다.', 'error');
        console.error('Image load error from URL:', url);
      };
      img.src = reader.result;
    };
    reader.onerror = (error) => {
      showToast('파일 읽기 오류', 'error');
      console.error('FileReader error:', error);
    };
    reader.readAsDataURL(blob);
  }
  catch (error) {
    showToast('도안 불러오기 실패: ' + error.message, 'error');
    console.error('Failed to fetch image from URL:', error);
  }
}

el.urlImportBtn.onclick = () => {
  const url = el.urlInput.value.trim();
  importImageFromUrl(url);
};



async function renderTemplateGallery() {
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
    state.currentPage = Math.max(1, Math.min(state.currentPage, totalPages || 1));

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
            showToast(`'${tpl.name}' 도안 삭제 완료`);
            renderTemplateGallery();
          } catch (error) {
            console.error('Failed to delete template:', error);
            showToast('도안 삭제 실패', 'error');
          }
        }
      };
      item.appendChild(deleteBtn);
      item.onclick = () => {
        showModal(tpl.data);
      };
      el.templateGallery.appendChild(item);
    });
  } catch (error) {
    console.error('Failed to load templates from DB:', error);
    showToast('도안 불러오기 실패', 'error');
  }
}

function showModal(imageUrl) {
  console.log('showModal called with image:', imageUrl ? imageUrl.substring(0, 50) + '...' : 'null');
  el.modalImage.src = imageUrl;
  el.templateModal.style.display = 'flex';
}

function hideModal() {
  console.log('hideModal called.');
  el.templateModal.style.display = 'none';
  el.modalImage.src = '';
}

async function boot() {
  console.log('Boot function started.');
  initCanvas();
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
  buildChildColorPalette();
  buildCategoryButtons();
  applyToolActive();
  attachPointer();
  window.addEventListener('resize', resizeCanvases);

  el.navGalleryBtn.onclick = () => showView('galleryView');
  el.navDrawingBtn.onclick = () => showView('drawingView');
  el.navSettingsBtn.onclick = () => showView('settingsView');

  const drawingView = document.getElementById('drawingView');
  if (el.sidebarToggleBtn && drawingView) {
    el.sidebarToggleBtn.onclick = () => {
      drawingView.classList.toggle('sidebar-collapsed');
      setTimeout(() => {
        resizeCanvases();
      }, 300);
    };
  }

  resizeCanvases();

  const savedChildMode = localStorage.getItem('isChildMode');
  if (savedChildMode !== null) {
    state.isChildMode = savedChildMode === 'true';
  }
  applyUIMode();

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

  el.loadTemplateFromModalBtn.onclick = () => {
    const imageUrl = el.modalImage.src;
    if (imageUrl) {
      const imgToLoad = new Image();
      imgToLoad.onload = () => {
        // Simplified content for debugging
        showToast('도안 불러오기 시작');
        hideModal();
        showView('drawingView');
      };
      imgToLoad.src = imageUrl;
    }
  };

  await renderTemplateGallery();

  showView(state.currentView);

  setStatus('준비완료');
}

boot();