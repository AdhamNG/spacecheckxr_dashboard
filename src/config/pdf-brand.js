/** SpaceCheck XR PDF palette — matches Pois Journey `brandPalette` / SCXR_PDF. */

export const SCXR_PDF = {
  navy: [0, 31, 63],
  white: [255, 255, 255],
  headerSubtext: [212, 224, 244],
};

/**
 * @param {'snapshot' | 'recording' | 'media'} kind
 */
export function pdfBrandedLinkLabel(kind) {
  switch (kind) {
    case 'snapshot':
      return 'Open SpaceCheck XR snapshot';
    case 'recording':
      return 'Open SpaceCheck XR recording';
    case 'media':
      return 'Open SpaceCheck XR media';
    default: {
      const _exhaustive = kind;
      return `Open SpaceCheck XR ${_exhaustive}`;
    }
  }
}
