/**
 * Tenant / owner scope — matches rows where `owner` (or VITE_OWNER_COLUMN) = slug.
 * Default: owner from SPACE_CHECK_OWNER (unset VITE_OWNER_SLUG → use that default).
 * Set VITE_OWNER_SLUG= to disable.
 */
import { SPACE_CHECK_OWNER } from './spacecheck-access.js';

const COL = import.meta.env.VITE_OWNER_COLUMN ?? 'owner';

export const OWNER_COLUMN = String(COL || 'owner').trim() || 'owner';

const rawSlug = import.meta.env.VITE_OWNER_SLUG;

/** Default owner when env omits VITE_OWNER_SLUG; empty env string disables scoping. */
const initialOwnerSlug =
  rawSlug === undefined || rawSlug === null ? SPACE_CHECK_OWNER : String(rawSlug).trim();

let ownerSlug = initialOwnerSlug;

export function isOwnerScopeEnabled() {
  return Boolean(ownerSlug);
}

export function getOwnerSlug() {
  return ownerSlug;
}

/**
 * Set active owner scope at runtime.
 * Pass empty string to disable owner scoping.
 */
export function setOwnerSlug(slug) {
  ownerSlug = String(slug ?? '').trim();
}

/** PostgREST fragment: `owner=eq.<slug>` */
export function ownerFilterParam() {
  if (!isOwnerScopeEnabled()) return '';
  return `${OWNER_COLUMN}=eq.${encodeURIComponent(ownerSlug)}`;
}

/**
 * Append owner filter to a REST path like `pj_pois?select=*&order=…`
 */
export function applyOwnerToPath(path) {
  if (!isOwnerScopeEnabled()) return path;
  const param = ownerFilterParam();
  if (!param) return path;
  if (new RegExp(`[?&]${OWNER_COLUMN}=eq\\.`, 'i').test(path)) return path;
  if (!path.includes('?')) return `${path}?${param}`;
  return `${path}&${param}`;
}

/** Merge `owner=eq…` with an existing filters string (no leading ?). */
export function mergeOwnerFilter(existing = '') {
  const o = ownerFilterParam();
  if (!o) return existing;
  if (!existing) return o;
  return `${o}&${existing}`;
}
