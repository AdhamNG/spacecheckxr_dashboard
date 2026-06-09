/**
 * Project scope for `pj_media.poi_type` — uses active map code from session, else owner slug.
 */
import { loadDashboardSession } from '../services/dashboard-session.js';
import { getOwnerSlug } from './owner-scope.js';

export function getMediaPoiType() {
  const session = loadDashboardSession();
  const mapCode = String(session?.mapCode ?? '').trim();
  if (mapCode) return mapCode;
  return String(getOwnerSlug() ?? '').trim();
}
