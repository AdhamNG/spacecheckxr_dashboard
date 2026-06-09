/**
 * Navnode density heat map — red-only blobs; intensity scales with cluster density.
 * Stamps only at each navnode XYZ (no path lines between points).
 */
import * as THREE from 'three';
import { getScene, getMultisetAnchor, getMapMeshBounds } from './scene.js';

const GRID = 256;
const HEAT_OPACITY = 0.92;

/** @type {THREE.Group | null} */
let globalHeatmapGroup = null;
/** @type {THREE.Group | null} */
let userHeatmapGroup = null;

/** Saturated red ramp: always strong red; dense areas pick up slight orange-red. */
function heatColor(t) {
  const x = Math.max(0, Math.min(1, t));
  return {
    r: 255,
    g: Math.round(4 + x * 42),
    b: 0,
  };
}

/**
 * @param {Array<{ pos_x: number, pos_y: number, pos_z: number }>} points
 */
function normalizePoints(points) {
  return points
    .map((p) => ({
      x: Number(p.pos_x),
      y: Number(p.pos_y),
      z: Number(p.pos_z),
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
}

/** Drop coordinates far from the map mesh (bad rows / other sites). */
function filterPointsToMap(pts) {
  const mapBox = getMapMeshBounds();
  if (!mapBox) return filterOutliersPercentile(pts);

  const box = mapBox.clone();
  box.expandByScalar(2.5);
  return pts.filter(
    (p) =>
      p.x >= box.min.x &&
      p.x <= box.max.x &&
      p.z >= box.min.z &&
      p.z <= box.max.z &&
      p.y >= box.min.y - 1.5 &&
      p.y <= box.max.y + 2.5,
  );
}

/** Ignore extreme XZ outliers when map mesh is not loaded yet. */
function filterOutliersPercentile(pts, low = 0.03, high = 0.97) {
  if (pts.length < 8) return pts;
  const xs = pts.map((p) => p.x).sort((a, b) => a - b);
  const zs = pts.map((p) => p.z).sort((a, b) => a - b);
  const q = (arr, t) => arr[Math.floor(t * (arr.length - 1))];
  const minX = q(xs, low);
  const maxX = q(xs, high);
  const minZ = q(zs, low);
  const maxZ = q(zs, high);
  return pts.filter((p) => p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ);
}

/**
 * @param {ReturnType<typeof normalizePoints>} pts
 */
function boundsForPoints(pts) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
    minY = Math.min(minY, p.y);
  }
  const padX = Math.max((maxX - minX) * 0.08, 1.5);
  const padZ = Math.max((maxZ - minZ) * 0.08, 1.5);
  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minZ: minZ - padZ,
    maxZ: maxZ + padZ,
    floorY: Number.isFinite(minY) ? minY : 0,
  };
}

/** Walk height from navnodes (mesh bbox min.y is often below the visible floor on scans). */
function floorYFromPoints(pts) {
  if (!pts.length) return 0;
  const ys = pts.map((p) => p.y).sort((a, b) => a - b);
  const idx = Math.floor(0.12 * (ys.length - 1));
  return ys[idx];
}

/** Map XZ extent + navnode Y so the plane sits on the floor users walked, not mesh bbox bottom. */
function boundsForHeatmap(pts) {
  const floorY = floorYFromPoints(pts);
  const mapBox = getMapMeshBounds();
  if (mapBox) {
    const pad = 0.75;
    return {
      minX: mapBox.min.x - pad,
      maxX: mapBox.max.x + pad,
      minZ: mapBox.min.z - pad,
      maxZ: mapBox.max.z + pad,
      floorY,
    };
  }
  const b = boundsForPoints(pts);
  return { ...b, floorY };
}

/**
 * Stamp soft Gaussian blobs at each navnode XZ — density stacks where many users visit.
 * @param {ReturnType<typeof normalizePoints>} pts
 * @param {ReturnType<typeof boundsForPoints>} bounds
 */
function buildDensityGrid(pts, bounds) {
  const grid = new Float32Array(GRID * GRID);
  const spanX = bounds.maxX - bounds.minX || 1;
  const spanZ = bounds.maxZ - bounds.minZ || 1;

  const stamp = (x, z, weight = 1) => {
    const gx = ((x - bounds.minX) / spanX) * (GRID - 1);
    const gz = ((z - bounds.minZ) / spanZ) * (GRID - 1);
    if (gx < 0 || gz < 0 || gx > GRID - 1 || gz > GRID - 1) return;
    const radius = 5;
    const ix = Math.round(gx);
    const iz = Math.round(gz);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = ix + dx;
        const cz = iz + dz;
        if (cx < 0 || cz < 0 || cx >= GRID || cz >= GRID) continue;
        const dist = Math.hypot(dx, dz);
        if (dist > radius) continue;
        const w = weight * Math.exp(-(dist * dist) / (radius * 0.38) ** 2);
        grid[cz * GRID + cx] += w;
      }
    }
  };

  for (const p of pts) stamp(p.x, p.z, 1.2);

  return { grid, spanX, spanZ };
}

/**
 * @param {Float32Array} grid
 */
function gridToCanvas(grid) {
  let max = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > max) max = grid[i];
  }
  if (max <= 0) max = 1;

  const canvas = document.createElement('canvas');
  canvas.width = GRID;
  canvas.height = GRID;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(GRID, GRID);
  for (let i = 0; i < grid.length; i++) {
    const t = Math.pow(grid[i] / max, 0.5);
    const { r, g, b } = heatColor(Math.min(1, t * 1.1));
    const a = t > 0.08 ? Math.round(75 + t * 180) : 0;
    const o = i * 4;
    img.data[o] = r;
    img.data[o + 1] = g;
    img.data[o + 2] = b;
    img.data[o + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function disposeGroup(group) {
  if (!group) return;
  const anchor = getMultisetAnchor();
  const scene = getScene();
  if (anchor) anchor.remove(group);
  else if (scene) scene.remove(group);
  group.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
}

/**
 * @param {Array<{ pos_x: number, pos_y: number, pos_z: number }>} rawPoints
 */
function buildHeatmapGroup(rawPoints) {
  const pts = filterPointsToMap(normalizePoints(rawPoints));
  const group = new THREE.Group();
  if (!pts.length) return group;

  const bounds = boundsForHeatmap(pts);
  const { grid, spanX, spanZ } = buildDensityGrid(pts, bounds);
  const canvas = gridToCanvas(grid);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(spanX, spanZ),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: HEAT_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(
    bounds.minX + spanX / 2,
    bounds.floorY + 0.08,
    bounds.minZ + spanZ / 2,
  );
  group.add(plane);

  return group;
}

function mountGroup(group) {
  const anchor = getMultisetAnchor();
  const scene = getScene();
  if (anchor) anchor.add(group);
  else if (scene) scene.add(group);
}

export function clearGlobalHeatmap() {
  disposeGroup(globalHeatmapGroup);
  globalHeatmapGroup = null;
}

export function clearUserHeatmap() {
  disposeGroup(userHeatmapGroup);
  userHeatmapGroup = null;
}

export function clearAllHeatmaps() {
  clearGlobalHeatmap();
  clearUserHeatmap();
}

/** All users — combined navnode density on the map floor only. */
export function showGlobalHeatmap(points) {
  clearGlobalHeatmap();
  globalHeatmapGroup = buildHeatmapGroup(points);
  globalHeatmapGroup.name = 'GlobalNavHeatmap';
  mountGroup(globalHeatmapGroup);
}

/** Single user — same red density style at that user's navnodes only. */
export function showUserHeatmap(points) {
  clearUserHeatmap();
  userHeatmapGroup = buildHeatmapGroup(points);
  userHeatmapGroup.name = 'UserNavHeatmap';
  mountGroup(userHeatmapGroup);
}

export function setGlobalHeatmapVisible(visible) {
  if (globalHeatmapGroup) globalHeatmapGroup.visible = visible;
}
