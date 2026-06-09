/**
 * 3D viewport tools: walk-to-point, place POI, and place media.
 */
import { iconFootprint, iconPlacePoi, iconPlaceMedia, iconClose } from './icons.js';

/** @typedef {'default' | 'walk' | 'add-poi' | 'add-media'} SceneToolMode */

/** @type {Record<string, 'pois' | 'media' | null>} */
const MODE_PANEL = {
  walk: null,
  'add-poi': 'pois',
  'add-media': 'media',
};

/**
 * @param {HTMLElement} viewportBody
 * @param {{
 *   onModeChange?: (mode: SceneToolMode) => void,
 *   onCancel?: () => void,
 *   onToolActivate?: (mode: SceneToolMode, panelId: 'pois' | 'media' | null) => void,
 * }} [options]
 */
export function createSceneToolbar(viewportBody, options = {}) {
  const onModeChange = options.onModeChange;
  const onCancel = options.onCancel;
  const onToolActivate = options.onToolActivate;
  let activeMode = 'default';

  const root = document.createElement('div');
  root.className = 'scene-toolbar chrome-layer';
  root.id = 'scene-toolbar';
  root.innerHTML = `
    <div class="scene-toolbar-inner float-glass">
      <button type="button" class="scene-tool-btn" data-mode="walk" title="Go to point — click the map to move the camera (Exit when done)" aria-pressed="false">
        <span class="scene-tool-icon">${iconFootprint()}</span>
        <span class="scene-tool-label">Go to</span>
      </button>
      <button type="button" class="scene-tool-btn" data-mode="add-poi" data-panel="pois" title="Add POI — click once on the map" aria-pressed="false">
        <span class="scene-tool-icon">${iconPlacePoi()}</span>
        <span class="scene-tool-label">Add POI</span>
      </button>
      <button type="button" class="scene-tool-btn" data-mode="add-media" data-panel="media" title="Add media — click on the map" aria-pressed="false">
        <span class="scene-tool-icon">${iconPlaceMedia()}</span>
        <span class="scene-tool-label">Add media</span>
      </button>
      <button type="button" class="scene-tool-cancel hidden" id="scene-tool-cancel" title="Exit tool" aria-label="Exit">
        ${iconClose()}
      </button>
    </div>
    <p class="scene-tool-hint hidden" id="scene-tool-hint" role="status"></p>
  `;

  viewportBody.appendChild(root);

  const hintEl = root.querySelector('#scene-tool-hint');
  const cancelBtn = root.querySelector('#scene-tool-cancel');
  const buttons = root.querySelectorAll('.scene-tool-btn');

  const HINTS = {
    walk: 'Walk mode — click the map to go there. Press Exit when finished.',
    'add-poi': 'Click on the space to place a POI',
    'add-media': 'Click on the map to place media',
  };

  function setMode(mode) {
    const next = mode === 'walk' || mode === 'add-poi' || mode === 'add-media' ? mode : 'default';
    activeMode = next;
    buttons.forEach((btn) => {
      const m = btn.dataset.mode;
      const on = m === next;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    cancelBtn.classList.toggle('hidden', next === 'default');
    if (next === 'default') {
      hintEl.classList.add('hidden');
      hintEl.textContent = '';
    } else {
      hintEl.textContent = HINTS[next] || '';
      hintEl.classList.remove('hidden');
    }
    if (onModeChange) onModeChange(next);
  }

  function cancel() {
    setMode('default');
    if (onCancel) onCancel();
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = /** @type {SceneToolMode} */ (btn.dataset.mode);
      if (activeMode === mode) {
        cancel();
        return;
      }
      setMode(mode);
      const panel = MODE_PANEL[mode] ?? null;
      onToolActivate?.(mode, panel);
    });
  });

  cancelBtn.addEventListener('click', cancel);

  return {
    element: root,
    setMode,
    cancel,
    getMode: () => activeMode,
  };
}
