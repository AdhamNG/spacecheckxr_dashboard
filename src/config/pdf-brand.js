/** NavMe PDF palette — matches Pois Journey `brandPalette` / SCXR_PDF. */

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
      return 'View snapshot';
    case 'recording':
      return 'View recording';
    case 'media':
      return 'View media';
    default: {
      const _exhaustive = kind;
      return `View ${_exhaustive}`;
    }
  }
}
