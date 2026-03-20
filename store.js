/* ============================================================
   DIGITALIZE — store.js
   Central immutable state + pure reducer + pub/sub.
   Redux pattern, zero dependencies.

   State shape:
   {
     layers:          Layer[],   // ordered bottom → top
     activeLayerId:   string | null,
     instanceCounter: number,    // monotonic ID source for modifiers
   }
   ============================================================ */

'use strict';

// ── Initial state ─────────────────────────────────────────

function _initialState() {
  return { layers: [], activeLayerId: null, instanceCounter: 0 };
}

// ── Layer factory ─────────────────────────────────────────
// Side-effectful (creates HTMLCanvasElement), but acceptable
// for a browser-only app with no serialization requirement.

let _layerCounter = 0;

function _createLayer(imageData, name) {
  const id = 'layer-' + (++_layerCounter);
  return LayerEngine.makeLayer(imageData, id, name || 'LAYER ' + _layerCounter);
}

// ── Reducer ───────────────────────────────────────────────

function _reduce(state, action) {
  switch (action.type) {

    case 'LOAD_IMAGE': {
      _layerCounter = 0;
      const layer = _createLayer(action.imageData, action.name || 'LAYER 1');
      return { layers: [layer], activeLayerId: layer.id, instanceCounter: 0 };
    }

    case 'ADD_LAYER': {
      const layer = _createLayer(action.imageData, action.name);
      return { ...state, layers: [...state.layers, layer], activeLayerId: layer.id };
    }

    case 'REMOVE_LAYER': {
      const idx       = state.layers.findIndex(l => l.id === action.id);
      if (idx === -1) return state;
      const newLayers = state.layers.filter(l => l.id !== action.id);
      const newActive = state.activeLayerId === action.id
        ? (newLayers.length ? newLayers[Math.min(idx, newLayers.length - 1)].id : null)
        : state.activeLayerId;
      return { ...state, layers: newLayers, activeLayerId: newActive };
    }

    case 'MOVE_LAYER': {
      const idx = state.layers.findIndex(l => l.id === action.id);
      if (idx === -1) return state;
      const arr = [...state.layers];
      if (action.direction === 'up'   && idx < arr.length - 1) [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
      if (action.direction === 'down' && idx > 0)               [arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]];
      return { ...state, layers: arr };
    }

    case 'DUPLICATE_LAYER': {
      const src = state.layers.find(l => l.id === action.id);
      if (!src) return state;
      const newData = new ImageData(
        new Uint8ClampedArray(src.imageData.data),
        src.imageData.width, src.imageData.height
      );
      const copy = _createLayer(newData, src.name + ' COPY');
      copy.visible   = src.visible;
      copy.opacity   = src.opacity;
      copy.blendMode = src.blendMode;
      copy.locked    = src.locked;
      copy.x         = src.x;
      copy.y         = src.y;
      copy.modifiers = src.modifiers.map(m => ({ ...m, id: m.id + '-dup', values: { ...m.values } }));
      const srcIdx    = state.layers.findIndex(l => l.id === action.id);
      const newLayers = [...state.layers];
      newLayers.splice(srcIdx + 1, 0, copy);
      return { ...state, layers: newLayers, activeLayerId: copy.id };
    }

    case 'SET_ACTIVE_LAYER': {
      if (!state.layers.find(l => l.id === action.id)) return state;
      return { ...state, activeLayerId: action.id };
    }

    // Generic single-prop update (visible, opacity, blendMode, locked, name, x, y)
    case 'SET_LAYER_PROP': {
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === action.id ? { ...l, [action.prop]: action.value } : l
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
        layers: state.layers.map(l =>
          l.id === action.layerId ? { ...l, modifiers: [...l.modifiers, modifier] } : l
        ),
      };
    }

    case 'REMOVE_MODIFIER': {
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === action.layerId
            ? { ...l, modifiers: l.modifiers.filter(m => m.id !== action.modifierId) }
            : l
        ),
      };
    }

    case 'UPDATE_MODIFIER_VALUE': {
      return {
        ...state,
        layers: state.layers.map(l => {
          if (l.id !== action.layerId) return l;
          return {
            ...l,
            modifiers: l.modifiers.map(m =>
              m.id !== action.modifierId
                ? m
                : { ...m, values: { ...m.values, [action.key]: action.value } }
            ),
          };
        }),
      };
    }

    // Used by filters with custom buildBody (e.g. palette) that mutate item.values
    // directly before calling triggerRun. Snapshots the whole values object.
    case 'SYNC_MODIFIER_VALUES': {
      return {
        ...state,
        layers: state.layers.map(l => {
          if (l.id !== action.layerId) return l;
          return {
            ...l,
            modifiers: l.modifiers.map(m =>
              m.id !== action.modifierId ? m : { ...m, values: action.values }
            ),
          };
        }),
      };
    }

    case 'CLEAR_MODIFIERS': {
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === action.layerId ? { ...l, modifiers: [] } : l
        ),
      };
    }

    default:
      return state;
  }
}

// ── Pub / sub ─────────────────────────────────────────────

let _state       = _initialState();
const _listeners = [];

function dispatch(action) {
  const prevState = _state;
  _state = _reduce(_state, action);
  _listeners.forEach(fn => fn(_state, prevState));
}

function subscribe(fn) {
  _listeners.push(fn);
}

function getState() {
  return _state;
}

window.Store = { dispatch, subscribe, getState };
