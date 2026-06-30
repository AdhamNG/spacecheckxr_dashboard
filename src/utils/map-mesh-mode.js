const STORAGE_KEY = 'scxr-map-mesh-mode';

/** @typedef {'raw' | 'textured'} MapMeshMode */

/** @returns {MapMeshMode} */
export function getMapMeshMode() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'raw' ? 'raw' : 'textured';
  } catch {
    return 'textured';
  }
}

/** @param {MapMeshMode} mode */
export function setMapMeshMode(mode) {
  const resolved = mode === 'raw' ? 'raw' : 'textured';
  try {
    localStorage.setItem(STORAGE_KEY, resolved);
  } catch { /* private browsing */ }
  return resolved;
}
