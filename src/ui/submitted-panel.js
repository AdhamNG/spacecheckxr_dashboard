import { flyTo } from '../ar/scene.js';
import { clearSubmittedPoints, hideSubmittedPoints, showOnlySubmittedPoint } from '../ar/submitted-points.js';
import { fetchImageBlobFromRow, fetchSubmittedPoints, isSupabaseConfigured } from '../services/supabase.js';
import { iconRefresh } from './icons.js';
import { formatEasternDateTime } from '../utils/journey-display.js';

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

async function imageDataUrl(row) {
  const blob = await fetchImageBlobFromRow(row, 'pj_snapshots');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read submitted image'));
    reader.readAsDataURL(blob);
  });
}

export function createSubmittedPanel(container) {
  const panel = document.createElement('div');
  panel.className = 'submitted-panel hidden';
  panel.id = 'submitted-panel';
  panel.innerHTML = `
    <div class="reviews-panel-header">
      <div class="nav-title">Submitted Reviews</div>
      <button type="button" class="reviews-refresh" id="submitted-refresh" title="Refresh" aria-label="Refresh">${iconRefresh()}</button>
    </div>
    <div class="reviews-list" id="submitted-list">
      <div class="reviews-loading">Open this tab to load submitted points…</div>
    </div>
    <div class="submitted-detail hidden" id="submitted-detail"></div>
  `;
  container.appendChild(panel);

  const refreshBtn = panel.querySelector('#submitted-refresh');
  const listEl = panel.querySelector('#submitted-list');
  const detailEl = panel.querySelector('#submitted-detail');
  let rows = [];

  async function openDetail(row) {
    detailEl.classList.remove('hidden');
    detailEl.innerHTML = `<div class="reviews-loading">Loading submitted detail…</div>`;
    let imageHtml = '<div class="reviews-error">No image available</div>';
    try {
      const src = await imageDataUrl(row);
      if (src) imageHtml = `<img class="submitted-detail-image" src="${esc(src)}" alt="Submitted snapshot" />`;
    } catch {
      imageHtml = '<div class="reviews-error">Image could not be loaded</div>';
    }
    detailEl.innerHTML = `
      <div class="review-card">
        <div class="review-card-top">
          <span class="review-user">${esc(row.user_name ?? row.user_email ?? 'Unknown')}</span>
        </div>
        ${imageHtml}
        <div class="review-body">${esc(row.review_text ?? row.description ?? 'No review text')}</div>
        <div class="review-when">${esc(row.created_at ? formatEasternDateTime(row.created_at) : '—')}</div>
      </div>
    `;
  }

  function renderList() {
    if (!rows.length) {
      listEl.innerHTML = '<div class="reviews-empty">No submitted points found.</div>';
      detailEl.classList.add('hidden');
      return;
    }
    listEl.innerHTML = '';
    rows.forEach((row) => {
      const card = document.createElement('div');
      card.className = 'review-card';
      const user = row.user_name ?? row.user_email ?? 'Unknown';
      card.innerHTML = `
        <div class="review-card-top">
          <span class="review-user">${esc(user)}</span>
        </div>
        <div class="review-body">${esc(row.title ?? row.review_text ?? 'Submitted point')}</div>
        <div class="review-when">XYZ: ${Number(row.pos_x ?? 0).toFixed(2)}, ${Number(row.pos_y ?? 0).toFixed(2)}, ${Number(row.pos_z ?? 0).toFixed(2)}</div>
      `;
      card.addEventListener('click', () => {
        const x = Number(row.pos_x ?? 0);
        const y = Number(row.pos_y ?? 0);
        const z = Number(row.pos_z ?? 0);
        flyTo(x, y, z);
        void openDetail(row);
        void showOnlySubmittedPoint(row);
      });
      listEl.appendChild(card);
    });
  }

  async function load() {
    listEl.innerHTML = '<div class="reviews-loading">Loading…</div>';
    detailEl.classList.add('hidden');
    try {
      if (!isSupabaseConfigured()) {
        listEl.innerHTML = '<div class="reviews-error">Configure Supabase in <code>.env</code> and restart.</div>';
        return;
      }
      rows = await fetchSubmittedPoints();
      renderList();
      clearSubmittedPoints();
    } catch (err) {
      console.error(err);
      listEl.innerHTML = `<div class="reviews-error">Could not load submitted points: ${esc(err.message)}</div>`;
      clearSubmittedPoints();
    }
  }

  refreshBtn.addEventListener('click', load);

  return {
    show() {
      panel.classList.remove('hidden');
      load();
    },
    hide() {
      panel.classList.add('hidden');
      hideSubmittedPoints();
      detailEl.classList.add('hidden');
    },
  };
}
