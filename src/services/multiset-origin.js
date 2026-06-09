/**
 * MultiSet REST API base URL.
 * - Development: `/api/multiset` is proxied by Vite to `https://api.multiset.ai` (see vite.config.js).
 * - Production (static host): call the API origin directly; CORS must allow your site origin.
 */
const DEFAULT_ORIGIN = 'https://api.multiset.ai';

/**
 * @param {string} path API path starting with `/v1/...`
 * @returns {string} Full URL for fetch()
 */
export function multisetApiUrl(path) {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (import.meta.env.DEV) {
    return `/api/multiset${suffix}`;
  }
  const origin = String(import.meta.env.VITE_MULTISET_API_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');
  return `${origin}${suffix}`;
}
