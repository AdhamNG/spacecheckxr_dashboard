/**
 * Journey reviews — reads `pj_journey_reviews` (separate sidebar section).
 */
import {
  fetchAllJourneyReviews,
  formatReviewDuration,
  getImageUrlForReview,
  getReviewVideoUrl,
  isSupabaseConfigured,
  reviewHasVideo,
} from '../services/supabase.js';
import {
  computeJourneyPdfDetail,
  generateJourneyPdfReport,
  preloadJsPDF,
} from '../services/journey-pdf-generator.js';
import {
  getCompleteJourneyStops,
  getJourneyDisplayNameById,
  getJourneyRowById,
  hydrateJourneyRegistry,
  sanitizeJourneyFilename,
} from '../services/journey-registry.js';
import { formatEasternDateTime, journeyIdFromRow } from '../utils/journey-display.js';
import { iconRefresh } from './icons.js';

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

function reviewText(row) {
  return row.comment ?? row.review_text ?? row.body ?? row.text ?? '';
}

function ratingValue(row) {
  const r = row.rating ?? row.stars ?? row.score;
  if (r == null) return null;
  const n = Number(r);
  return Number.isFinite(n) ? n : null;
}

function userLabel(row) {
  return (
    row.journey_user_name ??
    row.journey_user_email ??
    row.user_name ??
    row.userName ??
    row.username ??
    row.user_id ??
    row.userId ??
    row.user_ref ??
    'Unknown user'
  );
}

/** Raw journey UUID for filters / grouping. */
function journeyLabel(row) {
  const id = journeyIdFromRow(row);
  return id || 'Unknown journey';
}

function uniqueValues(rows, getValue) {
  const set = new Set();
  rows.forEach((row) => set.add(String(getValue(row))));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}


/** @param {Record<string, unknown>} row */
function reviewRowDateMs(row) {
  const raw = row.created_at ?? row.updated_at ?? row.reviewed_at ?? row.submitted_at;
  if (raw == null) return null;
  const t = new Date(String(raw)).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * @param {number | null} tsMs
 * @param {string} fromStr YYYY-MM-DD or ''
 * @param {string} toStr YYYY-MM-DD or ''
 */
function timestampInDateRange(tsMs, fromStr, toStr) {
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

/**
 * @param {HTMLElement} container
 */
export function createReviewsPanel(container) {
  const panel = document.createElement('div');
  panel.className = 'reviews-panel hidden';
  panel.id = 'reviews-panel';

  panel.innerHTML = `
    <div class="reviews-panel-header">
      <div class="nav-title">Journey reviews</div>
      <div class="reviews-header-actions">
        <button type="button" class="reviews-export" id="reviews-export" title="One PDF file per journey (all stops in each)">Export all journey PDFs</button>
        <button type="button" class="reviews-refresh" id="reviews-refresh" title="Refresh" aria-label="Refresh">${iconRefresh()}</button>
      </div>
    </div>
    <div class="reviews-summary-grid" id="reviews-summary-grid"></div>
    <div class="reviews-filters">
      <select class="reviews-filter-select" id="reviews-journey-filter">
        <option value="">All journeys</option>
      </select>
      <select class="reviews-filter-select" id="reviews-user-filter">
        <option value="">All users</option>
      </select>
    </div>
    <div class="reviews-date-filters">
      <label class="reviews-date-label" for="reviews-date-from">From</label>
      <input type="date" class="reviews-date-input" id="reviews-date-from" />
      <label class="reviews-date-label" for="reviews-date-to">To</label>
      <input type="date" class="reviews-date-input" id="reviews-date-to" />
      <button type="button" class="reviews-date-clear" id="reviews-date-clear" title="Clear dates">Clear</button>
    </div>
    <div class="reviews-list" id="reviews-list">
      <div class="reviews-loading">Open this tab to load reviews…</div>
    </div>
  `;

  container.appendChild(panel);

  const listEl = panel.querySelector('#reviews-list');
  const refreshBtn = panel.querySelector('#reviews-refresh');
  const exportBtn = panel.querySelector('#reviews-export');
  const summaryEl = panel.querySelector('#reviews-summary-grid');
  const journeyFilterEl = panel.querySelector('#reviews-journey-filter');
  const userFilterEl = panel.querySelector('#reviews-user-filter');
  const dateFromEl = panel.querySelector('#reviews-date-from');
  const dateToEl = panel.querySelector('#reviews-date-to');
  const dateClearBtn = panel.querySelector('#reviews-date-clear');
  let allRows = [];
  let currentRows = [];

  function videoDurationLabel(row) {
    const duration = Number(row.duration_seconds ?? row.durationSeconds ?? 0);
    if (duration > 0) return `${duration.toFixed(1)}s`;
    return formatReviewDuration(duration);
  }

  function groupByJourney(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const key = String(journeyLabel(row));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });
    return Array.from(map.entries()).map(([journeyId, journeyRows]) => {
      const sorted = journeyRows.sort(
        (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
      );
      return {
        journeyId,
        displayName:
          sorted[0]?.journey_display_name ??
          getJourneyDisplayNameById(journeyId, sorted),
        rows: sorted,
        user: userLabel(sorted[0]),
      };
    });
  }

  function renderStopMediaHtml(row, stopIndex) {
    const stopName = row.poi_name ?? row.pj_pois?.poi_name ?? row.poi_id ?? `Stop ${stopIndex + 1}`;
    const videoUrl = getReviewVideoUrl(row);
    const imageUrl = getImageUrlForReview(row);
    const body = reviewText(row) || 'No review text';
    const rating = ratingValue(row);
    const dur = videoUrl ? videoDurationLabel(row) : '';

    let media = '';
    if (videoUrl) {
      media = `
        <div class="review-stop-media">
          <span class="review-media-badge review-media-badge--video">Screen recording${dur ? ` · ${esc(dur)}` : ''}</span>
          <video class="review-video" controls playsinline preload="metadata" src="${esc(videoUrl)}"${imageUrl ? ` poster="${esc(imageUrl)}"` : ''}></video>
          <a class="review-video-open" href="${esc(videoUrl)}" target="_blank" rel="noopener noreferrer">Open video in new tab</a>
        </div>
      `;
    } else if (imageUrl) {
      media = `
        <div class="review-stop-media">
          <span class="review-media-badge">Snapshot</span>
          <img class="review-snapshot" src="${esc(imageUrl)}" alt="Snapshot for ${esc(stopName)}" loading="lazy" />
        </div>
      `;
    } else if (reviewHasVideo(row)) {
      media = '<div class="review-stop-media review-stop-media--missing">Screen recording could not be loaded</div>';
    } else {
      media = '<div class="review-stop-media review-stop-media--missing">No snapshot</div>';
    }

    return `
      <article class="review-stop">
        <div class="review-stop-head">
          <strong>${esc(stopName)}</strong>
          ${rating != null ? `<span class="review-stop-rating">${rating}/5</span>` : ''}
        </div>
        ${body ? `<p class="review-stop-text">${esc(body)}</p>` : ''}
        ${media}
      </article>
    `;
  }

  async function generateJourneyPDF(journeyGroup) {
    const rows = getCompleteJourneyStops(allRows, journeyGroup.journeyId);
    const journeyTitle =
      journeyGroup.displayName ?? getJourneyDisplayNameById(journeyGroup.journeyId, rows);
    const journeyRow = getJourneyRowById(journeyGroup.journeyId);
    const detail = computeJourneyPdfDetail(journeyRow, rows);
    const userEmail =
      journeyGroup.user
      ?? journeyRow?.user_email
      ?? journeyRow?.user_name
      ?? rows[0]?.journey_user_email
      ?? rows[0]?.journey_user_name
      ?? 'Guest';

    await generateJourneyPdfReport({
      detail,
      reviews: rows,
      userEmail: String(userEmail),
      fileName: `NavMe_Report_${sanitizeJourneyFilename(journeyTitle)}.pdf`,
    });
  }

  function applyFilters(rows) {
    const selectedJourney = journeyFilterEl.value;
    const selectedUser = userFilterEl.value;
    const fromStr = dateFromEl?.value ?? '';
    const toStr = dateToEl?.value ?? '';
    return rows.filter((row) => {
      const matchJourney = !selectedJourney || journeyIdFromRow(row) === selectedJourney;
      const matchUser = !selectedUser || String(userLabel(row)) === selectedUser;
      const ts = reviewRowDateMs(row);
      const matchDate = timestampInDateRange(ts, fromStr, toStr);
      return matchJourney && matchUser && matchDate;
    });
  }

  function renderFilterOptions(rows) {
    const journeyIds = uniqueValues(rows, journeyLabel);
    const users = uniqueValues(rows, userLabel);

    const prevJourney = journeyFilterEl.value;
    const prevUser = userFilterEl.value;

    journeyFilterEl.innerHTML = '<option value="">All journeys</option>';
    journeyIds.forEach((journeyId) => {
      const option = document.createElement('option');
      option.value = journeyId;
      const journeyRows = rows.filter((r) => journeyIdFromRow(r) === journeyId);
      option.textContent = getJourneyDisplayNameById(journeyId, journeyRows);
      journeyFilterEl.appendChild(option);
    });

    userFilterEl.innerHTML = '<option value="">All users</option>';
    users.forEach((user) => {
      const option = document.createElement('option');
      option.value = user;
      option.textContent = user;
      userFilterEl.appendChild(option);
    });

    if (journeyIds.includes(prevJourney)) journeyFilterEl.value = prevJourney;
    if (users.includes(prevUser)) userFilterEl.value = prevUser;
  }

  function renderSummary(rows) {
    const total = rows.length;
    const ratings = rows.map((row) => ratingValue(row)).filter((x) => x != null);
    const avgRating = ratings.length
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)
      : '—';
    const journeyCount = uniqueValues(rows, journeyLabel).length;
    const userCount = uniqueValues(rows, userLabel).length;
    summaryEl.innerHTML = `
      <div class="reviews-stat-card">
        <span class="reviews-stat-label">Total Reviews</span>
        <span class="reviews-stat-value">${total}</span>
      </div>
      <div class="reviews-stat-card">
        <span class="reviews-stat-label">Avg Rating</span>
        <span class="reviews-stat-value">${avgRating}</span>
      </div>
      <div class="reviews-stat-card">
        <span class="reviews-stat-label">Journeys</span>
        <span class="reviews-stat-value">${journeyCount}</span>
      </div>
      <div class="reviews-stat-card">
        <span class="reviews-stat-label">Users</span>
        <span class="reviews-stat-value">${userCount}</span>
      </div>
    `;
  }

  function renderReviews(rows) {
    currentRows = rows;
    if (!rows.length) {
      listEl.innerHTML = '<div class="reviews-empty">No reviews for current filters</div>';
      return;
    }
    const grouped = groupByJourney(rows);
    listEl.innerHTML = '';
    grouped.forEach((group) => {
      const row = group.rows[0];
      const card = document.createElement('div');
      card.className = 'review-card';
      const ratings = group.rows.map((r) => ratingValue(r)).filter((r) => r != null);
      const avgRating = ratings.length
        ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)
        : null;
      const rt = avgRating != null ? Number(avgRating) : ratingValue(row);
      const stars =
        rt != null
          ? `<span class="review-stars">${'★'.repeat(Math.min(5, Math.max(0, Math.round(rt))))}${'☆'.repeat(Math.max(0, 5 - Math.round(rt)))}</span><span class="review-rating-num">${rt}</span>`
          : '';
      const jid = group.journeyId;
      const completeStops = getCompleteJourneyStops(allRows, jid);
      const journeyTitle =
        group.displayName ?? getJourneyDisplayNameById(jid, completeStops);
      const usr = group.user;
      const first = completeStops[0];
      const last = completeStops[completeStops.length - 1];
      const when = first?.created_at && last?.created_at
        ? `${formatEasternDateTime(first.created_at)} – ${formatEasternDateTime(last.created_at)}`
        : first?.created_at
          ? formatEasternDateTime(first.created_at)
          : '';
      const stopsHtml = completeStops.map((r, idx) => renderStopMediaHtml(r, idx)).join('');
      card.innerHTML = `
        <div class="review-card-top">
          ${stars}
          <span class="review-meta review-journey-title">${esc(journeyTitle)}</span>
          <span class="review-user">User: ${esc(usr)}</span>
        </div>
        <div class="review-card-actions review-card-actions--top">
          <button type="button" class="review-download-btn">Download complete journey PDF</button>
        </div>
        <div class="review-card-meta-row">
          <span class="review-meta">Stops: ${completeStops.length} (complete journey)</span>
          ${when ? `<span class="review-when">${esc(when)}</span>` : ''}
        </div>
        <div class="review-stops">${stopsHtml}</div>
      `;
      const downloadBtn = card.querySelector('.review-download-btn');
      if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
          generateJourneyPDF({
            journeyId: String(jid),
            displayName: journeyTitle,
            rows: completeStops,
            user: usr,
          }).catch((err) => {
            console.error(err);
            listEl.innerHTML = `<div class="reviews-error">Could not export journey PDF: ${esc(err.message)}</div>`;
          });
        });
      }
      listEl.appendChild(card);
    });
  }

  function render() {
    const filteredRows = applyFilters(allRows);
    renderSummary(filteredRows);
    const visibleJourneyIds = new Set(
      filteredRows.map((r) => journeyIdFromRow(r)).filter(Boolean)
    );
    const rowsForCards = allRows.filter((r) => visibleJourneyIds.has(journeyIdFromRow(r)));
    renderReviews(rowsForCards);
  }

  async function exportAllJourneyPdfs() {
    const filteredRows = applyFilters(allRows);
    const visibleJourneyIds = Array.from(
      new Set(filteredRows.map((r) => journeyIdFromRow(r)).filter(Boolean))
    );
    if (!visibleJourneyIds.length) return;

    exportBtn.disabled = true;
    const prevLabel = exportBtn.textContent;
    exportBtn.textContent = 'Exporting…';
    try {
      for (let i = 0; i < visibleJourneyIds.length; i += 1) {
        const jid = visibleJourneyIds[i];
        const completeStops = getCompleteJourneyStops(allRows, jid);
        if (!completeStops.length) continue;
        const displayName = getJourneyDisplayNameById(jid, completeStops);
        exportBtn.textContent = `Exporting ${i + 1}/${visibleJourneyIds.length}…`;
        await generateJourneyPDF({
          journeyId: jid,
          displayName,
          rows: completeStops,
          user: userLabel(completeStops[0]),
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = prevLabel;
    }
  }

  async function load() {
    listEl.innerHTML = '<div class="reviews-loading">Loading…</div>';
    summaryEl.innerHTML = '';
    try {
      if (!isSupabaseConfigured()) {
        listEl.innerHTML =
          '<div class="reviews-error">Configure Supabase: add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to a <code>.env</code> file next to <code>package.json</code>, then restart <code>npm run dev</code>.</div>';
        return;
      }
      const raw = await fetchAllJourneyReviews();
      allRows = await hydrateJourneyRegistry(raw);
      preloadJsPDF();
      if (!allRows.length) {
        renderFilterOptions([]);
        renderSummary([]);
        listEl.innerHTML = '<div class="reviews-empty">No reviews yet</div>';
        return;
      }
      renderFilterOptions(allRows);
      render();
    } catch (err) {
      console.error(err);
      summaryEl.innerHTML = '';
      listEl.innerHTML = `<div class="reviews-error">Could not load reviews: ${esc(err.message)}</div>`;
    }
  }

  refreshBtn.addEventListener('click', () => load());
  exportBtn.addEventListener('click', () => exportAllJourneyPdfs().catch((err) => {
    console.error(err);
    listEl.innerHTML = `<div class="reviews-error">Could not export PDF: ${esc(err.message)}</div>`;
  }));
  journeyFilterEl.addEventListener('change', render);
  userFilterEl.addEventListener('change', render);
  dateFromEl.addEventListener('change', render);
  dateToEl.addEventListener('change', render);
  dateClearBtn.addEventListener('click', () => {
    dateFromEl.value = '';
    dateToEl.value = '';
    render();
  });

  return {
    show() {
      panel.classList.remove('hidden');
    },
    /** Initial load after auth (loads data once). */
    load,
    hide() {
      panel.classList.add('hidden');
    },
  };
}
