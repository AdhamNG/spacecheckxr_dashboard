/**
 * User Tracking — 3D markers and route lines.
 *
 * - addUserMarker / updateUserMarker / removeUserMarker for live positions
 * - drawHistoryRoute / clearHistoryRoute for the full route path
 */
import * as THREE from 'three';
import { getScene } from './scene.js';

const USER_COLORS = [
  0x6366f1, // indigo
  0x22c55e, // green
  0xf59e0b, // amber
  0xef4444, // red
  0x06b6d4, // cyan
  0xec4899, // pink
  0x8b5cf6, // violet
  0x14b8a6, // teal
];

const markers = new Map();
let historyGroup = null;

function colorForIndex(i) {
  return USER_COLORS[i % USER_COLORS.length];
}

function createLabelCanvas(text, color) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = 'Bold 28px Inter, Arial';
  ctx.font = font;
  const tw = ctx.measureText(text).width;
  const pad = 12;
  canvas.width = tw + pad * 2;
  canvas.height = 44;
  ctx.font = font;
  ctx.fillStyle = `rgba(10,10,20,0.85)`;
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 8);
  ctx.fill();
  ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  return canvas;
}

/**
 * Add a coloured sphere + name label at a position.
 * @returns the marker group added to the scene
 */
export function addUserMarker(userId, name, x, y, z, colorIndex = 0) {
  const scene = getScene();
  if (!scene) return null;

  removeUserMarker(userId);

  const color = colorForIndex(colorIndex);
  const group = new THREE.Group();
  group.name = `user-marker-${userId}`;

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 24, 24),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 })
  );
  group.add(sphere);

  const ringGeo = new THREE.RingGeometry(0.28, 0.36, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.45 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  const labelCanvas = createLabelCanvas(name, color);
  const tex = new THREE.CanvasTexture(labelCanvas);
  const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  const aspect = labelCanvas.width / labelCanvas.height;
  sprite.scale.set(aspect * 0.7, 0.7, 1);
  sprite.position.y = 0.65;
  group.add(sprite);

  group.position.set(x, y, z);
  scene.add(group);
  markers.set(userId, group);
  return group;
}

/** Smoothly move an existing marker to a new position. */
export function updateUserMarker(userId, x, y, z) {
  const group = markers.get(userId);
  if (!group) return;
  group.position.set(x, y, z);
}

/** Remove a single user marker from the scene. */
export function removeUserMarker(userId) {
  const scene = getScene();
  const group = markers.get(userId);
  if (group && scene) {
    scene.remove(group);
    group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    markers.delete(userId);
  }
}

/** Remove all user markers. */
export function clearAllMarkers() {
  for (const userId of [...markers.keys()]) {
    removeUserMarker(userId);
  }
}

/**
 * Draw a coloured 3D line through an array of {pos_x, pos_y, pos_z} points.
 * Also places small spheres at each waypoint.
 */
export function drawHistoryRoute(points, colorIndex = 0) {
  clearHistoryRoute();
  const scene = getScene();
  if (!scene || points.length === 0) return;

  historyGroup = new THREE.Group();
  historyGroup.name = 'user-history-route';

  const color = colorForIndex(colorIndex);
  const verts = points.map(
    (p) => new THREE.Vector3(Number(p.pos_x), Number(p.pos_y), Number(p.pos_z))
  );

  // Line
  const lineGeo = new THREE.BufferGeometry().setFromPoints(verts);
  const lineMat = new THREE.LineBasicMaterial({ color, linewidth: 2, transparent: true, opacity: 0.85 });
  historyGroup.add(new THREE.Line(lineGeo, lineMat));

  // Waypoint dots
  const dotGeo = new THREE.SphereGeometry(0.07, 12, 12);
  const dotMat = new THREE.MeshBasicMaterial({ color });
  verts.forEach((v) => {
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.copy(v);
    historyGroup.add(dot);
  });

  // Start marker (green)
  const startGeo = new THREE.SphereGeometry(0.15, 16, 16);
  const startMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
  const startMesh = new THREE.Mesh(startGeo, startMat);
  startMesh.position.copy(verts[0]);
  historyGroup.add(startMesh);

  // End marker (red)
  const endGeo = new THREE.SphereGeometry(0.15, 16, 16);
  const endMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const endMesh = new THREE.Mesh(endGeo, endMat);
  endMesh.position.copy(verts[verts.length - 1]);
  historyGroup.add(endMesh);

  scene.add(historyGroup);
}

/** Remove the history route from the scene. */
export function clearHistoryRoute() {
  const scene = getScene();
  if (historyGroup && scene) {
    scene.remove(historyGroup);
    historyGroup.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    historyGroup = null;
  }
}
