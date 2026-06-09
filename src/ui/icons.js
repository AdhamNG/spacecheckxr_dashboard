/** Shared inline SVG icons (stroke, 24×24 viewBox). */

function svg(className, paths, size = 16) {
  return `<svg class="ui-icon${className ? ` ${className}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export const iconSave = () =>
  svg('ui-icon-save', '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>');

export const iconDelete = () =>
  svg('ui-icon-delete', '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 18);

export const iconAdd = () =>
  svg('ui-icon-add', '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>');

export const iconEdit = () =>
  svg('ui-icon-edit', '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>');

export const iconBox = () =>
  svg('ui-icon-box', '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>');

export const iconGrip = () =>
  svg('ui-icon-grip', '<circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none"/>', 14);

export const iconClose = () =>
  svg('ui-icon-close', '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 14);

export const iconRefresh = () =>
  svg('ui-icon-refresh', '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>', 16);

export const iconEye = () =>
  svg('ui-icon-eye', '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 18);

export const iconEyeOff = () =>
  svg('ui-icon-eye-off', '<path d="M3 3l18 18"/><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.1 4.1"/><path d="M6.6 6.6C3.6 8.6 2 12 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4.3-.9"/>', 18);

/** Go to point — ring target on the map */
export const iconFootprint = () =>
  svg('ui-icon-go-ring', '<circle cx="12" cy="12" r="7"/>', 20);

/** Map pin with plus — place POI on click */
export const iconPlacePoi = () =>
  svg(
    'ui-icon-place-poi',
    '<path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="9" y1="10" x2="15" y2="10"/>',
    20,
  );

/** Place media on map click */
export const iconPlaceMedia = () =>
  svg(
    'ui-icon-place-media',
    '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5.5-5.5L5 21"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="10" y1="5" x2="14" y2="5"/>',
    20,
  );

export const iconMediaImage = () =>
  svg('ui-icon-media-image', '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5.5-5.5L5 21"/>', 18);

export const iconMediaVideo = () =>
  svg('ui-icon-media-video', '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/>', 18);

export const iconMediaModel = () =>
  svg('ui-icon-media-model', '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5"/><path d="M12 12v10"/><path d="M12 12L3 7"/>', 18);
