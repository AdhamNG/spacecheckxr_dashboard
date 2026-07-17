const STORAGE_KEY = 'scxr-dashboard-theme';

/** @typedef {'light' | 'dark'} DashboardTheme */

/** @returns {DashboardTheme} */
export function getDashboardTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export const THEME_CHANGE_EVENT = 'scxr-theme-change';

/** @returns {DashboardTheme} */
export function applyRootTheme(theme) {
  const isLight = theme !== 'dark';
  document.documentElement.classList.toggle('theme-light', isLight);
  document.documentElement.classList.toggle('theme-dark', !isLight);
  try {
    localStorage.setItem(STORAGE_KEY, isLight ? 'light' : 'dark');
  } catch { /* private browsing */ }
  return isLight ? 'light' : 'dark';
}

/**
 * @param {HTMLElement} dashEl
 * @param {DashboardTheme} theme
 * @returns {DashboardTheme}
 */
export function applyDashboardTheme(dashEl, theme) {
  const resolved = applyRootTheme(theme);
  dashEl.classList.toggle('ar-enterprise-shell', resolved === 'light');
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: resolved } }));
  return resolved;
}

/**
 * @param {HTMLElement} dashEl
 * @returns {DashboardTheme}
 */
export function toggleDashboardTheme(dashEl) {
  const next = getDashboardTheme() === 'light' ? 'dark' : 'light';
  return applyDashboardTheme(dashEl, next);
}

function svgWrap(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/** Icon for switching to dark (shown while light theme is active). */
function svgMoon() {
  return svgWrap('<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>');
}

/** Icon for switching to light (shown while dark theme is active). */
function svgSun() {
  return svgWrap(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'
  );
}

/**
 * @param {HTMLButtonElement | null} btn
 * @param {DashboardTheme} theme
 */
export function syncThemeButton(btn, theme) {
  if (!btn) return;
  const isLight = theme === 'light';
  btn.innerHTML = isLight ? svgMoon() : svgSun();
  const label = isLight ? 'Switch to dark theme' : 'Switch to light theme';
  btn.title = label;
  btn.setAttribute('aria-label', label);
}
