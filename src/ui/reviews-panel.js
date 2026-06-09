/**
 * Journey reviews — reads `pj_journey_reviews` (separate sidebar section).
 */
import {
  fetchImageBlobFromRow,
  fetchAllJourneyReviews,
  formatReviewDuration,
  getImageUrlForReview,
  getReviewVideoUrl,
  isSupabaseConfigured,
  reviewHasVideo,
} from '../services/supabase.js';
import {
  getCompleteJourneyStops,
  getJourneyDisplayNameById,
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

function sentimentLabel(row) {
  return row.sentiment ?? row.review_sentiment ?? 'N/A';
}

function distanceLabel(row) {
  const d = Number(row.distance_to_poi ?? row.distance ?? NaN);
  if (!Number.isFinite(d)) return 'N/A';
  return `${d.toFixed(2)}m`;
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

  async function loadJsPDF() {
    if (window.jspdf) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load jsPDF'));
      document.head.appendChild(s);
    });
  }

  async function imageBlobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Failed to read review image'));
      reader.readAsDataURL(blob);
    });
  }

  async function imageDataForReview(row) {
    const blob = await fetchImageBlobFromRow(row, 'pj_snapshots');
    return imageBlobToDataUrl(blob);
  }

  function reviewMediaKey(row, index = 0) {
    if (row?.id != null) return String(row.id);
    if (row?.review_id != null) return String(row.review_id);
    const j = row?.journey_id ?? row?.journeyId ?? '';
    const p = row?.poi_id ?? '';
    const t = row?.created_at ?? '';
    if (j || p || t) return `${j}|${p}|${t}`;
    return `idx-${index}`;
  }

  /**
   * Resolve poster JPEG (pj_snapshots) and screen-recording URL (snap_videos) per review.
   */
  function videoDurationLabel(row) {
    const duration = Number(row.duration_seconds ?? row.durationSeconds ?? 0);
    if (duration > 0) return `${duration.toFixed(1)}s`;
    return formatReviewDuration(duration);
  }

  async function preparePdfMediaMaps(rows) {
    const imageMap = new Map();
    const videoMetaMap = new Map();
    await Promise.all(
      rows.map(async (row, index) => {
        const key = reviewMediaKey(row, index);
        const videoUrl = getReviewVideoUrl(row);
        if (videoUrl) {
          videoMetaMap.set(key, {
            url: videoUrl,
            duration: videoDurationLabel(row),
          });
        }
        try {
          const dataUrl = await imageDataForReview(row);
          if (dataUrl) imageMap.set(key, dataUrl);
        } catch {
          /* poster / snapshot optional */
        }
      })
    );
    return { imageMap, videoMetaMap };
  }

  function drawPdfVideoPlayTile(doc, x, y, w, h, videoUrl, thumbDataUrl) {
    let drewThumb = false;
    if (thumbDataUrl) {
      try {
        const fmt = thumbDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        doc.addImage(thumbDataUrl, fmt, x, y, w, h);
        drewThumb = true;
      } catch {
        drewThumb = false;
      }
    }
    if (!drewThumb) {
      doc.setFillColor(15, 23, 42);
      doc.rect(x, y, w, h, 'F');
    }
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) * 0.1;
    doc.setFillColor(255, 255, 255);
    doc.circle(cx, cy, r, 'F');
    doc.setFillColor(30, 58, 138);
    doc.triangle(
      cx - r * 0.35,
      cy - r * 0.5,
      cx - r * 0.35,
      cy + r * 0.5,
      cx + r * 0.55,
      cy,
      'F'
    );
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('Tap to play', cx, y + h - 3.5, { align: 'center' });
    if (videoUrl && typeof doc.link === 'function') {
      doc.link(x, y, x + w, y + h, { url: videoUrl });
    }
  }

  /**
   * @returns {number} updated y position (mm)
   */
  function drawReviewMediaBlock(doc, {
    row,
    index,
    imageMap,
    videoMetaMap,
    x,
    y,
    imgW,
    imgH,
    pageBottom = 285,
  }) {
    const key = reviewMediaKey(row, index);
    const videoMeta = videoMetaMap.get(key);
    const imgData = imageMap.get(key);
    let cursorY = y;

    if (videoMeta) {
      if (cursorY + imgH + 14 > pageBottom) {
        doc.addPage();
        cursorY = 16;
      }
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text('Screen recording', x, cursorY);
      cursorY += 5;
      drawPdfVideoPlayTile(doc, x, cursorY, imgW, imgH, videoMeta.url, imgData ?? null);
      cursorY += imgH + 3;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      doc.text(`Duration: ${videoMeta.duration} — opens video in browser`, x, cursorY);
      cursorY += 5;
      if (imgData && !String(row?.image_path ?? '').includes('_poster')) {
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.text('Snapshot', x, cursorY);
        cursorY += 5;
        const snapH = Math.min(45, imgH * 0.55);
        if (cursorY + snapH + 4 > pageBottom) {
          doc.addPage();
          cursorY = 16;
        }
        const fmt = imgData.includes('data:image/png') ? 'PNG' : 'JPEG';
        doc.addImage(imgData, fmt, x, cursorY, imgW, snapH);
        cursorY += snapH + 4;
      }
      return cursorY;
    }

    if (imgData) {
      if (cursorY + imgH + 10 > pageBottom) {
        doc.addPage();
        cursorY = 16;
      }
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text('Snapshot', x, cursorY);
      cursorY += 5;
      const fmt = imgData.includes('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(imgData, fmt, x, cursorY, imgW, imgH);
      cursorY += imgH + 4;
      return cursorY;
    }

    doc.setFontSize(9);
    doc.setTextColor(220, 38, 38);
    doc.setFont('helvetica', 'normal');
    const label = reviewHasVideo(row) ? 'Screen recording unavailable' : 'Snapshot unavailable';
    doc.text(label, x, cursorY);
    return cursorY + 6;
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
    await loadJsPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const now = new Date();
    const reviewer = journeyGroup.user;
    const rows = getCompleteJourneyStops(allRows, journeyGroup.journeyId);
    const journeyTitle =
      journeyGroup.displayName ?? getJourneyDisplayNameById(journeyGroup.journeyId, rows);
    const { imageMap, videoMetaMap } = await preparePdfMediaMaps(rows);
    const ratings = rows.map((r) => ratingValue(r)).filter((r) => r != null);
    const avgRating = ratings.length
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)
      : 'N/A';
    const created = rows[0]?.created_at
      ? formatEasternDateTime(rows[0].created_at)
      : formatEasternDateTime(now);

    const pageW = 210;
    const margin = 14;
    const contentW = pageW - margin * 2;
    let y = 0;

    doc.setFillColor(30, 58, 138);
    doc.rect(0, 0, pageW, 34, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Spatial Navigation Report', margin, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text('POIs Journey - Visual Tour Summary', margin, 22);
    doc.setFontSize(9);
    doc.text(`Date: ${created}`, pageW - margin, 14, { align: 'right' });
    doc.text(`User: ${reviewer}`, pageW - margin, 20, { align: 'right' });
    doc.text(`Journey: ${journeyTitle}`, pageW - margin, 26, { align: 'right' });

    y = 42;
    doc.setTextColor(30, 58, 138);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`Stops Visited: ${rows.length}   |   Avg Rating: ${avgRating}`, margin, y);
    y += 8;
    doc.setDrawColor(220);
    doc.line(margin, y, pageW - margin, y);
    y += 8;

    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx];
      const rating = ratingValue(row);
      const sentiment = sentimentLabel(row);
      const distance = distanceLabel(row);
      const reviewBody = reviewText(row) || 'No review text';
      const when = row.created_at ? formatEasternDateTime(row.created_at) : 'Unknown date';
      const stopName = row.poi_name ?? row.pj_pois?.poi_name ?? row.poi_id ?? 'POI';

      if (y + 70 > 285) {
        doc.addPage();
        y = 16;
      }

      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text(`Stop ${idx + 1}: ${stopName}`, 14, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      doc.setFontSize(10);
      doc.text(`Distance: ${distance}   Sentiment: ${sentiment}   Rating: ${rating == null ? 'N/A' : `[${rating}/5]`}`, 14, y);
      y += 5;
      doc.text(`Date: ${when}`, 14, y);
      y += 6;
      const bodyLines = doc.splitTextToSize(reviewBody, 180);
      doc.text(bodyLines, 14, y);
      y += bodyLines.length * 5 + 4;

      y = drawReviewMediaBlock(doc, {
        row,
        index: idx,
        imageMap,
        videoMetaMap,
        x: margin,
        y,
        imgW: contentW,
        imgH: 85,
      });

      doc.setDrawColor(220);
      doc.line(14, y, 196, y);
      y += 6;
    }
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.setFont('helvetica', 'normal');
    doc.text('Generated by SpaceCheck XR Dashboard', 14, y);

    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `POIs_Journey_${sanitizeJourneyFilename(journeyTitle)}.pdf`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(blobUrl);
    }, 2000);
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
        <div class="review-meta">Stops: ${completeStops.length} (complete journey)</div>
        <div class="review-stops">${stopsHtml}</div>
        <div class="review-card-actions">
          <button type="button" class="review-download-btn">Download complete journey PDF</button>
        </div>
        ${when ? `<div class="review-when">${esc(when)}</div>` : ''}
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
