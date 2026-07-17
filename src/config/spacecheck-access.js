/**
 * Dashboard gate + MultiSet map credentials (bundled for this deployment).
 * For production hardening, move secrets to a backend or env-based build.
 */
export const SPACE_CHECK_LOGIN = {
  email: 'admin@spacecheck.com',
  password: 'Admin@2026',
};

/** Change this in one place to retarget owner-scoped data. */
export const SPACE_CHECK_OWNER = 'suhas';

export const MULTISET_MAP = {
  mapCode: 'MAP_RGGIXTQWDOX1',
  clientId: '8e7c420c-8b17-44e7-97ba-906b71437ab6',
  clientSecret: 'b7daf09562ed1d0ac925db66a6e6a61d16202c71d6e078f82615e20272f728e9',
};

export function isSpaceCheckLogin(email, password) {
  const e = String(email ?? '').trim().toLowerCase();
  const p = String(password ?? '');
  return e === SPACE_CHECK_LOGIN.email.toLowerCase() && p === SPACE_CHECK_LOGIN.password;
}
