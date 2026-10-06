// Who is calling — without a round trip to Supabase Auth.
//
// Every button of the app ends in an API route, and every route first
// asked Supabase «who is this?» (auth.getUser()) — a network call of its
// own, a few hundred milliseconds before any real work started. The
// answer is already in the request: the session's access token is a JWT
// signed by Supabase. It is checked here, on our server:
//   • asymmetric signing keys (ES256 / RS256) — the project's public keys
//     from …/auth/v1/.well-known/jwks.json, fetched once and kept;
//   • the legacy shared secret (HS256) — only if SUPABASE_JWT_SECRET is
//     set in the environment.
// The signature, the expiry, the audience and the issuer must all match.
// If the token can't be checked here, or doesn't pass, it falls back to
// the old auth.getUser() — never to trusting an unchecked token.
//
// Same shape as auth.getUser(): { data: { user: { id } | null } }.

import crypto from 'crypto';

const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache = { at: 0, keys: null, pending: null };

function b64urlToBuffer(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodePart(s) {
  try {
    return JSON.parse(b64urlToBuffer(s).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Checks a JWT. Returns its claims when the signature and the claims are
 * good, `false` when it is definitely bad, `null` when it can't be
 * checked here (unknown key / algorithm) — the caller then asks Supabase.
 * Pure: keys and settings come in as arguments (see authUser.test).
 * @param {string} token
 * @param {{ jwks?: any[], secret?: string | null, issuer?: string | null, now?: number }} [opts]
 * @returns {any}
 */
export function verifyJwt(token, { jwks = [], secret = null, issuer = null, now = Date.now() } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const [h, p, sig] = parts;
  const header = decodePart(h);
  const claims = decodePart(p);
  if (!header || !claims) return false;
  const data = Buffer.from(`${h}.${p}`);
  const signature = b64urlToBuffer(sig);

  let ok;
  try {
    if (header.alg === 'HS256') {
      if (!secret) return null;
      const expected = crypto.createHmac('sha256', secret).update(data).digest();
      ok = expected.length === signature.length && crypto.timingSafeEqual(expected, signature);
    } else if (header.alg === 'ES256' || header.alg === 'RS256') {
      const jwk = jwks.find((k) => k.kid === header.kid && (!k.alg || k.alg === header.alg));
      if (!jwk) return null;
      const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      ok =
        header.alg === 'ES256'
          ? crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, signature)
          : crypto.verify('RSA-SHA256', data, key, signature);
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (!ok) return false;

  const nowSec = Math.floor(now / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= nowSec) return false;
  if (typeof claims.nbf === 'number' && claims.nbf > nowSec + 30) return false;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes('authenticated')) return false;
  if (claims.role && claims.role !== 'authenticated') return false;
  if (issuer && claims.iss && claims.iss !== issuer) return false;
  if (!claims.sub) return false;
  return claims;
}

async function projectJwks() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return [];
  if (jwksCache.keys && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  if (!jwksCache.pending) {
    jwksCache.pending = (async () => {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${base.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`, {
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' },
          signal: controller.signal,
        });
        clearTimeout(t);
        const json = res.ok ? await res.json() : null;
        jwksCache = { at: Date.now(), keys: Array.isArray(json?.keys) ? json.keys : [], pending: null };
      } catch {
        jwksCache = { at: Date.now(), keys: [], pending: null };
      }
      return jwksCache.keys;
    })();
  }
  return jwksCache.pending;
}

/** `supabase` — the request's server client (lib/supabase/server). */
export async function getAuthUser(supabase) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) {
      const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
      const header = decodePart(token.split('.')[0] || '');
      const jwks = header?.alg === 'HS256' ? [] : await projectJwks();
      const claims = verifyJwt(token, {
        jwks,
        secret: process.env.SUPABASE_JWT_SECRET || null,
        issuer: base ? `${base}/auth/v1` : null,
      });
      if (claims) return { data: { user: { id: claims.sub } }, error: null };
      // false / null — not trusted here; Supabase decides below.
    }
  } catch {
    // fall through to the network check
  }
  return supabase.auth.getUser();
}

// «Is this user an admin?» — asked by almost every admin button. The
// answer is kept for 30 s per server instance, so a run of taps doesn't
// pay a database round trip each. (Taking admin rights away therefore
// takes effect within half a minute.) Same shape as the query it
// replaces: { data: { is_admin } | null }.
const ADMIN_TTL_MS = 30 * 1000;
const adminCache = new Map();

export async function adminRow(supabaseAdmin, userId) {
  if (!userId) return { data: null };
  const hit = adminCache.get(userId);
  if (hit && Date.now() - hit.at < ADMIN_TTL_MS) return { data: { is_admin: hit.isAdmin } };
  const res = await supabaseAdmin.from('users').select('is_admin').eq('id', userId).maybeSingle();
  if (!res.error && res.data) adminCache.set(userId, { at: Date.now(), isAdmin: !!res.data.is_admin });
  return res;
}
