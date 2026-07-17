/** File validation and metadata for `pj_media` uploads. */

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov']);
const MODEL_EXT = new Set(['glb', 'gltf']);

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
};

/**
 * @param {File} file
 * @returns {{ mediaType: 'image'|'video'|'model', mimeType: string, ext: string } | null}
 */
export function classifyMediaFile(file) {
  const name = String(file?.name ?? '');
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!ext) return null;

  let mediaType = null;
  if (IMAGE_EXT.has(ext)) mediaType = 'image';
  else if (VIDEO_EXT.has(ext)) mediaType = 'video';
  else if (MODEL_EXT.has(ext)) mediaType = 'model';
  if (!mediaType) return null;

  return {
    mediaType,
    mimeType: MIME_BY_EXT[ext] ?? (file.type || 'application/octet-stream'),
    ext,
  };
}

/**
 * @param {string} poiType
 * @param {'image'|'video'|'model'} mediaType
 * @param {string} fileName
 */
export function buildStorageObjectPath(poiType, mediaType, fileName) {
  const safeType = String(poiType ?? 'unknown').replace(/[^\w.-]+/g, '_');
  const safeName = String(fileName ?? 'file').replace(/[^\w.-]+/g, '_');
  const stamp = Date.now();
  return `${safeType}/${mediaType}/${stamp}_${safeName}`;
}

/**
 * @param {string} mediaUrl
 * @returns {string | null}
 */
export function storagePathFromPublicUrl(mediaUrl) {
  const marker = '/storage/v1/object/public/project-media/';
  const idx = String(mediaUrl ?? '').indexOf(marker);
  if (idx < 0) return null;
  return decodeURIComponent(mediaUrl.slice(idx + marker.length));
}
