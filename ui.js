/* ============================================================
   DIGITALIZE — ui.js
   Three render functions: library panel, toolbar, properties.
   ============================================================ */

'use strict';

// ── Top-level render ──────────────────────────────────────

function render(state, prevState) {
  _renderLibrary(state, prevState);
  _renderToolbar(state, prevState);
  _renderProperties(state, prevState);
}

// ── Library Panel ─────────────────────────────────────────

function _renderLibrary(state, prevState) {
  const libChanged =
    !prevState ||
    state.library !== prevState.library ||
    state.activeElementId !== prevState.activeElementId;

  if (!libChanged) return;

  const panel = document.getElementById('library-panel');
  panel.innerHTML = '';

  // Upload button
  const uploadWrap = document.createElement('div');
  uploadWrap.className = 'library-upload';
  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn btn--accent btn--block';
  uploadBtn.textContent = '+ Upload Photos';
  uploadBtn.addEventListener('click', () => document.getElementById('file-input').click());
  uploadWrap.appendChild(uploadBtn);
  panel.appendChild(uploadWrap);

  // Library section
  const libTitle = document.createElement('div');
  libTitle.className = 'library-section-title';
  libTitle.textContent = 'Photo Library';
  panel.appendChild(libTitle);

  const scroll = document.createElement('div');
  scroll.className = 'library-scroll';

  const grid = document.createElement('div');
  grid.className = 'library-grid';

  if (state.library.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'library-empty';
    empty.textContent = 'No photos yet. Upload to start.';
    grid.appendChild(empty);
  } else {
    for (const libImg of state.library) {
      const item = document.createElement('div');
      item.className = 'library-item';
      item.title = libImg.name;
      item.draggable = true;

      const img = document.createElement('img');
      img.src = libImg.thumbUrl;
      img.alt = libImg.name;
      img.className = 'library-item__thumb';
      item.appendChild(img);

      item.addEventListener('click', () => {
        Store.dispatch({ type: 'ADD_ELEMENT', libraryImageId: libImg.id });
      });

      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', libImg.id);
        e.dataTransfer.effectAllowed = 'copy';
      });

      grid.appendChild(item);
    }
  }
  scroll.appendChild(grid);
  panel.appendChild(scroll);

  // Divider
  const divider = document.createElement('div');
  divider.className = 'library-divider';
  panel.appendChild(divider);

  // Layer order
  const orderTitle = document.createElement('div');
  orderTitle.className = 'library-section-title';
  orderTitle.textContent = 'Layer Order';
  panel.appendChild(orderTitle);

  const actions = document.createElement('div');
  actions.className = 'layer-actions';

  const hasActive = !!state.activeElementId;

  const upBtn = document.createElement('button');
  upBtn.className = 'btn btn--ghost btn--block';
  upBtn.textContent = '↑ Move Up';
  upBtn.disabled = !hasActive;
  upBtn.addEventListener('click', () => {
    Store.dispatch({ type: 'MOVE_ELEMENT', id: Store.getState().activeElementId, direction: 'up' });
  });

  const downBtn = document.createElement('button');
  downBtn.className = 'btn btn--ghost btn--block';
  downBtn.textContent = '↓ Move Down';
  downBtn.disabled = !hasActive;
  downBtn.addEventListener('click', () => {
    Store.dispatch({ type: 'MOVE_ELEMENT', id: Store.getState().activeElementId, direction: 'down' });
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn--danger btn--block';
  delBtn.textContent = '✕ Delete';
  delBtn.disabled = !hasActive;
  delBtn.addEventListener('click', () => {
    Store.dispatch({ type: 'REMOVE_ELEMENT', id: Store.getState().activeElementId });
  });

  actions.appendChild(upBtn);
  actions.appendChild(downBtn);
  actions.appendChild(delBtn);
  panel.appendChild(actions);
}

// ── Toolbar ───────────────────────────────────────────────

let _toolbarReady = false;

function _renderToolbar(state, prevState) {
  if (!_toolbarReady) {
    _toolbarReady = true;
    const toolbar = document.getElementById('toolbar');
    toolbar.innerHTML = `
      <div class="toolbar__group">
        <label class="toolbar__label">W</label>
        <input type="number" id="input-canvas-w" class="toolbar__input" value="${state.canvasWidth}" min="100" max="4000" />
        <span class="toolbar__sep">×</span>
        <label class="toolbar__label">H</label>
        <input type="number" id="input-canvas-h" class="toolbar__input" value="${state.canvasHeight}" min="100" max="4000" />
      </div>
      <div class="toolbar__divider"></div>
      <div class="toolbar__group">
        <label class="toolbar__label">BG</label>
        <input type="color" id="input-bg-color" class="toolbar__color" value="${state.backgroundColor}" style="${state.transparentBg ? 'opacity:0.35;pointer-events:none' : ''}" />
        <label class="toolbar__checkbox-label">
          <input type="checkbox" id="check-transparent-bg" ${state.transparentBg ? 'checked' : ''} />
          Transp.
        </label>
      </div>
      <div class="toolbar__divider"></div>
      <div class="toolbar__group">
        <label class="toolbar__checkbox-label">
          <input type="checkbox" id="check-grid" ${state.showGrid ? 'checked' : ''} />
          Grid
        </label>
      </div>
      <div class="toolbar__spacer"></div>
      <div class="toolbar__group">
        <button id="btn-zoom-out" class="btn btn--ghost btn--sm">−</button>
        <span id="zoom-display" class="zoom-display">${Math.round(state.zoom * 100)}%</span>
        <button id="btn-zoom-in" class="btn btn--ghost btn--sm">+</button>
      </div>
      <div class="toolbar__divider"></div>
      <div class="toolbar__group">
        <button id="btn-undo" class="btn btn--ghost">↩ Undo</button>
        <button id="btn-export" class="btn btn--primary">↓ Export PNG</button>
      </div>
    `;

    document.getElementById('input-canvas-w').addEventListener('change', (e) => {
      const w = Math.max(100, Math.min(4000, parseInt(e.target.value) || 800));
      e.target.value = w;
      Store.dispatch({ type: 'SET_CANVAS_SIZE', width: w, height: Store.getState().canvasHeight });
    });
    document.getElementById('input-canvas-h').addEventListener('change', (e) => {
      const h = Math.max(100, Math.min(4000, parseInt(e.target.value) || 600));
      e.target.value = h;
      Store.dispatch({ type: 'SET_CANVAS_SIZE', width: Store.getState().canvasWidth, height: h });
    });
    document.getElementById('input-bg-color').addEventListener('input', (e) => {
      Store.dispatch({ type: 'SET_BACKGROUND', color: e.target.value });
    });
    document.getElementById('check-transparent-bg').addEventListener('change', () => {
      Store.dispatch({ type: 'TOGGLE_TRANSPARENT_BG' });
    });
    document.getElementById('check-grid').addEventListener('change', () => {
      Store.dispatch({ type: 'TOGGLE_GRID' });
    });
    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      Store.dispatch({ type: 'SET_ZOOM', zoom: Store.getState().zoom / 1.25 });
    });
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      Store.dispatch({ type: 'SET_ZOOM', zoom: Store.getState().zoom * 1.25 });
    });
    document.getElementById('btn-undo').addEventListener('click', () => Store.undo());
    document.getElementById('btn-export').addEventListener('click', () => {
      const a = document.createElement('a');
      a.download = 'digitalize_export.png';
      a.href = FabricBridge.exportDataURL();
      a.click();
    });
    return;
  }

  // Partial updates only
  if (state.zoom !== prevState?.zoom) {
    const el = document.getElementById('zoom-display');
    if (el) el.textContent = Math.round(state.zoom * 100) + '%';
  }
  if (state.transparentBg !== prevState?.transparentBg) {
    const cb  = document.getElementById('check-transparent-bg');
    const col = document.getElementById('input-bg-color');
    if (cb)  cb.checked = state.transparentBg;
    if (col) { col.style.opacity = state.transparentBg ? '0.35' : '1'; col.style.pointerEvents = state.transparentBg ? 'none' : ''; }
  }
  const wInput = document.getElementById('input-canvas-w');
  if (wInput && document.activeElement !== wInput && state.canvasWidth !== prevState?.canvasWidth) {
    wInput.value = state.canvasWidth;
  }
  const hInput = document.getElementById('input-canvas-h');
  if (hInput && document.activeElement !== hInput && state.canvasHeight !== prevState?.canvasHeight) {
    hInput.value = state.canvasHeight;
  }
}

// ── Properties Panel ──────────────────────────────────────

function _renderProperties(state, prevState) {
  const panel    = document.getElementById('properties-panel');
  const activeId = state.activeElementId;
  const active   = state.elements.find(e => e.id === activeId) ?? null;
  const prevAct  = prevState?.elements.find(e => e.id === prevState.activeElementId) ?? null;

  const needsRebuild =
    !prevState ||
    activeId !== prevState.activeElementId ||
    (active && prevAct && active.modifiers.length !== prevAct.modifiers.length) ||
    (active && prevAct && active.modifiers.some((m, i) => m.id !== prevAct.modifiers[i]?.id));

  if (!needsRebuild) {
    // Partial: update opacity display if slider not focused
    if (active && prevAct && active.opacity !== prevAct.opacity) {
      const slider  = panel.querySelector('#elem-opacity');
      const display = panel.querySelector('#elem-opacity-val');
      if (slider && document.activeElement !== slider) {
        slider.value = Math.round(active.opacity * 100);
        if (display) display.textContent = Math.round(active.opacity * 100) + '%';
        App.updateSliderFill(slider);
      }
    }
    return;
  }

  panel.innerHTML = '';

  if (!active) {
    const empty = document.createElement('p');
    empty.className = 'properties-empty';
    empty.textContent = 'Select an element to edit filters and opacity.';
    panel.appendChild(empty);
    return;
  }

  // Name header
  const nameEl = document.createElement('div');
  nameEl.className = 'properties-name';
  nameEl.textContent = active.name;
  panel.appendChild(nameEl);

  // Opacity
  const opPct = Math.round(active.opacity * 100);
  const opSection = document.createElement('div');
  opSection.className = 'properties-section';
  opSection.innerHTML = `
    <div class="filter-label-row">
      <label class="filter-label">Opacity</label>
      <span id="elem-opacity-val">${opPct}%</span>
    </div>
    <input type="range" id="elem-opacity" min="0" max="100" step="1" value="${opPct}" />
  `;
  const opSlider  = opSection.querySelector('#elem-opacity');
  const opDisplay = opSection.querySelector('#elem-opacity-val');
  let _opTimer = null;
  opSlider.addEventListener('input', () => {
    opDisplay.textContent = opSlider.value + '%';
    App.updateSliderFill(opSlider);
    clearTimeout(_opTimer);
    _opTimer = setTimeout(() => {
      Store.dispatch({ type: 'SET_ELEMENT_PROP', id: active.id, prop: 'opacity', value: opSlider.value / 100, _transient: true });
    }, 80);
  });
  opSlider.addEventListener('pointerup', () => {
    clearTimeout(_opTimer);
    Store.dispatch({ type: 'SET_ELEMENT_PROP', id: active.id, prop: 'opacity', value: opSlider.value / 100 });
  });
  requestAnimationFrame(() => App.updateSliderFill(opSlider));
  panel.appendChild(opSection);

  // ── Size shortcuts ────────────────────────────────────
  const libImg = state.library.find(l => l.id === active.libraryImageId);
  if (libImg) {
    const sizeDiv = document.createElement('div');
    sizeDiv.className = 'properties-divider';
    panel.appendChild(sizeDiv);

    const sizeTitle = document.createElement('div');
    sizeTitle.className = 'properties-section-title';
    sizeTitle.textContent = 'Size';
    panel.appendChild(sizeTitle);

    const sizeSection = document.createElement('div');
    sizeSection.className = 'properties-section';
    sizeSection.style.paddingTop = '4px';
    sizeSection.innerHTML = `<div class="size-btn-row">
      <button id="prop-btn-fit"      class="btn btn--ghost btn--sm" style="flex:1">Fit</button>
      <button id="prop-btn-fill"     class="btn btn--ghost btn--sm" style="flex:1">Fill</button>
      <button id="prop-btn-original" class="btn btn--ghost btn--sm" style="flex:1">1:1</button>
    </div>`;
    panel.appendChild(sizeSection);

    sizeSection.querySelector('#prop-btn-fit').addEventListener('click', () => {
      const scale = Math.min(state.canvasWidth / libImg.imageData.width, state.canvasHeight / libImg.imageData.height);
      Store.dispatch({ type: 'UPDATE_ELEMENT_TRANSFORM', id: active.id, x: state.canvasWidth / 2, y: state.canvasHeight / 2, scaleX: scale, scaleY: scale, angle: active.angle });
    });
    sizeSection.querySelector('#prop-btn-fill').addEventListener('click', () => {
      const scale = Math.max(state.canvasWidth / libImg.imageData.width, state.canvasHeight / libImg.imageData.height);
      Store.dispatch({ type: 'UPDATE_ELEMENT_TRANSFORM', id: active.id, x: state.canvasWidth / 2, y: state.canvasHeight / 2, scaleX: scale, scaleY: scale, angle: active.angle });
    });
    sizeSection.querySelector('#prop-btn-original').addEventListener('click', () => {
      Store.dispatch({ type: 'UPDATE_ELEMENT_TRANSFORM', id: active.id, x: state.canvasWidth / 2, y: state.canvasHeight / 2, scaleX: 1, scaleY: 1, angle: 0 });
    });
  }

  // ── Transform toolbar ─────────────────────────────────
  const transformDiv = document.createElement('div');
  transformDiv.className = 'properties-divider';
  panel.appendChild(transformDiv);

  const transformTitle = document.createElement('div');
  transformTitle.className = 'properties-section-title';
  transformTitle.textContent = 'Transform';
  panel.appendChild(transformTitle);

  const transformSection = document.createElement('div');
  transformSection.className = 'properties-section';
  transformSection.style.paddingTop = '4px';
  transformSection.innerHTML = `<div class="transform-toolbar">
    <button class="btn btn--ghost btn--sm" data-op="flipH"  title="Flip Horizontal">⇄</button>
    <button class="btn btn--ghost btn--sm" data-op="flipV"  title="Flip Vertical">⇅</button>
    <button class="btn btn--ghost btn--sm" data-op="rotCW"  title="Rotate 90° CW">↻</button>
    <button class="btn btn--ghost btn--sm" data-op="rotCCW" title="Rotate 90° CCW">↺</button>
    <button class="btn btn--ghost btn--sm" data-op="reset"  title="Reset Transform" style="margin-left:auto">Reset</button>
  </div>`;
  transformSection.querySelectorAll('[data-op]').forEach(btn => {
    btn.addEventListener('click', () => {
      Store.dispatch({ type: 'APPLY_TRANSFORM_OP', id: active.id, op: btn.dataset.op });
    });
  });
  panel.appendChild(transformSection);

  // Filter stack
  const divider = document.createElement('div');
  divider.className = 'properties-divider';
  panel.appendChild(divider);

  const stackTitle = document.createElement('div');
  stackTitle.className = 'properties-section-title';
  stackTitle.textContent = 'Filters';
  panel.appendChild(stackTitle);

  const stackContainer = document.createElement('div');
  stackContainer.className = 'stack-container';

  if (active.modifiers.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'stack-empty';
    empty.textContent = 'No filters applied';
    stackContainer.appendChild(empty);
  } else {
    active.modifiers.forEach((item, idx) =>
      stackContainer.appendChild(_buildStackItem(item, idx, active.id))
    );
  }
  stackContainer.appendChild(_buildAddRow(active.id));
  panel.appendChild(stackContainer);
}

// ── Stack item ────────────────────────────────────────────

function _buildStackItem(item, index, elementId) {
  const def = window.FilterDefs[item.filterId];
  const el  = document.createElement('div');
  el.className  = 'stack-item';
  el.dataset.id = item.id;
  // Drop target on the whole item; drag source is restricted to the header below
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('stack-item--drag-over'); });
  el.addEventListener('dragleave', () => el.classList.remove('stack-item--drag-over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('stack-item--drag-over');
    try {
      const { modifierId: draggedId, elementId: srcElemId } = JSON.parse(e.dataTransfer.getData('application/digitalize-modifier'));
      if (!draggedId || draggedId === item.id || srcElemId !== elementId) return;
      const elem = Store.getState().elements.find(e2 => e2.id === elementId);
      if (!elem) return;
      const fromIndex = elem.modifiers.findIndex(m => m.id === draggedId);
      const toIndex   = elem.modifiers.findIndex(m => m.id === item.id);
      if (fromIndex !== -1 && toIndex !== -1)
        Store.dispatch({ type: 'REORDER_MODIFIERS', elementId, fromIndex, toIndex });
    } catch (_) {}
  });

  const header = document.createElement('div');
  header.className = 'stack-item__header';
  header.innerHTML = `
    <span class="stack-item__drag" title="Drag to reorder">⠿</span>
    <span class="stack-item__index">${String(index + 1).padStart(2, '0')}</span>
    <span class="stack-item__name">${def.label}</span>
    ${def.reroll ? `<button class="stack-item__reroll" title="Reroll">↻</button>` : ''}
    <button class="stack-item__remove" title="Remove">✕</button>
  `;

  // Drag source restricted to header only — body controls (sliders, selects) are unaffected
  header.draggable = true;
  header.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/digitalize-modifier', JSON.stringify({ modifierId: item.id, elementId }));
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => el.classList.add('stack-item--dragging'));
  });
  header.addEventListener('dragend', () => el.classList.remove('stack-item--dragging'));

  if (def.reroll) {
    header.querySelector('.stack-item__reroll').addEventListener('click', () => {
      Store.dispatch({ type: 'UPDATE_MODIFIER_VALUE', elementId, modifierId: item.id, key: 'seed', value: Math.floor(Math.random() * 65536) });
    });
  }
  header.querySelector('.stack-item__remove').addEventListener('click', () => {
    Store.dispatch({ type: 'REMOVE_MODIFIER', elementId, modifierId: item.id });
  });
  el.appendChild(header);

  const body = document.createElement('div');
  body.className = 'stack-item__body';
  if (typeof def.buildBody === 'function') {
    const triggerRun = () => {
      Store.dispatch({ type: 'SYNC_MODIFIER_VALUES', elementId, modifierId: item.id, values: { ...item.values } });
    };
    def.buildBody(body, item, triggerRun);
  } else {
    for (const ctrl of (def.controls || [])) {
      body.appendChild(_buildControl(ctrl, item, elementId));
    }
  }
  el.appendChild(body);
  return el;
}

function _buildAddRow(elementId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'stack-add';

  const defs = Object.keys(window.FilterDefs ?? {});
  if (defs.length === 0) return wrapper;

  if (defs.length === 1) {
    const btn = document.createElement('button');
    btn.className   = 'btn-add-modifier';
    btn.textContent = `+ Add ${window.FilterDefs[defs[0]].label}`;
    btn.addEventListener('click', () =>
      Store.dispatch({ type: 'ADD_MODIFIER', elementId, filterId: defs[0] })
    );
    wrapper.appendChild(btn);
  } else {
    const sel = document.createElement('select');
    sel.className = 'retro-select';
    sel.style.flex = '1';
    for (const id of defs) {
      const opt = document.createElement('option');
      opt.value       = id;
      opt.textContent = window.FilterDefs[id].label;
      sel.appendChild(opt);
    }
    const btn = document.createElement('button');
    btn.className   = 'btn-add-modifier';
    btn.style.flex  = '0 0 auto';
    btn.style.width = 'auto';
    btn.style.padding = '0 10px';
    btn.textContent = '+ Add';
    btn.addEventListener('click', () =>
      Store.dispatch({ type: 'ADD_MODIFIER', elementId, filterId: sel.value })
    );
    wrapper.appendChild(sel);
    wrapper.appendChild(btn);
  }
  return wrapper;
}

// ── Control builders ──────────────────────────────────────

function _buildControl(ctrl, item, elementId) {
  const wrapper = document.createElement('div');
  const cur     = item.values[ctrl.id] ?? ctrl.default;

  if (ctrl.type === 'range') {
    wrapper.className = 'filter-row';
    wrapper.innerHTML = `
      <div class="filter-label-row">
        <label class="filter-label">${ctrl.label}</label>
        <span class="filter-value">${cur}</span>
      </div>
      <input type="range" min="${ctrl.min}" max="${ctrl.max}" step="${ctrl.step ?? 1}" value="${cur}" />
    `;
    const input = wrapper.querySelector('input');
    const valEl = wrapper.querySelector('.filter-value');
    let _debounceTimer = null;
    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      valEl.textContent = input.value;
      App.updateSliderFill(input);
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        Store.dispatch({ type: 'UPDATE_MODIFIER_VALUE', elementId, modifierId: item.id, key: ctrl.id, value: val, _transient: true });
      }, 80);
    });
    input.addEventListener('pointerup', () => {
      clearTimeout(_debounceTimer);
      Store.dispatch({ type: 'UPDATE_MODIFIER_VALUE', elementId, modifierId: item.id, key: ctrl.id, value: parseFloat(input.value) });
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
      Store.dispatch({ type: 'UPDATE_MODIFIER_VALUE', elementId, modifierId: item.id, key: ctrl.id, value: e.target.value })
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
      Store.dispatch({ type: 'UPDATE_MODIFIER_VALUE', elementId, modifierId: item.id, key: ctrl.id, value: e.target.checked })
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
      Store.dispatch({ type: 'UPDATE_MODIFIER_VALUE', elementId, modifierId: item.id, key: ctrl.id, value: e.target.value });
    });
  }

  return wrapper;
}

window.UI = { render };
