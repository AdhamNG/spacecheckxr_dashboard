/**
 * Journey display names app-wide: `username · date/time` in Eastern time.
 * Internal keys remain journey UUIDs; UI and PDFs use display names.
 */
import { buildJourneyDisplayLabel, journeyIdFromRow } from '../utils/journey-display.js';
import { fetchAllJourneyReviews, fetchJourneysByIds } from './supabase.js';

/** @type {Map<string, { displayName: string, journeyRow: Record<string, unknown> | null }>} */
let metaById = new Map();

export function clearJourneyRegistry() {
  metaById = new Map();
}

/**
 * @param {Record<string, unknown>[]} reviewRows
 * @returns {Promise<Record<string, unknown>[]>} rows enriched with journey_display_name
 */
export async function hydrateJourneyRegistry(reviewRows) {
  const rows = Array.isArray(reviewRows) ? reviewRows : await fetchAllJourneyReviews();
  const journeyIds = Array.from(new Set(rows.map(journeyIdFromRow).filter(Boolean)));
  const journeys = journeyIds.length ? await fetchJourneysByIds(journeyIds) : [];
  const journeyMap = new Map(journeys.map((j) => [String(j.id), j]));

  metaById = new Map();
  journeyIds.forEach((id) => {
    const reviewsForJ = rows.filter((r) => journeyIdFromRow(r) === id);
    const journeyRow = journeyMap.get(id) ?? null;
    metaById.set(id, {
      journeyRow,
      displayName: buildJourneyDisplayLabel(journeyRow, reviewsForJ),
    });
  });

  return rows.map((row) => {
    const key = journeyIdFromRow(row);
    const meta = metaById.get(key);
    const j = journeyMap.get(key);
    if (!meta && !j) return row;
    return {
      ...row,
      journey_user_name: j?.user_name ?? row.journey_user_name ?? null,
      journey_user_email: j?.user_email ?? row.journey_user_email ?? null,
      journey_display_name: meta?.displayName ?? row.journey_display_name ?? null,
    };
  });
}

/** @param {string} journeyId */
export function getJourneyDisplayNameById(journeyId, fallbackReviews = []) {
  const meta = metaById.get(String(journeyId));
  if (meta?.displayName) return meta.displayName;
  return buildJourneyDisplayLabel(meta?.journeyRow ?? null, fallbackReviews);
}

/** @param {Record<string, unknown>} row */
export function getJourneyDisplayNameFromRow(row, allReviews = []) {
  const fromRow = row?.journey_display_name;
  if (fromRow) return String(fromRow);
  const id = journeyIdFromRow(row);
  if (!id) return 'Unknown journey';
  const reviews = allReviews.length
    ? allReviews.filter((r) => journeyIdFromRow(r) === id)
    : [];
  return getJourneyDisplayNameById(id, reviews.length ? reviews : [row]);
}

export function sanitizeJourneyFilename(displayName) {
  const safe = String(displayName ?? 'journey')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return safe.slice(0, 100) || 'journey';
}

/**
 * All review rows for one journey (every POI stop), oldest → newest.
 * @param {Record<string, unknown>[]} allReviews
 * @param {string} journeyId
 */
export function getCompleteJourneyStops(allReviews, journeyId) {
  const id = String(journeyId);
  return allReviews
    .filter((r) => journeyIdFromRow(r) === id)
    .sort(
      (a, b) =>
        new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    );
}
