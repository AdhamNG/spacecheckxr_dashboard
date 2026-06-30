import * as THREE from 'three';
import { fetchAllPois, insertPoiRow, updatePoiRow, deletePoiRow } from '../services/supabase.js';
import { DUMMY_POI_SEED_ROWS } from '../data/poi-dummy-seed.js';

/** In-memory POIs synced with `pj_pois` — each item may include `id` (uuid) when stored in DB */
export const poisData = [];

/** Map a Supabase row to the shape used by the 3D UI */
export function normalizePoiRow(row) {
  return {
    id: row.id,
    poi_name: row.poi_name ?? row.title ?? row.name ?? 'POI',
    description: row.description ?? row.poi_description ?? '',
    pos_x: Number(row.pos_x),
    pos_y: Number(row.pos_y),
    pos_z: Number(row.pos_z),
    sort_order: row.sort_order != null ? Number(row.sort_order) : 0,
  };
}

export function sortPoisDataInPlace() {
  poisData.sort(
    (a, b) =>
      (a.sort_order ?? 999) - (b.sort_order ?? 999) ||
      String(a.poi_name).localeCompare(String(b.poi_name))
  );
}

/**
 * Load POIs from `pj_pois` before building the 3D scene.
 */
export async function hydratePoisFromSupabase() {
  poisData.length = 0;
  try {
    const rows = await fetchAllPois();
    rows.forEach((r) => poisData.push(normalizePoiRow(r)));
    sortPoisDataInPlace();
  } catch (err) {
    console.error('[pois] Failed to load from Supabase:', err);
  }
}

/**
 * Insert 10 demo POIs when the table is empty (003 … 370, sort_order 1–10).
 * Requires optional column `sort_order` on `pj_pois` for ordering (add in SQL if PATCH fails).
 */
export async function seedDummyPoisWhenEmpty() {
  if (poisData.length > 0) return;
  for (const row of DUMMY_POI_SEED_ROWS) {
    try {
      await insertPoiRow(row);
    } catch (e1) {
      try {
        const { sort_order: _s, ...rest } = row;
        await insertPoiRow(rest);
      } catch (e2) {
        console.warn('[pois] Seed insert failed:', e2);
      }
    }
  }
}

/** Rebuild POI meshes under the map anchor (after reorder or hydrate). */
export function refreshPOIGroup(container) {
  if (!container) return;
  addPOIsToScene(container);
}

/**
 * Apply new visit order from the roadmap (array of POI ids left-to-right).
 */
export async function applyRoadmapReorder(orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const p = poisData.find((x) => x.id === id);
    if (!p) continue;
    p.sort_order = i + 1;
    try {
      await updatePoiRow(id, {
        sort_order: i + 1,
        poi_name: p.poi_name,
        description: p.description ?? '',
        pos_x: p.pos_x,
        pos_y: p.pos_y,
        pos_z: p.pos_z,
      });
    } catch {
      try {
        await updatePoiRow(id, {
          poi_name: p.poi_name,
          pos_x: p.pos_x,
          pos_y: p.pos_y,
          pos_z: p.pos_z,
        });
      } catch (e2) {
        console.warn('[pois] reorder PATCH failed', e2);
      }
    }
  }
  sortPoisDataInPlace();
}

const poiObjects = [];
let poiGroupRef = null;
/** Persisted when POIGroup is rebuilt (e.g. tracking hides POIs). */
let poiGroupVisible = true;

function createTextSprite(message) {
  const fontface = 'Arial';
  const fontsize = 20;
  const padding = 5;
  const borderRadius = 6;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');

  context.font = `Bold ${fontsize}px ${fontface}`;
  const metrics = context.measureText(message);
  const textWidth = metrics.width;

  canvas.width = textWidth + padding * 2;
  canvas.height = fontsize * 1.4 + padding * 2;

  context.font = `Bold ${fontsize}px ${fontface}`;
  context.textBaseline = 'middle';
  context.textAlign = 'center';

  context.fillStyle = 'rgba(10, 10, 20, 0.8)';
  context.beginPath();
  context.roundRect(0, 0, canvas.width, canvas.height, borderRadius);
  context.fill();

  context.lineWidth = 1.5;
  context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  context.stroke();

  context.fillStyle = 'rgba(255, 255, 255, 1.0)';
  context.fillText(message, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(spriteMaterial);

  const scaleObj = 0.62;
  sprite.scale.set(scaleObj * (canvas.width / canvas.height), scaleObj, 1);

  return sprite;
}

export function addPOIsToScene(container) {
  const existing = container.getObjectByName('POIGroup');
  if (existing) container.remove(existing);

  poiObjects.length = 0;

  const poiGroup = new THREE.Group();
  poiGroup.name = 'POIGroup';
  poiGroupRef = poiGroup;

  const dotMat = new THREE.MeshBasicMaterial({ color: 0xff3366 });

  poisData.forEach((poi, index) => {
    const dotGeo = new THREE.SphereGeometry(0.18, 12, 12);
    const obj = createPOIObject(poi, index, dotGeo, dotMat);
    poiGroup.add(obj.mesh);
    poiGroup.add(obj.label);
    poiObjects.push(obj);
  });

  poiGroup.visible = poiGroupVisible;
  container.add(poiGroup);
}

/** Hide/show all POI meshes (e.g. hide while Track panel is open). Survives POIGroup rebuilds. */
export function setPOIGroupVisible(visible) {
  poiGroupVisible = Boolean(visible);
  if (poiGroupRef) poiGroupRef.visible = poiGroupVisible;
}

export function getPOIObjects() {
  return poiObjects;
}

export function updatePOIPosition(index, x, y, z) {
  const obj = poiObjects[index];
  if (!obj) return;
  obj.mesh.position.set(x, y, z);
  obj.label.position.set(x, y + 0.85, z);
  poisData[index].pos_x = x;
  poisData[index].pos_y = y;
  poisData[index].pos_z = z;
}

export function updatePOIName(index, name) {
  const obj = poiObjects[index];
  const poi = poisData[index];
  if (!obj || !poi) return;
  poi.poi_name = name;

  const oldMaterial = obj.label.material;
  const oldMap = oldMaterial.map;
  const newLabel = createTextSprite(name);
  newLabel.position.copy(obj.label.position);

  if (poiGroupRef) poiGroupRef.remove(obj.label);
  obj.label = newLabel;
  if (poiGroupRef) poiGroupRef.add(newLabel);

  if (oldMap) oldMap.dispose();
  oldMaterial.dispose();
}

export function updatePOIDescription(index, description) {
  const poi = poisData[index];
  if (!poi) return;
  poi.description = description ?? '';
}

function nextSortOrder() {
  let m = 0;
  for (const p of poisData) {
    if (p.sort_order != null && p.sort_order > m) m = p.sort_order;
  }
  return m + 1;
}

export async function addPOIWithDb(poi) {
  const sort_order = poi.sort_order ?? nextSortOrder();
  const payload = {
    poi_name: poi.poi_name,
    description: poi.description ?? '',
    pos_x: poi.pos_x,
    pos_y: poi.pos_y,
    pos_z: poi.pos_z,
    sort_order,
  };
  let inserted;
  try {
    inserted = await insertPoiRow(payload);
  } catch {
    inserted = await insertPoiRow({
      poi_name: poi.poi_name,
      pos_x: poi.pos_x,
      pos_y: poi.pos_y,
      pos_z: poi.pos_z,
    });
  }
  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  const normalized = normalizePoiRow(row);
  poisData.push(normalized);
  sortPoisDataInPlace();

  const idx = poisData.findIndex((p) => p.id === normalized.id);
  if (poiGroupRef?.parent) {
    addPOIsToScene(poiGroupRef.parent);
  }
  return idx >= 0 ? idx : poisData.length - 1;
}

export function addPOI(poi) {
  const newPoi = {
    id: poi.id ?? null,
    poi_name: poi.poi_name,
    description: poi.description ?? '',
    pos_x: poi.pos_x,
    pos_y: poi.pos_y,
    pos_z: poi.pos_z,
    sort_order: poi.sort_order ?? nextSortOrder(),
  };
  poisData.push(newPoi);
  sortPoisDataInPlace();
  const index = poisData.indexOf(newPoi);

  if (poiGroupRef?.parent) {
    addPOIsToScene(poiGroupRef.parent);
  }
  return index;
}

export async function savePoiToDb(index) {
  const poi = poisData[index];
  if (!poi?.id) return;
  const body = {
    poi_name: poi.poi_name,
    description: poi.description ?? '',
    pos_x: poi.pos_x,
    pos_y: poi.pos_y,
    pos_z: poi.pos_z,
    sort_order: poi.sort_order ?? index + 1,
  };
  try {
    await updatePoiRow(poi.id, body);
  } catch {
    await updatePoiRow(poi.id, {
      poi_name: poi.poi_name,
      pos_x: poi.pos_x,
      pos_y: poi.pos_y,
      pos_z: poi.pos_z,
    });
  }
}

export async function removePoiFromDb(index) {
  const poi = poisData[index];
  if (poi?.id) {
    await deletePoiRow(poi.id);
  }
}

export function deletePOI(index) {
  if (index < 0 || index >= poisData.length) return;

  const obj = poiObjects[index];
  if (obj && poiGroupRef) {
    poiGroupRef.remove(obj.mesh);
    poiGroupRef.remove(obj.label);
    if (obj.mesh.geometry) obj.mesh.geometry.dispose();
    if (obj.mesh.material) obj.mesh.material.dispose();
    if (obj.label.material?.map) obj.label.material.map.dispose();
    if (obj.label.material) obj.label.material.dispose();
  }

  poiObjects.splice(index, 1);
  poisData.splice(index, 1);

  poiObjects.forEach((entry, i) => {
    entry.mesh.userData.poiIndex = i;
  });
}

function createPOIObject(poi, index, dotGeo, dotMat) {
  const mesh = new THREE.Mesh(dotGeo, dotMat);
  mesh.position.set(poi.pos_x, poi.pos_y, poi.pos_z);
  mesh.userData.poiIndex = index;

  const label = createTextSprite(poi.poi_name);
  label.position.set(poi.pos_x, poi.pos_y + 0.85, poi.pos_z);
  return { mesh, label };
}
