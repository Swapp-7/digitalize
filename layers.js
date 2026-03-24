/* ============================================================
   DIGITALIZE — layers.js
   Pipeline only: makeLayer factory, runLayerStack, flatten,
   updateThumbnail, invalidateLayer.
   State ownership has moved to store.js.
   ============================================================ */

'use strict';

// ── Layer factory ─────────────────────────────────────────
// Called by the store reducer. id is provided explicitly.

function makeLayer(imageData, id, name) {
  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width  = imageData.width;
  offscreenCanvas.height = imageData.height;
  return {
    id,
    name:      name || id,
    visible:   true,
    opacity:   1.0,
    blendMode: 'source-over',
    locked:    false,
    imageData,
    x: 0, y: 0,
    width:  imageData.width,
    height: imageData.height,
    modifiers:      [],
    offscreenCanvas,
    _thumbCanvas:   null,
    fabricObjectId: null,
  };
}

// ── Thumbnail ─────────────────────────────────────────────

function updateThumbnail(layer) {
  const t = layer._thumbCanvas || (layer._thumbCanvas = document.createElement('canvas'));
  t.width  = 60;
  t.height = 60;
  t.getContext('2d').drawImage(layer.offscreenCanvas, 0, 0, 60, 60);
}

// ── Filter pipeline ───────────────────────────────────────
// Reads layer.imageData + layer.modifiers, writes to layer.offscreenCanvas.

function runLayerStack(layer) {
  const ctx = layer.offscreenCanvas.getContext('2d', { willReadFrequently: true });
  ctx.putImageData(layer.imageData, 0, 0);
  for (const item of layer.modifiers) {
    const def = window.FilterDefs?.[item.filterId];
    if (!def) continue;
    try {
      def.apply(layer.offscreenCanvas, ctx, { ...item.values });
    } catch (err) {
      console.error(`[runLayerStack] Filter "${item.filterId}" (${item.id}) failed:`, err);
    }
  }
}

// ── Composition ───────────────────────────────────────────
// layers array is passed explicitly — no internal state.

function flatten(displayCanvas, displayCtx, layers) {
  const W = displayCanvas.width;
  const H = displayCanvas.height;
  displayCtx.clearRect(0, 0, W, H);
  for (const layer of layers) {
    if (!layer.visible || !layer.imageData) continue;
    displayCtx.save();
    displayCtx.globalAlpha            = layer.opacity;
    displayCtx.globalCompositeOperation = layer.blendMode;
    displayCtx.drawImage(layer.offscreenCanvas, layer.x, layer.y);
    displayCtx.restore();
  }
}

// ── Invalidate helper ─────────────────────────────────────

function invalidateLayer(layer, displayCanvas, displayCtx, layers) {
  runLayerStack(layer);
  updateThumbnail(layer);
  flatten(displayCanvas, displayCtx, layers);
}

// ── Public API ────────────────────────────────────────────

window.LayerEngine = { makeLayer, runLayerStack, updateThumbnail, flatten, invalidateLayer };
