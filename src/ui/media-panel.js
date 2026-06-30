/**
 * Media panel — list + gizmo edit in the right drawer.
 */

import {
  mediaData,
  getMediaObjects,
  updateMediaTransform,
  saveMediaToDb,
  removeMediaFromDb,
  deleteMediaFromScene,
} from '../ar/media.js';
import {
  flyTo,
  attachGizmo,
  detachGizmo,
  addGizmoDragListener,
  addGizmoDragEndListener,
  setGizmoMode,
} from '../ar/scene.js';
import { showToast } from './toast.js';
import { deleteProjectMediaFile } from '../services/media-storage.js';
import { storagePathFromPublicUrl } from '../utils/media-files.js';
import { openMediaModal } from './media-modal.js';
import { iconSave, iconDelete, iconMediaImage, iconMediaVideo, iconMediaModel } from './icons.js';

let selectedIndex = -1;
let gizmoMode = 'translate';

/**
 * @param {HTMLElement} container
 * @param {{ onMediaChange?: () => void, onEditMedia?: (saved: Record<string, unknown>, context?: { previewUrl?: string }) => void }} [options]
 */
export function createMediaPanel(container, options = {}) {
  const onMediaChange = options.onMediaChange;
  const onEditMedia = options.onEditMedia;

  const panel = document.createElement('div');
  panel.className = 'media-panel hidden';
  panel.id = 'media-panel';

  panel.innerHTML = `
    <div class="drawer-panel-edge drawer-panel-edge--top" aria-hidden="true"></div>
    <div class="media-panel-header poi-panel-header">
      <div class="poi-panel-header-row">
        <div class="poi-panel-title">Media</div>
      </div>
      <p class="media-panel-hint">Use the toolbar “Add media” button, then click on the map.</p>
    </div>
    <div class="media-list poi-list" id="media-list"></div>
    <div class="media-coords poi-coords hidden" id="media-coords">
      <div class="nav-divider"></div>
      <div class="poi-coords-title" id="media-selected-label"></div>
      <div class="media-gizmo-modes">
        <button type="button" class="gizmo-mode-btn active" data-mode="translate">Move</button>
        <button type="button" class="gizmo-mode-btn" data-mode="rotate">Rotate</button>
        <button type="button" class="gizmo-mode-btn" data-mode="scale">Scale</button>
      </div>
      <div class="coord-inputs media-fields-move" id="media-fields-move">
        <div class="coord-group"><span class="field-label field-label--x">X</span><input type="number" id="media-x" step="any" inputmode="decimal" /></div>
        <div class="coord-group"><span class="field-label field-label--y">Y</span><input type="number" id="media-y" step="any" inputmode="decimal" /></div>
        <div class="coord-group"><span class="field-label field-label--z">Z</span><input type="number" id="media-z" step="any" inputmode="decimal" /></div>
      </div>
      <div class="coord-inputs media-fields-rotate hidden" id="media-fields-rotate">
        <div class="coord-group"><span class="field-label field-label--x">X</span><input type="number" id="media-rotx" step="any" /></div>
        <div class="coord-group"><span class="field-label field-label--y">Y</span><input type="number" id="media-roty" step="any" /></div>
        <div class="coord-group"><span class="field-label field-label--z">Z</span><input type="number" id="media-rotz" step="any" /></div>
      </div>
      <div class="coord-inputs media-fields-scale hidden" id="media-fields-scale-plane">
        <div class="coord-group"><span class="field-label">Scale W</span><input type="number" id="media-width-edit" step="any" min="0.1" value="1" /></div>
        <div class="coord-group"><span class="field-label">Scale H</span><input type="number" id="media-height-edit" step="any" min="0.1" value="1" /></div>
      </div>
      <div class="coord-inputs media-fields-scale hidden" id="media-fields-scale-model">
        <div class="coord-group"><span class="field-label">Scale X</span><input type="number" id="media-scale-x" step="any" min="0.01" value="1" /></div>
        <div class="coord-group"><span class="field-label">Scale Y</span><input type="number" id="media-scale-y" step="any" min="0.01" value="1" /></div>
        <div class="coord-group"><span class="field-label">Scale Z</span><input type="number" id="media-scale-z" step="any" min="0.01" value="1" /></div>
      </div>
      <div class="media-panel-details">
        <button type="button" class="btn-secondary media-edit-details-btn" id="btn-edit-media-details">Edit file &amp; label</button>
      </div>
      <div class="poi-actions-row media-panel-save-row">
        <button type="button" class="btn-save poi-btn-save" id="btn-save-media">
          <span class="icon">${iconSave()}</span> Save
        </button>
        <button type="button" class="btn-save btn-delete poi-btn-delete" id="btn-delete-media" title="Delete">${iconDelete()}</button>
      </div>
    </div>
    <div class="drawer-panel-edge drawer-panel-edge--bottom" aria-hidden="true"></div>
  `;

  container.appendChild(panel);

  const listEl = panel.querySelector('#media-list');
  const coordsEl = panel.querySelector('#media-coords');
  const moveFields = panel.querySelector('#media-fields-move');
  const rotateFields = panel.querySelector('#media-fields-rotate');
  const planeScaleFields = panel.querySelector('#media-fields-scale-plane');
  const modelScaleFields = panel.querySelector('#media-fields-scale-model');
  const inputs = {
    x: panel.querySelector('#media-x'),
    y: panel.querySelector('#media-y'),
    z: panel.querySelector('#media-z'),
    rotx: panel.querySelector('#media-rotx'),
    roty: panel.querySelector('#media-roty'),
    rotz: panel.querySelector('#media-rotz'),
    width: panel.querySelector('#media-width-edit'),
    height: panel.querySelector('#media-height-edit'),
    scaleX: panel.querySelector('#media-scale-x'),
    scaleY: panel.querySelector('#media-scale-y'),
    scaleZ: panel.querySelector('#media-scale-z'),
  };

  function mediaTypeIcon(type) {
    if (type === 'video') return iconMediaVideo();
    if (type === 'model') return iconMediaModel();
    return iconMediaImage();
  }

  function updateFieldVisibility(mode = gizmoMode) {
    gizmoMode = mode;
    const showMove = mode === 'translate';
    const showRotate = mode === 'rotate';
    const showScale = mode === 'scale';

    moveFields.classList.toggle('hidden', !showMove);
    rotateFields.classList.toggle('hidden', !showRotate);

    const item = selectedIndex >= 0 ? mediaData[selectedIndex] : null;
    const isPlane = item && (item.media_type === 'image' || item.media_type === 'video');
    const isModel = item && item.media_type === 'model';

    planeScaleFields.classList.toggle('hidden', !showScale || !isPlane);
    modelScaleFields.classList.toggle('hidden', !showScale || !isModel);
  }

  function setMediaGizmoMode(mode) {
    panel.querySelectorAll('.gizmo-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    setGizmoMode(mode);
    updateFieldVisibility(mode);
  }

  function rebuildList() {
    listEl.innerHTML = '';
    mediaData.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'poi-item media-item';
      row.dataset.index = index;
      const inactive = item.is_active ? '' : ' (off)';
      const redirectTag = String(item.redirect_link ?? '').trim() ? ' <span class="media-item-redirect">(link)</span>' : '';
      row.innerHTML = `<span class="media-item-badge" aria-hidden="true">${mediaTypeIcon(item.media_type)}</span><span class="media-item-label">${item.label}${redirectTag}${inactive}</span>`;
      row.addEventListener('click', () => selectMedia(index));
      listEl.appendChild(row);
    });
  }

  function fillInputs(item) {
    inputs.x.value = item.pos_x.toFixed(4);
    inputs.y.value = item.pos_y.toFixed(4);
    inputs.z.value = item.pos_z.toFixed(4);
    inputs.rotx.value = item.rot_x.toFixed(4);
    inputs.roty.value = item.rot_y.toFixed(4);
    inputs.rotz.value = item.rot_z.toFixed(4);
    inputs.width.value = item.width.toFixed(2);
    inputs.height.value = item.height.toFixed(2);
    inputs.scaleX.value = item.scale_x.toFixed(4);
    inputs.scaleY.value = item.scale_y.toFixed(4);
    inputs.scaleZ.value = item.scale_z.toFixed(4);
    updateFieldVisibility(gizmoMode);
  }

  function readInputsIntoItem(index) {
    const item = mediaData[index];
    if (!item) return;
    updateMediaTransform(index, {
      pos_x: parseFloat(inputs.x.value) || 0,
      pos_y: parseFloat(inputs.y.value) || 0,
      pos_z: parseFloat(inputs.z.value) || 0,
      rot_x: parseFloat(inputs.rotx.value) || 0,
      rot_y: parseFloat(inputs.roty.value) || 0,
      rot_z: parseFloat(inputs.rotz.value) || 0,
      scale_x: parseFloat(inputs.scaleX.value) || 1,
      scale_y: parseFloat(inputs.scaleY.value) || 1,
      scale_z: parseFloat(inputs.scaleZ.value) || 1,
      width: parseFloat(inputs.width.value) || 1,
      height: parseFloat(inputs.height.value) || 1,
    });
  }

  function selectMedia(index) {
    selectedIndex = index;
    const item = mediaData[index];
    listEl.querySelectorAll('.poi-item').forEach((el, i) => el.classList.toggle('active', i === index));
    coordsEl.classList.remove('hidden');
    panel.querySelector('#media-selected-label').textContent = item.label;
    fillInputs(item);
    setMediaGizmoMode('translate');
    flyTo(item.pos_x, item.pos_y, item.pos_z);
    const objs = getMediaObjects();
    if (objs[index]?.root) {
      attachGizmo(objs[index].root);
    } else if (!item.is_active) {
      showToast('Inactive — enable to show in 3D', 'info');
    }
  }

  function deselectMedia() {
    selectedIndex = -1;
    coordsEl.classList.add('hidden');
    detachGizmo();
  }

  panel.querySelectorAll('.gizmo-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMediaGizmoMode(btn.dataset.mode));
  });

  panel.querySelector('#btn-save-media').addEventListener('click', async () => {
    if (selectedIndex < 0) return;
    readInputsIntoItem(selectedIndex);
    try {
      await saveMediaToDb(selectedIndex);
      showToast('Media saved', 'success');
      rebuildList();
      onMediaChange?.();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  panel.querySelector('#btn-edit-media-details').addEventListener('click', () => {
    if (selectedIndex < 0) return;
    const item = mediaData[selectedIndex];
    openMediaModal({
      row: { ...item },
      onSaved: (saved, context) => onEditMedia?.(saved, context),
    });
  });

  panel.querySelector('#btn-delete-media').addEventListener('click', async () => {
    if (selectedIndex < 0) return;
    const item = mediaData[selectedIndex];
    if (!confirm(`Delete "${item.label}"?`)) return;
    const deleteStorage = confirm('Also delete file from storage?');
    try {
      await removeMediaFromDb(selectedIndex);
      if (deleteStorage) {
        const path = storagePathFromPublicUrl(item.media_url);
        if (path) await deleteProjectMediaFile(path);
      }
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
    deleteMediaFromScene(selectedIndex);
    deselectMedia();
    rebuildList();
    onMediaChange?.();
    showToast('Media deleted', 'success');
  });

  function onMediaCoordInput() {
    if (selectedIndex < 0) return;
    readInputsIntoItem(selectedIndex);
  }

  [
    inputs.x,
    inputs.y,
    inputs.z,
    inputs.rotx,
    inputs.roty,
    inputs.rotz,
    inputs.width,
    inputs.height,
    inputs.scaleX,
    inputs.scaleY,
    inputs.scaleZ,
  ].forEach((el) => {
    el.addEventListener('input', onMediaCoordInput);
  });

  function onMediaGizmoDrag(transform) {
    if (selectedIndex < 0) return;
    const pos = transform.position;
    const rot = transform.rotation;
    const scl = transform.scale;
    inputs.x.value = pos.x.toFixed(4);
    inputs.y.value = pos.y.toFixed(4);
    inputs.z.value = pos.z.toFixed(4);
    inputs.rotx.value = rot.x.toFixed(4);
    inputs.roty.value = rot.y.toFixed(4);
    inputs.rotz.value = rot.z.toFixed(4);
    inputs.scaleX.value = scl.x.toFixed(4);
    inputs.scaleY.value = scl.y.toFixed(4);
    inputs.scaleZ.value = scl.z.toFixed(4);
    updateMediaTransform(selectedIndex, {
      pos_x: pos.x,
      pos_y: pos.y,
      pos_z: pos.z,
      rot_x: rot.x,
      rot_y: rot.y,
      rot_z: rot.z,
      scale_x: scl.x,
      scale_y: scl.y,
      scale_z: scl.z,
    });
  }

  addGizmoDragListener(onMediaGizmoDrag);
  addGizmoDragEndListener(() => {
    if (selectedIndex < 0) return;
    saveMediaToDb(selectedIndex).catch((err) => console.error('[media-panel]', err));
  });

  return {
    show() {
      panel.classList.remove('hidden');
      gizmoMode = 'translate';
      setMediaGizmoMode('translate');
    },
    hide() {
      panel.classList.add('hidden');
      deselectMedia();
    },
    refresh() {
      rebuildList();
      if (selectedIndex >= 0 && selectedIndex < mediaData.length) {
        selectMedia(selectedIndex);
      } else {
        deselectMedia();
      }
    },
    deselect: deselectMedia,
    selectByIndex(index) {
      if (index >= 0 && index < mediaData.length) selectMedia(index);
    },
  };
}
