/** PDF date/time formatting — aligned with Pois Journey `timezone` helpers (Eastern). */

const FEATURE_TIMEZONE = 'America/New_York';

/** @param {Date} date */
export function formatDateInFeatureTimeZone(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: FEATURE_TIMEZONE,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

export function formatTimeInFeatureTimeZone(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: FEATURE_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d);
}

/** @param {string | number | Date} value */
export function formatPdfCapturedAt(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: FEATURE_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

export function getFeatureTimeZoneLabel() {
  return 'Eastern Time (US)';
}
