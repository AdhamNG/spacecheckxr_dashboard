import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fetchAllMedia, insertMediaRow, updateMediaRow, deleteMediaRow } from '../services/supabase.js';

/** In-memory media rows synced with `pj_media`. */
export const mediaData = [];

const mediaObjects = [];
let mediaGroupRef = null;
let mediaGroupVisible = true;
let sharedGltfLoader = null;

export function setMediaGltfLoader(loader) {
  sharedGltfLoader = loader;
}

export function normalizeMediaRow(row) {
  return {
    id: row.id,
    poi_type: row.poi_type,
    media_url: row.media_url,
    media_type: row.media_type,
    mime_type: row.mime_type,
    file_name: row.file_name,
    label: row.label ?? row.file_name ?? 'Media',
    pos_x: Number(row.pos_x),
    pos_y: Number(row.pos_y),
    pos_z: Number(row.pos_z),
    rot_x: Number(row.rot_x),
    rot_y: Number(row.rot_y),
    rot_z: Number(row.rot_z),
    scale_x: Number(row.scale_x ?? 1),
    scale_y: Number(row.scale_y ?? 1),
    scale_z: Number(row.scale_z ?? 1),
    width: Number(row.width ?? 1),
    height: Number(row.height ?? 1),
    is_active: row.is_active !== false,
    redirect_link: row.redirect_link ?? null,
  };
}

export async function hydrateMediaFromSupabase() {
  mediaData.length = 0;
  const rows = await fetchAllMedia();
  rows.forEach((row) => mediaData.push(normalizeMediaRow(row)));
}

export function upsertMediaFromSaved(row) {
  const normalized = normalizeMediaRow(row);
  const idx = mediaData.findIndex((m) => m.id === normalized.id);
  if (idx >= 0) {
    mediaData[idx] = normalized;
    return idx;
  }
  mediaData.push(normalized);
  return mediaData.length - 1;
}

/**
 * @param {Record<string, unknown> | null | undefined} saved
 * @param {THREE.Object3D | null | undefined} container
 * @param {{ previewUrl?: string }} [options]
 */
export async function applySavedMediaRow(saved, container, options = {}) {
  if (!saved?.id) {
    await hydrateMediaFromSupabase();
  } else {
    upsertMediaFromSaved(saved);
  }

  const index = saved?.id ? mediaData.findIndex((m) => m.id === saved.id) : -1;
  if (index >= 0 && options.previewUrl) {
    mediaData[index]._previewUrl = options.previewUrl;
  }

  setMediaGroupVisible(true);

  if (container) {
    await refreshMediaGroup(container);
  }

  return index;
}

function resolveMediaSource(item) {
  return item._previewUrl || item.media_url;
}

function loadTexture(url, attempts = 3) {
  return new Promise((resolve, reject) => {
    const tryLoad = (left) => {
      new THREE.TextureLoader().load(
        url,
        resolve,
        undefined,
        (err) => {
          if (left <= 1) reject(err);
          else setTimeout(() => tryLoad(left - 1), 350);
        },
      );
    };
    tryLoad(attempts);
  });
}

function applyTransform(group, item) {
  group.position.set(item.pos_x, item.pos_y, item.pos_z);
  group.rotation.set(item.rot_x, item.rot_y, item.rot_z);
  group.scale.set(item.scale_x, item.scale_y, item.scale_z);
}

function disposeObject3D(obj) {
  obj.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (!m) return;
        m.map?.dispose();
        m.dispose();
      });
    }
    if (child.isVideoTexture) {
      const video = child.image;
      if (video?.pause) video.pause();
    }
  });
}

async function buildImagePlane(item) {
  const tex = await loadTexture(resolveMediaSource(item));
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true });
  const geo = new THREE.PlaneGeometry(item.width, item.height);
  return new THREE.Mesh(geo, mat);
}

async function buildVideoPlane(item) {
  const previewUrl = item._previewUrl;
  const video = document.createElement('video');
  video.src = previewUrl || item.media_url;
  video.crossOrigin = previewUrl ? null : 'anonymous';
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => {});

  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(item.width, item.height);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.videoEl = video;
  return mesh;
}

async function buildModel(item) {
  const loader = sharedGltfLoader ?? new GLTFLoader();
  const source = resolveMediaSource(item);
  const gltf = await new Promise((resolve, reject) => {
    loader.load(source, resolve, undefined, reject);
  });
  const root = gltf.scene;
  root.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = false;
      c.receiveShadow = false;
    }
  });
  return root;
}

async function createMediaVisual(item) {
  if (item.media_type === 'image') return buildImagePlane(item);
  if (item.media_type === 'video') return buildVideoPlane(item);
  if (item.media_type === 'model') return buildModel(item);
  const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const mat = new THREE.MeshBasicMaterial({ color: 0x888888, wireframe: true });
  return new THREE.Mesh(geo, mat);
}

export async function addMediaToScene(container) {
  const existing = container.getObjectByName('MediaGroup');
  if (existing) {
    disposeObject3D(existing);
    container.remove(existing);
  }

  mediaObjects.length = 0;
  const mediaGroup = new THREE.Group();
  mediaGroup.name = 'MediaGroup';
  mediaGroupRef = mediaGroup;

  for (let index = 0; index < mediaData.length; index++) {
    const item = mediaData[index];
    if (!item.is_active) {
      mediaObjects.push({ root: null, item });
      continue;
    }

    const root = new THREE.Group();
    root.name = `Media_${item.id}`;
    root.userData.mediaIndex = index;

    try {
      const visual = await createMediaVisual(item);
      root.add(visual);
      applyTransform(root, item);
      mediaGroup.add(root);
      mediaObjects.push({ root, item });
    } catch (err) {
      console.warn('[media] Failed to load', item.label, err);
      mediaObjects.push({ root: null, item });
    }
  }

  mediaGroup.visible = mediaGroupVisible;
  container.add(mediaGroup);
}

export function refreshMediaGroup(container) {
  if (!container) return Promise.resolve();
  return addMediaToScene(container);
}

export async function remountMediaItem(index, container = mediaGroupRef?.parent) {
  if (!container || index < 0 || index >= mediaData.length) return false;
  await refreshMediaGroup(container);
  return Boolean(getMediaObjects()[index]?.root);
}

export function setMediaGroupVisible(visible) {
  mediaGroupVisible = Boolean(visible);
  if (mediaGroupRef) mediaGroupRef.visible = mediaGroupVisible;
}

export function getMediaObjects() {
  return mediaObjects;
}

export function updateMediaTransform(index, patch) {
  const item = mediaData[index];
  const obj = mediaObjects[index];
  if (!item || !obj) return;
  Object.assign(item, patch);
  if (!obj.root) return;
  applyTransform(obj.root, item);
}

export async function saveMediaToDb(index) {
  const item = mediaData[index];
  if (!item?.id) return;
  await updateMediaRow(item.id, {
    label: item.label,
    media_url: item.media_url,
    media_type: item.media_type,
    mime_type: item.mime_type,
    file_name: item.file_name,
    pos_x: item.pos_x,
    pos_y: item.pos_y,
    pos_z: item.pos_z,
    rot_x: item.rot_x,
    rot_y: item.rot_y,
    rot_z: item.rot_z,
    scale_x: item.scale_x,
    scale_y: item.scale_y,
    scale_z: item.scale_z,
    width: item.width,
    height: item.height,
    is_active: item.is_active,
    redirect_link: item.redirect_link ?? null,
  });
}

export async function removeMediaFromDb(index) {
  const item = mediaData[index];
  if (item?.id) await deleteMediaRow(item.id);
}

export function deleteMediaFromScene(index) {
  if (index < 0 || index >= mediaData.length) return;
  const obj = mediaObjects[index];
  if (obj?.root && mediaGroupRef) {
    disposeObject3D(obj.root);
    mediaGroupRef.remove(obj.root);
  }
  mediaObjects.splice(index, 1);
  mediaData.splice(index, 1);
  mediaObjects.forEach((entry, i) => {
    if (entry.root) entry.root.userData.mediaIndex = i;
  });
}
