/**
 * 2D map sidebar — Matterport floorplan helpers (replaces manual floor / mesh slice UI).
 */
import { resetView } from '../ar/map2d.js';

export function create2DMapPanel(container) {
  const panel = document.createElement('div');
  panel.className = 'map2d-panel hidden';
  panel.id = 'map2d-panel';

  panel.innerHTML = `
    <div class="map2d-header">
      <div class="nav-title">2D floor plan</div>
    </div>
    <div class="map2d-actions">
      <button type="button" class="btn-nav" id="btn-2d-rebuild-route">Refresh route overlay</button>
    </div>
  `;

  container.appendChild(panel);

  const btnRebuild = panel.querySelector('#btn-2d-rebuild-route');
  btnRebuild.addEventListener('click', () => {
    resetView();
  });

  return {
    show() {
      panel.classList.remove('hidden');
    },
    hide() {
      panel.classList.add('hidden');
    },
    bindZoomListener() {
      /* Legacy: orthographic 2D had zoom events; Matterport map does not use this. */
    },
    getConfirmedFloors() {
      return [];
    },
    setSwitchTo3D(cb) {
      void cb;
    },
  };
}
