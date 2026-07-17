import { iconRefresh } from './icons.js';
import { formatEasternDateTime } from '../utils/journey-display.js';
import {
  fetchAllJourneys,
  fetchAllUsers,
  fetchCounts,
  fetchLatestNavnode,
  isSupabaseConfigured,
} from '../services/supabase.js';

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

function durationSeconds(journey) {
  const start = new Date(journey.started_at ?? journey.created_at ?? 0).getTime();
  const end = new Date(journey.completed_at ?? journey.updated_at ?? journey.created_at ?? 0).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 1000);
}

/** Primary calendar day for filtering a journey row (schema-tolerant). */
function journeyFilterDayMs(journey) {
  const candidates = [
    journey.started_at,
    journey.startedAt,
    journey.created_at,
    journey.createdAt,
    journey.completed_at,
    journey.completedAt,
    journey.updated_at,
    journey.updatedAt,
    journey.begin_at,
    journey.beginAt,
    journey.start_time,
    journey.startTime,
    journey.timestamp,
    journey.recorded_at,
    journey.recordedAt,
  ];
  for (const raw of candidates) {
    if (raw == null || raw === '') continue;
    const t = new Date(String(raw)).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * @param {number | null} tsMs
 * @param {string} fromStr
 * @param {string} toStr
 */
function journeyInDateRange(tsMs, fromStr, toStr) {
  if (!fromStr && !toStr) return true;
  if (tsMs == null || !Number.isFinite(tsMs)) return false;
  const day = new Date(tsMs);
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  const isoDay = `${y}-${m}-${d}`;
  if (fromStr && isoDay < fromStr) return false;
  if (toStr && isoDay > toStr) return false;
  return true;
}

function toHms(totalSec) {
  const s = Math.max(0, Number(totalSec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function userKey(row) {
  return String(row.user_email ?? row.email ?? row.user_name ?? 'unknown');
}

export function createUserInsightsPanel(container) {
  const panel = document.createElement('div');
  panel.className = 'user-insights-panel hidden';
  panel.id = 'user-insights-panel';
  panel.innerHTML = `
    <div class="user-insights-header">
      <div class="nav-title">User Insights</div>
      <button type="button" class="reviews-refresh" id="insights-refresh" title="Refresh" aria-label="Refresh">${iconRefresh()}</button>
    </div>
    <div class="reviews-date-filters" id="insights-date-filters">
      <label class="reviews-date-label" for="insights-date-from">From</label>
      <input type="date" class="reviews-date-input" id="insights-date-from" />
      <label class="reviews-date-label" for="insights-date-to">To</label>
      <input type="date" class="reviews-date-input" id="insights-date-to" />
      <button type="button" class="reviews-date-clear" id="insights-date-clear" title="Clear dates">Clear</button>
    </div>
    <div class="reviews-summary-grid" id="insights-summary"></div>
    <div class="insights-user-list" id="insights-user-list">
      <div class="reviews-loading">Open this tab to load user insights…</div>
    </div>
  `;
  container.appendChild(panel);

  const refreshBtn = panel.querySelector('#insights-refresh');
  const summaryEl = panel.querySelector('#insights-summary');
  const listEl = panel.querySelector('#insights-user-list');
  const dateFromEl = panel.querySelector('#insights-date-from');
  const dateToEl = panel.querySelector('#insights-date-to');
  const dateClearBtn = panel.querySelector('#insights-date-clear');

  async function load() {
    summaryEl.innerHTML = '';
    listEl.innerHTML = '<div class="reviews-loading">Loading…</div>';
    try {
      if (!isSupabaseConfigured()) {
        listEl.innerHTML =
          '<div class="reviews-error">Configure Supabase first in <code>.env</code> then restart <code>npm run dev</code>.</div>';
        return;
      }

      const [counts, users, journeysAll] = await Promise.all([
        fetchCounts(),
        fetchAllUsers(),
        fetchAllJourneys(),
      ]);

      const fromStr = dateFromEl?.value ?? '';
      const toStr = dateToEl?.value ?? '';
      const hasDateFilter = Boolean(fromStr || toStr);
      const journeys = journeysAll.filter((j) =>
        journeyInDateRange(journeyFilterDayMs(j), fromStr, toStr)
      );

      const byUser = new Map();
      journeys.forEach((j) => {
        const key = userKey(j);
        if (!byUser.has(key)) {
          byUser.set(key, {
            email: j.user_email ?? key,
            name: j.user_name ?? j.user_email ?? key,
            journeys: 0,
            completed: 0,
            totalPoisDone: 0,
            totalTimeSec: 0,
          });
        }
        const row = byUser.get(key);
        row.journeys += 1;
        if (String(j.status).toLowerCase() === 'completed') row.completed += 1;
        row.totalPoisDone += Number(j.completed_pois ?? 0);
        row.totalTimeSec += durationSeconds(j);
      });

      await Promise.all(users.map(async (u) => {
        const key = userKey(u);
        if (!byUser.has(key)) {
          if (!hasDateFilter) {
            byUser.set(key, {
              email: u.email ?? key,
              name: u.user_name ?? u.full_name ?? u.email ?? key,
              journeys: 0,
              completed: 0,
              totalPoisDone: 0,
              totalTimeSec: 0,
            });
          }
          return;
        }

        const row = byUser.get(key);
        row.name = row.name || u.user_name || u.full_name || u.email || key;

        try {
          const latest = await fetchLatestNavnode(u);
          if (latest.length) {
            row.lastSeen = latest[0].recorded_at ?? latest[0].created_at ?? null;
          }
        } catch {
          // keep panel resilient
        }
      }));

      let rows = Array.from(byUser.values()).sort((a, b) => b.totalTimeSec - a.totalTimeSec);
      if (hasDateFilter) {
        rows = rows.filter(
          (r) => r.journeys > 0 || r.totalTimeSec > 0 || r.totalPoisDone > 0
        );
      }
      const totalTime = rows.reduce((sum, r) => sum + r.totalTimeSec, 0);
      const usersInRange = new Set(journeys.map((j) => userKey(j))).size;

      summaryEl.innerHTML = `
        <div class="reviews-stat-card"><span class="reviews-stat-label">Users (DB)</span><span class="reviews-stat-value">${counts.users}</span></div>
        <div class="reviews-stat-card"><span class="reviews-stat-label">Journeys${hasDateFilter ? ' (range)' : ''}</span><span class="reviews-stat-value">${journeys.length}</span></div>
        <div class="reviews-stat-card"><span class="reviews-stat-label">Reviews (DB)</span><span class="reviews-stat-value">${counts.reviews}</span></div>
        <div class="reviews-stat-card"><span class="reviews-stat-label">Total time${hasDateFilter ? ' (range)' : ''}</span><span class="reviews-stat-value">${toHms(totalTime)}</span></div>
        ${
          hasDateFilter
            ? `<div class="insights-range-hint">Distinct users with journeys in range: ${usersInRange}</div>`
            : ''
        }
      `;

      if (!rows.length) {
        listEl.innerHTML = `<div class="reviews-empty">${
          hasDateFilter
            ? 'No journey activity in the selected date range.'
            : 'No user journey activity yet.'
        }</div>`;
        return;
      }

      listEl.innerHTML = '';
      rows.forEach((r) => {
        const card = document.createElement('div');
        card.className = 'review-card insights-user-card';
        card.innerHTML = `
          <div class="review-card-top">
            <span class="review-meta">User</span>
          </div>
          <div class="review-body">
            <strong>${esc(r.name)}</strong><br/>
            ${esc(r.email || '—')}<br/>
            Journeys: ${r.journeys} | Completed: ${r.completed}<br/>
            POIs Completed: ${r.totalPoisDone}<br/>
            Total Time In App/Journeys: ${toHms(r.totalTimeSec)}
          </div>
          <div class="review-when">Last Seen: ${r.lastSeen ? esc(formatEasternDateTime(r.lastSeen)) : '—'}</div>
        `;
        listEl.appendChild(card);
      });
    } catch (err) {
      console.error(err);
      listEl.innerHTML = `<div class="reviews-error">Could not load insights: ${esc(err.message)}</div>`;
    }
  }

  refreshBtn.addEventListener('click', load);
  dateFromEl.addEventListener('change', load);
  dateToEl.addEventListener('change', load);
  dateClearBtn.addEventListener('click', () => {
    dateFromEl.value = '';
    dateToEl.value = '';
    load();
  });

  return {
    show() {
      panel.classList.remove('hidden');
      load();
    },
    hide() {
      panel.classList.add('hidden');
    },
  };
}
