/**
 * NavMe journey PDF — layout ported from Pois Journey `PoisJourneyUI._generatePDFReport`.
 */
import { pdfBrandedLinkLabel, SCXR_PDF } from '../config/pdf-brand.js';
import {
  formatDateInFeatureTimeZone,
  formatPdfCapturedAt,
  formatTimeInFeatureTimeZone,
} from '../utils/pdf-timezone.js';
import { fetchAllPois, resolveStoragePublicUrl, storagePublicUrl } from './supabase.js';

const MIN_RECORDING_SECONDS = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PDF_REVIEW_COL_GAP = 4;
const PDF_REVIEW_MEDIA_PAGE_H = 30;
const PDF_REVIEW_MEDIA_COMPACT_H = 32;
const PDF_REVIEW_MEDIA_STACKED_H = 22;
const PDF_MAX_STOPS_PER_PAGE = 2;

let jspdfPreloadStarted = false;

export async function loadJsPDF() {
  if (window.jspdf) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load jsPDF'));
    document.head.appendChild(s);
  });
}

export function preloadJsPDF() {
  if (jspdfPreloadStarted) return;
  jspdfPreloadStarted = true;
  void loadJsPDF().catch(() => {
    jspdfPreloadStarted = false;
  });
}

function isValidRecordingDuration(durationSeconds) {
  return durationSeconds >= MIN_RECORDING_SECONDS - 0.2;
}

function pdfDisplayText(text, fallback) {
  const cleaned = String(text ?? '')
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function wrapText(doc, text, maxWidth) {
  return doc.splitTextToSize(text, maxWidth);
}

async function imgToBase64(url, maxWidth = 960) {
  try {
    const resp = await fetch(url, { mode: 'cors' });
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image load failed'));
        el.src = objectUrl;
      });
      const naturalWidth = Math.max(1, img.naturalWidth || maxWidth);
      const naturalHeight = Math.max(1, img.naturalHeight || maxWidth);
      const scale = Math.min(1, maxWidth / naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return {
        dataUrl: canvas.toDataURL('image/jpeg', 0.82),
        naturalWidth,
        naturalHeight,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

function pdfMediaMaxWidth(contentW, landscape = false) {
  return contentW * (landscape ? 0.9 : 0.86);
}

function pdfFitMediaSize(naturalWidth, naturalHeight, maxW, maxH) {
  const nw = Math.max(1, naturalWidth);
  const nh = Math.max(1, naturalHeight);
  const scale = Math.min(maxW / nw, maxH / nh, 1);
  return { w: nw * scale, h: nh * scale };
}

function pdfCenteredX(margin, contentW, mediaW) {
  return margin + Math.max(0, (contentW - mediaW) / 2);
}

function addPdfLink(doc, x, y, w, h, url) {
  const trimmed = String(url || '').trim();
  if (!trimmed || typeof doc.link !== 'function') return;
  doc.link(x, y, Math.max(0.5, w), Math.max(0.5, h), { url: trimmed });
}

function estimatePdfDownloadBlockHeight(doc, contentW) {
  const hint = 'Click here to view the full-size image.';
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  const hintLines = doc.splitTextToSize(hint, contentW);
  return 4 + 9 + 6 + hintLines.length * 3.5 + 4;
}

function drawPdfDownloadButton(doc, ctx, label, url, contentX, contentW) {
  const btnH = 9;
  const padX = 10;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  const textW = doc.getTextWidth(label);
  const btnW = textW + padX * 2;
  const btnX = contentX + Math.max(0, (contentW - btnW) / 2);
  const btnTop = ctx.y + 2;

  doc.setFillColor(...SCXR_PDF.navy);
  doc.setDrawColor(...SCXR_PDF.navy);
  doc.setLineWidth(0.3);
  doc.roundedRect(btnX, btnTop, btnW, btnH, 2, 2, 'FD');
  doc.setTextColor(255, 255, 255);
  doc.text(label, btnX + btnW / 2, btnTop + btnH / 2, { align: 'center', baseline: 'middle' });
  addPdfLink(doc, btnX, btnTop, btnW, btnH, url);
  ctx.y = btnTop + btnH + 6;
}

function isPdfPublicRecordingUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('blob:') || lower.startsWith('file:')) return false;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost'
      || host === '127.0.0.1'
      || host === '[::1]'
      || host === '::1'
      || host.endsWith('.local')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function formatPdfDuration(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  const pad2 = (n) => (n < 10 ? `0${n}` : String(n));
  return `${pad2(mins)}:${pad2(secs)}`;
}

async function verifyPdfMediaUrl(url) {
  const trimmed = String(url || '').trim();
  if (!isPdfPublicRecordingUrl(trimmed)) return false;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const head = await fetch(trimmed, { method: 'HEAD', signal: controller.signal });
    if (head.ok) return true;
  } catch {
    /* HEAD often blocked on storage — try ranged GET */
  }
  try {
    const get = await fetch(trimmed, {
      method: 'GET',
      headers: { Range: 'bytes=0-1' },
      signal: controller.signal,
    });
    return get.ok || get.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function pdfEnsureSpace(doc, ctx, needed) {
  const limit = ctx.pageH - ctx.margin;
  if (ctx.y + needed > limit) {
    doc.addPage();
    ctx.y = ctx.margin;
  }
}

function pdfPlaceImage(doc, ctx, dataUrl, x, w, h) {
  pdfEnsureSpace(doc, ctx, h + 2);
  const pagesBefore = doc.internal.getNumberOfPages();
  doc.addImage(dataUrl, pdfImageFormat(dataUrl), x, ctx.y, w, h);
  const pagesAfter = doc.internal.getNumberOfPages();
  if (pagesAfter > pagesBefore) {
    ctx.y = ctx.margin + h;
  } else {
    ctx.y += h;
  }
}

function pdfImageFormat(dataUrl) {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
}

async function preparePdfMediaMaps(reviews) {
  const mediaMap = new Map();

  await Promise.all(reviews.map(async (review, i) => {
    const imgUrl = resolveStoragePublicUrl(
      'pj_snapshots',
      review.image_path,
      review.image_url,
    );
    const videoPath = String(review.video_path || '').trim();
    const videoUrl = (videoPath
      ? storagePublicUrl('snap_videos', videoPath)
      : resolveStoragePublicUrl('snap_videos', null, review.video_url)
    ).trim();
    const hasRecording = Boolean(videoUrl);
    const imagePathStr = String(review.image_path || '');
    const isPosterOnly = hasRecording && imagePathStr.includes('_poster');

    let imageAsset = null;
    if (imgUrl) {
      imageAsset = await imgToBase64(imgUrl);
      const altImgUrl = review.image_path
        ? storagePublicUrl('pj_snapshots', review.image_path)
        : '';
      if (!imageAsset && altImgUrl && imgUrl !== altImgUrl) {
        imageAsset = await imgToBase64(altImgUrl);
      }
    }

    const capturedAt = review.created_at
      ? formatPdfCapturedAt(review.created_at)
      : '';
    const poiLabel = review.pj_pois?.poi_name || 'Stop';

    let snapshotB64 = null;
    let snapshotUrl = null;
    let snapshotUrlReachable = false;
    let snapshotNaturalWidth = 4;
    let snapshotNaturalHeight = 3;
    let recording = null;

    if (hasRecording) {
      const durationSec = Number(review.duration_seconds || 0);
      const meetsMinimumDuration = durationSec <= 0 || isValidRecordingDuration(durationSec);
      if (meetsMinimumDuration) {
        const urlReachable = await verifyPdfMediaUrl(videoUrl);
        recording = {
          url: videoUrl,
          urlReachable,
          storagePath: videoPath,
          durationLabel: durationSec > 0 ? formatPdfDuration(durationSec) : '—',
          capturedAt,
          name: poiLabel,
          thumbB64: imageAsset?.dataUrl ?? null,
          thumbNaturalWidth: imageAsset?.naturalWidth ?? 16,
          thumbNaturalHeight: imageAsset?.naturalHeight ?? 9,
        };
      }
    }

    if (imageAsset && !isPosterOnly) {
      snapshotB64 = imageAsset.dataUrl;
      snapshotNaturalWidth = imageAsset.naturalWidth;
      snapshotNaturalHeight = imageAsset.naturalHeight;
      snapshotUrl = imgUrl || null;
      if (snapshotUrl) {
        snapshotUrlReachable = await verifyPdfMediaUrl(snapshotUrl);
      }
    }

    mediaMap.set(i, {
      capturedAt,
      snapshotB64,
      snapshotUrl,
      snapshotUrlReachable,
      snapshotNaturalWidth,
      snapshotNaturalHeight,
      recording,
    });
  }));

  return mediaMap;
}

function drawPdfRecordingThumbnail(doc, x, y, w, h, thumbDataUrl) {
  let drewThumb = false;
  if (thumbDataUrl) {
    try {
      doc.addImage(thumbDataUrl, pdfImageFormat(thumbDataUrl), x, y, w, h);
      drewThumb = true;
    } catch {
      drewThumb = false;
    }
  }
  if (!drewThumb) {
    doc.setFillColor(241, 245, 249);
    doc.rect(x, y, w, h, 'F');
  }

  const cx = x + w / 2;
  const cy = y + h / 2 - 1;
  const radius = Math.min(w, h) * 0.14;

  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy, radius, 'F');
  doc.setDrawColor(...SCXR_PDF.white);
  doc.setLineWidth(0.3);
  doc.circle(cx, cy, radius, 'S');

  const tri = radius * 0.5;
  doc.setFillColor(...SCXR_PDF.navy);
  doc.triangle(
    cx - tri * 0.4,
    cy - tri * 0.72,
    cx - tri * 0.4,
    cy + tri * 0.72,
    cx + tri * 0.76,
    cy,
    'F',
  );
}

function pdfReviewColumnWidth(contentW) {
  return { colW: (contentW - PDF_REVIEW_COL_GAP) / 2, gap: PDF_REVIEW_COL_GAP };
}

function pdfPlaceImageAt(doc, dataUrl, x, y, w, h) {
  doc.addImage(dataUrl, pdfImageFormat(dataUrl), x, y, w, h);
}

function drawPdfDownloadButtonAtY(doc, label, url, contentX, contentW, y) {
  const fakeCtx = { y: y - 2 };
  drawPdfDownloadButton(doc, fakeCtx, label, url, contentX, contentW);
  return fakeCtx.y;
}

function estimatePdfStackedReviewBlockHeight(commentLineCount, hasSnapshot, hasRecording, mediaMaxH, hasCapturedAt = false) {
  const mediaH = (hasSnapshot || hasRecording)
    ? 10 + mediaMaxH + 16
    : 0;
  const headerExtra = hasCapturedAt ? 5 : 0;
  return 13 + headerExtra + mediaH + 18 + commentLineCount * 4.5 + 8;
}

function pdfStackedMediaMaxH() {
  return PDF_REVIEW_MEDIA_STACKED_H;
}

function pdfMaxStackedReviewsPerPage() {
  return PDF_MAX_STOPS_PER_PAGE;
}

function drawPdfStopsSectionTitle(doc, pageW, startY) {
  doc.setTextColor(...SCXR_PDF.navy);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Detailed Stops & Snapshots', pageW / 2, startY + 4, { align: 'center' });
  doc.setDrawColor(...SCXR_PDF.navy);
  doc.setLineWidth(0.35);
  const lineW = 72;
  doc.line(pageW / 2 - lineW / 2, startY + 7, pageW / 2 + lineW / 2, startY + 7);
  return startY + 13;
}

function estimatePdfReviewBlockHeight(commentLineCount, hasSnapshot, hasRecording, mediaMaxH = PDF_REVIEW_MEDIA_PAGE_H, hasCapturedAt = false) {
  const mediaH = (hasSnapshot || hasRecording)
    ? 10 + mediaMaxH + 16
    : 0;
  const headerExtra = hasCapturedAt ? 5 : 0;
  return 15 + headerExtra + mediaH + 18 + commentLineCount * 4.5 + 8;
}

function pdfCenteredInnerBox(margin, contentW, widthRatio = 0.9) {
  const w = contentW * widthRatio;
  const x = margin + (contentW - w) / 2;
  return { x, w, centerX: margin + contentW / 2 };
}

function drawPdfSnapshotColumn(doc, colX, colW, startY, maxH, snapshot) {
  const downloadLabel = pdfBrandedLinkLabel('snapshot');
  const canLink = Boolean(
    snapshot.url && (snapshot.reachable || isPdfPublicRecordingUrl(snapshot.url)),
  );
  const maxW = colW - 8;
  const size = pdfFitMediaSize(snapshot.naturalWidth, snapshot.naturalHeight, maxW, maxH);
  let y = startY;

  doc.setTextColor(...SCXR_PDF.navy);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Snapshot', colX + colW / 2, y + 4, { align: 'center' });
  y += 8;

  const imgX = colX + Math.max(0, (colW - size.w) / 2);
  try {
    pdfPlaceImageAt(doc, snapshot.b64, imgX, y, size.w, size.h);
    y += size.h + 3;
  } catch {
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('Preview unavailable', colX + colW / 2, y + 5, { align: 'center' });
    y += 10;
  }

  if (canLink && snapshot.url) {
    y = drawPdfDownloadButtonAtY(doc, downloadLabel, snapshot.url, colX, colW, y);
  } else {
    y += 4;
  }
  return y;
}

function drawPdfRecordingColumn(doc, colX, colW, startY, maxH, recording) {
  const downloadLabel = pdfBrandedLinkLabel('recording');
  const shareUrl = String(recording.url || '').trim();
  const canLink = recording.urlReachable && isPdfPublicRecordingUrl(shareUrl);
  const maxW = colW - 8;
  const thumbSize = pdfFitMediaSize(
    recording.thumbNaturalWidth,
    recording.thumbNaturalHeight,
    maxW,
    maxH,
  );
  let y = startY;

  doc.setTextColor(...SCXR_PDF.navy);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Recording', colX + colW / 2, y + 4, { align: 'center' });
  y += 8;

  const thumbX = colX + Math.max(0, (colW - thumbSize.w) / 2);
  drawPdfRecordingThumbnail(doc, thumbX, y, thumbSize.w, thumbSize.h, recording.thumbB64);
  y += thumbSize.h + 3;

  if (canLink) {
    y = drawPdfDownloadButtonAtY(doc, downloadLabel, shareUrl, colX, colW, y);
  } else {
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'italic');
    doc.text('In-app only', colX + colW / 2, y + 3, { align: 'center' });
    y += 8;
  }

  return y;
}

function drawPdfReviewMediaPair(
  doc,
  margin,
  contentW,
  startY,
  snapshot,
  recording,
  mediaMaxH = PDF_REVIEW_MEDIA_PAGE_H,
) {
  const maxH = mediaMaxH;
  if (snapshot && recording) {
    const { colW, gap } = pdfReviewColumnWidth(contentW);
    const leftBottom = drawPdfSnapshotColumn(
      doc, margin, colW, startY, maxH, snapshot,
    );
    const rightBottom = drawPdfRecordingColumn(
      doc, margin + colW + gap, colW, startY, maxH, recording,
    );
    return Math.max(leftBottom, rightBottom);
  }
  if (snapshot) {
    return drawPdfSnapshotColumn(doc, margin, contentW, startY, maxH + 6, snapshot);
  }
  if (recording) {
    return drawPdfRecordingColumn(doc, margin, contentW, startY, maxH + 6, recording);
  }
  return startY;
}

function looksLikeUuid(value) {
  return UUID_RE.test(String(value ?? '').trim());
}

/** @param {Record<string, unknown>} row @param {Map<string, string>} [poiNameById] */
export function resolvePoiNameForReview(row, poiNameById = new Map()) {
  const candidates = [
    row.poi_name,
    row.pj_pois?.poi_name,
    row.poi_title,
    row.poi_label,
    row.title,
    row.name,
  ];
  for (const candidate of candidates) {
    const label = String(candidate ?? '').trim();
    if (label && !looksLikeUuid(label)) return label;
  }
  const poiId = String(row.poi_id ?? '').trim();
  if (poiId && poiNameById.has(poiId)) return poiNameById.get(poiId);
  return 'Unknown Location';
}

/** @param {Map<string, string>} poiNameById */
async function buildPoiNameLookup(poiNameById = new Map()) {
  try {
    const pois = await fetchAllPois();
    pois.forEach((poi) => {
      const id = String(poi.id ?? '').trim();
      const name = String(poi.poi_name ?? poi.title ?? poi.name ?? '').trim();
      if (id && name) poiNameById.set(id, name);
    });
  } catch {
    /* POI lookup is best-effort */
  }
  return poiNameById;
}

function drawPdfStopHeader(doc, boxX, boxW, startY, index, poiName, distanceM, capturedAt, hideDistance = false) {
  const centerX = boxX + boxW / 2;
  const titleLines = doc.splitTextToSize(String(poiName || 'Unknown Location'), boxW - 10);
  const titleLineCount = Math.max(1, titleLines.length);
  const metaParts = [`Stop ${index + 1}`];
  if (!hideDistance) metaParts.push(`Distance: ${Number(distanceM || 0).toFixed(2)}m`);
  if (capturedAt) metaParts.push(`Captured: ${capturedAt}`);
  const metaLine = metaParts.join(' · ');
  const headerH = 6 + titleLineCount * 4.5 + 5;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.25);
  doc.roundedRect(boxX, startY, boxW, headerH, 2, 2, 'FD');

  doc.setTextColor(...SCXR_PDF.navy);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(titleLines, centerX, startY + 5, { align: 'center' });

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.text(metaLine, centerX, startY + 5 + titleLineCount * 4.5 + 1, {
    align: 'center',
    maxWidth: boxW - 8,
  });

  return startY + headerH;
}

function drawPdfStackedReviewBlock(
  doc,
  margin,
  contentW,
  pdfCtx,
  index,
  poiName,
  distanceM,
  sentiment,
  rating,
  commentLines,
  media,
  mediaMaxH,
) {
  const hasSnapshot = Boolean(media?.snapshotB64);
  const hasRecording = Boolean(media?.recording);
  const capturedAt = media?.capturedAt || media?.recording?.capturedAt || '';
  const centerX = margin + contentW / 2;

  pdfCtx.y = drawPdfStopHeader(
    doc,
    margin,
    contentW,
    pdfCtx.y,
    index,
    poiName,
    distanceM,
    capturedAt,
  ) + 4;

  if (hasSnapshot || hasRecording) {
    const mediaBottom = drawPdfReviewMediaPair(
      doc,
      margin,
      contentW,
      pdfCtx.y,
      hasSnapshot && media?.snapshotB64
        ? {
            b64: media.snapshotB64,
            url: media.snapshotUrl,
            reachable: media.snapshotUrlReachable,
            naturalWidth: media.snapshotNaturalWidth,
            naturalHeight: media.snapshotNaturalHeight,
          }
        : null,
      hasRecording && media?.recording ? media.recording : null,
      mediaMaxH,
    );
    pdfCtx.y = mediaBottom + 4;
  }

  const sentLabel = sentiment === 'positive' ? 'Positive' : 'Needs Improvement';
  const ratingStr = `[${rating}/5]`;
  doc.setFontSize(9);
  if (sentiment === 'positive') {
    doc.setTextColor(22, 101, 52);
  } else {
    doc.setTextColor(153, 27, 27);
  }
  doc.setFont('helvetica', 'bold');
  doc.text(sentLabel, centerX, pdfCtx.y + 5, { align: 'center' });
  doc.setTextColor(245, 158, 11);
  doc.setFontSize(11);
  doc.text(`Rating: ${ratingStr}`, centerX, pdfCtx.y + 12, { align: 'center' });

  doc.setTextColor(51, 65, 85);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(commentLines, centerX, pdfCtx.y + 20, { align: 'center', maxWidth: contentW - 8 });
  pdfCtx.y += 20 + commentLines.length * 4.5 + 6;
}

function drawPdfCenteredReviewPage(
  doc,
  pageW,
  pageH,
  margin,
  contentW,
  pdfCtx,
  params,
) {
  const pageBottom = pageH - margin;
  let contentTop = params.pageStartY ?? margin;

  if (params.showSectionTitle) {
    const sectionLabel = params.sectionTitle ?? 'Detailed Stops & Snapshots';
    doc.setTextColor(...SCXR_PDF.navy);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(sectionLabel, pageW / 2, contentTop + 4, { align: 'center' });
    contentTop += 7;
    doc.setDrawColor(...SCXR_PDF.navy);
    doc.setLineWidth(0.35);
    const lineW = 72;
    doc.line(pageW / 2 - lineW / 2, contentTop, pageW / 2 + lineW / 2, contentTop);
    contentTop += 6;
  }

  const hasSnapshot = Boolean(params.media?.snapshotB64);
  const hasRecording = Boolean(params.media?.recording);
  const capturedAt = params.capturedAt
    || params.media?.capturedAt
    || params.media?.recording?.capturedAt
    || '';
  const availableH = pageBottom - contentTop;
  const mediaMaxH = Math.min(
    PDF_REVIEW_MEDIA_PAGE_H,
    Math.max(28, availableH * 0.32),
  );
  pdfCtx.y = contentTop + 2;

  const inner = pdfCenteredInnerBox(margin, contentW, 0.9);
  const { x: innerX, w: innerW, centerX } = inner;

  pdfCtx.y = drawPdfStopHeader(
    doc,
    innerX,
    innerW,
    pdfCtx.y,
    params.index,
    params.poiName,
    params.distanceM,
    capturedAt,
    params.hideDistance,
  ) + 4;

  if (hasSnapshot || hasRecording) {
    const mediaBottom = drawPdfReviewMediaPair(
      doc,
      innerX,
      innerW,
      pdfCtx.y,
      hasSnapshot && params.media?.snapshotB64
        ? {
            b64: params.media.snapshotB64,
            url: params.media.snapshotUrl,
            reachable: params.media.snapshotUrlReachable,
            naturalWidth: params.media.snapshotNaturalWidth,
            naturalHeight: params.media.snapshotNaturalHeight,
          }
        : null,
      hasRecording && params.media?.recording ? params.media.recording : null,
      mediaMaxH,
    );
    pdfCtx.y = mediaBottom + 4;
  }

  const sentLabel = params.sentiment === 'positive' ? 'Positive' : 'Needs Improvement';
  const ratingStr = `[${params.rating}/5]`;
  if (!params.hideSentiment) {
    doc.setFontSize(9);
    if (params.sentiment === 'positive') {
      doc.setTextColor(22, 101, 52);
    } else {
      doc.setTextColor(153, 27, 27);
    }
    doc.setFont('helvetica', 'bold');
    doc.text(sentLabel, centerX, pdfCtx.y + 4, { align: 'center' });
    doc.setTextColor(245, 158, 11);
    doc.setFontSize(11);
    doc.text(`Rating: ${ratingStr}`, centerX, pdfCtx.y + 10, { align: 'center' });
    pdfCtx.y += 16;
  } else {
    doc.setTextColor(245, 158, 11);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Rating: ${ratingStr}`, centerX, pdfCtx.y + 4, { align: 'center' });
    pdfCtx.y += 10;
  }

  doc.setTextColor(51, 65, 85);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(params.commentLines, centerX, pdfCtx.y, { align: 'center', maxWidth: innerW });
  pdfCtx.y += params.commentLines.length * 4.5 + 6;
}

/** @param {Record<string, unknown>} row @param {Map<string, string>} [poiNameById] */
export function normalizeReviewForPdf(row, poiNameById = new Map()) {
  const poiName = resolvePoiNameForReview(row, poiNameById);
  return {
    ...row,
    review_text: row.review_text ?? row.comment ?? row.body ?? row.text ?? '',
    pj_pois: {
      poi_name: poiName,
    },
  };
}

function reviewPosition(row) {
  const x = Number(row.pos_x ?? row.user_pos_x ?? row.x);
  const y = Number(row.pos_y ?? row.user_pos_y ?? row.y);
  const z = Number(row.pos_z ?? row.user_pos_z ?? row.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function distance3dMeters(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function sortReviewsChronologically(reviews) {
  return [...reviews].sort(
    (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
  );
}

/** Total meters walked between consecutive stop capture positions. */
export function computeWalkedDistanceMeters(reviews) {
  const sorted = sortReviewsChronologically(reviews);
  let total = 0;
  let prev = null;
  for (const row of sorted) {
    const pos = reviewPosition(row);
    if (!pos) continue;
    if (prev) total += distance3dMeters(prev, pos);
    prev = pos;
  }
  return total;
}

function journeyRowDistanceMeters(journeyRow) {
  const candidates = [
    journeyRow?.total_distance,
    journeyRow?.distance_walked,
    journeyRow?.total_distance_m,
    journeyRow?.distance_traveled,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/**
 * @param {Record<string, unknown> | null} journeyRow
 * @param {Record<string, unknown>[]} reviews
 */
export function computeJourneyPdfDetail(journeyRow, reviews) {
  const sorted = sortReviewsChronologically(reviews);
  const totalPois = Number(journeyRow?.total_pois ?? sorted.length) || sorted.length;
  let elapsedSeconds = 0;
  const started = journeyRow?.started_at ? new Date(String(journeyRow.started_at)) : null;
  const completed = journeyRow?.completed_at ? new Date(String(journeyRow.completed_at)) : null;
  if (started && completed && Number.isFinite(started.getTime()) && Number.isFinite(completed.getTime())) {
    elapsedSeconds = Math.max(0, Math.round((completed.getTime() - started.getTime()) / 1000));
  } else if (sorted.length >= 2) {
    const first = new Date(String(sorted[0].created_at)).getTime();
    const last = new Date(String(sorted[sorted.length - 1].created_at)).getTime();
    if (Number.isFinite(first) && Number.isFinite(last)) {
      elapsedSeconds = Math.max(0, Math.round((last - first) / 1000));
    }
  }

  const fromJourneyRow = journeyRowDistanceMeters(journeyRow);
  const totalDistance = fromJourneyRow != null
    ? fromJourneyRow
    : computeWalkedDistanceMeters(sorted);

  return {
    totalPois,
    elapsedSeconds,
    totalDistance,
  };
}

/**
 * Build and download a NavMe journey PDF (Pois Journey layout).
 *
 * @param {{
 *   detail: { totalPois: number; elapsedSeconds: number; totalDistance: number };
 *   reviews: Record<string, unknown>[];
 *   userEmail?: string;
 *   extraIssues?: Array<Record<string, unknown>>;
 *   fileName?: string;
 *   onProgress?: (label: string) => void;
 * }} params
 */
export async function generateJourneyPdfReport(params) {
  const {
    detail,
    reviews: rawReviews,
    userEmail = 'Guest',
    extraIssues = [],
    fileName = 'NavMe_Report.pdf',
    onProgress,
  } = params;

  onProgress?.('Loading POI names…');
  const poiNameById = await buildPoiNameLookup();
  const reviews = rawReviews.map((row) => normalizeReviewForPdf(row, poiNameById));

  onProgress?.('Preparing report…');
  await loadJsPDF();
  const { jsPDF } = window.jspdf;

  onProgress?.('Loading media…');
  const mediaMap = await preparePdfMediaMaps(reviews);

  onProgress?.('Building PDF…');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = 210;
  const pageH = 297;
  const margin = 15;
  const contentW = pageW - margin * 2;
  const pdfCtx = { y: margin, pageH, margin };

  const checkPage = (needed) => {
    pdfEnsureSpace(doc, pdfCtx, needed);
  };

  doc.setFillColor(...SCXR_PDF.navy);
  doc.rect(0, 0, pageW, 46, 'F');
  doc.setFillColor(...SCXR_PDF.white);
  doc.rect(0, 42, pageW, 1.2, 'F');
  doc.setTextColor(...SCXR_PDF.white);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('NavMe Report', margin, 16);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Check your space from anywhere.', margin, 24);

  const reportDate = new Date();
  const dateStr = formatDateInFeatureTimeZone(reportDate);
  const timeStr = `${formatTimeInFeatureTimeZone(reportDate)} EST`;
  const metaRight = pageW - margin;
  const metaTop = 13;
  const metaLineGap = 4.5;
  doc.setTextColor(...SCXR_PDF.headerSubtext);
  doc.setFont('courier', 'normal');
  doc.setFontSize(7);
  doc.text(`Date: ${dateStr}`, metaRight, metaTop, { align: 'right' });
  doc.text(`Time: ${timeStr}`, metaRight, metaTop + metaLineGap, { align: 'right' });
  doc.text(`Username: ${userEmail}`, metaRight, metaTop + metaLineGap * 2, { align: 'right' });

  pdfCtx.y = 50;

  const mins = Math.floor(detail.elapsedSeconds / 60);
  const secs = detail.elapsedSeconds % 60;
  const distM = detail.totalDistance.toFixed(1);
  const statW = contentW / 3 - 3;
  const stats = [
    { val: String(detail.totalPois), lbl: 'Stops Visited' },
    { val: `${mins}m ${secs}s`, lbl: 'Time Elapsed' },
    { val: `${distM}m`, lbl: 'Distance Walked' },
  ];

  stats.forEach((s, i) => {
    const sx = margin + i * (statW + 4.5);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...SCXR_PDF.navy);
    doc.setLineWidth(0.4);
    doc.roundedRect(sx, pdfCtx.y, statW, 20, 3, 3, 'FD');
    doc.setTextColor(...SCXR_PDF.navy);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(s.val, sx + statW / 2, pdfCtx.y + 9, { align: 'center' });
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(s.lbl.toUpperCase(), sx + statW / 2, pdfCtx.y + 16, { align: 'center' });
  });

  pdfCtx.y += 24;

  if (reviews.length > 0) {
    const firstReview = reviews[0];
    const lastReview = reviews[reviews.length - 1];
    if (firstReview?.created_at) {
      const startCap = formatPdfCapturedAt(firstReview.created_at);
      const endCap = lastReview?.created_at && lastReview !== firstReview
        ? formatPdfCapturedAt(lastReview.created_at)
        : '';
      const journeyWhen = endCap ? `${startCap} – ${endCap}` : startCap;
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(`Journey captured: ${journeyWhen}`, pageW / 2, pdfCtx.y + 1, { align: 'center' });
      pdfCtx.y += 6;
    }
  }

  if (reviews.length > 0) {
    pdfCtx.y += 2;
    let stopsOnPage = 0;
    let sectionTitlePlaced = false;
    const pageLimit = pageH - margin;
    const mediaMaxH = pdfStackedMediaMaxH();

    for (let i = 0; i < reviews.length; i += 1) {
      const r = reviews[i];
      const poiName = r.pj_pois?.poi_name || 'Unknown Location';
      const media = mediaMap.get(i);
      const commentText = pdfDisplayText(r.review_text, 'No comment provided.');
      const commentLines = wrapText(doc, commentText, contentW - 8);
      const hasSnapshot = Boolean(media?.snapshotB64);
      const hasRecording = Boolean(media?.recording);
      const hasCapturedAt = Boolean(media?.capturedAt || media?.recording?.capturedAt);
      const sectionReserve = sectionTitlePlaced ? 0 : 13;
      const dividerReserve = i < reviews.length - 1 ? 6 : 0;
      const blockH = estimatePdfStackedReviewBlockHeight(
        commentLines.length,
        hasSnapshot,
        hasRecording,
        mediaMaxH,
        hasCapturedAt,
      ) + dividerReserve;

      const needsNewPage =
        stopsOnPage >= PDF_MAX_STOPS_PER_PAGE
        || pdfCtx.y + sectionReserve + blockH > pageLimit;

      if (needsNewPage) {
        if (stopsOnPage > 0) {
          doc.addPage();
          pdfCtx.y = margin;
          stopsOnPage = 0;
        } else if (pdfCtx.y + sectionReserve + blockH > pageLimit) {
          doc.addPage();
          pdfCtx.y = margin;
        }
      }

      if (!sectionTitlePlaced) {
        pdfCtx.y = drawPdfStopsSectionTitle(doc, pageW, pdfCtx.y);
        sectionTitlePlaced = true;
      }

      drawPdfStackedReviewBlock(
        doc,
        margin,
        contentW,
        pdfCtx,
        i,
        poiName,
        Number(r.distance_to_poi ?? 0),
        String(r.sentiment ?? 'positive'),
        Number(r.rating ?? 5),
        commentLines,
        media,
        mediaMaxH,
      );
      stopsOnPage += 1;

      if (i < reviews.length - 1) {
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.2);
        doc.line(margin + 10, pdfCtx.y, margin + contentW - 10, pdfCtx.y);
        pdfCtx.y += 6;
      }
    }
  }

  if (reviews.length === 0) {
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(11);
    doc.text('No reviews recorded for this journey.', pageW / 2, pdfCtx.y + 10, { align: 'center' });
    pdfCtx.y += 20;
  }

  if (extraIssues.length > 0) {
    doc.addPage();
    pdfCtx.y = margin;
    doc.setTextColor(...SCXR_PDF.navy);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Added community issues', margin, pdfCtx.y);
    pdfCtx.y += 3;
    doc.setDrawColor(...SCXR_PDF.navy);
    doc.setLineWidth(0.35);
    doc.line(margin, pdfCtx.y, margin + 72, pdfCtx.y);
    pdfCtx.y += 8;

    let extrasOnPage = 0;
    const pageLimitEx = pageH - margin;
    const mediaMaxHEx = pdfStackedMediaMaxH();

    for (let ei = 0; ei < extraIssues.length; ei += 1) {
      const ex = extraIssues[ei];
      const issueTitle = pdfDisplayText(ex.title, 'Submitted issue');
      const linesEx = wrapText(
        doc,
        pdfDisplayText(ex.review_text, 'No comment.'),
        contentW - 8,
      );

      const videoPathEx = String(ex.video_path || '').trim();
      const videoUrlEx = (videoPathEx
        ? storagePublicUrl('snap_videos', videoPathEx)
        : resolveStoragePublicUrl('snap_videos', null, ex.video_url)
      ).trim();
      const hasVideoEx = Boolean(videoUrlEx);
      const imagePathEx = String(ex.image_path || '');
      const isPosterOnlyEx = hasVideoEx && imagePathEx.includes('_poster');

      let imageAssetEx = null;
      if (ex.image_url) {
        imageAssetEx = await imgToBase64(String(ex.image_url));
      }

      const issueCapturedAt = ex.created_at
        ? formatPdfCapturedAt(ex.created_at)
        : '';
      const durationEx = Number(ex.duration_seconds || 0);
      const recordingEx = hasVideoEx && (durationEx <= 0 || isValidRecordingDuration(durationEx))
        ? {
            url: videoUrlEx,
            urlReachable: await verifyPdfMediaUrl(videoUrlEx),
            storagePath: videoPathEx,
            durationLabel: durationEx > 0
              ? formatPdfDuration(durationEx)
              : '—',
            capturedAt: issueCapturedAt,
            name: issueTitle,
            thumbB64: imageAssetEx?.dataUrl ?? null,
            thumbNaturalWidth: imageAssetEx?.naturalWidth ?? 16,
            thumbNaturalHeight: imageAssetEx?.naturalHeight ?? 9,
          }
        : null;

      const hasSnapshotEx = Boolean(imageAssetEx && !isPosterOnlyEx);
      const snapshotUrlEx = String(ex.image_url || '').trim();
      const snapshotReachable = snapshotUrlEx
        ? await verifyPdfMediaUrl(snapshotUrlEx)
        : false;
      const blockHEx = estimatePdfStackedReviewBlockHeight(
        linesEx.length,
        hasSnapshotEx,
        Boolean(recordingEx),
        mediaMaxHEx,
        Boolean(issueCapturedAt),
      ) - 2;

      const maxOnPageEx = pdfMaxStackedReviewsPerPage();
      const needsNewPageEx =
        extrasOnPage >= maxOnPageEx
        || pdfCtx.y + blockHEx > pageLimitEx;

      if (needsNewPageEx) {
        if (extrasOnPage > 0) {
          doc.addPage();
          pdfCtx.y = margin;
          extrasOnPage = 0;
        } else if (pdfCtx.y + blockHEx > pageLimitEx) {
          doc.addPage();
          pdfCtx.y = margin;
        }
      }

      const drawMediaMaxHEx = mediaMaxHEx;

      const issueHeaderH = issueCapturedAt ? 14 : 8;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.25);
      doc.roundedRect(margin, pdfCtx.y, contentW, issueHeaderH, 2, 2, 'FD');
      doc.setTextColor(...SCXR_PDF.navy);
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      doc.text(`Issue Report — ${issueTitle}`, margin + contentW / 2, pdfCtx.y + 5, { align: 'center', maxWidth: contentW - 8 });
      if (issueCapturedAt) {
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.text(`Captured: ${issueCapturedAt}`, margin + contentW / 2, pdfCtx.y + 10.5, { align: 'center' });
      }
      pdfCtx.y += issueHeaderH + 3;

      if (hasSnapshotEx || recordingEx) {
        const mediaBottomEx = drawPdfReviewMediaPair(
          doc,
          margin,
          contentW,
          pdfCtx.y,
          hasSnapshotEx && imageAssetEx
            ? {
                b64: imageAssetEx.dataUrl,
                url: snapshotUrlEx || null,
                reachable: snapshotReachable,
                naturalWidth: imageAssetEx.naturalWidth,
                naturalHeight: imageAssetEx.naturalHeight,
              }
            : null,
          recordingEx,
          drawMediaMaxHEx,
        );
        pdfCtx.y = mediaBottomEx + 4;
      }

      const issueCenterX = margin + contentW / 2;
      doc.setTextColor(245, 158, 11);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`Rating: [${ex.rating}/5]`, issueCenterX, pdfCtx.y + 5, { align: 'center' });

      doc.setTextColor(51, 65, 85);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(linesEx, issueCenterX, pdfCtx.y + 12, { align: 'center', maxWidth: contentW - 8 });
      pdfCtx.y += 12 + linesEx.length * 4.5 + 8;
      extrasOnPage += 1;

      if (ei < extraIssues.length - 1) {
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.2);
        doc.line(margin + 10, pdfCtx.y, margin + contentW - 10, pdfCtx.y);
        pdfCtx.y += 6;
      }
    }
  }

  checkPage(20);
  pdfCtx.y += 8;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, pdfCtx.y, margin + contentW, pdfCtx.y);
  pdfCtx.y += 6;
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.text('Generated automatically by NavMe', pageW / 2, pdfCtx.y, { align: 'center' });

  const pdfBlob = doc.output('blob');
  const blobUrl = URL.createObjectURL(pdfBlob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(blobUrl);
  }, 2000);

  onProgress?.('Downloaded ✓');
  return pdfBlob;
}
