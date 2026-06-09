/**
 * 2D map: Matterport solid-color floorplan minimap (GraphQL JSON, SVG route).
 * Replaces the previous orthographic WebGL mesh slice view.
 */
import { mountMatterportFloorplanMinimap } from './matterport-floorplan-map.js';
import { poisData, updatePOIPosition, savePoiToDb } from './pois.js';

let matterportHandle = null;

/**
 * Mount the Matterport floorplan UI into the 2D viewport (fills container).
 * POI positions are **MultiSet VPS** (Y up). Matterport→MultiSet: x=x, y=y, z=−z; on the floor plan px=MP.x, py=MP.z so MS (x,z) = (px, −py); **y** stays fixed for that drag.
 * @param {HTMLElement} container
 */
export function init2DView(container) {
  if (matterportHandle) {
    matterportHandle.dispose();
    matterportHandle = null;
  }
  matterportHandle = mountMatterportFloorplanMinimap(container, {
    matterportWithNav: false,
    showMatterportSweepDots: false,
    showNavigationRoute: false,
    floatingCircle: false,
    updateDocumentTitle: false,
    baseTitle: 'SpaceCheck XR',
    poiBridge: {
      getPois: () =>
        poisData.map((p, index) => ({
          index,
          x: p.pos_x,
          y: p.pos_y,
          z: p.pos_z,
          label: p.poi_name,
        })),
      onPoiPositionChange: (index, x, y, z) => {
        updatePOIPosition(index, x, y, z);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('spacecheck-poi-dragging-xy', { detail: { index, x, y, z } }),
          );
        }
      },
      onPoiDragEnd: (index) => {
        const p = poisData[index];
        if (p && typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('spacecheck-poi-moved-xy', {
              detail: { index, x: p.pos_x, y: p.pos_y, z: p.pos_z },
            }),
          );
        }
        savePoiToDb(index).catch((err) => console.error('[2d-map] save POI after drag:', err));
      },
    },
  });
  return matterportHandle;
}

export function getMatterportHandle() {
  return matterportHandle;
}

/** @deprecated No-op — 2D view no longer mirrors the MultiSet GLB mesh. */
export function loadMeshFor2D() {}

/** @deprecated No-op — Matterport view is DOM/SVG, not a WebGL canvas loop. */
export function requestRender() {}

/** @deprecated Floor clipping was for the old orthographic mesh view. */
export function setManualFloors() {}

/** @deprecated */
export function showFloor() {}

export function resetView() {
  matterportHandle?.rebuildRoute();
}

export function getZoomLevel() {
  return 1;
}
