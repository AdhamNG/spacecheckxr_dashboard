/**
 * Admin CRUD Panels
 * Users management plus an Analytics overview.
 */
import { iconEdit, iconClose } from './icons.js';
import {
  fetchAllUsers,
  updateUser,
  deleteUser,
  fetchCounts,
  isSupabaseConfigured,
} from '../services/supabase.js';

/**
 * @param {{ users: HTMLElement, analytics: HTMLElement }} slots
 */
export function createAdminPanels(slots, onRefresh) {
  buildCrudPanel({
    slot: slots.users,
    title: 'USER MANAGEMENT',
    fetchAll: fetchAllUsers,
    updateItem: updateUser,
    deleteItem: deleteUser,
    columns: [
      { key: 'user_name', label: 'Name', editable: true },
      { key: 'email', label: 'Email', editable: true },
    ],
    display: (item) =>
      `<span class="admin-item-title">${esc(item.user_name || item.full_name || item.email)}</span>
       <span class="admin-item-meta">${esc(item.email || '—')}</span>`,
    onRefresh,
  });

  buildAnalyticsPanel(slots.analytics);
}

/* ── Generic CRUD Panel Builder ── */

function buildCrudPanel({ slot, title, fetchAll, updateItem, deleteItem, columns, display, onRefresh }) {
  slot.innerHTML = `
    <div class="admin-panel">
      <div class="admin-header">
        <div class="admin-title">${title}</div>
        <button class="admin-refresh-btn" title="Refresh">&#x21bb;</button>
      </div>
      <div class="admin-list"></div>
    </div>
  `;

  const listEl = slot.querySelector('.admin-list');
  const refreshBtn = slot.querySelector('.admin-refresh-btn');
  let items = [];

  async function load() {
    listEl.innerHTML = '<div class="admin-loading">Loading...</div>';
    try {
      if (!isSupabaseConfigured()) {
        listEl.innerHTML = `<div class="admin-error">Supabase is not configured. Add a file named <code>.env</code> next to <code>package.json</code> with <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (Project Settings → API in Supabase), then restart <code>npm run dev</code>.</div>`;
        return;
      }
      items = await fetchAll();
      render();
    } catch (err) {
      listEl.innerHTML = `<div class="admin-error">Failed to load: ${esc(err.message)}</div>`;
    }
  }

  function render() {
    if (items.length === 0) {
      listEl.innerHTML = '<div class="admin-empty">No records found</div>';
      return;
    }
    listEl.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'admin-item';
      row.dataset.id = item.id;

      row.innerHTML = `
        <div class="admin-item-display">
          <div class="admin-item-info">${display(item)}</div>
          <div class="admin-item-actions">
            <button class="admin-btn admin-btn-edit" title="Edit" aria-label="Edit">${iconEdit()}</button>
            <button class="admin-btn admin-btn-delete" title="Delete" aria-label="Delete">${iconClose()}</button>
          </div>
        </div>
        <div class="admin-item-edit hidden">
          ${columns.map((col) => {
            if (col.type === 'bool') {
              const checked = item[col.key] ? 'checked' : '';
              return `<label class="admin-field admin-field-bool">
                <input type="checkbox" data-key="${col.key}" ${checked} />
                <span>${col.label}</span>
              </label>`;
            }
            return `<div class="admin-field">
              <label>${col.label}</label>
              <input type="text" data-key="${col.key}" value="${esc(String(item[col.key] ?? ''))}" />
            </div>`;
          }).join('')}
          <div class="admin-edit-actions">
            <button class="admin-btn admin-btn-save">Save</button>
            <button class="admin-btn admin-btn-cancel">Cancel</button>
          </div>
        </div>
      `;

      const displayEl = row.querySelector('.admin-item-display');
      const editEl = row.querySelector('.admin-item-edit');
      const editBtn = row.querySelector('.admin-btn-edit');
      const deleteBtn = row.querySelector('.admin-btn-delete');
      const saveBtn = row.querySelector('.admin-btn-save');
      const cancelBtn = row.querySelector('.admin-btn-cancel');

      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        listEl.querySelectorAll('.admin-item-edit').forEach((el) => el.classList.add('hidden'));
        editEl.classList.toggle('hidden');
      });

      cancelBtn.addEventListener('click', () => editEl.classList.add('hidden'));

      saveBtn.addEventListener('click', async () => {
        const data = {};
        editEl.querySelectorAll('[data-key]').forEach((input) => {
          if (input.type === 'checkbox') {
            data[input.dataset.key] = input.checked;
          } else {
            data[input.dataset.key] = input.value;
          }
        });
        saveBtn.textContent = '...';
        try {
          await updateItem(item.id, data);
          saveBtn.textContent = 'Saved!';
          setTimeout(() => load(), 600);
          if (onRefresh) onRefresh();
        } catch (err) {
          saveBtn.textContent = 'Error';
          console.error(err);
          setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
        }
      });

      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${item[columns[0].key]}"?`)) return;
        deleteBtn.innerHTML = '...';
        try {
          await deleteItem(item.id);
          row.style.opacity = '0';
          setTimeout(() => { row.remove(); if (onRefresh) onRefresh(); }, 300);
        } catch (err) {
          console.error(err);
          deleteBtn.innerHTML = iconClose();
        }
      });

      listEl.appendChild(row);
    });
  }

  refreshBtn.addEventListener('click', load);

  const observer = new MutationObserver(() => {
    if (slot.classList.contains('active') && items.length === 0) load();
  });
  observer.observe(slot, { attributes: true, attributeFilter: ['class'] });
  if (slot.classList.contains('active')) load();
}

/* ── Analytics Panel ── */

function buildAnalyticsPanel(slot) {
  slot.innerHTML = `
    <div class="admin-panel analytics-panel">
      <div class="admin-header">
        <div class="admin-title">SYSTEM ANALYTICS</div>
        <button class="admin-refresh-btn" title="Refresh">&#x21bb;</button>
      </div>
      <div class="analytics-grid" id="analytics-grid">
        <div class="analytics-loading">Loading analytics...</div>
      </div>
    </div>
  `;

  const grid = slot.querySelector('#analytics-grid');
  const refreshBtn = slot.querySelector('.admin-refresh-btn');

  async function load() {
    grid.innerHTML = '<div class="analytics-loading">Loading...</div>';
    try {
      const c = await fetchCounts();
      if (c.missingEnv) {
        grid.innerHTML =
          '<div class="admin-error">Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env</code> (see Project Settings → API), then restart the dev server.</div>';
        return;
      }
      grid.innerHTML = `
        ${analyticsCard('Users', c.users, 'cyan')}
        ${analyticsCard('POIs', c.pois, 'violet')}
        ${analyticsCard('Journeys', c.journeys, 'green')}
        ${analyticsCard('Reviews', c.reviews, 'amber')}
      `;
    } catch (err) {
      grid.innerHTML = `<div class="admin-error">${esc(err.message)}</div>`;
    }
  }

  refreshBtn.addEventListener('click', load);

  const observer = new MutationObserver(() => {
    if (slot.classList.contains('active')) load();
  });
  observer.observe(slot, { attributes: true, attributeFilter: ['class'] });
}

function analyticsCard(label, value, color) {
  return `
    <div class="analytics-card analytics-card--${color}">
      <div class="analytics-card-value">${value}</div>
      <div class="analytics-card-label">${label}</div>
    </div>
  `;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
