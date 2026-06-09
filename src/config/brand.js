/** App branding — logo asset and display name. */

export const BRAND_NAME = 'SpaceCheck XR';

export const LOGO_SRC = `${import.meta.env.BASE_URL}logo-spacecheck-xr.png`;

/**
 * @param {string} [className]
 * @param {number} [size] height in px (width auto)
 */
export function brandLogoHtml(className = 'brand-logo', size = 40) {
  return `<img class="${className}" src="${LOGO_SRC}" alt="${BRAND_NAME}" height="${size}" decoding="async" />`;
}
