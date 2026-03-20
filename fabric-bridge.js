/* ============================================================
   DIGITALIZE — fabric-bridge.js
   Checkpoint B stub: vanilla canvas composition.
   Fabric.js integration comes in Checkpoint C.

   Responsibilities:
   - Own the display canvas
   - Run filter pipelines (only for layers that changed)
   - Flatten all layers to display canvas
   - Expose exportDataURL()
   - invalidateLayer() for reroll (no state change needed)
   ============================================================ */

'use strict';

let _canvas = null;
let _ctx    = null;

// ── Init ──────────────────────────────────────────────────

function init(canvasEl) {
  _canvas = canvasEl;
  _ctx    = canvasEl.getContext('2d', { willReadFrequently: true });
}

// ── Sync ──────────────────────────────────────────────────
// Called by the store subscriber on every state change.
// prevState allows skipping pipeline re-runs when nothing changed.

function sync(state, prevState) {
  if (!_canvas || state.layers.length === 0) return;

  // Resize display canvas to match base layer
  const base = state.layers[0];
  if (_canvas.width !== base.width || _canvas.height !== base.height) {
    _canvas.width  = base.width;
    _canvas.height = base.height;
  }

  // Re-run pipeline only for layers whose modifiers or imageData changed
  for (const layer of state.layers) {
    const prev = prevState?.layers.find(l => l.id === layer.id);
    if (!prev || prev.modifiers !== layer.modifiers || prev.imageData !== layer.imageData) {
      LayerEngine.runLayerStack(layer);
      LayerEngine.updateThumbnail(layer);
    }
  }

  LayerEngine.flatten(_canvas, _ctx, state.layers);
}

// ── Invalidate (reroll) ───────────────────────────────────
// Re-runs a single layer's pipeline without dispatching an action.
// Used by randomized filters (glitch reroll) where the desired
// behavior is a fresh random result, not a state change.

function invalidateLayer(layerId) {
  const state = Store.getState();
  const layer = state.layers.find(l => l.id === layerId);
  if (!layer || !_canvas) return;

  LayerEngine.runLayerStack(layer);
  LayerEngine.updateThumbnail(layer);
  LayerEngine.flatten(_canvas, _ctx, state.layers);

  // Push updated thumbnail into the DOM without a full panel rebuild
  _syncThumbnailInDOM(layer);
}

function _syncThumbnailInDOM(layer) {
  if (!layer._thumbCanvas) return;
  const row = document.querySelector(`.layer-row[data-id="${layer.id}"]`);
  if (!row) return;
  const tc = row.querySelector('.layer-row__thumb');
  if (!tc) return;
  tc.getContext('2d').clearRect(0, 0, 60, 60);
  tc.getContext('2d').drawImage(layer._thumbCanvas, 0, 0);
}

// ── Export ────────────────────────────────────────────────

function exportDataURL() {
  return _canvas?.toDataURL('image/png') ?? '';
}

window.FabricBridge = { init, sync, invalidateLayer, exportDataURL };
