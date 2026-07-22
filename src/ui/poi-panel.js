/**
 * POI Panel UI
 * Shows a scrollable list of POIs. Clicking one shows editable fields in the right panel.
 * Add POI is only via the scene toolbar (modal dialog).
 */

import {
  poisData,
  addPOIWithDb,
  deletePOI,
  getPOIObjects,
  removePoiFromDb,
  savePoiToDb,
  updatePOIName,
  updatePOIPosition,
  updatePOIDescription,
} from '../ar/pois.js';
import {
  flyTo,
  attachGizmo,
  detachGizmo,
  addGizmoDragListener,
  addGizmoDragEndListener,
  setLastPickedPoiIndex,
  setSceneInteractionMode,
} from '../ar/scene.js';
import { iconSave, iconDelete, iconAdd } from './icons.js';

/** Default label + origin for quick adds (Journey “+” and empty-name manual add). */
export const DEFAULT_NEW_POI_NAME = 'New POI';

let selectedIndex = -1;
let inputName, inputDescription, inputX, inputY, inputZ;

/**
 * @param {HTMLElement} container
 * @param {{ onPoiListChange?: () => void }} [options]
 */
export function createPOIPanel(container, options = {}) {
  const onPoiListChange = options.onPoiListChange;
  const panel = document.createElement('div');
  panel.className = 'poi-panel hidden';
  panel.id = 'poi-panel';

  panel.innerHTML = `
    <div class="drawer-panel-edge drawer-panel-edge--top" aria-hidden="true"></div>
    <div class="poi-panel-header">
      <div class="poi-panel-header-row">
        <div class="poi-panel-title">Points of interest</div>
      </div>
    </div>
    <div class="poi-list" id="poi-list"></div>
    <div class="poi-coords hidden" id="poi-coords">
      <div class="nav-divider"></div>
      <div class="poi-coords-title" id="poi-selected-name"></div>
      <div class="coord-group" style="padding:0 16px 8px;">
        <span class="field-label">Name of POI</span>
        <input type="text" id="poi-name" value="" />
      </div>
      <div class="coord-group poi-desc-field" style="padding:0 16px 8px;">
        <span class="field-label">Description</span>
        <textarea id="poi-description" rows="3" placeholder="Enter POI description"></textarea>
      </div>
      <div class="coord-inputs">
        <div class="coord-group">
          <span class="field-label" style="color:#ef4444;font-weight:700;">X</span>
          <input type="number" id="poi-x" value="0" step="any" />
        </div>
        <div class="coord-group">
          <span class="field-label" style="color:#22c55e;font-weight:700;">Y</span>
          <input type="number" id="poi-y" value="0" step="any" />
        </div>
        <div class="coord-group">
          <span class="field-label" style="color:#3b82f6;font-weight:700;">Z</span>
          <input type="number" id="poi-z" value="0" step="any" />
        </div>
      </div>
      <div class="poi-actions-row">
        <button type="button" class="btn-save poi-btn-save" id="btn-save-poi">
          <span class="icon">${iconSave()}</span> Save Changes
        </button>
        <button type="button" class="btn-save btn-delete btn-delete-poi poi-btn-delete" id="btn-delete-poi" title="Delete POI" aria-label="Delete POI">
          ${iconDelete()}
        </button>
      </div>
    </div>
    <div class="drawer-panel-edge drawer-panel-edge--bottom" aria-hidden="true"></div>
  `;

  container.appendChild(panel);

  const addDialogHost = document.getElementById('app') || document.body;
  const addDialog = document.createElement('div');
  addDialog.className = 'poi-add-dialog media-modal-overlay hidden';
  addDialog.id = 'poi-add-dialog';
  addDialog.setAttribute('role', 'dialog');
  addDialog.setAttribute('aria-modal', 'true');
  addDialog.setAttribute('aria-labelledby', 'poi-add-dialog-title');
  addDialog.innerHTML = `
    <div class="poi-add-dialog-backdrop" data-action="close"></div>
    <div class="poi-add-dialog-card media-modal-card">
      <header class="poi-add-dialog-header">
        <h3 class="poi-add-dialog-title" id="poi-add-dialog-title">Add New POI</h3>
        <button type="button" class="poi-add-dialog-close" data-action="close" aria-label="Close">&times;</button>
      </header>
      <div class="media-modal-form">
        <div class="coord-group poi-add-field">
          <span class="field-label">Name of POI</span>
          <input type="text" id="new-poi-name" placeholder="Enter a POI name" />
        </div>
        <div class="coord-group poi-add-field">
          <span class="field-label">Description</span>
          <textarea id="new-poi-description" rows="3" placeholder="Enter POI description (optional)"></textarea>
        </div>
        <div class="coord-inputs poi-add-coords">
          <div class="coord-group">
            <span class="field-label coord-axis coord-axis-x">X</span>
            <input type="number" id="new-poi-x" value="0" step="any" />
          </div>
          <div class="coord-group">
            <span class="field-label coord-axis coord-axis-y">Y</span>
            <input type="number" id="new-poi-y" value="0" step="any" />
          </div>
          <div class="coord-group">
            <span class="field-label coord-axis coord-axis-z">Z</span>
            <input type="number" id="new-poi-z" value="0" step="any" />
          </div>
        </div>
      </div>
      <footer class="poi-add-dialog-actions media-modal-footer">
        <button type="button" class="btn-secondary" data-action="close">Cancel</button>
        <button type="button" class="btn-save" id="btn-add-poi">
          <span class="icon">${iconAdd()}</span> Add POI
        </button>
      </footer>
    </div>
  `;
  addDialogHost.appendChild(addDialog);

  const listEl = panel.querySelector('#poi-list');
  const coordsEl = panel.querySelector('#poi-coords');
  const selectedNameEl = panel.querySelector('#poi-selected-name');
  inputName = panel.querySelector('#poi-name');
  inputDescription = panel.querySelector('#poi-description');
  inputX = panel.querySelector('#poi-x');
  inputY = panel.querySelector('#poi-y');
  inputZ = panel.querySelector('#poi-z');
  const btnSave = panel.querySelector('#btn-save-poi');
  const btnDelete = panel.querySelector('#btn-delete-poi');
  const btnAdd = addDialog.querySelector('#btn-add-poi');
  const newPoiName = addDialog.querySelector('#new-poi-name');
  const newPoiDescription = addDialog.querySelector('#new-poi-description');
  const newPoiX = addDialog.querySelector('#new-poi-x');
  const newPoiY = addDialog.querySelector('#new-poi-y');
  const newPoiZ = addDialog.querySelector('#new-poi-z');

  function rebuildList() {
    listEl.innerHTML = '';
    poisData.forEach((poi, index) => {
      const item = document.createElement('div');
      item.className = 'poi-item';
      item.dataset.index = index;
      item.textContent = poi.poi_name;
      item.addEventListener('click', () => selectPOI(index));
      listEl.appendChild(item);
    });
  }
  rebuildList();

  panel.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.poi-item')) return;
    if (e.target.closest('#poi-coords')) return;
    deselectPOI();
  });

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (panel.classList.contains('hidden')) return;
      if (panel.contains(e.target)) return;
      if (addDialog.contains(e.target)) return;
      if (e.target.closest('.viewport-body, .viewport-3d, .scene-stage, canvas')) return;
      deselectPOI();
    },
    true,
  );

  function deselectPOI() {
    if (selectedIndex < 0) return;
    selectedIndex = -1;
    coordsEl.classList.add('hidden');
    listEl.querySelectorAll('.poi-item').forEach((el) => el.classList.remove('active'));
    detachGizmo();
  }

  /**
   * @param {number} index
   * @param {{ fly?: boolean, cancelTool?: boolean }} [options]
   *   fly — move camera to the POI (default true)
   *   cancelTool — exit Go to / Add POI / Add media (default true)
   */
  function selectPOI(index, options = {}) {
    selectedIndex = index;
    setLastPickedPoiIndex(index);
    const poi = poisData[index];

    listEl.querySelectorAll('.poi-item').forEach((el, i) => {
      el.classList.toggle('active', i === index);
    });

    coordsEl.classList.remove('hidden');
    selectedNameEl.textContent = poi.poi_name;
    inputName.value = poi.poi_name;
    inputDescription.value = poi.description ?? '';
    inputX.value = poi.pos_x.toFixed(4);
    inputY.value = poi.pos_y.toFixed(4);
    inputZ.value = poi.pos_z.toFixed(4);

    if (options.fly !== false) {
      flyTo(poi.pos_x, poi.pos_y, poi.pos_z);
    }

    if (options.cancelTool !== false) {
      setSceneInteractionMode('default');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('spacecheck-scene-tool-cancel'));
      }
    }

    const objs = getPOIObjects();
    if (objs[index]?.mesh) {
      attachGizmo(objs[index].mesh);
    }
  }

  function fillAddDialogDefaults({ name = '', description = '', x = 0, y = 0, z = 0 } = {}) {
    newPoiName.value = name;
    newPoiDescription.value = description;
    newPoiX.value = Number(x).toFixed(4);
    newPoiY.value = Number(y).toFixed(4);
    newPoiZ.value = Number(z).toFixed(4);
  }

  function openAddDialog(preset = {}) {
    fillAddDialogDefaults(preset);
    addDialog.classList.remove('hidden');
    requestAnimationFrame(() => newPoiName.focus());
  }

  function closeAddDialog() {
    addDialog.classList.add('hidden');
  }

  addDialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="close"]')) closeAddDialog();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !addDialog.classList.contains('hidden')) {
      closeAddDialog();
    }
  });

  btnSave.addEventListener('click', async () => {
    if (selectedIndex < 0) return;
    const name = inputName.value.trim();
    const x = parseFloat(inputX.value) || 0;
    const y = parseFloat(inputY.value) || 0;
    const z = parseFloat(inputZ.value) || 0;
    if (name) {
      updatePOIName(selectedIndex, name);
      selectedNameEl.textContent = name;
    }
    updatePOIDescription(selectedIndex, inputDescription.value.trim());
    updatePOIPosition(selectedIndex, x, y, z);
    rebuildList();
    selectPOI(selectedIndex);

    btnSave.disabled = true;
    try {
      await savePoiToDb(selectedIndex);
      onPoiListChange?.();
      btnSave.textContent = 'Saved';
    } catch (err) {
      console.error(err);
      btnSave.textContent = 'DB error';
    } finally {
      setTimeout(() => {
        btnSave.disabled = false;
        btnSave.innerHTML = `<span class="icon">${iconSave()}</span> Save Changes`;
      }, 1400);
    }
  });

  btnAdd.addEventListener('click', async () => {
    const name = newPoiName.value.trim() || DEFAULT_NEW_POI_NAME;
    const x = parseFloat(newPoiX.value) || 0;
    const y = parseFloat(newPoiY.value) || 0;
    const z = parseFloat(newPoiZ.value) || 0;
    btnAdd.disabled = true;
    try {
      const idx = await addPOIWithDb({
        poi_name: name,
        description: newPoiDescription.value.trim(),
        pos_x: x,
        pos_y: y,
        pos_z: z,
      });
      rebuildList();
      // Stay at the placement view (no zoom-out / fly-away after Go to → Add POI).
      // cancelTool exits Add POI mode and hides the Exit control.
      selectPOI(idx, { fly: false });
      closeAddDialog();
      onPoiListChange?.();
    } catch (err) {
      console.error(err);
      alert(`Could not add POI: ${err.message}`);
    } finally {
      btnAdd.disabled = false;
    }
  });

  btnDelete.addEventListener('click', async () => {
    if (selectedIndex < 0) return;
    const name = poisData[selectedIndex]?.poi_name || 'this POI';
    if (!confirm(`Delete ${name}?`)) return;
    btnDelete.disabled = true;
    try {
      await removePoiFromDb(selectedIndex);
    } catch (err) {
      console.error(err);
    }
    deletePOI(selectedIndex);
    detachGizmo();
    selectedIndex = -1;
    coordsEl.classList.add('hidden');
    rebuildList();
    onPoiListChange?.();
    btnDelete.disabled = false;
  });

  function syncCoordInputsFromData(index) {
    const poi = poisData[index];
    if (!poi) return;
    inputX.value = poi.pos_x.toFixed(4);
    inputY.value = poi.pos_y.toFixed(4);
    inputZ.value = poi.pos_z.toFixed(4);
  }

  function onPoiCoordInput() {
    if (selectedIndex < 0) return;
    const x = parseFloat(inputX.value);
    const y = parseFloat(inputY.value);
    const z = parseFloat(inputZ.value);
    if (![x, y, z].every(Number.isFinite)) return;
    updatePOIPosition(selectedIndex, x, y, z);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('spacecheck-poi-dragging-xy', {
          detail: { index: selectedIndex, x, y, z },
        }),
      );
    }
  }

  [inputX, inputY, inputZ].forEach((el) => {
    el.addEventListener('input', onPoiCoordInput);
  });

  function onGizmoDrag(transform) {
    if (selectedIndex < 0) return;
    const pos = transform.position;
    inputX.value = pos.x.toFixed(4);
    inputY.value = pos.y.toFixed(4);
    inputZ.value = pos.z.toFixed(4);
    updatePOIPosition(selectedIndex, pos.x, pos.y, pos.z);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('spacecheck-poi-dragging-xy', {
          detail: { index: selectedIndex, x: pos.x, y: pos.y, z: pos.z },
        }),
      );
    }
  }

  function onExternalPoiXY(ev) {
    const d = ev.detail;
    if (!d || typeof d.index !== 'number') return;
    updatePOIPosition(d.index, Number(d.x), Number(d.y), Number(d.z));
    if (selectedIndex === d.index) {
      syncCoordInputsFromData(d.index);
    }
  }

  function onExternalPoiMoved(ev) {
    onExternalPoiXY(ev);
    const d = ev.detail;
    if (!d || typeof d.index !== 'number') return;
    savePoiToDb(d.index).catch((err) => console.error('[poi-panel] save after drag:', err));
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('spacecheck-poi-dragging-xy', onExternalPoiXY);
    window.addEventListener('spacecheck-poi-moved-xy', onExternalPoiMoved);
  }

  addGizmoDragListener(onGizmoDrag);
  addGizmoDragEndListener(() => {
    if (selectedIndex < 0) return;
    const idx = selectedIndex;
    const p = poisData[idx];
    if (p && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('spacecheck-poi-moved-xy', {
          detail: { index: idx, x: p.pos_x, y: p.pos_y, z: p.pos_z },
        }),
      );
    }
    savePoiToDb(selectedIndex).catch((err) => console.error('[poi-panel] save after gizmo:', err));
  });

  return {
    show() {
      panel.classList.remove('hidden');
    },
    hide() {
      panel.classList.add('hidden');
      deselectPOI();
    },
    deselect() {
      deselectPOI();
    },
    selectByIndex(index) {
      if (index >= 0 && index < poisData.length) selectPOI(index);
    },
    refresh() {
      rebuildList();
      if (selectedIndex >= 0 && selectedIndex < poisData.length) {
        // Sync list highlight + editor fields only. Do not fly, cancel tools, or
        // re-attach the gizmo — that would break Go to → Add POI at the same view.
        const poi = poisData[selectedIndex];
        listEl.querySelectorAll('.poi-item').forEach((el, i) => {
          el.classList.toggle('active', i === selectedIndex);
        });
        coordsEl.classList.remove('hidden');
        selectedNameEl.textContent = poi.poi_name;
        inputName.value = poi.poi_name;
        inputDescription.value = poi.description ?? '';
        inputX.value = poi.pos_x.toFixed(4);
        inputY.value = poi.pos_y.toFixed(4);
        inputZ.value = poi.pos_z.toFixed(4);
      } else {
        selectedIndex = -1;
        coordsEl.classList.add('hidden');
      }
    },
    openAddDialog,
    /** @deprecated Use openAddDialog — opens the add dialog at origin. */
    addDefaultPoiAtOrigin() {
      openAddDialog({ x: 0, y: 0, z: 0, name: '' });
    },
  };
}
