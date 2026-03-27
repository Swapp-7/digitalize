/* ============================================================
   DIGITALIZE — fabric-bridge.js
   Fabric.js canvas owner. Subscribes to store via sync().
   ============================================================ */

'use strict';

let _fc           = null;
let _currentState = null;

// elementId → fabric.Image
const _objectMap = new Map();
// elementId → HTMLCanvasElement (offscreen, holds filtered pixels)
const _canvasMap = new Map();

// ── Init ──────────────────────────────────────────────────

function init() {
  const initialState = Store.getState();
  _fc = new fabric.Canvas('main-canvas', {
    backgroundColor: initialState.backgroundColor,
    width:           initialState.canvasWidth,
    height:          initialState.canvasHeight,
    preserveObjectStacking: true,
  });
  _currentState = initialState;

  // Fabric events → store
  _fc.on('object:modified', ({ target }) => {
    if (!target?.data?.elementId) return;
    Store.dispatch({
      type:    'UPDATE_ELEMENT_TRANSFORM',
      id:      target.data.elementId,
      x:       target.left,
      y:       target.top,
      scaleX:  target.scaleX,
      scaleY:  target.scaleY,
      angle:   target.angle,
    });
  });

  _fc.on('selection:created', ({ selected }) => {
    const id = selected?.[0]?.data?.elementId;
    if (id) Store.dispatch({ type: 'SET_ACTIVE_ELEMENT', id });
  });

  _fc.on('selection:updated', ({ selected }) => {
    const id = selected?.[0]?.data?.elementId;
    if (id) Store.dispatch({ type: 'SET_ACTIVE_ELEMENT', id });
  });

  _fc.on('selection:cleared', () => {
    Store.dispatch({ type: 'SET_ACTIVE_ELEMENT', id: null });
  });

  // Grid overlay drawn after every render
  _fc.on('after:render', _drawGrid);

  // Grid snapping on move
  _fc.on('object:moving', ({ target }) => {
    if (!_currentState?.showGrid) return;
    const snap = 40;
    target.set({
      left: Math.round(target.left / snap) * snap,
      top:  Math.round(target.top  / snap) * snap,
    });
  });
}

// ── Grid ──────────────────────────────────────────────────

function _drawGrid() {
  if (!_currentState?.showGrid) return;
  const ctx  = _fc.getContext();
  const zoom = _currentState.zoom;
  const W    = _currentState.canvasWidth  * zoom;
  const H    = _currentState.canvasHeight * zoom;
  const step = 40 * zoom;
  ctx.save();
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  for (let x = step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.restore();
}

// ── Sync ──────────────────────────────────────────────────

function sync(state, prevState) {
  if (!_fc) return;
  _currentState = state;

  let needsRender = false;

  // 1. Canvas physical size (= logical size × zoom)
  const physW = state.canvasWidth  * state.zoom;
  const physH = state.canvasHeight * state.zoom;
  if (_fc.getWidth() !== physW || _fc.getHeight() !== physH) {
    _fc.setWidth(physW);
    _fc.setHeight(physH);
    needsRender = true;
  }

  // 2. Zoom level
  if (state.zoom !== prevState?.zoom) {
    _fc.setZoom(state.zoom);
    needsRender = true;
  }

  // 3. Background color
  if (state.backgroundColor !== prevState?.backgroundColor) {
    _fc.setBackgroundColor(state.backgroundColor, () => _fc.requestRenderAll());
  }

  // 4. Grid toggle
  if (state.showGrid !== prevState?.showGrid) needsRender = true;

  // 5. Remove elements that no longer exist
  const stateIds = new Set(state.elements.map(e => e.id));
  for (const id of [..._objectMap.keys()]) {
    if (!stateIds.has(id)) {
      _fc.remove(_objectMap.get(id));
      _objectMap.delete(id);
      _canvasMap.delete(id);
      needsRender = true;
    }
  }

  // 6. Add new / update existing elements
  for (const elem of state.elements) {
    const prevElem = prevState?.elements.find(e => e.id === elem.id);
    const libImg   = state.library.find(l => l.id === elem.libraryImageId);
    if (!libImg) continue;

    if (!_objectMap.has(elem.id)) {
      // New element — create offscreen canvas, run pipeline, create fabric object
      const oc = document.createElement('canvas');
      oc.width  = libImg.imageData.width;
      oc.height = libImg.imageData.height;
      _canvasMap.set(elem.id, oc);

      LayerEngine.runLayerStack({ imageData: libImg.imageData, offscreenCanvas: oc, modifiers: elem.modifiers });
      _dispatchThumb(oc, elem.libraryImageId);

      const fabricImg = new fabric.Image(oc, {
        originX:      'center',
        originY:      'center',
        left:         elem.x,
        top:          elem.y,
        scaleX:       elem.scaleX,
        scaleY:       elem.scaleY,
        angle:        elem.angle,
        opacity:      elem.opacity,
        visible:      elem.visible,
        selectable:   !elem.locked,
        evented:      !elem.locked,
        objectCaching: false,
        data:         { elementId: elem.id },
      });
      _objectMap.set(elem.id, fabricImg);
      _fc.add(fabricImg);
      needsRender = true;

    } else {
      const fabricImg = _objectMap.get(elem.id);
      let changed = false;

      // Re-run filter pipeline if modifiers changed
      if (!prevElem || prevElem.modifiers !== elem.modifiers) {
        const oc = _canvasMap.get(elem.id);
        LayerEngine.runLayerStack({ imageData: libImg.imageData, offscreenCanvas: oc, modifiers: elem.modifiers });
        _dispatchThumb(oc, elem.libraryImageId);
        // fabricImg references the same oc canvas — just mark dirty
        fabricImg.dirty = true;
        changed = true;
      }

      // Sync transform only if values differ from what Fabric currently has
      if (fabricImg.left !== elem.x || fabricImg.top !== elem.y ||
          fabricImg.scaleX !== elem.scaleX || fabricImg.scaleY !== elem.scaleY ||
          fabricImg.angle  !== elem.angle) {
        fabricImg.set({ left: elem.x, top: elem.y, scaleX: elem.scaleX, scaleY: elem.scaleY, angle: elem.angle });
        fabricImg.setCoords();
        changed = true;
      }
      if (fabricImg.opacity !== elem.opacity) {
        fabricImg.set('opacity', elem.opacity);
        changed = true;
      }
      if (fabricImg.visible !== elem.visible) {
        fabricImg.set('visible', elem.visible);
        changed = true;
      }
      if (fabricImg.selectable !== !elem.locked) {
        fabricImg.set({ selectable: !elem.locked, evented: !elem.locked });
        changed = true;
      }
      if (changed) needsRender = true;
    }
  }

  // 7. Z-order: match state.elements array order (index 0 = bottom)
  state.elements.forEach((elem, i) => {
    const obj = _objectMap.get(elem.id);
    if (obj) _fc.moveTo(obj, i);
  });

  // 8. Active selection
  if (state.activeElementId !== prevState?.activeElementId) {
    if (state.activeElementId) {
      const obj = _objectMap.get(state.activeElementId);
      if (obj && _fc.getActiveObject() !== obj) _fc.setActiveObject(obj);
    } else {
      if (_fc.getActiveObject()) _fc.discardActiveObject();
    }
    needsRender = true;
  }

  if (needsRender) _fc.requestRenderAll();
}

// ── Export ────────────────────────────────────────────────

function exportDataURL() {
  if (!_fc) return '';
  const zoom        = _currentState?.zoom ?? 1;
  const transparent = _currentState?.transparentBg ?? false;
  if (transparent) {
    const prevBg = _fc.backgroundColor;
    _fc.backgroundColor = null;
    const url = _fc.toDataURL({ format: 'png', multiplier: 1 / zoom });
    _fc.backgroundColor = prevBg;
    return url;
  }
  return _fc.toDataURL({ format: 'png', multiplier: 1 / zoom });
}

// ── Helpers ───────────────────────────────────────────────

function getContainerEl() {
  return _fc?.wrapperEl ?? null;
}

function _dispatchThumb(oc, libraryImageId) {
  const thumb = document.createElement('canvas');
  const W = oc.width, H = oc.height;
  const aspect = W / H;
  let tw = 80, th = 80;
  if (aspect > 1) th = Math.round(80 / aspect);
  else            tw = Math.round(80 * aspect);
  thumb.width = 80; thumb.height = 80;
  thumb.getContext('2d').drawImage(oc, Math.round((80 - tw) / 2), Math.round((80 - th) / 2), tw, th);
  const thumbUrl = thumb.toDataURL();
  thumb.width = 0;
  // Defer to avoid re-entrancy (this is called from inside a Store subscriber)
  setTimeout(() => Store.dispatch({ type: 'UPDATE_LIBRARY_THUMB', libraryImageId, thumbUrl }), 0);
}

window.FabricBridge = { init, sync, exportDataURL, getContainerEl };
