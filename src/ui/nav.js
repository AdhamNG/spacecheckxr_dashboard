/**
 * Navigation Panel UI
 * Renders controls for going to Origin and specific XYZ coordinates.
 */

/**
 * @param {HTMLElement} container
 * @param {(x: number, y: number, z: number) => void} onFlyTo
 */
export function createNavPanel(container, onFlyTo) {
  const panel = document.createElement('div');
  panel.className = 'nav-panel hidden';
  panel.id = 'nav-panel';

  panel.innerHTML = `
    <div class="nav-title">Navigation</div>
    <button class="btn-nav" id="btn-origin">Go to origin</button>
    <div class="nav-divider"></div>
    <div class="nav-subtitle">Go to Coordinate</div>
    <div class="coord-inputs">
      <div class="coord-group">
        <label>X</label>
        <input type="number" id="coord-x" value="0" step="any" />
      </div>
      <div class="coord-group">
        <label>Y</label>
        <input type="number" id="coord-y" value="0" step="any" />
      </div>
      <div class="coord-group">
        <label>Z</label>
        <input type="number" id="coord-z" value="0" step="any" />
      </div>
    </div>
    <button class="btn-nav" id="btn-go-xyz">Fly to coordinates</button>
    <p class="nav-hint">Click a POI dot in the 3D view, then press <kbd>F</kbd> to fly the camera to it.</p>
  `;

  container.appendChild(panel);

  const btnOrigin = panel.querySelector('#btn-origin');
  const btnGoXYZ = panel.querySelector('#btn-go-xyz');
  const inputX = panel.querySelector('#coord-x');
  const inputY = panel.querySelector('#coord-y');
  const inputZ = panel.querySelector('#coord-z');

  btnOrigin.addEventListener('click', () => {
    // Fly to 0,0,0
    onFlyTo(0, 0, 0);
  });

  btnGoXYZ.addEventListener('click', () => {
    const x = parseFloat(inputX.value) || 0;
    const y = parseFloat(inputY.value) || 0;
    const z = parseFloat(inputZ.value) || 0;
    onFlyTo(x, y, z);
  });

  return {
    show() {
      panel.classList.remove('hidden');
    },
    hide() {
      panel.classList.add('hidden');
    }
  };
}
