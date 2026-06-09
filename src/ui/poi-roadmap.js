/**
 * Journey sequence — START → ordered POIs → [+]
 * Drag-and-drop reorders sequence (sort_order in DB).
 */
import { poisData, applyRoadmapReorder } from '../ar/pois.js';
import { iconAdd, iconGrip } from './icons.js';

/**
 * @param {HTMLElement} root
 * @param {{ onAddNew: () => void, onReordered?: () => void }} handlers
 */
export function createPoiRoadmap(root, handlers) {
  let dragId = null;

  function sortedSnapshot() {
    return [...poisData].sort(
      (a, b) =>
        (a.sort_order ?? 999) - (b.sort_order ?? 999) ||
        String(a.poi_name).localeCompare(String(b.poi_name))
    );
  }

  function render() {
    const list = sortedSnapshot();
    root.innerHTML = `
      <div class="roadmap-inner">
        <div class="drawer-panel-edge drawer-panel-edge--top" aria-hidden="true"></div>
        <div class="roadmap-toolbar">
          <span class="roadmap-title">Journey</span>
        </div>
        <div class="roadmap-chain roadmap-chain--vertical" id="roadmap-chain"></div>
        <p class="roadmap-hint">You can drag and move the stops to change their order. The updated sequence will be saved automatically.</p>
        <div class="drawer-panel-edge drawer-panel-edge--bottom" aria-hidden="true"></div>
      </div>
    `;

    const chain = root.querySelector('#roadmap-chain');

    const start = document.createElement('div');
    start.className = 'roadmap-node roadmap-node--start';
    start.innerHTML = '<span class="roadmap-node-label">START</span>';
    start.draggable = false;
    chain.appendChild(start);

    const conn0 = document.createElement('div');
    conn0.className = 'roadmap-connector';
    conn0.innerHTML = '↓';
    chain.appendChild(conn0);

    list.forEach((poi, i) => {
      if (!poi.id) return;
      const card = document.createElement('div');
      card.className = 'roadmap-node roadmap-node--poi';
      card.draggable = true;
      card.dataset.poiId = poi.id;
      card.innerHTML = `
        <span class="roadmap-node-seq">${i + 1}</span>
        <span class="roadmap-node-name">${escapeHtml(poi.poi_name)}</span>
        <span class="roadmap-node-drag">${iconGrip()}</span>
      `;
      card.addEventListener('dragstart', (e) => {
        dragId = poi.id;
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        dragId = null;
        card.classList.remove('dragging');
      });
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetId = poi.id;
        if (dragId && dragId !== targetId) {
          reorderIds(dragId, targetId);
        }
      });

      chain.appendChild(card);

      const conn = document.createElement('div');
      conn.className = 'roadmap-connector';
      conn.innerHTML = '↓';
      chain.appendChild(conn);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'roadmap-node roadmap-node--add';
    addBtn.id = 'roadmap-btn-add';
    addBtn.title = 'Add new POI on the map';
    addBtn.innerHTML = `<span class="roadmap-plus">${iconAdd()}</span>`;
    addBtn.addEventListener('click', () => {
      const r = handlers.onAddNew?.();
      if (r && typeof r.then === 'function') r.catch((e) => console.error('[journey]', e));
    });
    chain.appendChild(addBtn);
  }

  async function reorderIds(fromId, toId) {
    const order = sortedSnapshot().map((p) => p.id).filter(Boolean);
    const fi = order.indexOf(fromId);
    const ti = order.indexOf(toId);
    if (fi < 0 || ti < 0) return;
    const [moved] = order.splice(fi, 1);
    order.splice(ti, 0, moved);
    await applyRoadmapReorder(order);
    if (handlers.onReordered) handlers.onReordered();
    render();
  }

  return {
    render,
    refresh: render,
  };
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}
