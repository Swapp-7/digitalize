/* ============================================================
   DIGITALIZE — store.js
   State shape:
   {
     canvasWidth, canvasHeight, backgroundColor,
     library: [{id, name, imageData, thumbUrl}],
     elements: [{id, name, libraryImageId, modifiers, opacity, visible, locked, x, y, scaleX, scaleY, angle}],
     activeElementId, zoom, showGrid, instanceCounter
   }
   ============================================================ */

'use strict';

let _libCounter  = 0;
let _elemCounter = 0;

function _initialState() {
  return {
    canvasWidth:     800,
    canvasHeight:    600,
    backgroundColor: '#ffffff',
    transparentBg:   false,
    library:         [],
    elements:        [],
    activeElementId: null,
    zoom:            1,
    showGrid:        false,
    instanceCounter: 0,
  };
}

function _reduce(state, action) {
  switch (action.type) {

    case 'ADD_LIBRARY_IMAGE': {
      const id = 'lib-' + (++_libCounter);
      // Create 80×80 letterboxed thumbnail (side-effect acceptable in browser-only app)
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width  = action.imageData.width;
      srcCanvas.height = action.imageData.height;
      srcCanvas.getContext('2d').putImageData(action.imageData, 0, 0);
      const thumb = document.createElement('canvas');
      thumb.width = 80; thumb.height = 80;
      const aspect = action.imageData.width / action.imageData.height;
      let tw = 80, th = 80;
      if (aspect > 1) th = Math.round(80 / aspect);
      else            tw = Math.round(80 * aspect);
      const tx = Math.round((80 - tw) / 2);
      const ty = Math.round((80 - th) / 2);
      thumb.getContext('2d').drawImage(srcCanvas, tx, ty, tw, th);
      const thumbUrl = thumb.toDataURL();
      srcCanvas.width = 0; thumb.width = 0;
      const libImage = { id, name: action.name || 'Image ' + _libCounter, imageData: action.imageData, thumbUrl };
      return { ...state, library: [...state.library, libImage] };
    }

    case 'ADD_ELEMENT': {
      const libImg = state.library.find(l => l.id === action.libraryImageId);
      if (!libImg) return state;
      const id   = 'elem-' + (++_elemCounter);
      const maxW = state.canvasWidth  * 0.8;
      const maxH = state.canvasHeight * 0.8;
      const scale = Math.min(1, maxW / libImg.imageData.width, maxH / libImg.imageData.height);
      const elem = {
        id,
        name:           libImg.name,
        libraryImageId: action.libraryImageId,
        modifiers:      [],
        opacity:        1,
        visible:        true,
        locked:         false,
        x:      action.x ?? state.canvasWidth  / 2,
        y:      action.y ?? state.canvasHeight / 2,
        scaleX: scale,
        scaleY: scale,
        angle:  0,
      };
      return { ...state, elements: [...state.elements, elem], activeElementId: id };
    }

    case 'REMOVE_ELEMENT': {
      const id = action.id ?? state.activeElementId;
      if (!id) return state;
      const newElems = state.elements.filter(e => e.id !== id);
      const newActive = state.activeElementId === id
        ? (newElems.length ? newElems[newElems.length - 1].id : null)
        : state.activeElementId;
      return { ...state, elements: newElems, activeElementId: newActive };
    }

    case 'SET_ACTIVE_ELEMENT': {
      return { ...state, activeElementId: action.id };
    }

    case 'UPDATE_ELEMENT_TRANSFORM': {
      return {
        ...state,
        elements: state.elements.map(e =>
          e.id === action.id
            ? { ...e, x: action.x, y: action.y, scaleX: action.scaleX, scaleY: action.scaleY, angle: action.angle }
            : e
        ),
      };
    }

    case 'SET_ELEMENT_PROP': {
      return {
        ...state,
        elements: state.elements.map(e =>
          e.id === action.id ? { ...e, [action.prop]: action.value } : e
        ),
      };
    }

    case 'MOVE_ELEMENT': {
      const idx = state.elements.findIndex(e => e.id === action.id);
      if (idx === -1) return state;
      const arr = [...state.elements];
      if (action.direction === 'up'   && idx < arr.length - 1) [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
      if (action.direction === 'down' && idx > 0)               [arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]];
      return { ...state, elements: arr };
    }

    case 'SET_CANVAS_SIZE': {
      return { ...state, canvasWidth: action.width, canvasHeight: action.height };
    }

    case 'SET_BACKGROUND': {
      return { ...state, backgroundColor: action.color };
    }

    case 'SET_ZOOM': {
      return { ...state, zoom: Math.max(0.1, Math.min(4, action.zoom)) };
    }

    case 'TOGGLE_GRID': {
      return { ...state, showGrid: !state.showGrid };
    }

    case 'TOGGLE_TRANSPARENT_BG': {
      return { ...state, transparentBg: !state.transparentBg };
    }

    case 'DUPLICATE_ELEMENT': {
      const src = state.elements.find(e => e.id === action.sourceId);
      if (!src) return state;
      const id   = 'elem-' + (++_elemCounter);
      const dupe = {
        ...src, id,
        x: src.x + 20, y: src.y + 20,
        modifiers: JSON.parse(JSON.stringify(src.modifiers)),
      };
      return { ...state, elements: [...state.elements, dupe], activeElementId: id };
    }

    case 'APPLY_TRANSFORM_OP': {
      const elem = state.elements.find(e => e.id === action.id);
      if (!elem) return state;
      let { scaleX, scaleY, angle } = elem;
      if (action.op === 'flipH')  scaleX = -scaleX;
      if (action.op === 'flipV')  scaleY = -scaleY;
      if (action.op === 'rotCW')  angle  = (angle + 90) % 360;
      if (action.op === 'rotCCW') angle  = ((angle - 90) % 360 + 360) % 360;
      if (action.op === 'reset')  { scaleX = Math.abs(scaleX); scaleY = Math.abs(scaleY); angle = 0; }
      return {
        ...state,
        elements: state.elements.map(e => e.id === action.id ? { ...e, scaleX, scaleY, angle } : e),
      };
    }

    case 'REORDER_MODIFIERS': {
      const elem = state.elements.find(e => e.id === action.elementId);
      if (!elem) return state;
      const mods = [...elem.modifiers];
      const [moved] = mods.splice(action.fromIndex, 1);
      mods.splice(action.toIndex, 0, moved);
      return {
        ...state,
        elements: state.elements.map(e => e.id === action.elementId ? { ...e, modifiers: mods } : e),
      };
    }

    case 'UPDATE_LIBRARY_THUMB': {
      return {
        ...state,
        library: state.library.map(l =>
          l.id === action.libraryImageId ? { ...l, thumbUrl: action.thumbUrl } : l
        ),
      };
    }

    case 'ADD_MODIFIER': {
      const def = window.FilterDefs?.[action.filterId];
      if (!def) return state;
      const values = {};
      for (const ctrl of (def.controls || [])) values[ctrl.id] = ctrl.default ?? 0;
      const newCounter = state.instanceCounter + 1;
      const modifier   = { id: `${action.filterId}-${newCounter}`, filterId: action.filterId, values };
      return {
        ...state,
        instanceCounter: newCounter,
        elements: state.elements.map(e =>
          e.id === action.elementId ? { ...e, modifiers: [...e.modifiers, modifier] } : e
        ),
      };
    }

    case 'REMOVE_MODIFIER': {
      return {
        ...state,
        elements: state.elements.map(e =>
          e.id === action.elementId
            ? { ...e, modifiers: e.modifiers.filter(m => m.id !== action.modifierId) }
            : e
        ),
      };
    }

    case 'UPDATE_MODIFIER_VALUE': {
      return {
        ...state,
        elements: state.elements.map(e => {
          if (e.id !== action.elementId) return e;
          return {
            ...e,
            modifiers: e.modifiers.map(m =>
              m.id !== action.modifierId
                ? m
                : { ...m, values: { ...m.values, [action.key]: action.value } }
            ),
          };
        }),
      };
    }

    case 'SYNC_MODIFIER_VALUES': {
      return {
        ...state,
        elements: state.elements.map(e => {
          if (e.id !== action.elementId) return e;
          return {
            ...e,
            modifiers: e.modifiers.map(m =>
              m.id !== action.modifierId ? m : { ...m, values: action.values }
            ),
          };
        }),
      };
    }

    case 'CLEAR_MODIFIERS': {
      return {
        ...state,
        elements: state.elements.map(e =>
          e.id === action.elementId ? { ...e, modifiers: [] } : e
        ),
      };
    }

    default:
      return state;
  }
}

const _history    = [];
const MAX_HISTORY = 30;
let _state        = _initialState();
const _listeners  = [];
let _persistTimer = null;

// ── Persistence helpers ───────────────────────────────────

function _imageDataToDataURL(imageData) {
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  const url = c.toDataURL('image/png');
  c.width = 0;
  return url;
}

function _serializeState(state) {
  try {
    return JSON.stringify({
      canvasWidth:     state.canvasWidth,
      canvasHeight:    state.canvasHeight,
      backgroundColor: state.backgroundColor,
      transparentBg:   state.transparentBg,
      showGrid:        state.showGrid,
      zoom:            state.zoom,
      library: state.library.map(l => ({
        id: l.id, name: l.name, thumbUrl: l.thumbUrl,
        imageDataUrl: _imageDataToDataURL(l.imageData),
      })),
      elements: state.elements.map(e => ({
        id: e.id, name: e.name, libraryImageId: e.libraryImageId,
        modifiers: e.modifiers, opacity: e.opacity,
        visible: e.visible, locked: e.locked,
        x: e.x, y: e.y, scaleX: e.scaleX, scaleY: e.scaleY, angle: e.angle,
      })),
    });
  } catch (_) { return null; }
}

function _restoreAsync(saved) {
  return new Promise((resolve) => {
    const promises = (saved.library || []).map(item => new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx2 = c.getContext('2d');
        ctx2.drawImage(img, 0, 0);
        const imageData = ctx2.getImageData(0, 0, c.width, c.height);
        c.width = 0;
        res({ id: item.id, name: item.name, thumbUrl: item.thumbUrl, imageData });
      };
      img.onerror = () => res(null);
      img.src = item.imageDataUrl;
    }));

    Promise.all(promises).then(items => {
      const library  = items.filter(Boolean);
      const elements = saved.elements || [];

      // Re-seed counters from max IDs in saved data
      for (const l of library) {
        const n = parseInt(l.id.split('-')[1], 10);
        if (!isNaN(n) && n > _libCounter) _libCounter = n;
      }
      for (const e of elements) {
        const n = parseInt(e.id.split('-')[1], 10);
        if (!isNaN(n) && n > _elemCounter) _elemCounter = n;
      }

      _state = {
        ..._initialState(),
        canvasWidth:     saved.canvasWidth     ?? 800,
        canvasHeight:    saved.canvasHeight    ?? 600,
        backgroundColor: saved.backgroundColor ?? '#ffffff',
        transparentBg:   saved.transparentBg   ?? false,
        showGrid:        saved.showGrid        ?? false,
        zoom:            saved.zoom            ?? 1,
        library,
        elements,
      };
      resolve(true);
    });
  });
}

function restore() {
  try {
    const raw = localStorage.getItem('digitalize_v1');
    if (!raw) return Promise.resolve(false);
    return _restoreAsync(JSON.parse(raw));
  } catch (_) { return Promise.resolve(false); }
}

// ── Store core ────────────────────────────────────────────

function dispatch(action) {
  const prevState = _state;
  if (!action._transient) {
    _history.push(prevState);
    if (_history.length > MAX_HISTORY) _history.shift();
  }
  _state = _reduce(_state, action);
  _listeners.forEach(fn => fn(_state, prevState));

  if (!action._transient) {
    clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
      const data = _serializeState(_state);
      if (data) {
        try { localStorage.setItem('digitalize_v1', data); }
        catch (_) { /* quota exceeded — fail silently */ }
      }
    }, 300);
  }
}

function undo() {
  if (!_history.length) return;
  const prevState = _state;
  _state = _history.pop();
  _listeners.forEach(fn => fn(_state, prevState));
}

function subscribe(fn) {
  _listeners.push(fn);
  const idx = _listeners.length - 1;
  return () => _listeners.splice(idx, 1);
}

function getState() { return _state; }

window.Store = { dispatch, subscribe, getState, undo, restore };
