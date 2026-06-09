/**
 * MultiSet Map Download
 * 1. MAP_*  → GET /v1/vps/map/{mapCode}
 * 2. MSET_* → GET /v1/vps/map-set/{mapSetCode} → primary MAP_* from mapSetData
 * 3. GET /v1/file?key={key} → pre-signed URL → GLB bytes
 *
 * Mesh keys: prefers TexturedMesh / textured GLB over wireframe or navmesh assets.
 */
import { multisetApiUrl } from './multiset-origin.js';
import { parseJsonResponse } from '../utils/parse-json-response.js';

const MAP_INFO_URL = multisetApiUrl('/v1/vps/map');
const MAP_SET_URL = multisetApiUrl('/v1/vps/map-set');
const FILE_URL = multisetApiUrl('/v1/file');
// Default to textured meshes so maps render with their authored colors.
// Set VITE_PREFER_TEXTURED_MESH=false only when debugging heavy assets.
const rawPreferTextured = String(import.meta.env.VITE_PREFER_TEXTURED_MESH || '').toLowerCase().trim();
const PREFER_TEXTURED_MESH = rawPreferTextured === '' ? true : rawPreferTextured === 'true';

/**
 * Download the map's 3D file (GLB), preferring textured/color mesh when several keys exist.
 * @param {string} token  JWT bearer token
 * @param {string} mapOrSetCode  MAP_* or MSET_* code
 * @returns {Promise<ArrayBuffer|null>}  GLB data or null if unavailable
 */
export async function downloadMapMesh(token, mapOrSetCode) {
  const mapCode = await resolveMapCodeForMeshDownload(token, mapOrSetCode.trim());

  const mapInfoRes = await fetch(`${MAP_INFO_URL}/${encodeURIComponent(mapCode)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!mapInfoRes.ok) {
    const errText = await mapInfoRes.text().catch(() => '');
    console.warn(`Could not fetch map info (${mapInfoRes.status}):`, errText);
    const hint =
      mapInfoRes.status === 404
        ? ' Use a MAP_* code from the portal, or MSET_* if the set exists under this account.'
        : '';
    throw new Error(`Failed to fetch map info (${mapInfoRes.status})${hint}`);
  }

  const mapInfo = await parseJsonResponse(mapInfoRes, 'MultiSet map info');
  if (mapInfo == null) {
    throw new Error('Map info response was empty');
  }
  if (import.meta.env.DEV) {
    console.log('[multiset] map info keys:', Object.keys(mapInfo));
  }

  const meshKey = findMeshKey(mapInfo);

  if (!meshKey) {
    const fallbackKey = buildFallbackKey(mapInfo);
    if (fallbackKey) {
      console.log('[multiset] trying fallback key:', fallbackKey);
      const result = await tryDownload(token, fallbackKey);
      if (result) return result;
    }

    console.warn('[multiset] no downloadable file found. Map info keys:', Object.keys(mapInfo));
    return null;
  }

  const orderedKeys = orderMeshKeysForDownload(meshKey);
  if (orderedKeys.length > 1) {
    console.log('[multiset] mesh candidates for download:', orderedKeys.join(' -> '));
  } else {
    console.log('[multiset] mesh key:', orderedKeys[0]);
  }
  for (const key of orderedKeys) {
    const result = await tryDownload(token, key);
    if (result) return result;
  }
  return null;
}

function orderMeshKeysForDownload(meshKey) {
  const key = String(meshKey || '');
  if (!key) return [];
  const textured = key.replace(/\/mesh\/mesh\.glb$/i, '/Mesh/TexturedMesh.glb');
  const plain = key.replace(/\/mesh\/texturedmesh\.glb$/i, '/Mesh/Mesh.glb');

  const looksTextured = /\/mesh\/texturedmesh\.glb$/i.test(key);
  const looksPlain = /\/mesh\/mesh\.glb$/i.test(key);
  if (!looksTextured && !looksPlain) return [key];

  if (PREFER_TEXTURED_MESH) {
    return looksTextured ? [textured, plain] : [textured, plain];
  }
  return looksPlain ? [plain, textured] : [plain, textured];
}

/**
 * GET /vps/map/{mapCode} only accepts MAP_*.
 * For MSET_*, load MapSet details and use the primary map (order === 0).
 */
async function resolveMapCodeForMeshDownload(token, code) {
  if (!code.toUpperCase().startsWith('MSET_')) {
    return code;
  }

  const res = await fetch(`${MAP_SET_URL}/${encodeURIComponent(code)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`MapSet lookup failed (${res.status}):`, body);
    throw new Error(
      res.status === 404
        ? 'MapSet not found. Check the MSET_* code, or use a MAP_* code from Get MapSet details in the portal.'
        : `Failed to resolve MapSet (${res.status})`
    );
  }

  const data = await parseJsonResponse(res, 'MultiSet map-set');
  if (data == null) {
    throw new Error('MapSet response was empty');
  }
  const mapSet = data.mapSet ?? data.data?.mapSet ?? data;
  const rows = mapSet?.mapSetData ?? mapSet?.maps ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('MapSet has no maps — cannot download mesh.');
  }

  const sorted = [...rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const primary = sorted[0];
  const mapCode = primary?.map?.mapCode ?? primary?.mapCode;
  if (!mapCode || !String(mapCode).startsWith('MAP_')) {
    throw new Error('Could not read MAP_* code from MapSet response.');
  }

  console.log(`[multiset] resolved ${code} → primary map ${mapCode}`);
  return mapCode;
}

async function tryDownload(token, key) {
  const fileRes = await fetch(`${FILE_URL}?key=${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!fileRes.ok) {
    console.warn(`File URL request failed (${fileRes.status}) for key: ${key}`);
    return null;
  }

  const fileData = await parseJsonResponse(fileRes, 'MultiSet file URL');
  if (fileData == null) {
    console.warn('File URL response was empty for key:', key);
    return null;
  }
  if (import.meta.env.DEV) {
    console.log('[multiset] file response keys:', Object.keys(fileData));
  }

  let downloadUrl =
    fileData.url || fileData.downloadUrl || fileData.signedUrl || fileData.presignedUrl;
  if (!downloadUrl) {
    console.warn('No download URL in file response:', fileData);
    return null;
  }

  if (
    import.meta.env.DEV &&
    downloadUrl.startsWith('https://prod-multiset.s3-accelerate.amazonaws.com')
  ) {
    downloadUrl = downloadUrl.replace(
      'https://prod-multiset.s3-accelerate.amazonaws.com',
      '/s3-proxy'
    );
  }

  const glbRes = await fetch(downloadUrl);
  if (!glbRes.ok) {
    console.warn(`GLB download failed (${glbRes.status})`);
    return null;
  }

  return await glbRes.arrayBuffer();
}

/**
 * Paths the portal / API usually intend as the main viewer mesh — never merge with
 * “everything that looks like .glb” from deep JSON (one map can list huge alternates).
 */
function collectExplicitMeshCandidates(info, out) {
  pushIfFile(out, info.meshKey);
  pushIfFile(out, info.meshFileKey);
  pushIfFile(out, info.mesh?.key);
  pushIfFile(out, info.mesh?.fileKey);
  pushIfFile(out, info.glbKey);
  pushIfFile(out, info.fileKey);
  pushIfFile(out, info.data?.meshKey);
  pushIfFile(out, info.map?.meshKey);
  pushIfFile(out, info.offlineBundle?.meshKey);
  pushIfFile(out, info.offlineBundle?.glbKey);
  pushIfFile(out, info.offlineBundle?.key);

  if (Array.isArray(info.files)) {
    for (const f of info.files) {
      if (!f || typeof f !== 'object') continue;
      const path = f.key || f.path || f.name || f.url;
      const role = `${f.type || ''} ${f.role || ''} ${f.category || ''}`.toLowerCase();
      if (path && typeof path === 'string') {
        const lower = path.toLowerCase();
        const looksMesh =
          lower.endsWith('.glb') ||
          lower.endsWith('.gltf') ||
          lower.includes('/mesh/');
        if (!looksMesh) continue;
        if (role && (role.includes('nav') || role.includes('collision') || role.includes('occlusion'))) {
          continue;
        }
      }
      pushIfFile(out, path);
    }
  }
}

function findMeshKey(info) {
  const explicit = [];
  collectExplicitMeshCandidates(info, explicit);

  let chosen = chooseBestMeshCandidate(explicit);
  if (chosen) {
    return chosen;
  }

  const deep = [];
  deepCollectGlb(info, deep);
  chosen = chooseBestMeshCandidate(deep);
  return chosen;
}

function buildFallbackKey(info) {
  const accountId = info.accountId || info.account_id || info.userId || info.user_id;
  const mapId = info._id || info.id || info.mapId || info.map_id;

  if (accountId && mapId) {
    return `${accountId}/${mapId}/Mesh/TexturedMesh.glb`;
  }
  return null;
}

const DEEP_SKIP_KEYS = new Set([
  'history',
  'versions',
  'changelog',
  'logs',
  'debug',
  'telemetry',
  'events',
  'audit',
  'rawcaptures',
  'pointclouds',
]);

function deepCollectGlb(obj, out, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return;
  for (const [key, val] of Object.entries(obj)) {
    if (DEEP_SKIP_KEYS.has(String(key).toLowerCase())) continue;
    if (typeof val === 'string') {
      pushIfFile(out, val);
    } else if (val && typeof val === 'object') {
      deepCollectGlb(val, out, depth + 1);
    }
  }
}

function pushIfFile(out, value) {
  if (!value || typeof value !== 'string') return;
  const lower = value.toLowerCase();
  if (lower.endsWith('.glb') || lower.endsWith('.gltf') || lower.includes('/mesh/')) {
    out.push(value);
  }
}

function chooseBestMeshCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const unique = [...new Set(candidates.filter(Boolean))];
  if (unique.length === 0) return null;

  const score = (path) => {
    const p = String(path).toLowerCase();
    let s = 0;
    if (p.endsWith('.glb')) s += 6;
    if (p.endsWith('.gltf')) s += 4;
    if (PREFER_TEXTURED_MESH) {
      if (p.includes('texturedmesh')) s += 180;
      else if (p.includes('textured')) s += 120;
      if (p.includes('texture')) s += 100;
    } else {
      if (p.includes('texturedmesh')) s -= 55;
      else if (p.includes('textured')) s -= 20;
      if (p.includes('texture')) s -= 15;
    }
    if (p.includes('albedo') || p.includes('diffuse') || p.includes('color')) s += 60;
    if (p.includes('/mesh/')) s += 15;
    if (p.includes('pointcloud') || p.includes('pcd') || p.includes('.ply') || p.includes('.las')) {
      s -= 120;
    }
    if (p.includes('navmesh') || p.includes('collision') || p.includes('occlusion')) s -= 90;
    if (p.includes('wire') || p.includes('wireframe')) s -= 40;
    if (p.includes('lod0') || p.includes('lod_0') || p.includes('/lod0/')) s -= 35;
    if (p.includes('highpoly') || p.includes('high_poly') || p.includes('fullres') || p.includes('densemesh')) {
      s -= 45;
    }
    if (p.includes('simplified') || p.includes('decimated') || p.includes('preview')) s += 25;
    if (p.includes('bundle') && p.includes('offline')) s -= 30;
    return s;
  };

  unique.sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return String(a).length - String(b).length;
  });
  const picked = unique[0] || null;
  if (import.meta.env.DEV) {
    console.log('[multiset] mesh candidates:', unique.length, '→', picked);
  }
  return picked;
}
