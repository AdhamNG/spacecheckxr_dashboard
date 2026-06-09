/**
 * Navigation mesh generator — uses @recast-navigation/generators directly
 * for full control over the Recast pipeline + proper auto-scaling.
 *
 * The "Failed to create Detour navmesh data" error from threeToSoloNavMesh
 * happens when either:
 *  - The grid produces >65535 polygons (Detour 16-bit limit for solo mesh)
 *  - All walkable area gets eroded away (0 polygons)
 *  - Cell size is too fine for the map size
 *
 * Fix: extract positions/indices ourselves, compute bounds, auto-scale cs/ch
 * so the polygon count stays within Detour limits, and use generateSoloNavMesh
 * with keepIntermediates=true for diagnostics.
 */
import * as THREE from 'three';
import { init, exportNavMesh } from 'recast-navigation';
import { generateSoloNavMesh } from '@recast-navigation/generators';
import { NavMeshHelper } from '@recast-navigation/three';
import { getScene, getMultisetAnchor } from './scene.js';

let initPromise = null;
let currentNavMesh = null;
let currentHelper = null;

export async function ensureRecastLoaded() {
  if (!initPromise) initPromise = init();
  await initPromise;
}

function collectMeshes() {
  const anchor = getMultisetAnchor();
  if (!anchor) return [];

  const meshes = [];
  const mapRoot = anchor.getObjectByName('MapMesh');
  if (mapRoot) {
    mapRoot.traverse((child) => {
      if (child.isMesh && child.geometry) meshes.push(child);
    });
  }

  if (!meshes.length) {
    const scene = getScene();
    if (scene) {
      scene.traverse((child) => {
        if (
          child.isMesh &&
          child.geometry &&
          child.name !== 'NavMeshHelperMesh'
        ) {
          meshes.push(child);
        }
      });
    }
  }

  return meshes.filter((m) => {
    if (!m || !m.geometry || !m.isMesh) return false;
    const pos = m.geometry.attributes?.position;
    return pos && pos.count >= 3;
  });
}

function extractWorldPositionsAndIndices(meshes) {
  // Two-pass: count then fill (avoids repeated array growth for large meshes).
  let totalVerts = 0;
  let totalIndices = 0;

  for (const mesh of meshes) {
    if (!mesh?.isMesh || !mesh.geometry?.attributes?.position) continue;
    mesh.updateWorldMatrix(true, false);

    const posAttr = mesh.geometry.attributes.position;
    totalVerts += posAttr.count;

    const idx = mesh.geometry.index;
    if (idx && idx.count >= 3) {
      totalIndices += idx.count;
    } else {
      // Non-indexed geometry: assume triangles, 3 verts per tri.
      totalIndices += Math.floor(posAttr.count / 3) * 3;
    }
  }

  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  let vOffset = 0; // vertex offset (in vertices)
  let iOffset = 0; // index offset (in indices)

  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();

  for (const mesh of meshes) {
    if (!mesh?.isMesh || !mesh.geometry?.attributes?.position) continue;
    mesh.updateWorldMatrix(true, false);

    m.copy(mesh.matrixWorld);
    const det = m.determinant();
    const flipWindingForThisMesh = det < 0;

    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;

    // Bake world positions
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(m);
      const p = (vOffset + i) * 3;
      positions[p] = v.x;
      positions[p + 1] = v.y;
      positions[p + 2] = v.z;
    }

    // Bake indices
    const idxAttr = geo.index;
    if (idxAttr && idxAttr.count >= 3) {
      if (!flipWindingForThisMesh) {
        for (let i = 0; i < idxAttr.count; i++) {
          indices[iOffset + i] = vOffset + idxAttr.getX(i);
        }
        iOffset += idxAttr.count;
      } else {
        const triCount = Math.floor(idxAttr.count / 3);
        for (let t = 0; t < triCount; t++) {
          const a = idxAttr.getX(t * 3 + 0);
          const b = idxAttr.getX(t * 3 + 1);
          const c = idxAttr.getX(t * 3 + 2);
          indices[iOffset++] = vOffset + a;
          indices[iOffset++] = vOffset + c;
          indices[iOffset++] = vOffset + b;
        }
      }
    } else {
      const triCount = Math.floor(posAttr.count / 3);
      for (let t = 0; t < triCount; t++) {
        const a = t * 3 + 0;
        const b = t * 3 + 1;
        const c = t * 3 + 2;
        if (!flipWindingForThisMesh) {
          indices[iOffset++] = vOffset + a;
          indices[iOffset++] = vOffset + b;
          indices[iOffset++] = vOffset + c;
        } else {
          indices[iOffset++] = vOffset + a;
          indices[iOffset++] = vOffset + c;
          indices[iOffset++] = vOffset + b;
        }
      }
    }

    vOffset += posAttr.count;
  }

  if (iOffset !== indices.length) {
    return [positions, indices.slice(0, iOffset)];
  }
  return [positions, indices];
}

function computeBounds(positions, indices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const x = positions[idx * 3];
    const y = positions[idx * 3 + 1];
    const z = positions[idx * 3 + 2];
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  return {
    min,
    max,
    sizeX: max[0] - min[0],
    sizeY: max[1] - min[1],
    sizeZ: max[2] - min[2],
  };
}

/**
 * Build a config whose grid won't exceed Detour's limits.
 * Target: keep estimated grid cells under ~4M and estimated polys under 60k.
 */
function buildAutoConfig(bounds, triangleCount) {
  const maxHoriz = Math.max(bounds.sizeX, bounds.sizeZ, 0.1);

  const configs = [];
  const csValues = [0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.0];

  for (const cs of csValues) {
    const ch = Math.max(0.05, cs * 0.5);
    const gridW = Math.ceil(maxHoriz / cs);
    const gridH = Math.ceil(maxHoriz / cs);
    const gridCells = gridW * gridH;

    const estPolys = Math.min(triangleCount, gridCells * 0.3);

    if (gridCells > 8_000_000) continue;
    if (estPolys > 60_000) continue;

    configs.push({
      cs,
      ch,
      walkableSlopeAngle: 60,
      walkableHeight: Math.max(3, Math.ceil(2.0 / ch)),
      walkableClimb: Math.max(1, Math.ceil(0.3 / ch)),
      walkableRadius: Math.max(1, Math.ceil(0.2 / cs)),
      borderSize: 0,
      minRegionArea: cs <= 0.15 ? 8 : 2,
      mergeRegionArea: cs <= 0.15 ? 20 : 6,
      gridW,
      gridH,
      gridCells,
      estPolys,
    });
  }

  if (configs.length === 0) {
    const cs = Math.max(1.0, maxHoriz / 2000);
    const ch = cs * 0.5;
    configs.push({
      cs,
      ch,
      walkableSlopeAngle: 75,
      walkableHeight: Math.max(3, Math.ceil(2.0 / ch)),
      walkableClimb: Math.max(2, Math.ceil(0.5 / ch)),
      walkableRadius: Math.max(1, Math.ceil(0.2 / cs)),
      borderSize: 0,
      minRegionArea: 1,
      mergeRegionArea: 4,
    });
  }

  return configs;
}

function buildPermissiveConfigs(bounds) {
  const maxHoriz = Math.max(bounds.sizeX, bounds.sizeZ, 0.1);
  const cs = Math.max(0.1, Math.min(1.2, maxHoriz / 40));
  const ch = Math.max(0.05, cs * 0.5);
  return [
    {
      cs,
      ch,
      walkableSlopeAngle: 89,
      walkableHeight: 1,
      walkableClimb: Math.max(2, Math.ceil(1 / ch)),
      walkableRadius: 0,
      borderSize: 0,
      minRegionArea: 0,
      mergeRegionArea: 0,
    },
    {
      cs: Math.max(cs, 0.5),
      ch: Math.max(ch, 0.25),
      walkableSlopeAngle: 89,
      walkableHeight: 1,
      walkableClimb: 8,
      walkableRadius: 0,
      borderSize: 0,
      minRegionArea: 0,
      mergeRegionArea: 0,
    },
  ];
}

function remapPositions(positions, mode) {
  if (mode === 'identity') return positions;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (mode === 'swapYZ') {
      out[i] = x;
      out[i + 1] = z;
      out[i + 2] = y;
    } else if (mode === 'swapXY') {
      out[i] = y;
      out[i + 1] = x;
      out[i + 2] = z;
    } else if (mode === 'mirrorX') {
      out[i] = -x;
      out[i + 1] = y;
      out[i + 2] = z;
    } else if (mode === 'mirrorZ') {
      out[i] = x;
      out[i + 1] = y;
      out[i + 2] = -z;
    } else {
      out[i] = x;
      out[i + 1] = y;
      out[i + 2] = z;
    }
  }
  return out;
}

function estimateWalkableBySlope(positions, indices, slopeDeg) {
  const maxAngle = THREE.MathUtils.degToRad(slopeDeg);
  const cosMin = Math.cos(maxAngle);

  let tested = 0;
  let walkable = 0;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();

  const maxTests = Math.min(indices.length / 3, 50_000);
  for (let t = 0; t < maxTests; t++) {
    const ia = indices[t * 3] * 3;
    const ib = indices[t * 3 + 1] * 3;
    const ic = indices[t * 3 + 2] * 3;
    a.set(positions[ia], positions[ia + 1], positions[ia + 2]);
    b.set(positions[ib], positions[ib + 1], positions[ib + 2]);
    c.set(positions[ic], positions[ic + 1], positions[ic + 2]);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const len = n.length();
    if (len < 1e-12) continue;
    n.multiplyScalar(1 / len);

    tested++;
    if (n.y >= cosMin) walkable++;
  }

  return { tested, walkable };
}

function remapIndices(indices, mode) {
  if (mode === 'normal') return indices;
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    // Flip triangle winding so normals invert.
    out[i] = a;
    out[i + 1] = c;
    out[i + 2] = b;
  }
  return out;
}

function tryGenerate(positions, indices, config) {
  const { gridW, gridH, gridCells, estPolys, ...recastConfig } = config;

  console.log('[NavMesh] Config:', JSON.stringify(recastConfig, null, 2));
  if (gridW) {
    console.log(
      `[NavMesh] Grid: ${gridW}x${gridH} = ${gridCells} cells, est polys: ${Math.round(estPolys)}`,
    );
  }

  const t0 = performance.now();
  const result = generateSoloNavMesh(positions, indices, recastConfig, true);
  const t1 = performance.now();

  if (!result.success) {
    const inter = result.intermediates;
    const polyCount = inter?.polyMesh ? inter.polyMesh.npolys() : '?';
    const vertCount = inter?.polyMesh ? inter.polyMesh.nverts() : '?';
    console.warn(
      `[NavMesh] Failed — polyMesh: ${vertCount} verts, ${polyCount} polys — error: ${result.error}`,
    );
  }

  return { result, durationMs: t1 - t0 };
}

export async function generateNavMesh() {
  await ensureRecastLoaded();
  clearNavMeshVisualization();

  const meshes = collectMeshes();
  if (!meshes.length) {
    return {
      success: false,
      error: 'No map mesh loaded — load a map first.',
      durationMs: 0,
    };
  }

  console.log(`[NavMesh] Collecting geometry from ${meshes.length} meshes...`);
  const [positions, indices] = extractWorldPositionsAndIndices(meshes);
  const triCount = indices.length / 3;
  console.log(
    `[NavMesh] Geometry: ${(positions.length / 3).toLocaleString()} vertices, ${triCount.toLocaleString()} triangles`,
  );

  if (triCount === 0) {
    return {
      success: false,
      error: 'Map mesh has no triangles.',
      durationMs: 0,
    };
  }

  let result = null;
  let durationMs = 0;
  const orientationModes = ['identity', 'swapYZ', 'swapXY', 'mirrorX', 'mirrorZ'];
  const windingModes = ['normal', 'flipped'];
  for (const orient of orientationModes) {
    const orientedPositions = remapPositions(positions, orient);
    for (const winding of windingModes) {
      const orientedIndices = remapIndices(indices, winding);
      const bounds = computeBounds(orientedPositions, orientedIndices);
      console.log(
        `[NavMesh] Orientation=${orient}, winding=${winding}, bounds: ${bounds.sizeX.toFixed(1)} x ${bounds.sizeY.toFixed(1)} x ${bounds.sizeZ.toFixed(1)}`,
      );

      const slopeCheck = estimateWalkableBySlope(orientedPositions, orientedIndices, 60);
      if (slopeCheck.tested > 0) {
        const pct = (slopeCheck.walkable / slopeCheck.tested) * 100;
        console.log(
          `[NavMesh] Slope sanity: ${slopeCheck.walkable}/${slopeCheck.tested} (~${pct.toFixed(1)}%) triangles face +Y within 60°`,
        );
      }

      const configs = [
        ...buildAutoConfig(bounds, triCount),
        ...buildPermissiveConfigs(bounds),
      ];
      console.log(`[NavMesh] Orientation=${orient}, winding=${winding} will try ${configs.length} configs`);

      for (let i = 0; i < configs.length; i++) {
        console.log(
          `[NavMesh] Attempt ${i + 1}/${configs.length} (${orient}, ${winding}) - cs=${configs[i].cs}, ch=${configs[i].ch}`,
        );
        const out = tryGenerate(orientedPositions, orientedIndices, configs[i]);
        durationMs += out.durationMs;
        result = out.result;
        if (result.success) {
          console.log(`[NavMesh] Success on orientation=${orient}, winding=${winding}, attempt=${i + 1}`);
          break;
        }
        console.warn(`[NavMesh] Attempt ${i + 1} failed: ${result.error}`);
      }

      if (result?.success) break;
    }
    if (result?.success) break;
  }

  if (!result || !result.success) {
    console.error('[NavMesh] All attempts failed:', result?.error);
    return {
      success: false,
      error: result?.error || 'Failed to create Detour navmesh data',
      durationMs,
    };
  }

  currentNavMesh = result.navMesh;

  const material = new THREE.MeshBasicMaterial({
    color: 0x22ff66,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  currentHelper = new NavMeshHelper(result.navMesh, {
    navMeshMaterial: material,
  });
  currentHelper.name = 'NavMeshHelper';
  currentHelper.update();

  const parent = getMultisetAnchor();
  if (parent) parent.add(currentHelper);

  console.log(`[NavMesh] Done — total ${durationMs.toFixed(0)} ms`);
  return { success: true, durationMs };
}

function disposeHelper() {
  if (!currentHelper) return;
  currentHelper.removeFromParent();
  if (currentHelper.navMeshGeometry) currentHelper.navMeshGeometry.dispose();
  if (currentHelper.navMeshMaterial) currentHelper.navMeshMaterial.dispose();
  currentHelper = null;
}

export function clearNavMeshVisualization() {
  disposeHelper();
  if (currentNavMesh) {
    try {
      currentNavMesh.destroy();
    } catch {
      /* */
    }
    currentNavMesh = null;
  }
}

/** @returns {Uint8Array|null} Serialized nav mesh, or null if none. */
export function getNavMeshExportBytes() {
  if (!currentNavMesh) return null;
  return exportNavMesh(currentNavMesh);
}

export function downloadNavMeshFile(filename = 'generated.navmesh') {
  const data = getNavMeshExportBytes();
  if (!data) return false;
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export function hasNavMesh() {
  return currentNavMesh !== null;
}

export function getNavMesh() {
  return currentNavMesh;
}
