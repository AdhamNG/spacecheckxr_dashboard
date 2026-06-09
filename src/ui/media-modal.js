/**
 * Add / edit Media — file upload (auto-detected type), label, optional redirect link.
 */

import { classifyMediaFile } from '../utils/media-files.js';
import { uploadProjectMedia } from '../services/media-storage.js';
import { insertMediaRow, updateMediaRow } from '../services/supabase.js';
import { getMediaPoiType } from '../config/media-scope.js';
import { showToast } from './toast.js';
import { iconClose } from './icons.js';

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

const FILE_ACCEPT =
  '.jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,.glb,.gltf,image/*,video/*';

/**
 * @param {object} options
 * @param {Record<string, unknown> | null} [options.row]
 * @param {{ x?: number, y?: number, z?: number }} [options.placement]
 * @param {(saved: Record<string, unknown>, context?: { previewUrl?: string }) => void} [options.onSaved]
 */
export function openMediaModal(options = {}) {
  const { row = null, placement = {}, onSaved } = options;
  const isEdit = Boolean(row?.id);
  const existingRedirect = String(row?.redirect_link ?? '').trim();

  const overlay = document.createElement('div');
  overlay.className = 'media-modal-overlay poi-add-dialog';
  overlay.innerHTML = `
    <div class="poi-add-dialog-backdrop" data-action="close"></div>
    <div class="media-modal media-modal-card poi-add-dialog-card float-glass" role="dialog" aria-labelledby="media-modal-title">
      <header class="poi-add-dialog-header media-modal-header">
        <h2 class="poi-add-dialog-title" id="media-modal-title">${isEdit ? 'Edit media' : 'Add media'}</h2>
        <button type="button" class="poi-add-dialog-close media-modal-close" data-action="close" aria-label="Close">${iconClose()}</button>
      </header>
      <form class="media-modal-form" id="media-modal-form">
        <div class="media-modal-section">
          <label class="media-upload-zone" id="media-upload-zone">
            <span class="media-upload-zone-title">Choose a file</span>
            <span class="media-upload-zone-hint">Image, video, or GLB — type is detected automatically</span>
            <input type="file" id="media-file" class="media-file-input" accept="${FILE_ACCEPT}" ${isEdit ? '' : 'required'} />
          </label>
          <div class="media-preview hidden" id="media-preview"></div>
          ${isEdit ? '<p class="media-modal-hint">Leave empty to keep the current file.</p>' : ''}
        </div>
        <div class="coord-group poi-add-field">
          <span class="field-label">Display name</span>
          <input type="text" id="media-label" placeholder="Display label (optional)" value="${escapeAttr(row?.label ?? '')}" />
        </div>
        <div class="coord-group poi-add-field media-redirect-field">
          <span class="field-label">Set up redirection?</span>
          <div class="media-redirect-toggle" role="radiogroup" aria-label="Set up redirection">
            <label class="media-redirect-option">
              <input type="radio" name="media-redirect" id="media-redirect-no" value="no" ${existingRedirect ? '' : 'checked'} />
              <span>No</span>
            </label>
            <label class="media-redirect-option">
              <input type="radio" name="media-redirect" id="media-redirect-yes" value="yes" ${existingRedirect ? 'checked' : ''} />
              <span>Yes</span>
            </label>
          </div>
        </div>
        <div class="coord-group poi-add-field media-redirect-link-wrap ${existingRedirect ? '' : 'hidden'}" id="media-redirect-link-wrap">
          <span class="field-label">Redirect link</span>
          <input type="url" id="media-redirect-link" placeholder="https://example.com" value="${escapeAttr(existingRedirect)}" />
        </div>
        <footer class="poi-add-dialog-actions media-modal-footer">
          <button type="button" class="btn-secondary" data-action="close">Cancel</button>
          <button type="submit" class="btn-save" id="media-save">${isEdit ? 'Save' : 'Add media'}</button>
        </footer>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  let uploadedMeta = null;
  let previewObjectUrl = null;
  let detectedType = row?.media_type ?? null;
  const fileInput = overlay.querySelector('#media-file');
  const previewEl = overlay.querySelector('#media-preview');
  const uploadZone = overlay.querySelector('#media-upload-zone');
  const saveBtn = overlay.querySelector('#media-save');
  const redirectYes = overlay.querySelector('#media-redirect-yes');
  const redirectNo = overlay.querySelector('#media-redirect-no');
  const redirectLinkWrap = overlay.querySelector('#media-redirect-link-wrap');
  const redirectLinkInput = overlay.querySelector('#media-redirect-link');

  function syncRedirectLinkField(fromUserToggle = false) {
    const enabled = redirectYes.checked;
    redirectLinkWrap.classList.toggle('hidden', !enabled);
    if (!enabled && fromUserToggle) {
      redirectLinkInput.value = '';
    } else if (enabled && !redirectLinkInput.value.trim() && existingRedirect) {
      redirectLinkInput.value = existingRedirect;
    }
  }

  redirectYes.addEventListener('change', () => syncRedirectLinkField(true));
  redirectNo.addEventListener('change', () => syncRedirectLinkField(true));
  syncRedirectLinkField(false);

  function syncSaveButton() {
    const hasNewFile = Boolean(uploadedMeta?.file || fileInput.files?.[0]);
    const canSave = isEdit || hasNewFile;
    saveBtn.disabled = !canSave;
  }

  function renderPreview(url, type) {
    previewEl.classList.remove('hidden');
    previewEl.innerHTML = '';
    const tag = document.createElement('span');
    tag.className = 'media-type-detected';
    tag.textContent = type === 'image' ? 'Image' : type === 'video' ? 'Video' : '3D model';
    previewEl.appendChild(tag);
    if (type === 'image') {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Preview';
      previewEl.appendChild(img);
    } else if (type === 'video') {
      const vid = document.createElement('video');
      vid.src = url;
      vid.controls = true;
      vid.muted = true;
      previewEl.appendChild(vid);
    } else {
      const p = document.createElement('p');
      p.className = 'media-preview-model';
      p.textContent = 'Model will appear in the 3D view after save.';
      previewEl.appendChild(p);
    }
  }

  if (row?.media_url) renderPreview(row.media_url, row.media_type);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      uploadedMeta = null;
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
      }
      detectedType = row?.media_type ?? null;
      previewEl.classList.add('hidden');
      previewEl.innerHTML = '';
      uploadZone.classList.remove('media-upload-zone--ready');
      syncSaveButton();
      return;
    }
    const classified = classifyMediaFile(file);
    if (!classified) {
      showToast('Unsupported file. Use image, video (.mp4/.webm/.mov), or .glb/.gltf', 'error');
      fileInput.value = '';
      syncSaveButton();
      return;
    }
    uploadedMeta = { file, ...classified };
    detectedType = classified.mediaType;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(file);
    renderPreview(previewObjectUrl, classified.mediaType);
    uploadZone.classList.add('media-upload-zone--ready');
    syncSaveButton();
  });

  syncSaveButton();

  function close() {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
    overlay.remove();
  }

  overlay.querySelectorAll('[data-action="close"]').forEach((el) => {
    el.addEventListener('click', close);
  });

  overlay.querySelector('#media-modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;

    try {
      const poiType = getMediaPoiType() || row?.poi_type;
      if (!poiType) throw new Error('Sign in before adding media.');

      let mediaUrl = row?.media_url ?? '';
      let mimeType = row?.mime_type ?? null;
      let fileName = row?.file_name ?? null;
      let mediaType = detectedType ?? row?.media_type;

      if (uploadedMeta?.file) {
        const up = await uploadProjectMedia(uploadedMeta.file, poiType, uploadedMeta.mediaType);
        mediaUrl = up.publicUrl;
        mimeType = uploadedMeta.mimeType;
        fileName = uploadedMeta.file.name;
        mediaType = uploadedMeta.mediaType;
      } else if (!isEdit) {
        throw new Error('Choose a file to upload.');
      }

      if (!mediaType) throw new Error('Could not detect media type.');

      const label =
        overlay.querySelector('#media-label').value.trim() ||
        fileName?.replace(/\.[^.]+$/, '') ||
        'Media';

      let redirectLink = null;
      if (redirectYes.checked) {
        redirectLink = redirectLinkInput.value.trim();
        if (!redirectLink) {
          throw new Error('Paste a redirect link or choose No.');
        }
        if (!/^https?:\/\//i.test(redirectLink)) {
          redirectLink = `https://${redirectLink}`;
        }
      }

      const payload = {
        poi_type: poiType,
        media_url: mediaUrl,
        media_type: mediaType,
        mime_type: mimeType,
        file_name: fileName,
        label,
        pos_x: placement.x ?? row?.pos_x ?? 0,
        pos_y: placement.y ?? row?.pos_y ?? 0,
        pos_z: placement.z ?? row?.pos_z ?? 0,
        rot_x: row?.rot_x ?? 0,
        rot_y: row?.rot_y ?? 0,
        rot_z: row?.rot_z ?? 0,
        scale_x: row?.scale_x ?? 1,
        scale_y: row?.scale_y ?? 1,
        scale_z: row?.scale_z ?? 1,
        width: row?.width ?? 1,
        height: row?.height ?? 1,
        is_active: row?.is_active ?? true,
        redirect_link: redirectLink,
      };

      let saved;
      if (isEdit) {
        const updated = await updateMediaRow(row.id, payload);
        saved = Array.isArray(updated) ? updated[0] : updated;
      } else {
        const inserted = await insertMediaRow(payload);
        saved = Array.isArray(inserted) ? inserted[0] : inserted;
      }

      showToast(isEdit ? 'Media updated' : 'Media added — adjust position in the Media panel', 'success');
      const previewUrl = uploadedMeta?.file ? previewObjectUrl ?? undefined : undefined;
      previewObjectUrl = null;
      await Promise.resolve(onSaved?.(saved, { previewUrl }));
      close();
    } catch (err) {
      console.error(err);
      showToast(err.message ?? String(err), 'error');
    } finally {
      syncSaveButton();
    }
  });
}
