const SESSION_STORAGE_KEY = 'spacecheckxr.dashboardSession.v1';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

function storage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function validFutureTime(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > Date.now();
}

export function isStoredTokenUsable(expiresAt) {
  const n = Number(expiresAt);
  return Number.isFinite(n) && n > Date.now() + TOKEN_REFRESH_BUFFER_MS;
}

export function loadDashboardSession() {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!validFutureTime(session?.sessionExpiresAt)) {
      clearDashboardSession();
      return null;
    }
    if (!session?.ownerSlug || !session?.mapCode) {
      clearDashboardSession();
      return null;
    }
    return session;
  } catch {
    clearDashboardSession();
    return null;
  }
}

export function saveDashboardSession({
  ownerSlug,
  mapCode,
  token,
  tokenExpiresAt = 0,
  sessionExpiresAt = Date.now() + SESSION_DURATION_MS,
}) {
  const s = storage();
  if (!s || !ownerSlug || !mapCode) return;
  const session = {
    ownerSlug,
    mapCode,
    token: token || '',
    tokenExpiresAt: Number(tokenExpiresAt) || 0,
    sessionExpiresAt,
    savedAt: Date.now(),
  };
  try {
    s.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* Ignore storage failures; the current login still proceeds. */
  }
}

export function clearDashboardSession() {
  const s = storage();
  if (!s) return;
  s.removeItem(SESSION_STORAGE_KEY);
}
