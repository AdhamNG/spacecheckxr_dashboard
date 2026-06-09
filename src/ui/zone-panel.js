/**
 * Zone Panel UI
 * Manages 3D zone boxes (cuboids) — CRUD tied to access_control_zones + ar_ropin_zones.
 */
import {
  fetchAllAccessZones,
  createAccessZone,
  updateAccessZone,
  deleteAccessZone,
  createRopinZone,
  deleteRopinZoneByAccessId,
} from '../services/supabase.js';
import { addZoneBox, updateZoneBox, removeZoneBox, clearAllZoneBoxes, setPreviewBox, clearPreviewBox, getZoneObjects, syncZoneVisuals } from '../ar/zone-box.js';
import { flyTo, getCamera, getCanvas, getScene, setOrbitEnabled, attachGizmo, detachGizmo, setGizmoDragCallback, setGizmoMode } from '../ar/scene.js';
import * as THREE from 'three';
import { iconSave, iconDelete, iconEdit, iconBox, iconClose } from './icons.js';

const DEFAULT_FLOOR_ID = 'c6e4ff7b-94ce-4062-9fce-20d99bf2d077';

let zones = [];
let selectedZone = null;

export function createZonePanel(container) {
  const panel = document.createElement('div');
  panel.className = 'zone-panel hidden';
  panel.id = 'zone-panel';

  panel.innerHTML = `
    <div class="zone-panel-header">
      <div class="nav-title">ZONES</div>
    </div>

    <div class="zone-list" id="zone-list">
      <div class="zone-loading">Loading zones…</div>
    </div>

    <div class="zone-detail hidden" id="zone-detail">
      <div class="nav-divider"></div>
      <div class="zone-detail-title" id="zone-selected-label"></div>

      <div class="coord-group" style="padding:0 16px 8px;">
        <label>Label</label>
        <input type="text" id="zone-label-input" />
      </div>

      <div class="coord-inputs">
        <div class="coord-group">
          <label style="color:#ef4444;font-weight:700;">X</label>
          <input type="number" id="zone-x" value="0" step="any" />
        </div>
        <div class="coord-group">
          <label style="color:#22c55e;font-weight:700;">Y</label>
          <input type="number" id="zone-y" value="0" step="any" />
        </div>
        <div class="coord-group">
          <label style="color:#3b82f6;font-weight:700;">Z</label>
          <input type="number" id="zone-z" value="0" step="any" />
        </div>
      </div>

      <div class="coord-inputs">
        <div class="coord-group">
          <label style="color:#ffaa00;font-weight:700;">W (breadth)</label>
          <input type="number" id="zone-w" value="10" step="any" />
        </div>
        <div class="coord-group">
          <label style="color:#ffaa00;font-weight:700;">H (length)</label>
          <input type="number" id="zone-h" value="10" step="any" />
        </div>
        <div class="coord-group">
          <label style="color:#a855f7;font-weight:700;">Rotation</label>
          <input type="number" id="zone-rotation" value="0" step="any" />
        </div>
      </div>

      <div class="nav-divider"></div>
      <div class="transform-modes" style="display:flex;gap:8px;padding:0 16px 12px;">
        <button class="btn-mode active" id="btn-mode-move" title="Move (T)">Move</button>
        <button class="btn-mode" id="btn-mode-rotate" title="Rotate (R)">Rotate</button>
        <button class="btn-mode" id="btn-mode-scale" title="Scale (S)">Scale</button>
      </div>

      <div style="display:flex;gap:8px;padding:0 16px;">
        <button class="btn-save" id="btn-save-zone" style="flex:1;margin:0;">
          <span class="icon">${iconSave()}</span> Save Changes
        </button>
        <button class="btn-save btn-delete" id="btn-delete-zone" style="width:auto;margin:0;padding:10px 12px;" title="Delete Zone" aria-label="Delete Zone">
          ${iconDelete()}
        </button>
      </div>
    </div>

    <div class="nav-divider"></div>
    <div class="nav-subtitle">Draw New Zone</div>
    <div class="coord-group" style="padding:0 16px 8px;">
      <label>Zone Name</label>
      <input type="text" id="new-zone-name" placeholder="e.g. Server Room" />
    </div>
    <button class="btn-save zone-draw-btn" id="btn-draw-zone" style="background:linear-gradient(135deg,rgba(255,170,0,0.3),rgba(255,170,0,0.15));border:1px solid rgba(255,170,0,0.4);color:#ffaa00;">
      <span class="icon">${iconEdit()}</span> Draw on Map
    </button>
    <div class="zone-draw-status hidden" id="zone-draw-status">
      <span class="zone-draw-pulse"></span>
      <span>Click &amp; drag on the 3D map to draw the zone box</span>
    </div>
    <div class="zone-draw-result hidden" id="zone-draw-result">
      <div class="coord-inputs">
        <div class="coord-group">
          <label style="color:#ef4444;font-weight:700;">X</label>
          <input type="number" id="new-zone-x" value="0" step="any" />
        </div>
        <div class="coord-group">
          <label style="color:#22c55e;font-weight:700;">Y</label>
          <input type="number" id="new-zone-y" value="0" step="any" />
        </div>
        <div class="coord-group">
          <label style="color:#3b82f6;font-weight:700;">Z</label>
          <input type="number" id="new-zone-z" value="0" step="any" />
        </div>
      </div>
      <div class="coord-inputs">
        <div class="coord-group">
          <label style="color:#ffaa00;font-weight:700;">W</label>
          <input type="number" id="new-zone-w" value="0" step="any" />
        </div>
        <div class="coord-group">
          <label style="color:#ffaa00;font-weight:700;">H</label>
          <input type="number" id="new-zone-h" value="0" step="any" />
        </div>
      </div>
      <div style="display:flex;gap:8px;padding:0 16px;">
        <button class="btn-save" id="btn-confirm-zone" style="flex:1;margin:0;">
          <span class="icon">${iconBox()}</span> Confirm &amp; Save
        </button>
        <button class="btn-save btn-delete" id="btn-cancel-draw" style="width:auto;margin:0;padding:10px 12px;" aria-label="Cancel draw">
          ${iconClose()}
        </button>
      </div>
    </div>
  `;

  container.appendChild(panel);

  const listEl = panel.querySelector('#zone-list');
  const detailEl = panel.querySelector('#zone-detail');
  const selectedLabelEl = panel.querySelector('#zone-selected-label');
  const labelInput = panel.querySelector('#zone-label-input');
  const inputX = panel.querySelector('#zone-x');
  const inputY = panel.querySelector('#zone-y');
  const inputZ = panel.querySelector('#zone-z');
  const inputW = panel.querySelector('#zone-w');
  const inputH = panel.querySelector('#zone-h');
  const inputRot = panel.querySelector('#zone-rotation');
  const btnModeMove = panel.querySelector('#btn-mode-move');
  const btnModeRotate = panel.querySelector('#btn-mode-rotate');
  const btnModeScale = panel.querySelector('#btn-mode-scale');
  const btnSave = panel.querySelector('#btn-save-zone');
  const btnDelete = panel.querySelector('#btn-delete-zone');
  const btnDraw = panel.querySelector('#btn-draw-zone');
  const drawStatus = panel.querySelector('#zone-draw-status');
  const drawResult = panel.querySelector('#zone-draw-result');
  const btnConfirm = panel.querySelector('#btn-confirm-zone');
  const btnCancelDraw = panel.querySelector('#btn-cancel-draw');
  const newName = panel.querySelector('#new-zone-name');
  const newX = panel.querySelector('#new-zone-x');
  const newY = panel.querySelector('#new-zone-y');
  const newZ = panel.querySelector('#new-zone-z');
  const newW = panel.querySelector('#new-zone-w');
  const newH = panel.querySelector('#new-zone-h');

  let isDrawing = false;
  let drawStart = null;
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function raycastGround(event) {
    const canvas = getCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, getCamera());

    // Prefer real mesh intersection so Y follows actual map height.
    const scene = getScene();
    if (scene) {
      const mapRoot = scene.getObjectByName('MapMesh');
      if (mapRoot) {
        const hits = raycaster.intersectObject(mapRoot, true);
        const meshHit = hits.find((h) => h.object && h.object.isMesh);
        if (meshHit) return meshHit.point.clone();
      }
    }

    // Fallback to y=0 plane when no mesh is available.
    const hit = new THREE.Vector3();
    const intersected = raycaster.ray.intersectPlane(groundPlane, hit);
    return intersected ? hit : null;
  }

  function onDrawMouseDown(e) {
    if (e.button !== 0) return;
    const pt = raycastGround(e);
    if (!pt) return;
    drawStart = pt.clone();
    setPreviewBox(pt.x, pt.y, pt.z, 0.1, 0.1);
  }

  function onDrawMouseMove(e) {
    if (!drawStart) return;
    const pt = raycastGround(e);
    if (!pt) return;
    const x = Math.min(drawStart.x, pt.x);
    const z = Math.min(drawStart.z, pt.z);
    const w = Math.abs(pt.x - drawStart.x);
    const h = Math.abs(pt.z - drawStart.z);
    setPreviewBox(x, drawStart.y, z, w, h);
  }

  function onDrawMouseUp(e) {
    if (e.button !== 0 || !drawStart) return;
    const pt = raycastGround(e);
    if (!pt) { exitDrawMode(); return; }
    const x = Math.min(drawStart.x, pt.x);
    const z = Math.min(drawStart.z, pt.z);
    const w = Math.abs(pt.x - drawStart.x);
    const h = Math.abs(pt.z - drawStart.z);

    if (w < 0.3 && h < 0.3) { exitDrawMode(); return; }

    newX.value = (x + w / 2).toFixed(2);
    newY.value = drawStart.y.toFixed(2);
    newZ.value = (z + h / 2).toFixed(2);
    newW.value = w.toFixed(2);
    newH.value = h.toFixed(2);

    stopListeners();
    drawStatus.classList.add('hidden');
    drawResult.classList.remove('hidden');
    btnDraw.classList.add('hidden');
    setOrbitEnabled(true);
    const canvas = getCanvas();
    if (canvas) canvas.style.cursor = '';
    isDrawing = false;
  }

  function stopListeners() {
    const canvas = getCanvas();
    if (!canvas) return;
    canvas.removeEventListener('pointerdown', onDrawMouseDown);
    canvas.removeEventListener('pointermove', onDrawMouseMove);
    canvas.removeEventListener('pointerup', onDrawMouseUp);
  }

  function exitDrawMode() {
    stopListeners();
    clearPreviewBox();
    drawStart = null;
    isDrawing = false;
    setOrbitEnabled(true);
    const canvas = getCanvas();
    if (canvas) canvas.style.cursor = '';
    drawStatus.classList.add('hidden');
    drawResult.classList.add('hidden');
    btnDraw.classList.remove('hidden');
  }

  async function loadZones() {
    listEl.innerHTML = '<div class="zone-loading">Loading zones…</div>';
    try {
      zones = await fetchAllAccessZones();
      clearAllZoneBoxes();
      renderList();
      zones.forEach((z) => {
        addZoneBox({
          id: z.id,
          label: z.label,
          x: Number(z.x),
          y: Number(z.y),
          z: Number(z.z),
          w: Number(z.w),
          h: Number(z.h),
          rotation: Number(z.rotation || 0),
        });
      });
    } catch (err) {
      listEl.innerHTML = `<div class="zone-loading" style="color:var(--red);">${err.message}</div>`;
    }
  }

  function renderList() {
    listEl.innerHTML = '';
    if (!zones.length) {
      listEl.innerHTML = '<div class="zone-loading">No zones found</div>';
      return;
    }
    zones.forEach((z) => {
      const item = document.createElement('div');
      item.className = 'poi-item' + (selectedZone && selectedZone.id === z.id ? ' active' : '');
      item.textContent = z.label;
      item.addEventListener('click', () => selectZone(z));
      listEl.appendChild(item);
    });
  }

  function selectZone(z) {
    selectedZone = z;
    detailEl.classList.remove('hidden');
    selectedLabelEl.textContent = z.label;
    labelInput.value = z.label;
    inputX.value = Number(z.x);
    inputY.value = Number(z.y);
    inputZ.value = Number(z.z);
    inputW.value = Number(z.w);
    inputH.value = Number(z.h);
    inputRot.value = Number(z.rotation || 0);
    renderList();
    flyTo(Number(z.x), Number(z.y), Number(z.z));

    // Attach gizmo to this zone's mesh
    const entries = getZoneObjects();
    const entry = entries.find(e => e.id === z.id);
    if (entry) {
      attachGizmo(entry.mesh);
      setGizmoMode('translate');
      updateModeButtons('move');
    }
  }

  function updateModeButtons(activeMode) {
    btnModeMove.classList.toggle('active', activeMode === 'move');
    btnModeRotate.classList.toggle('active', activeMode === 'rotate');
    btnModeScale.classList.toggle('active', activeMode === 'scale');
  }

  btnModeMove.addEventListener('click', () => { setGizmoMode('translate'); updateModeButtons('move'); });
  btnModeRotate.addEventListener('click', () => { setGizmoMode('rotate'); updateModeButtons('rotate'); });
  btnModeScale.addEventListener('click', () => { setGizmoMode('scale'); updateModeButtons('scale'); });

  // Listen for gizmo drag
  setGizmoDragCallback((transform) => {
    if (!selectedZone) return;
    
    const pos = transform.position;
    const rot = transform.rotation;
    const scale = transform.scale;

    // Direct center sync (matching Mattercraft)
    inputX.value = pos.x.toFixed(2);
    inputY.value = pos.y.toFixed(2);
    inputZ.value = pos.z.toFixed(2);
    
    const w = selectedZone.w * scale.x;
    const h = selectedZone.h * scale.z;
    inputW.value = w.toFixed(2);
    inputH.value = h.toFixed(2);
    
    // Rotation (radians)
    inputRot.value = rot.y.toFixed(4);

    // Update visuals (wireframe, label)
    syncZoneVisuals(selectedZone.id);
  });

  btnSave.addEventListener('click', async () => {
    if (!selectedZone) return;
    const label = labelInput.value.trim() || selectedZone.label;
    const x = parseFloat(inputX.value) || 0;
    const y = parseFloat(inputY.value) || 0;
    const z = parseFloat(inputZ.value) || 0;
    const w = parseFloat(inputW.value) || 1;
    const h = parseFloat(inputH.value) || 1;
    const rotation = parseFloat(inputRot.value) || 0;
 
    try {
      await updateAccessZone(selectedZone.id, { label, x, y, z, w, h, rotation, updated_at: new Date().toISOString() });
      updateZoneBox(selectedZone.id, { x, y, z, w, h, rotation, label });
      Object.assign(selectedZone, { label, x, y, z, w, h, rotation });
      selectedLabelEl.textContent = label;
      renderList();

      btnSave.textContent = '✓ Saved!';
      btnSave.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
      setTimeout(() => {
        btnSave.innerHTML = `<span class="icon">${iconSave()}</span> Save Changes`;
        btnSave.style.background = '';
      }, 1200);
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  });

  btnDelete.addEventListener('click', async () => {
    if (!selectedZone) return;
    if (!confirm(`Delete zone "${selectedZone.label}"?`)) return;
    try {
      await deleteRopinZoneByAccessId(selectedZone.zone_id);
      await deleteAccessZone(selectedZone.id);
      removeZoneBox(selectedZone.id);
      zones = zones.filter((z) => z.id !== selectedZone.id);
      selectedZone = null;
      detailEl.classList.add('hidden');
      renderList();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  });

  btnDraw.addEventListener('click', () => {
    const name = newName.value.trim();
    if (!name) { newName.focus(); return; }

    isDrawing = true;
    drawStart = null;
    drawStatus.classList.remove('hidden');
    drawResult.classList.add('hidden');
    btnDraw.classList.add('hidden');
    setOrbitEnabled(false);

    const canvas = getCanvas();
    if (canvas) {
      canvas.style.cursor = 'crosshair';
      canvas.addEventListener('pointerdown', onDrawMouseDown);
      canvas.addEventListener('pointermove', onDrawMouseMove);
      canvas.addEventListener('pointerup', onDrawMouseUp);
    }
  });

  btnCancelDraw.addEventListener('click', () => {
    clearPreviewBox();
    exitDrawMode();
  });

  btnConfirm.addEventListener('click', async () => {
    const name = newName.value.trim();
    if (!name) return;
    const x = parseFloat(newX.value) || 0;
    const y = parseFloat(newY.value) || 0;
    const z = parseFloat(newZ.value) || 0;
    const w = parseFloat(newW.value) || 1;
    const h = parseFloat(newH.value) || 1;
    const zoneId = `zone-${Date.now()}`;

    try {
      const [created] = await createAccessZone({
        zone_id: zoneId,
        label: name,
        type: 'other',
        x, y, z, w, h,
        is_blocked: false,
        floor: 'ground',
        zone_type: 'normal',
      });

      await createRopinZone({
        floor_id: DEFAULT_FLOOR_ID,
        zone_name: name.toLowerCase().replace(/\s+/g, '_'),
        status: 'OPEN',
        weight_factor: 1,
        is_active: true,
        access_zone_id: zoneId,
        name_display: name,
      });

      clearPreviewBox();
      zones.unshift(created);
      addZoneBox({ id: created.id, label: name, x, y, z, w, h });
      renderList();
      selectZone(created);
      newName.value = '';
      drawResult.classList.add('hidden');
      btnDraw.classList.remove('hidden');
    } catch (err) {
      alert('Create failed: ' + err.message);
    }
  });

  loadZones();

  return {
    show() { panel.classList.remove('hidden'); },
    hide() { panel.classList.add('hidden'); },
    reload() { loadZones(); },
  };
}
