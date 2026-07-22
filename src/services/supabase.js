/**
 * Supabase REST client — SpaceCheck XR (`pj_*` tables).
 *
 * Set in `.env` (Vite):
 *   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
 *   VITE_SUPABASE_ANON_KEY=<anon_jwt>
 *
 * Expected table names: pj_users, pj_navnodes, pj_pois, pj_journeys, pj_journey_reviews, pj_media
 * Adjust column names in normalize* helpers if your SQL schema differs slightly.
 */

import { parseJsonResponse } from '../utils/parse-json-response.js';
import {
  applyOwnerToPath,
  getOwnerSlug,
  mergeOwnerFilter,
  isOwnerScopeEnabled,
  OWNER_COLUMN,
} from '../config/owner-scope.js';
import { getMediaPoiType } from '../config/media-scope.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export function getSupabaseUrl() {
  return SUPABASE_URL;
}

export function getSupabaseAnonKey() {
  return SUPABASE_ANON_KEY;
}

/** True when `.env` defines both keys (restart `npm run dev` after editing). */
export function isSupabaseConfigured() {
  return Boolean(String(SUPABASE_URL).trim() && String(SUPABASE_ANON_KEY).trim());
}

const baseHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

function ensureConfig() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Create `.env` next to package.json (inside the antimatpvs app folder), add both variables from Supabase → Project Settings → API, then restart the dev server.'
    );
  }
}

async function query(path) {
  ensureConfig();
  const scoped = applyOwnerToPath(path);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${scoped}`, { headers: baseHeaders });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${t || res.statusText}`);
  }
  const data = await parseJsonResponse(res, 'Supabase');
  return data == null ? [] : data;
}

function normalizeStoragePath(rawPath, bucket = 'pj_snapshots') {
  if (!rawPath) return '';
  let p = String(rawPath).trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) {
    const m = p.match(/\/storage\/v1\/(?:object|render\/image)\/(?:public|authenticated)\/[^/]+\/(.+?)(?:\?|$)/i);
    if (m?.[1]) p = m[1];
  }
  p = p.replace(/^\/+/, '');
  p = p.replace(/^storage\/v1\/(?:object|render\/image)\/(?:public|authenticated)\/[^/]+\//i, '');
  p = p.replace(/^object\/(?:public|authenticated)\/[^/]+\//i, '');
  p = p.replace(/^public\/[^/]+\//i, '');
  p = p.replace(new RegExp(`^${bucket}\\/+`, 'i'), '');
  return p;
}

function isMissingColumnError(err) {
  const msg = String(err?.message ?? err ?? '');
  return /42703|column .* does not exist|PGRST/i.test(msg);
}

async function queryWithOrderFallback(table, orderColumns = []) {
  let lastErr = null;
  for (const col of orderColumns) {
    try {
      return await query(`${table}?select=*&order=${col}.desc`);
    } catch (err) {
      lastErr = err;
      if (!isMissingColumnError(err)) throw err;
    }
  }
  throw lastErr ?? new Error(`Could not query ${table}`);
}

export function getImageCandidates(row, bucket = 'pj_snapshots') {
  const base = String(SUPABASE_URL || '').replace(/\/$/, '');
  const direct = row?.image_url ?? row?.imageUrl ?? '';
  const rawPath = row?.image_path ?? row?.imagePath ?? '';
  const candidates = [];
  if (direct) {
    const d = String(direct).trim();
    candidates.push(d);
    if (base && d.startsWith('/')) candidates.push(`${base}${d}`);
  }
  const path = normalizeStoragePath(rawPath, bucket);
  if (base && path) {
    const encodedPath = path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
    candidates.push(`${base}/storage/v1/object/public/${bucket}/${path}`);
    candidates.push(`${base}/storage/v1/object/public/${bucket}/${encodedPath}`);
    candidates.push(`${base}/storage/v1/render/image/public/${bucket}/${path}`);
    candidates.push(`${base}/storage/v1/object/authenticated/${bucket}/${path}`);
    candidates.push(`${base}/storage/v1/object/authenticated/${bucket}/${encodedPath}`);
  }
  return Array.from(new Set(candidates));
}

/** Public storage URL — matches Pois Journey `storagePublicUrl`. */
export function storagePublicUrl(bucket, path, bucketForNormalize = bucket) {
  const base = String(SUPABASE_URL || '').replace(/\/$/, '');
  const normalized = normalizeStoragePath(path, bucketForNormalize);
  if (!base || !normalized) return '';
  const encodedPath = normalized.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`;
}

/** Prefer storage path URL, else fall back to stored public URL column. */
export function resolveStoragePublicUrl(bucket, path, fallbackUrl) {
  const fromPath = path ? storagePublicUrl(bucket, path) : '';
  if (fromPath) return fromPath;
  return String(fallbackUrl ?? '').trim();
}

/** Resolve screen-recording URLs from `snap_videos` (video_url / video_path). */
export function getVideoCandidates(row, bucket = 'snap_videos') {
  const base = String(SUPABASE_URL || '').replace(/\/$/, '');
  const direct = row?.video_url ?? row?.videoUrl ?? '';
  const rawPath = row?.video_path ?? row?.videoPath ?? '';
  const candidates = [];
  if (direct) {
    const d = String(direct).trim();
    if (d) {
      candidates.push(d);
      if (base && d.startsWith('/')) candidates.push(`${base}${d}`);
    }
  }
  const path = normalizeStoragePath(rawPath, bucket);
  if (base && path) {
    candidates.push(storagePublicUrl(bucket, path, bucket));
    const encodedPath = path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
    candidates.push(`${base}/storage/v1/object/public/${bucket}/${encodedPath}`);
    candidates.push(`${base}/storage/v1/object/authenticated/${bucket}/${path}`);
    candidates.push(`${base}/storage/v1/object/authenticated/${bucket}/${encodedPath}`);
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

/** First playable URL — prefers `video_path` via public storage (matches Pois Journey). */
export function getReviewVideoUrl(row) {
  const rawPath = row?.video_path ?? row?.videoPath ?? '';
  const videoPathUrl = rawPath ? storagePublicUrl('snap_videos', rawPath) : '';
  const direct = String(row?.video_url ?? row?.videoUrl ?? '').trim();
  const url = videoPathUrl || direct;
  if (url) return url;
  const candidates = getVideoCandidates(row, 'snap_videos');
  return candidates[0] ?? null;
}

/** First poster / snapshot URL for HTML `<video poster>` or `<img>`. */
export function getImageUrlForReview(row, bucket = 'pj_snapshots') {
  const candidates = getImageCandidates(row, bucket);
  return candidates[0] ?? null;
}

/** Human-readable duration for PDF / UI (duration_seconds column). */
export function formatReviewDuration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return '—';
  const total = Math.round(n);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function reviewHasVideo(row) {
  return Boolean(
    row?.video_url ??
      row?.videoUrl ??
      row?.video_path ??
      row?.videoPath
  );
}

export async function fetchImageBlobFromRow(row, bucket = 'pj_snapshots') {
  ensureConfig();
  const candidates = getImageCandidates(row, bucket);
  const rawPath = row?.image_path ?? row?.imagePath ?? '';
  let lastErr = null;
  for (const url of candidates) {
    try {
      const resNoAuth = await fetch(url, { mode: 'cors' });
      if (resNoAuth.ok) return await resNoAuth.blob();
      const resAuth = await fetch(url, {
        mode: 'cors',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });
      if (resAuth.ok) return await resAuth.blob();
      lastErr = new Error(`Image fetch failed (${resAuth.status})`);
    } catch (err) {
      lastErr = err;
    }
  }
  try {
    const normalizedPath = normalizeStoragePath(rawPath, bucket);
    if (normalizedPath) {
      const signEndpoint = `${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${normalizedPath}`;
      const signRes = await fetch(signEndpoint, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 120 }),
      });
      if (signRes.ok) {
        const payload = await signRes.json().catch(() => null);
        const signedPath = payload?.signedURL ?? payload?.signedUrl ?? payload?.signed_url ?? null;
        if (signedPath) {
          const signedUrl = signedPath.startsWith('http')
            ? signedPath
            : `${SUPABASE_URL}/storage/v1${signedPath.startsWith('/') ? '' : '/'}${signedPath}`;
          const signedBlobRes = await fetch(signedUrl, {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
          });
          if (signedBlobRes.ok) return await signedBlobRes.blob();
        }
      }
    }
  } catch (err) {
    lastErr = err;
  }
  throw lastErr ?? new Error('Image fetch failed');
}

async function mutate(method, path, body = null) {
  ensureConfig();
  const scopedPath = applyOwnerToPath(path);
  let payload = body;
  if (method === 'POST' && body != null && typeof body === 'object' && isOwnerScopeEnabled()) {
    payload = { ...body, [OWNER_COLUMN]: getOwnerSlug() };
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${scopedPath}`, {
    method,
    headers: { ...baseHeaders, Prefer: 'return=representation' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${res.status}: ${text || res.statusText}`);
  }
  if (method === 'DELETE') return null;
  return parseJsonResponse(res, 'Supabase');
}

async function headCount(table, filter = '') {
  ensureConfig();
  const merged = mergeOwnerFilter(filter);
  const qs = merged ? `?${merged}` : '';
  const parseRange = (res) => {
    const range = res.headers.get('content-range');
    if (!range) return null;
    const total = parseInt(range.split('/')[1], 10);
    return Number.isFinite(total) ? total : null;
  };

  // Prefer HEAD; some browsers/proxies hide Content-Range on HEAD — fall back to GET.
  const headRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method: 'HEAD',
    headers: { ...baseHeaders, Prefer: 'count=exact' },
  });
  const headTotal = parseRange(headRes);
  if (headTotal != null) return headTotal;

  const sep = qs ? '&' : '?';
  const getRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}${sep}select=id&limit=1`, {
    method: 'GET',
    headers: { ...baseHeaders, Prefer: 'count=exact', Range: '0-0' },
  });
  const getTotal = parseRange(getRes);
  return getTotal != null ? getTotal : 0;
}

/* ── Users (pj_users) ── */

function normalizeUserRow(u) {
  if (!u) return u;
  const display =
    u.full_name ?? u.user_name ?? u.name ?? u.display_name ?? '';
  const email = u.email ?? u.user_email ?? u.userEmail ?? '';
  return {
    ...u,
    full_name: display,
    user_name: u.user_name ?? display,
    email,
  };
}

/** Users for tracking sidebar */
export function fetchUsers() {
  return query('pj_users?select=*&order=created_at.asc').then((rows) => rows.map(normalizeUserRow));
}

export function fetchAllUsers() {
  return query('pj_users?select=*&order=created_at.desc').then((rows) => rows.map(normalizeUserRow));
}

export function updateUser(id, data) {
  return mutate('PATCH', `pj_users?id=eq.${id}`, data);
}

export function deleteUser(id) {
  return mutate('DELETE', `pj_users?id=eq.${id}`);
}

/* ── Location nodes (pj_navnodes) ── */

/** Map DB row to the shape the tracking UI expects (handles alternate column names). */
export function normalizeNavnodeRow(r) {
  if (!r || typeof r !== 'object') return r;
  const pos_x = Number(r.pos_x ?? r.x ?? 0);
  const pos_y = Number(r.pos_y ?? r.y ?? 0);
  const pos_z = Number(r.pos_z ?? r.z ?? 0);
  /** UI uses `recorded_at`; your table may only expose `created_at` — prefer that first */
  const recorded_at =
    r.created_at ?? r.recorded_at ?? r.updated_at ?? r.ts ?? r.time ?? null;
  return {
    ...r,
    pos_x,
    pos_y,
    pos_z,
    recorded_at,
  };
}

function navnodeTimeMs(r) {
  const t = normalizeNavnodeRow(r).recorded_at;
  if (!t) return 0;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isBadRequestSchema(err) {
  const m = String(err?.message ?? err);
  return m.includes('400') || m.includes('PGRST') || m.includes('42703');
}

/** FK from pj_navnodes → pj_users.id (try in order). */
const NAVNODE_USER_FK = ['user_id', 'userid', 'users_id', 'pj_user_id', 'id_user'];
/** Match navnodes to the same person as pj_users.email / user_email */
const NAVNODE_EMAIL_COL = ['user_email', 'email', 'userEmail', 'useremail'];
/** Sort / history time column — `created_at` first (common when `recorded_at` is absent). */
const NAVNODE_TIME_COL = ['created_at', 'recorded_at', 'updated_at', 'inserted_at'];

/**
 * @param {string | { id: string, email?: string, user_email?: string }} userRef — pass full `pj_users` row for email matching
 */
function resolveUserRef(userRef) {
  if (userRef != null && typeof userRef === 'object' && 'id' in userRef) {
    const email =
      userRef.email ?? userRef.user_email ?? userRef.userEmail ?? '';
    return { id: String(userRef.id), email: String(email).trim() };
  }
  return { id: String(userRef), email: '' };
}

/**
 * Build PostgREST `col=eq.val` filters: email columns first (your schema links by user email), then user id FKs.
 */
function buildNavnodeFilters({ id, email }) {
  const encId = encodeURIComponent(id);
  const filters = [];
  if (email) {
    const encEmail = encodeURIComponent(email);
    for (const col of NAVNODE_EMAIL_COL) {
      filters.push(`${col}=eq.${encEmail}`);
    }
  }
  for (const fk of NAVNODE_USER_FK) {
    filters.push(`${fk}=eq.${encId}`);
  }
  return filters;
}

/**
 * Load all navnodes for a user from `pj_navnodes`.
 * Tries matching by **user email** (user_email / email / …) then by user id, until a query returns rows or all are exhausted.
 * Sorted oldest → newest by time (for history / route).
 */
export async function fetchNavnodeHistory(userRef) {
  const resolved = resolveUserRef(userRef);
  const filters = buildNavnodeFilters(resolved);

  for (const filter of filters) {
    for (const tcol of NAVNODE_TIME_COL) {
      const path = `pj_navnodes?${filter}&select=*&order=${tcol}.asc`;
      try {
        const rows = await query(path);
        const arr = Array.isArray(rows) ? rows : [];
        const mapped = arr.map(normalizeNavnodeRow);
        if (mapped.length > 0) return mapped;
      } catch (e) {
        if (isBadRequestSchema(e)) continue;
        throw e;
      }
    }
  }

  for (const filter of filters) {
    const path = `pj_navnodes?${filter}&select=*`;
    try {
      const rows = await query(path);
      const arr = (Array.isArray(rows) ? rows : []).map(normalizeNavnodeRow);
      if (arr.length > 0) {
        return [...arr].sort((a, b) => navnodeTimeMs(a) - navnodeTimeMs(b));
      }
    } catch (e) {
      if (isBadRequestSchema(e)) continue;
      throw e;
    }
  }

  return [];
}

/** Latest single point for live tracking (newest first). */
export async function fetchLatestNavnode(userRef) {
  const resolved = resolveUserRef(userRef);
  const filters = buildNavnodeFilters(resolved);

  for (const filter of filters) {
    for (const tcol of NAVNODE_TIME_COL) {
      const path = `pj_navnodes?${filter}&select=*&order=${tcol}.desc&limit=1`;
      try {
        const rows = await query(path);
        const arr = Array.isArray(rows) ? rows : [];
        const mapped = arr.map(normalizeNavnodeRow);
        if (mapped.length > 0) return mapped;
      } catch (e) {
        if (isBadRequestSchema(e)) continue;
        throw e;
      }
    }
  }

  const hist = await fetchNavnodeHistory(userRef);
  if (!hist.length) return [];
  return [hist[hist.length - 1]];
}

/** All navnodes for the current owner (global movement heat map). */
export function fetchAllNavnodes() {
  return query('pj_navnodes?select=*&order=created_at.asc').then((rows) =>
    (Array.isArray(rows) ? rows : []).map(normalizeNavnodeRow),
  );
}

/**
 * Combined navnodes for every user (same rows as per-user History/Heat map tabs).
 * Merges `fetchNavnodeHistory` per user so Display heat map matches John + Raghu + all others.
 */
export async function fetchAllUsersNavnodesCombined() {
  const users = await fetchUsers();
  if (!users.length) return fetchAllNavnodes();

  const chunks = await Promise.all(users.map((u) => fetchNavnodeHistory(u)));
  const merged = [];
  const seen = new Set();

  for (const rows of chunks) {
    for (const r of rows) {
      const n = normalizeNavnodeRow(r);
      const key = `${n.pos_x.toFixed(3)}|${n.pos_y.toFixed(3)}|${n.pos_z.toFixed(3)}|${n.recorded_at ?? ''}|${n.user_email ?? n.email ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(n);
    }
  }

  if (merged.length > 0) return merged;
  return fetchAllNavnodes();
}

/* ── POIs (pj_pois) ── */

export function fetchAllPois() {
  return query('pj_pois?select=*&order=created_at.desc');
}

export function insertPoiRow(body) {
  return mutate('POST', 'pj_pois', body);
}

export function updatePoiRow(id, data) {
  return mutate('PATCH', `pj_pois?id=eq.${id}`, data);
}

export function deletePoiRow(id) {
  return mutate('DELETE', `pj_pois?id=eq.${id}`);
}

/* ── Journey reviews (pj_journey_reviews) ── */

export function fetchAllJourneyReviews() {
  return query('pj_journey_reviews?select=*,pj_pois(poi_name)&order=created_at.desc');
}

export function fetchJourneysByIds(journeyIds = []) {
  const ids = Array.from(new Set((journeyIds || []).filter(Boolean)));
  if (!ids.length) return Promise.resolve([]);
  const inList = ids.map((id) => `"${String(id).replace(/"/g, '\\"')}"`).join(',');
  return query(
    `pj_journeys?select=*&id=in.(${inList})`,
  );
}

export function fetchAllJourneys() {
  return queryWithOrderFallback('pj_journeys', ['created_at', 'started_at', 'completed_at', 'updated_at']);
}

export async function fetchSubmittedPoints() {
  const tables = [
    { name: 'pj_user_submitted_points', orderColumns: ['created_at', 'updated_at'] },
    { name: 'pj_user_submitted', orderColumns: ['created_at', 'updated_at'] },
  ];
  let lastErr = null;
  for (const t of tables) {
    try {
      return await queryWithOrderFallback(t.name, t.orderColumns);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('Could not load submitted points');
}

export function updateJourneyReview(id, data) {
  return mutate('PATCH', `pj_journey_reviews?id=eq.${id}`, data);
}

export function deleteJourneyReview(id) {
  return mutate('DELETE', `pj_journey_reviews?id=eq.${id}`);
}

/* ── Media (pj_media) ─── */

function mediaFilterParams({ poiType, mediaType, isActive, search } = {}) {
  const parts = [];
  if (poiType) parts.push(`poi_type=ilike.${encodeURIComponent(poiType)}`);
  if (mediaType) parts.push(`media_type=eq.${encodeURIComponent(mediaType)}`);
  if (isActive === true) parts.push('is_active=eq.true');
  if (isActive === false) parts.push('is_active=eq.false');
  if (search) {
    const q = encodeURIComponent(`%${search}%`);
    parts.push(`or=(label.ilike.${q},file_name.ilike.${q})`);
  }
  return parts.length ? `&${parts.join('&')}` : '';
}

/**
 * @param {{ poiType?: string, mediaType?: string, isActive?: boolean | null, search?: string, allTypes?: boolean }} [opts]
 */
export function fetchAllMedia(opts = {}) {
  const useSessionType = !opts.allTypes && !opts.poiType;
  const poiType = opts.poiType ?? (useSessionType ? getMediaPoiType() : '');
  const filter = mediaFilterParams({
    poiType: poiType || undefined,
    mediaType: opts.mediaType,
    isActive: opts.isActive,
    search: opts.search,
  });
  const qs = `?select=*${filter}&order=created_at.desc`;
  return query(`pj_media${qs}`);
}

export function insertMediaRow(body) {
  const poiType = String(body.poi_type ?? getMediaPoiType() ?? '').trim();
  if (!poiType) {
    throw new Error('poi_type is required for media.');
  }
  return mutate('POST', 'pj_media', {
    poi_type: poiType,
    media_url: body.media_url,
    media_type: body.media_type,
    mime_type: body.mime_type ?? null,
    file_name: body.file_name ?? null,
    label: body.label ?? null,
    pos_x: body.pos_x ?? 0,
    pos_y: body.pos_y ?? 0,
    pos_z: body.pos_z ?? 0,
    rot_x: body.rot_x ?? 0,
    rot_y: body.rot_y ?? 0,
    rot_z: body.rot_z ?? 0,
    scale_x: body.scale_x ?? 1,
    scale_y: body.scale_y ?? 1,
    scale_z: body.scale_z ?? 1,
    width: body.width ?? 1,
    height: body.height ?? 1,
    is_active: body.is_active ?? true,
    redirect_link: body.redirect_link ?? null,
  });
}

export function updateMediaRow(id, data) {
  return mutate('PATCH', `pj_media?id=eq.${id}`, {
    ...data,
    updated_at: new Date().toISOString(),
  });
}

export function deleteMediaRow(id) {
  return mutate('DELETE', `pj_media?id=eq.${id}`);
}

/* ── Analytics ── */

async function safeHeadCount(table, filter = '') {
  try {
    return await headCount(table, filter);
  } catch {
    return 0;
  }
}

export async function fetchCounts() {
  if (!isSupabaseConfigured()) {
    return { users: 0, pois: 0, reviews: 0, journeys: 0, missingEnv: true };
  }
  const [users, pois, reviews, journeys] = await Promise.all([
    safeHeadCount('pj_users'),
    safeHeadCount('pj_pois'),
    safeHeadCount('pj_journey_reviews'),
    safeHeadCount('pj_journeys'),
  ]);
  return { users, pois, reviews, journeys, missingEnv: false };
}

/* ── Admin login (pj_adminlogin) ── */

/**
 * Authenticate dashboard login using `pj_adminlogin`:
 * - Lookup by username/email
 * - Compare stored password exactly (plain-text legacy behavior)
 * - Return related owner/map metadata for auto-loading
 */
export async function authenticateAdminLogin({ username, password }) {
  ensureConfig();
  const cleanUsername = String(username ?? '').trim().toLowerCase();
  const cleanPassword = String(password ?? '');

  if (!cleanUsername || !cleanPassword) return null;

  // Use RPC to avoid exposing raw credential table via RLS policies.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/authenticate_pj_adminlogin`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      p_email: cleanUsername,
      p_password: cleanPassword,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${t || res.statusText}`);
  }

  const rows = await parseJsonResponse(res, 'Supabase');
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;

  const ownername = String(row.ownername ?? '').trim();
  const mapcode = String(row.mapcode ?? '').trim();
  if (!ownername || !mapcode) return null;

  return {
    ownername,
    mapcode,
    email: String(row.email ?? '').trim().toLowerCase(),
  };
}
