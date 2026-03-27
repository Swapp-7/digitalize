/* ============================================================
   DIGITALIZE — main.js
   Event wiring. All state goes through Store.dispatch().
   ============================================================ */

'use strict';

// ── Init ──────────────────────────────────────────────────

// Restore persisted state, then boot
Store.restore().then(() => {
  FabricBridge.init();

  // Store → render (FabricBridge sync first, then UI)
  Store.subscribe((state, prevState) => {
    FabricBridge.sync(state, prevState);
    UI.render(state, prevState);
  });

  // Initial render
  UI.render(Store.getState(), null);
});

// ── File loading ──────────────────────────────────────────

function loadFileToLibrary(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const imageData = canvas.getContext('2d').getImageData(0, 0, img.naturalWidth, img.naturalHeight);
    canvas.width = 0;
    const name = file.name.replace(/\.[^/.]+$/, '');
    Store.dispatch({ type: 'ADD_LIBRARY_IMAGE', imageData, name });
    URL.revokeObjectURL(url);
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

// ── File input ────────────────────────────────────────────

const fileInput = document.getElementById('file-input');
fileInput.addEventListener('change', () => {
  Array.from(fileInput.files).forEach(loadFileToLibrary);
  fileInput.value = '';
});

// ── Drag from library onto canvas ─────────────────────────

const canvasScrollArea = document.getElementById('canvas-scroll-area');

canvasScrollArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

canvasScrollArea.addEventListener('drop', (e) => {
  e.preventDefault();
  const libraryImageId = e.dataTransfer.getData('text/plain');
  if (!libraryImageId) return;

  // Calculate drop position in canvas logical coordinates
  const containerEl = FabricBridge.getContainerEl();
  if (containerEl) {
    const rect = containerEl.getBoundingClientRect();
    const zoom = Store.getState().zoom;
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top)  / zoom;
    Store.dispatch({ type: 'ADD_ELEMENT', libraryImageId, x, y });
  } else {
    Store.dispatch({ type: 'ADD_ELEMENT', libraryImageId });
  }
});

// ── Paste ─────────────────────────────────────────────────

document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) { loadFileToLibrary(new File([file], 'Pasted Image.png', { type: file.type })); }
      break;
    }
  }
});

// ── Keyboard shortcuts ────────────────────────────────────

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const { activeElementId } = Store.getState();
    if (activeElementId) Store.dispatch({ type: 'REMOVE_ELEMENT', id: activeElementId });
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    Store.undo();
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    e.preventDefault();
    const { activeElementId } = Store.getState();
    if (activeElementId) Store.dispatch({ type: 'DUPLICATE_ELEMENT', sourceId: activeElementId });
  }

  if (e.key === '[') {
    const { activeElementId } = Store.getState();
    if (activeElementId) Store.dispatch({ type: 'MOVE_ELEMENT', id: activeElementId, direction: 'down' });
  }
  if (e.key === ']') {
    const { activeElementId } = Store.getState();
    if (activeElementId) Store.dispatch({ type: 'MOVE_ELEMENT', id: activeElementId, direction: 'up' });
  }

  if (e.key === 'Escape') {
    Store.dispatch({ type: 'SET_ACTIVE_ELEMENT', id: null });
  }
});

// ── Slider fill helper ────────────────────────────────────

function updateSliderFill(input) {
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 100;
  const pct = ((parseFloat(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--pct', pct + '%');
}

document.addEventListener('input', (e) => {
  if (e.target.type === 'range') updateSliderFill(e.target);
});

window.App = { updateSliderFill };
