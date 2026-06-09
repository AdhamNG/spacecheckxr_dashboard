/**
 * Corporate glass login — validates SpaceCheck XR admin, then loads dashboard.
 */

import { BRAND_NAME, brandLogoHtml } from '../config/brand.js';
import { getOwnerSlug } from '../config/owner-scope.js';
import { MULTISET_MAP } from '../config/spacecheck-access.js';
import { authenticateAdminLogin } from '../services/supabase.js';
import { iconEye, iconEyeOff } from './icons.js';

/**
 * @param {HTMLElement} container
 * @param {(creds: { clientId: string; clientSecret: string; mapCode: string; ownerSlug: string }) => void} onSubmit
 */
export function renderForm(container, onSubmit) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay form-overlay form-overlay--glass';
  overlay.id = 'form-overlay';

  overlay.innerHTML = `
    <div class="form-card float-glass">
      <div class="form-brand">${brandLogoHtml('brand-logo brand-logo--login', 128)}</div>
      <h1 class="form-brand-title">${BRAND_NAME}</h1>
      <p class="form-error hidden" id="login-error" role="alert"></p>
      <form id="cred-form" autocomplete="on">
        <div class="form-group">
          <label for="login-username">Username</label>
          <input id="login-username" name="username" type="text" autocomplete="username" required />
        </div>
        <div class="form-group">
          <label for="login-password">Password</label>
          <div class="password-field">
            <input id="login-password" name="password" type="password" autocomplete="current-password" required />
            <button type="button" class="password-toggle" id="password-toggle" aria-label="Show password" aria-pressed="false" title="Show password">
              ${iconEye()}
            </button>
          </div>
        </div>
        <button type="submit" class="btn-start" id="btn-start">Sign in</button>
      </form>
    </div>
  `;

  container.appendChild(overlay);

  const form = overlay.querySelector('#cred-form');
  const errEl = overlay.querySelector('#login-error');
  const btnStart = overlay.querySelector('#btn-start');
  const passwordInput = overlay.querySelector('#login-password');
  const passwordToggle = overlay.querySelector('#password-toggle');
  const defaultOwnerSlug = getOwnerSlug() || '';
  const defaultMapCode = MULTISET_MAP.mapCode || '';

  function setError(msg) {
    if (!msg) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
      return;
    }
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
  }

  passwordToggle.addEventListener('click', () => {
    const isVisible = passwordInput.type === 'text';
    passwordInput.type = isVisible ? 'password' : 'text';
    passwordToggle.setAttribute('aria-pressed', String(!isVisible));
    passwordToggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
    passwordToggle.title = isVisible ? 'Show password' : 'Hide password';
    passwordToggle.innerHTML = isVisible ? iconEye() : iconEyeOff();
    passwordInput.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    const username = form.querySelector('#login-username').value.trim();
    const password = form.querySelector('#login-password').value;
    btnStart.disabled = true;
    btnStart.textContent = 'Signing in…';
    try {
      const loginData = await authenticateAdminLogin({
        username,
        password,
      });
      if (!loginData) {
        setError('Invalid username or password.');
        btnStart.disabled = false;
        btnStart.textContent = 'Sign in';
        return;
      }
      const ownerSlug = loginData.ownername || defaultOwnerSlug;
      const mapCode = loginData.mapcode || defaultMapCode;
      if (!ownerSlug || !mapCode) {
        setError('Login row is missing owner or map code.');
        btnStart.disabled = false;
        btnStart.textContent = 'Sign in';
        return;
      }
      onSubmit({
        clientId: MULTISET_MAP.clientId,
        clientSecret: MULTISET_MAP.clientSecret,
        mapCode,
        ownerSlug,
      });
    } catch (err) {
      setError(`Login check failed: ${String(err?.message ?? err)}`);
      btnStart.disabled = false;
      btnStart.textContent = 'Sign in';
    }
  });

  return {
    hide() {
      overlay.style.pointerEvents = 'none';
      overlay.style.visibility = 'hidden';
      overlay.style.display = 'none';
      overlay.style.opacity = '0';
      overlay.classList.add('hidden');
    },
    show() {
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';
      overlay.style.visibility = 'visible';
      overlay.style.pointerEvents = 'auto';
      overlay.style.opacity = '1';
      overlay.style.transition = '';
      btnStart.disabled = false;
      btnStart.textContent = 'Sign in';
      setError('');
    },
    disable() {
      btnStart.disabled = true;
    },
    enable() {
      btnStart.disabled = false;
    },
    setError,
  };
}
