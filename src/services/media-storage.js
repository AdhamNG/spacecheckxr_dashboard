/**
 * Supabase Storage — `project-media` bucket (public read).
 */

import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseConfigured } from './supabase.js';
import { buildStorageObjectPath } from '../utils/media-files.js';

const BUCKET = 'project-media';

function ensureConfig() {
  if (!isSupabaseConfigured()) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  }
}

function storageHeaders(contentType) {
  const key = getSupabaseAnonKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': contentType,
  };
}

/**
 * @param {string} objectPath
 */
export function getPublicMediaUrl(objectPath) {
  const base = getSupabaseUrl().replace(/\/$/, '');
  const encoded = objectPath.split('/').map((s) => encodeURIComponent(s)).join('/');
  return `${base}/storage/v1/object/public/${BUCKET}/${encoded}`;
}

/**
 * @param {File} file
 * @param {string} poiType
 * @param {'image'|'video'|'model'} mediaType
 */
export async function uploadProjectMedia(file, poiType, mediaType) {
  ensureConfig();
  const objectPath = buildStorageObjectPath(poiType, mediaType, file.name);
  const url = `${getSupabaseUrl().replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${objectPath}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...storageHeaders(file.type || 'application/octet-stream'),
      'x-upsert': 'true',
    },
    body: file,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Storage upload ${res.status}: ${text || res.statusText}`);
  }

  return {
    objectPath,
    publicUrl: getPublicMediaUrl(objectPath),
  };
}

/**
 * @param {string} objectPath
 */
export async function deleteProjectMediaFile(objectPath) {
  if (!objectPath) return;
  ensureConfig();
  const url = `${getSupabaseUrl().replace(/\/$/, '')}/storage/v1/object/${BUCKET}`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers: storageHeaders('application/json'),
    body: JSON.stringify([objectPath]),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Storage delete ${res.status}: ${text || res.statusText}`);
  }
}
