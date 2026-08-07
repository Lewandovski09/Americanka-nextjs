// The single source of truth for how a login maps to a Supabase Auth
// account.
//
// There is no real email in this app any more — Telegram is the only
// contact channel. But Supabase Auth identifies accounts by email, so we
// derive a stable synthetic one from the login. The domain is fictional;
// nothing is ever sent to it.
//
// Because the mapping is a pure function, the login is immutable by
// design: changing it would point at a different Auth account and lock
// the player out. The profile form therefore does not offer it, and
// nothing server-side updates it.

export const SYNTHETIC_EMAIL_DOMAIN = 'americanka.app';

// The login doubles as an email local-part, so it has to stay inside the
// characters that are safe there. Enforced at registration — previously
// there was no validation at all, and a login with a space or a Cyrillic
// letter would fail deep inside Supabase with an unhelpful error.
export const LOGIN_PATTERN = /^[a-z0-9._-]{3,32}$/;

export function normalizeLogin(login: string | null | undefined): string {
  return String(login || '').trim().toLowerCase();
}

export function isValidLogin(login: string | null | undefined): boolean {
  return LOGIN_PATTERN.test(normalizeLogin(login));
}

export function emailForLogin(login: string | null | undefined): string {
  return `${normalizeLogin(login)}@${SYNTHETIC_EMAIL_DOMAIN}`;
}
