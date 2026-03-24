/* ============================================================
   DIGITALIZE — main.js
   Event wiring only. All state changes go through Store.dispatch().
   ============================================================ */

'use strict';

// ── DOM refs ──────────────────────────────────────────────
const canvas     = document.getElementById('main-canvas');
const dropZone   = document.getElementById('drop-zone');
const dropHint   = document.getElementById('drop-hint');
const fileInput  = document.getElementById('file-input');
const btnOpen    = document.getElementById('btn-open');
const btnUndo    = document.getElementById('btn-undo');
const btnExport  = document.getElementById('btn-export');
const canvasInfo = document.getElementById('canvas-info');

// ── FabricBridge owns the display canvas ──────────────────
FabricBridge.init(canvas);

// ── Image loading ─────────────────────────────────────────

function loadImageOntoCanvas(img) {
  const maxW  = dropZone.clientWidth  - 32;
  const maxH  = dropZone.clientHeight - 32;
  const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
  const w     = Math.round(img.naturalWidth  * scale);
  const h     = Math.round(img.naturalHeight * scale);

  const scratch = document.createElement('canvas');
  scratch.width = w; scratch.height = h;
  scratch.getContext('2d').drawImage(img, 0, 0, w, h);
  const imageData = scratch.getContext('2d').getImageData(0, 0, w, h);
  scratch.width = 0; // free GPU memory

  Store.dispatch({ type: 'LOAD_IMAGE', imageData, name: 'LAYER 1' });

  dropHint.classList.add('hidden');
  canvas.style.display = 'block';
  btnUndo.disabled     = false;
  btnExport.disabled   = false;
  updateInfoBar(img.naturalWidth, img.naturalHeight, w, h);
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload  = () => { loadImageOntoCanvas(img); URL.revokeObjectURL(url); };
  img.onerror = () => { console.error('Failed to load:', file.name); URL.revokeObjectURL(url); };
  img.src = url;
}

// ── Undo ──────────────────────────────────────────────────

function undoToOriginal() {
  Store.undo();
}

// ── Export ────────────────────────────────────────────────

function exportPNG() {
  if (!Store.getState().layers.length) return;
  const a = document.createElement('a');
  a.download = 'digitalize_export.png';
  a.href     = FabricBridge.exportDataURL();
  a.click();
}

// ── Info bar ──────────────────────────────────────────────

function updateInfoBar(nw, nh, dw, dh) {
  canvasInfo.innerHTML =
    `<span>ORIGINAL</span> ${nw} × ${nh}px&nbsp;&nbsp;<span>DISPLAY</span> ${dw} × ${dh}px`;
}

// ── Drag & Drop ───────────────────────────────────────────

dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  loadFile(e.dataTransfer.files[0]);
});

// ── File picker ───────────────────────────────────────────

btnOpen.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { loadFile(fileInput.files[0]); fileInput.value = ''; });

// ── Action buttons ────────────────────────────────────────

btnUndo.addEventListener('click', undoToOriginal);
btnExport.addEventListener('click', exportPNG);

// ── Paste ─────────────────────────────────────────────────

document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) { loadFile(item.getAsFile()); break; }
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

// ── Init ──────────────────────────────────────────────────

canvas.style.display = 'none';

window.App = {
  canvas,
  updateSliderFill,
  hasImage: () => Store.getState().layers.length > 0,
};
