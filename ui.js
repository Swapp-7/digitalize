/* ============================================================
   DIGITALIZE — ui.js
   Pure render layer — subscribes to Store, dispatches actions.
   No direct LayerEngine calls. No mutable module state.

   Subscription strategy:
   - FabricBridge.sync() runs first (pipeline + thumbnails)
   - _render() runs second (DOM panels)
   - DOM rebuilds only on structural changes to avoid disrupting
     focused inputs during slider interaction.
   ============================================================ */

'use strict';

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const noImageMsg        = document.getElementById('no-image-msg');
const controlsContainer = document.getElementById('controls-container');

// ── Store subscription ────────────────────────────────────

Store.subscribe((state, prevState) => {
  FabricBridge.sync(state, prevState);  // pipeline + thumbnails first
  _render(state, prevState);            // DOM second
});

// ── Top-level render ──────────────────────────────────────

function _render(state, prevState) {
  // Show/hide controls panel
  const hasLayers = state.layers.length > 0;
  const hadLayers = (prevState?.layers.length ?? 0) > 0;
  if (hasLayers !== hadLayers) {
    noImageMsg.style.display = hasLayers ? 'none' : '';
    controlsContainer.classList.toggle('hidden', !hasLayers);
  }

  const active     = state.layers.find(l => l.id === state.activeLayerId) ?? null;
  const prevActive = prevState?.layers.find(l => l.id === prevState.activeLayerId) ?? null;

  // Layer panel: rebuild on structural or visual-prop change
  if (_panelNeedsRebuild(state, prevState)) {
    _renderLayerPanel(state);
  } else {
    // Partial: push updated thumbnails into existing rows
    for (const layer of state.layers) {
      const prev = prevState?.layers.find(l => l.id === layer.id);
      if (!prev || prev.modifiers !== layer.modifiers || prev.imageData !== layer.imageData) {
        _syncThumbnailInDOM(layer);
      }
    }
  }

  // Stack: rebuild only on structural change (active layer switch, modifier add/remove)
  if (_stackNeedsRebuild(state, prevState, active, prevActive)) {
    _renderStack(state, active);
  }
}

function _panelNeedsRebuild(state, prevState) {
  if (!prevState) return true;
  if (state.activeLayerId !== prevState.activeLayerId) return true;
  if (state.layers.length !== prevState.layers.length)  return true;
  if (state.layers.some((l, i) => l.id !== prevState.layers[i]?.id)) return true;
  // Rebuild when visible/opacity/blendMode change (affects icons + meta display)
  if (state.layers.some((l, i) => {
    const p = prevState.layers[i];
    return !p || p.visible !== l.visible || p.opacity !== l.opacity || p.blendMode !== l.blendMode;
  })) return true;
  return false;
}

function _stackNeedsRebuild(state, prevState, active, prevActive) {
  if (!prevState) return true;
  if (state.activeLayerId !== prevState.activeLayerId) return true;
  const am = active?.modifiers ?? [];
  const pm = prevActive?.modifiers ?? [];
  if (am.length !== pm.length) return true;
  if (am.some((m, i) => m.id !== pm[i]?.id)) return true;
  return false;
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

// ── Stack render ──────────────────────────────────────────

function _renderStack(state, active) {
  const container = document.getElementById('stack-container');
  container.innerHTML = '';

  const label    = document.getElementById('stack-section-label');
  const nameSpan = document.getElementById('active-layer-name');
  if (active) {
    label.classList.remove('hidden');
    nameSpan.textContent = active.name;
  } else {
    label.classList.add('hidden');
  }

  const modifiers = active?.modifiers ?? [];
  if (modifiers.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'stack-empty';
    msg.innerHTML = '&gt; STACK EMPTY<span class="blink">_</span>';
    container.appendChild(msg);
  } else {
    modifiers.forEach((item, index) =>
      container.appendChild(_buildStackItem(item, index, state.activeLayerId))
    );
  }

  container.appendChild(_buildAddRow(state.activeLayerId));
}

function _buildStackItem(item, index, layerId) {
  const def = window.FilterDefs[item.filterId];
  const el  = document.createElement('div');
  el.className  = 'stack-item';
  el.dataset.id = item.id;

  const header = document.createElement('div');
  header.className = 'stack-item__header';
  header.innerHTML = `
    <span class="stack-item__index">${String(index + 1).padStart(2, '0')}</span>
    <span class="stack-item__name">${def.label.toUpperCase()}</span>
    ${def.reroll ? `<button class="stack-item__reroll" title="Reroll">↻</button>` : ''}
    <button class="stack-item__remove" title="Remove modifier">✕</button>
  `;
  if (def.reroll) {
    header.querySelector('.stack-item__reroll').addEventListener('click', () => {
      Store.dispatch({ type: 'UPDATE_MODIFIER_VALUE', layerId, modifierId: item.id, key: 'seed', value: Math.floor(Math.random() * 65536) });
    });
  }
  header.querySelector('.stack-item__remove').addEventListener('click', () => {
    Store.dispatch({ type: 'REMOVE_MODIFIER', layerId, modifierId: item.id });
  });
  el.appendChild(header);

  const body = document.createElement('div');
  body.className = 'stack-item__body';
  if (typeof def.buildBody === 'function') {
    // Adapter: filters.js buildBody mutates item.values then calls triggerRun.
    // triggerRun snapshots the (already mutated) values and dispatches.
    const triggerRun = () => {
      Store.dispatch({ type: 'SYNC_MODIFIER_VALUES', layerId, modifierId: item.id, values: { ...item.values } });
    };
    def.buildBody(body, item, triggerRun);
  } else {
    for (const ctrl of (def.controls || [])) {
      body.appendChild(_buildControl(ctrl, item, layerId));
    }
  }
  el.appendChild(body);

  return el;
}

function _buildAddRow(activeLayerId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'stack-add';

  const defs = Object.keys(window.FilterDefs ?? {});
  if (defs.length === 0) return wrapper;

  if (defs.length === 1) {
    const btn = document.createElement('button');
    btn.className   = 'btn-add-modifier';
    btn.textContent = `+ ADD ${window.FilterDefs[defs[0]].label.toUpperCase()}`;
    btn.addEventListener('click', () =>
      Store.dispatch({ type: 'ADD_MODIFIER', layerId: activeLayerId, filterId: defs[0] })
    );
    wrapper.appendChild(btn);
  } else {
    const sel = document.createElement('select');
    sel.className = 'retro-select';
    for (const id of defs) {
      const opt = document.createElement('option');
      opt.value       = id;
      opt.textContent = window.FilterDefs[id].label.toUpperCase();
      sel.appendChild(opt);
    }
    const btn = document.createElement('button');
    btn.className   = 'btn-add-modifier btn-add-modifier--small';
    btn.textContent = '+ ADD';
    btn.addEventListener('click', () =>
      Store.dispatch({ type: 'ADD_MODIFIER', layerId: activeLayerId, filterId: sel.value })
    );
    wrapper.appendChild(sel);
    wrapper.appendChild(btn);
  }

  return wrapper;
}

// ── Control builders ──────────────────────────────────────

function _buildControl(ctrl, item, layerId) {
  const wrapper = document.createElement('div');
  const cur     = item.values[ctrl.id] ?? ctrl.default;

  if (ctrl.type === 'range') {
    wrapper.className = 'filter-row';
    wrapper.innerHTML = `
      <div class="filter-label-row">
        <label class="filter-label">${ctrl.label}</label>
        <span class="filter-value">${cur}</span>
      </div>
      <input type="range" min="${ctrl.min}" max="${ctrl.max}"
        step="${ctrl.step ?? 1}" value="${cur}" />
    `;
    const input = wrapper.querySelector('input');
    const valEl = wrapper.querySelector('.filter-value');
    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      valEl.textContent = input.value;
      App.updateSliderFill(input);
      Store.dispatch({ type: 'UPDATE_MODIFIER_VALUE', layerId, modifierId: item.id, key: ctrl.id, value: val, _transient: true });
    });
    input.addEventListener('pointerup', () => {
      Store.dispatch({ type: 'UPDATE_MODIFIER_VALUE', layerId, modifierId: item.id, key: ctrl.id, value: parseFloat(input.value) });
    });
    requestAnimationFrame(() => App.updateSliderFill(input));

  } else if (ctrl.type === 'select') {
    wrapper.className = 'filter-row';
    const opts = ctrl.options.map(o =>
      `<option value="${o.value}"${o.value === cur ? ' selected' : ''}>${o.label}</option>`
    ).join('');
    wrapper.innerHTML = `
      <div class="filter-label-row"><label class="filter-label">${ctrl.label}</label></div>
      <select class="retro-select">${opts}</select>
    `;
    wrapper.querySelector('select').addEventListener('change', (e) =>
      Store.dispatch({ type: 'UPDATE_MODIFIER_VALUE', layerId, modifierId: item.id, key: ctrl.id, value: e.target.value })
    );

  } else if (ctrl.type === 'toggle') {
    wrapper.className = 'toggle-row';
    wrapper.innerHTML = `
      <span class="toggle-label">${ctrl.label}</span>
      <label class="toggle">
        <input type="checkbox" ${cur ? 'checked' : ''} />
        <span class="toggle__track"></span>
        <span class="toggle__thumb"></span>
      </label>
    `;
    wrapper.querySelector('input').addEventListener('change', (e) =>
      Store.dispatch({ type: 'UPDATE_MODIFIER_VALUE', layerId, modifierId: item.id, key: ctrl.id, value: e.target.checked })
    );

  } else if (ctrl.type === 'color') {
    wrapper.className = 'filter-row filter-row--color';
    wrapper.innerHTML = `
      <div class="filter-label-row">
        <label class="filter-label">${ctrl.label}</label>
        <span class="filter-value-swatch" style="background:${cur}"></span>
      </div>
      <input type="color" value="${cur}" />
    `;
    wrapper.querySelector('input').addEventListener('input', (e) => {
      wrapper.querySelector('.filter-value-swatch').style.background = e.target.value;
      Store.dispatch({ type: 'UPDATE_MODIFIER_VALUE', layerId, modifierId: item.id, key: ctrl.id, value: e.target.value });
    });
  }

  return wrapper;
}

// ── Layer panel render ────────────────────────────────────

function _renderLayerPanel(state) {
  const panel = document.getElementById('layer-panel');
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'layer-panel__header';
  header.innerHTML = `
    <span class="layer-panel__title">// LAYERS</span>
    <button class="layer-panel__new-btn" id="btn-new-layer">+ NEW</button>
  `;
  panel.appendChild(header);

  const list = document.createElement('div');
  list.className = 'layer-panel__list';

  const layers = state.layers.slice().reverse();
  if (layers.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'stack-empty';
    empty.style.padding = '8px 0';
    empty.textContent = '> NO LAYERS';
    list.appendChild(empty);
  } else {
    for (const layer of layers) {
      list.appendChild(_buildLayerRow(layer, layer.id === state.activeLayerId));
    }
  }
  panel.appendChild(list);

  document.getElementById('btn-new-layer')?.addEventListener('click', () => {
    const { activeLayerId } = Store.getState();
    if (activeLayerId) Store.dispatch({ type: 'DUPLICATE_LAYER', id: activeLayerId });
  });
}

function _buildLayerRow(layer, isActive) {
  const row = document.createElement('div');
  row.className  = 'layer-row' + (isActive ? ' layer-row--active' : '');
  row.dataset.id = layer.id;

  // Thumbnail
  const thumb = document.createElement('canvas');
  thumb.className = 'layer-row__thumb';
  thumb.width  = 60;
  thumb.height = 60;
  if (layer._thumbCanvas) thumb.getContext('2d').drawImage(layer._thumbCanvas, 0, 0);

  // Info: visibility + name + delete
  const info = document.createElement('div');
  info.className = 'layer-row__info';

  const visBtn = document.createElement('button');
  visBtn.title         = 'Toggle visibility';
  visBtn.textContent   = layer.visible ? '◉' : '○';
  visBtn.style.opacity = layer.visible ? '1' : '0.35';
  visBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Store.dispatch({ type: 'SET_LAYER_PROP', id: layer.id, prop: 'visible', value: !layer.visible });
  });

  const nameEl = document.createElement('span');
  nameEl.className   = 'layer-row__name';
  nameEl.textContent = layer.name;

  const delBtn = document.createElement('button');
  delBtn.title       = 'Delete layer';
  delBtn.className   = 'layer-row__del-btn';
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Store.dispatch({ type: 'REMOVE_LAYER', id: layer.id });
  });

  info.appendChild(visBtn);
  info.appendChild(nameEl);
  info.appendChild(delBtn);

  // Controls: move up/down
  const controls = document.createElement('div');
  controls.className = 'layer-row__controls';

  const upBtn = document.createElement('button');
  upBtn.title = 'Move up'; upBtn.textContent = '↑';
  upBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Store.dispatch({ type: 'MOVE_LAYER', id: layer.id, direction: 'up' });
  });

  const downBtn = document.createElement('button');
  downBtn.title = 'Move down'; downBtn.textContent = '↓';
  downBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Store.dispatch({ type: 'MOVE_LAYER', id: layer.id, direction: 'down' });
  });

  controls.appendChild(upBtn);
  controls.appendChild(downBtn);

  // Meta: opacity + blend (visible only on active row via CSS)
  const meta = document.createElement('div');
  meta.className = 'layer-row__meta';

  const BLEND_INFO = {
    'source-over': 'Normal — pose le calque par-dessus. L\'opacité contrôle la transparence.',
    'multiply':    'Multiplie — assombrit. Blanc = neutre, Noir = noir. Idéal pour ombres.',
    'screen':      'Écran — éclaircit. Noir = neutre, Blanc = blanc. Idéal pour lumières.',
    'overlay':     'Incrustation — contraste fort selon la luminosité.',
    'darken':      'Plus sombre — garde le pixel le plus sombre entre les deux calques.',
    'lighten':     'Plus clair — garde le pixel le plus clair entre les deux calques.',
    'difference':  'Différence — soustrait les couleurs. Même couleur = noir. Effet glitch.',
    'luminosity':  'Luminosité — luminosité du calque sur teinte/saturation du dessous.',
  };

  const opacityPct = Math.round(layer.opacity * 100);
  meta.innerHTML = `
    <div class="layer-row__meta-row">
      <label class="filter-label">OPACITY</label>
      <span class="filter-value" id="opacity-val-${layer.id}">${opacityPct}%</span>
    </div>
    <input type="range" class="layer-opacity-slider" min="0" max="100" step="1" value="${opacityPct}" />
    <div class="layer-row__meta-row" style="margin-top:8px">
      <label class="filter-label">BLEND</label>
    </div>
    <select class="retro-select layer-blend-select">
      ${Object.keys(BLEND_INFO).map(m =>
        `<option value="${m}"${layer.blendMode === m ? ' selected' : ''}>${m}</option>`
      ).join('')}
    </select>
    <p class="blend-desc">${BLEND_INFO[layer.blendMode]}</p>
  `;

  const opSlider  = meta.querySelector('.layer-opacity-slider');
  const opVal     = meta.querySelector(`#opacity-val-${layer.id}`);
  const blendDesc = meta.querySelector('.blend-desc');
  requestAnimationFrame(() => App.updateSliderFill(opSlider));

  opSlider.addEventListener('input', () => {
    opVal.textContent = opSlider.value + '%';
    App.updateSliderFill(opSlider);
    Store.dispatch({ type: 'SET_LAYER_PROP', id: layer.id, prop: 'opacity', value: opSlider.value / 100, _transient: true });
  });
  opSlider.addEventListener('pointerup', () => {
    Store.dispatch({ type: 'SET_LAYER_PROP', id: layer.id, prop: 'opacity', value: opSlider.value / 100 });
  });

  meta.querySelector('.layer-blend-select').addEventListener('change', (e) => {
    blendDesc.textContent = BLEND_INFO[e.target.value]; // direct DOM update
    Store.dispatch({ type: 'SET_LAYER_PROP', id: layer.id, prop: 'blendMode', value: e.target.value });
  });

  row.appendChild(thumb);
  row.appendChild(info);
  row.appendChild(controls);
  row.appendChild(meta);

  meta.addEventListener('click', (e) => e.stopPropagation());
  row.addEventListener('click', () =>
    Store.dispatch({ type: 'SET_ACTIVE_LAYER', id: layer.id })
  );

  return row;
}
