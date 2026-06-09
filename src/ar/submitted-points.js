import * as THREE from 'three';
import { getCamera, getCanvas, getMultisetAnchor, getScene } from './scene.js';
import { fetchImageBlobFromRow } from '../services/supabase.js';

let submittedGroup = null;
let clickableMeshes = [];
let clickHandlerInstalled = false;
let onSelectCallback = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function ensureGroup() {
  const anchor = getMultisetAnchor();
  if (!anchor) return null;
  if (!submittedGroup) {
    submittedGroup = new THREE.Group();
    submittedGroup.name = 'SubmittedPointsGroup';
    anchor.add(submittedGroup);
  }
  return submittedGroup;
}

function makeFallbackMesh(row) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x1e3a8a,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), mat);
  mesh.userData.submitted = row;
  return mesh;
}

async function createImageMesh(row) {
  try {
    const blob = await fetchImageBlobFromRow(row, 'pj_snapshots');
    const localUrl = URL.createObjectURL(blob);
    const loader = new THREE.TextureLoader();
    return await new Promise((resolve) => {
      loader.load(
        localUrl,
        (texture) => {
          URL.revokeObjectURL(localUrl);
          texture.colorSpace = THREE.SRGBColorSpace;
          const mat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1), mat);
          mesh.userData.submitted = row;
          resolve(mesh);
        },
        undefined,
        () => {
          URL.revokeObjectURL(localUrl);
          resolve(makeFallbackMesh(row));
        }
      );
    });
  } catch {
    return makeFallbackMesh(row);
  }
}

function installClickHandler() {
  if (clickHandlerInstalled) return;
  const canvas = getCanvas();
  if (!canvas) return;
  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  clickHandlerInstalled = true;
}

function uninstallClickHandler() {
  if (!clickHandlerInstalled) return;
  const canvas = getCanvas();
  if (!canvas) return;
  canvas.removeEventListener('pointerdown', onCanvasPointerDown);
  clickHandlerInstalled = false;
}

function onCanvasPointerDown(event) {
  if (!clickableMeshes.length) return;
  const canvas = getCanvas();
  const camera = getCamera();
  if (!canvas || !camera) return;

  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(clickableMeshes, true);
  if (!hits.length) return;
  const row = hits[0].object?.userData?.submitted;
  if (row && onSelectCallback) onSelectCallback(row);
}

export async function renderSubmittedPoints(rows, options = {}) {
  const group = ensureGroup();
  if (!group) return;
  const camera = getCamera();

  onSelectCallback = options.onSelect ?? null;

  clearSubmittedPoints();

  const meshes = await Promise.all(rows.map((row) => createImageMesh(row)));
  meshes.forEach((mesh, idx) => {
    const row = rows[idx];
    const x = Number(row.pos_x ?? row.x ?? 0);
    const y = Number(row.pos_y ?? row.y ?? 0);
    const z = Number(row.pos_z ?? row.z ?? 0);
    mesh.position.set(x, y + 1.4, z);
    if (camera) mesh.lookAt(camera.position);
    group.add(mesh);
    clickableMeshes.push(mesh);
  });

  installClickHandler();
}

export function clearSubmittedPoints() {
  if (!submittedGroup) return;
  while (submittedGroup.children.length) {
    const child = submittedGroup.children.pop();
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  }
  clickableMeshes = [];
}

export function hideSubmittedPoints() {
  clearSubmittedPoints();
  uninstallClickHandler();
  onSelectCallback = null;
  if (submittedGroup && getScene()) {
    submittedGroup.visible = false;
  }
}

export function showSubmittedPoints() {
  if (submittedGroup) submittedGroup.visible = true;
}

/** Show a single submitted snapshot in the scene; hide all others. */
export async function showOnlySubmittedPoint(row) {
  const group = ensureGroup();
  if (!group || !row) return;
  const camera = getCamera();

  clearSubmittedPoints();

  const mesh = await createImageMesh(row);
  const x = Number(row.pos_x ?? row.x ?? 0);
  const y = Number(row.pos_y ?? row.y ?? 0);
  const z = Number(row.pos_z ?? row.z ?? 0);
  mesh.position.set(x, y + 1.4, z);
  if (camera) mesh.lookAt(camera.position);
  group.add(mesh);
  clickableMeshes = [mesh];
  submittedGroup.visible = true;
  installClickHandler();
}
