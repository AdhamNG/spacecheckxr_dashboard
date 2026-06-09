/**
 * Zone Box — 3D cuboid rendering for access control zones.
 *
 * Each zone is a translucent box at (x, y, z) with dimensions w (X-axis) × h (Z-axis).
 * A fixed visual height of 3 units is used for the Y-axis.
 */
import * as THREE from 'three';
import { getScene } from './scene.js';

const VISUAL_HEIGHT = 0.2;
const BOX_COLOR = 0x60a5fa;
const BOX_OPACITY = 0.12;
const EDGE_COLOR = 0x60a5fa;

const zoneObjects = [];
let zoneGroup = null;

function ensureGroup() {
  if (zoneGroup) return;
  const scene = getScene();
  if (!scene) return;
  zoneGroup = new THREE.Group();
  zoneGroup.name = 'ZoneBoxGroup';
  scene.add(zoneGroup);
}

function createTextSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'Bold 28px Arial';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  ctx.fillStyle = 'rgba(0,10,20,0.75)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 8);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,240,255,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#00f0ff';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3, 0.4, 1);
  return sprite;
}

/**
 * Add a zone box to the 3D scene.
 * @param {{ id:string, label:string, x:number, y:number, z:number, w:number, h:number, rotation:number }} zone
 * @returns {object} internal zone entry
 */
export function addZoneBox(zone) {
  ensureGroup();
  if (!zoneGroup) return null;

  const w = Math.max(zone.w, 0.5);
  const h = Math.max(zone.h, 0.5);

  const geo = new THREE.BoxGeometry(w, VISUAL_HEIGHT, h);
  const mat = new THREE.MeshBasicMaterial({
    color: BOX_COLOR,
    transparent: true,
    opacity: BOX_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(zone.x, zone.y, zone.z);
  if (zone.rotation) mesh.rotation.y = Number(zone.rotation);

  const edges = new THREE.EdgesGeometry(geo);
  const lineMat = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.5 });
  const wireframe = new THREE.LineSegments(edges, lineMat);
  wireframe.position.copy(mesh.position);

  const label = createTextSprite(zone.label || 'Zone');
  label.position.set(mesh.position.x, mesh.position.y + VISUAL_HEIGHT / 2 + 0.6, mesh.position.z);

  zoneGroup.add(mesh);
  zoneGroup.add(wireframe);
  zoneGroup.add(label);

  const entry = { id: zone.id, mesh, wireframe, label, data: { ...zone } };
  mesh.userData.zoneEntry = entry;
  zoneObjects.push(entry);
  return entry;
}

/**
 * Update a zone box position and dimensions in 3D.
 */
export function updateZoneBox(id, { x, y, z, w, h, rotation, label }) {
  const entry = zoneObjects.find((e) => e.id === id);
  if (!entry) return;

  const bw = Math.max(w ?? entry.data.w, 0.5);
  const bh = Math.max(h ?? entry.data.h, 0.5);
  const bx = x ?? entry.data.x;
  const by = y ?? entry.data.y;
  const bz = z ?? entry.data.z;

  entry.mesh.geometry.dispose();
  entry.mesh.geometry = new THREE.BoxGeometry(bw, VISUAL_HEIGHT, bh);
  entry.mesh.position.set(bx, by, bz);
  if (rotation !== undefined) entry.mesh.rotation.y = Number(rotation);

  entry.wireframe.geometry.dispose();
  entry.wireframe.geometry = new THREE.EdgesGeometry(entry.mesh.geometry);
  entry.wireframe.position.copy(entry.mesh.position);

  entry.label.position.set(entry.mesh.position.x, entry.mesh.position.y + VISUAL_HEIGHT / 2 + 0.6, entry.mesh.position.z);

  if (label !== undefined && label !== entry.data.label) {
    const oldMap = entry.label.material.map;
    const oldMat = entry.label.material;
    const newSprite = createTextSprite(label);
    newSprite.position.copy(entry.label.position);
    zoneGroup.remove(entry.label);
    entry.label = newSprite;
    zoneGroup.add(newSprite);
    if (oldMap) oldMap.dispose();
    oldMat.dispose();
    entry.data.label = label;
  }

  if (rotation !== undefined) entry.data.rotation = rotation;
  Object.assign(entry.data, { x: bx, y: by, z: bz, w: bw, h: bh });
}

/**
 * Sync wireframe and label to the mesh's latest transform (for gizmo updates).
 */
export function syncZoneVisuals(id) {
  const entry = zoneObjects.find((e) => e.id === id);
  if (!entry) return;
  entry.wireframe.position.copy(entry.mesh.position);
  entry.wireframe.rotation.copy(entry.mesh.rotation);
  entry.wireframe.scale.copy(entry.mesh.scale);
  entry.label.position.set(entry.mesh.position.x, entry.mesh.position.y + (VISUAL_HEIGHT * entry.mesh.scale.y) / 2 + 0.6, entry.mesh.position.z);
}

/**
 * Remove a zone box from the 3D scene.
 */
export function removeZoneBox(id) {
  const idx = zoneObjects.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const entry = zoneObjects[idx];
  if (zoneGroup) {
    zoneGroup.remove(entry.mesh);
    zoneGroup.remove(entry.wireframe);
    zoneGroup.remove(entry.label);
  }
  entry.mesh.geometry.dispose();
  entry.mesh.material.dispose();
  entry.wireframe.geometry.dispose();
  entry.wireframe.material.dispose();
  if (entry.label.material?.map) entry.label.material.map.dispose();
  entry.label.material.dispose();
  zoneObjects.splice(idx, 1);
}

let previewMesh = null;
let previewEdges = null;

/**
 * Create or update a translucent preview box while the user is drawing.
 */
export function setPreviewBox(x, y, z, w, h) {
  ensureGroup();
  if (!zoneGroup) return;
  const bw = Math.max(Math.abs(w), 0.05);
  const bh = Math.max(Math.abs(h), 0.05);

  if (previewMesh) {
    previewMesh.geometry.dispose();
    previewMesh.geometry = new THREE.BoxGeometry(bw, VISUAL_HEIGHT, bh);
    previewMesh.position.set(x + w / 2, y + VISUAL_HEIGHT / 2, z + h / 2);

    previewEdges.geometry.dispose();
    previewEdges.geometry = new THREE.EdgesGeometry(previewMesh.geometry);
    previewEdges.position.copy(previewMesh.position);
  } else {
    const geo = new THREE.BoxGeometry(bw, VISUAL_HEIGHT, bh);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    previewMesh = new THREE.Mesh(geo, mat);
    previewMesh.position.set(x + w / 2, y + VISUAL_HEIGHT / 2, z + h / 2);

    const edges = new THREE.EdgesGeometry(geo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.7 });
    previewEdges = new THREE.LineSegments(edges, lineMat);
    previewEdges.position.copy(previewMesh.position);

    zoneGroup.add(previewMesh);
    zoneGroup.add(previewEdges);
  }
}

/**
 * Remove the preview box from the scene.
 */
export function clearPreviewBox() {
  if (!previewMesh) return;
  if (zoneGroup) {
    zoneGroup.remove(previewMesh);
    zoneGroup.remove(previewEdges);
  }
  previewMesh.geometry.dispose();
  previewMesh.material.dispose();
  previewEdges.geometry.dispose();
  previewEdges.material.dispose();
  previewMesh = null;
  previewEdges = null;
}

/**
 * Get all zone entries.
 */
export function getZoneObjects() {
  return zoneObjects;
}

/**
 * Remove all zone boxes from the scene.
 */
export function clearAllZoneBoxes() {
  while (zoneObjects.length) {
    removeZoneBox(zoneObjects[0].id);
  }
}
