/**
 * User Tracking Panel
 *
 * Two modes:
 *   Live   — polls latest navnode per user every 5 s, shows 3D markers
 *   History — click a user to fetch full navnode history, draws 3D route
 */
import {
  fetchUsers,
  fetchLatestNavnode,
  fetchNavnodeHistory,
} from '../services/supabase.js';
import { flyTo } from '../ar/scene.js';
import { showUserHeatmap, clearUserHeatmap, clearGlobalHeatmap } from '../ar/nav-heatmap.js';
import {
  addUserMarker,
  updateUserMarker,
  clearAllMarkers,
  drawHistoryRoute,
  clearHistoryRoute,
} from '../ar/user-tracking.js';
import { formatEasternDateTime } from '../utils/journey-display.js';

const POLL_INTERVAL = 5000;

let users = [];
let mode = 'live'; // 'live' | 'history' | 'heatmap'
let pollTimer = null;
let selectedUserId = null;
let historyPoints = [];

// ─── DOM refs (set during create) ───
let panel, listEl, tabLive, tabHistory, tabHeatmap, detailSection, detailContent;

/**
 * @param {HTMLElement} container
 */
export function createUserPanel(container) {
  panel = document.createElement('div');
  panel.className = 'user-panel hidden';
  panel.id = 'user-panel';

  panel.innerHTML = `
    <div class="user-panel-header">
      <div class="nav-title">Users</div>
      <div class="user-tabs">
        <button class="user-tab active" data-mode="live">Live</button>
        <button class="user-tab" data-mode="history">History</button>
        <button class="user-tab" data-mode="heatmap">Heat map</button>
      </div>
    </div>
    <div class="user-list" id="user-list"></div>
    <div class="user-detail hidden" id="user-detail">
      <div class="nav-divider"></div>
      <div class="user-detail-content" id="user-detail-content"></div>
    </div>
  `;

  container.appendChild(panel);

  listEl = panel.querySelector('#user-list');
  detailSection = panel.querySelector('#user-detail');
  detailContent = panel.querySelector('#user-detail-content');
  tabLive = panel.querySelector('[data-mode="live"]');
  tabHistory = panel.querySelector('[data-mode="history"]');
  tabHeatmap = panel.querySelector('[data-mode="heatmap"]');

  tabLive.addEventListener('click', () => switchMode('live'));
  tabHistory.addEventListener('click', () => switchMode('history'));
  tabHeatmap.addEventListener('click', () => switchMode('heatmap'));

  return {
    show() {
      panel.classList.remove('hidden');
      loadUsers();
    },
    hide() {
      panel.classList.add('hidden');
      stopPolling();
      selectedUserId = null;
      detailSection.classList.add('hidden');
      clearAllMarkers();
      clearHistoryRoute();
      clearUserHeatmap();
    },
  };
}

// ─── Mode switching ───

function switchMode(newMode) {
  mode = newMode;
  tabLive.classList.toggle('active', mode === 'live');
  tabHistory.classList.toggle('active', mode === 'history');
  tabHeatmap.classList.toggle('active', mode === 'heatmap');
  selectedUserId = null;
  detailSection.classList.add('hidden');
  clearAllMarkers();
  clearHistoryRoute();
  clearUserHeatmap();

  highlightSelected();

  if (mode === 'live') {
    startPolling();
  } else {
    stopPolling();
  }
}

// ─── Load users from Supabase ───

async function loadUsers() {
  try {
    users = await fetchUsers();
    renderUserList();
    if (mode === 'live') startPolling();
  } catch (err) {
    console.error('Failed to fetch users:', err);
    listEl.innerHTML = '<div class="user-empty">Failed to load users</div>';
  }
}

function renderUserList() {
  listEl.innerHTML = '';
  if (users.length === 0) {
    listEl.innerHTML = '<div class="user-empty">No users found</div>';
    return;
  }
  users.forEach((u, i) => {
    const item = document.createElement('div');
    item.className = 'user-item';
    item.dataset.userId = u.id;

    const dot = document.createElement('span');
    dot.className = 'user-dot';
    dot.style.background = dotColor(i);

    const name = document.createElement('span');
    name.className = 'user-name';
    name.textContent = u.full_name || u.email;

    const role = document.createElement('span');
    role.className = 'user-role';
    role.textContent = u.role || '';

    item.appendChild(dot);
    item.appendChild(name);
    item.appendChild(role);

    item.addEventListener('click', () => onUserClick(u, i));
    listEl.appendChild(item);
  });
}

const DOT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#8b5cf6', '#14b8a6'];
function dotColor(i) {
  return DOT_COLORS[i % DOT_COLORS.length];
}

function highlightSelected() {
  listEl.querySelectorAll('.user-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.userId === selectedUserId);
  });
}

// ─── User click handler ───

async function onUserClick(user, colorIndex) {
  selectedUserId = user.id;
  highlightSelected();

  if (mode === 'live') {
    await showLivePosition(user, colorIndex);
  } else if (mode === 'history') {
    await showHistory(user, colorIndex);
  } else if (mode === 'heatmap') {
    await showUserHeatmapView(user, colorIndex);
  }
}

// ─── LIVE mode ───

async function showLivePosition(user, colorIndex) {
  detailSection.classList.remove('hidden');
  detailContent.innerHTML = '<div class="user-loading">Fetching position…</div>';

  try {
    const rows = await fetchLatestNavnode(user);
    if (rows.length === 0) {
      detailContent.innerHTML = '<div class="user-empty">No positions found</div>';
      return;
    }
    const p = rows[0];
    const x = Number(p.pos_x);
    const y = Number(p.pos_y);
    const z = Number(p.pos_z);

    detailContent.innerHTML = `
      <div class="user-pos-label">${user.full_name || user.email}</div>
      <div class="user-pos-coords">
        <span style="color:#ef4444">X ${x.toFixed(4)}</span>
        <span style="color:#22c55e">Y ${y.toFixed(4)}</span>
        <span style="color:#3b82f6">Z ${z.toFixed(4)}</span>
      </div>
      <div class="user-pos-time">${formatNavTime(p.recorded_at)}</div>
    `;

    addUserMarker(user.id, user.full_name || user.email, x, y, z, colorIndex);
    flyTo(x, y, z);
  } catch (err) {
    console.error(err);
    detailContent.innerHTML = `<div class="user-empty">${formatNavnodeErrHtml(err, 'position')}</div>`;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollAllLivePositions, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollAllLivePositions() {
  if (mode !== 'live') return;
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    try {
      const rows = await fetchLatestNavnode(u);
      if (rows.length === 0) continue;
      const p = rows[0];
      const x = Number(p.pos_x);
      const y = Number(p.pos_y);
      const z = Number(p.pos_z);

      updateUserMarker(u.id, x, y, z);

      if (u.id === selectedUserId) {
        const coordsEl = detailContent.querySelector('.user-pos-coords');
        const timeEl = detailContent.querySelector('.user-pos-time');
        if (coordsEl) {
          coordsEl.innerHTML = `
            <span style="color:#ef4444">X ${x.toFixed(4)}</span>
            <span style="color:#22c55e">Y ${y.toFixed(4)}</span>
            <span style="color:#3b82f6">Z ${z.toFixed(4)}</span>
          `;
        }
        if (timeEl) {
          timeEl.textContent = formatNavTime(p.recorded_at);
        }
      }
    } catch {
      // ignore per-user fetch errors during polling
    }
  }
}

// ─── HEAT MAP tab (single user) ───

async function showUserHeatmapView(user, _colorIndex) {
  detailSection.classList.remove('hidden');
  detailContent.innerHTML = '<div class="user-loading">Building heat map…</div>';
  clearGlobalHeatmap();
  clearHistoryRoute();
  clearUserHeatmap();

  try {
    const points = await fetchNavnodeHistory(user);
    if (points.length === 0) {
      detailContent.innerHTML = '<div class="user-empty">No navnodes for heat map</div>';
      return;
    }

    showUserHeatmap(points);
    const first = points[0];
    flyTo(Number(first.pos_x), Number(first.pos_y), Number(first.pos_z));

    detailContent.innerHTML = `
      <div class="user-pos-label">${user.full_name || user.email}</div>
      <div class="user-pos-coords">Heat map — ${points.length} visits (red density)</div>
      <div class="user-pos-time">Select another user to compare routes</div>
    `;
  } catch (err) {
    console.error(err);
    detailContent.innerHTML = `<div class="user-empty">${formatNavnodeErrHtml(err, 'history')}</div>`;
  }
}

// ─── HISTORY mode ───

async function showHistory(user, colorIndex) {
  detailSection.classList.remove('hidden');
  detailContent.innerHTML = '<div class="user-loading">Loading route history…</div>';
  clearUserHeatmap();
  clearHistoryRoute();

  try {
    historyPoints = await fetchNavnodeHistory(user);
    if (historyPoints.length === 0) {
      detailContent.innerHTML = '<div class="user-empty">No history found for this user</div>';
      return;
    }

    drawHistoryRoute(historyPoints, colorIndex);

    const first = historyPoints[0];
    flyTo(Number(first.pos_x), Number(first.pos_y), Number(first.pos_z));

    let html = `<div class="user-pos-label">${user.full_name || user.email} — ${historyPoints.length} points</div>`;
    html += '<div class="user-history-list">';
    historyPoints.forEach((p, idx) => {
      const t = p.recorded_at ? formatEasternDateTime(p.recorded_at) : '—';
      html += `<div class="user-history-item" data-idx="${idx}">
        <span class="user-history-num">${idx + 1}</span>
        <span class="user-history-time">${t}</span>
        <span class="user-history-xyz">${Number(p.pos_x).toFixed(3)}, ${Number(p.pos_y).toFixed(3)}, ${Number(p.pos_z).toFixed(3)}</span>
      </div>`;
    });
    html += '</div>';

    detailContent.innerHTML = html;

    detailContent.querySelectorAll('.user-history-item').forEach((el) => {
      el.addEventListener('click', () => {
        const p = historyPoints[Number(el.dataset.idx)];
        flyTo(Number(p.pos_x), Number(p.pos_y), Number(p.pos_z));
      });
    });
  } catch (err) {
    console.error(err);
    detailContent.innerHTML = `<div class="user-empty">${formatNavnodeErrHtml(err, 'history')}</div>`;
  }
}

function formatNavTime(iso) {
  if (!iso) return '—';
  return formatEasternDateTime(iso);
}

/** Short, safe HTML hint for Supabase / RLS / schema issues on pj_navnodes */
function formatNavnodeErrHtml(err, kind) {
  const raw = String(err?.message ?? err ?? 'Unknown error');
  let hint =
    kind === 'position'
      ? 'Could not load live position from <code>pj_navnodes</code>.'
      : 'Could not load history from <code>pj_navnodes</code>.';
  if (/403|401/.test(raw)) {
    hint +=
      ' <strong>RLS</strong>: allow <code>SELECT</code> on <code>pj_navnodes</code> for the anon key (or your role).';
  } else if (/400|PGRST|column|42703/i.test(raw)) {
    hint +=
      ' Check columns: match by <code>user_email</code> / <code>email</code> (same as <code>pj_users</code>), or <code>user_id</code>, plus <code>created_at</code>.';
  }
  const esc = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `${hint}<br/><span class="user-err-detail">${esc(raw.slice(0, 280))}</span>`;
}
