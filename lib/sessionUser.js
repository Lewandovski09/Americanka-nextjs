// Who is calling — read from the Supabase session cookie WITHOUT a
// network call, for the rate limiter only (middleware.js). On a
// tournament day the whole beach shares one Wi-Fi (one address), so the
// limits are counted per player, not per address.
//
// Not a security check: the token is not verified here (the API routes
// verify it themselves). A forged cookie only gets its own counter —
// and middleware still keeps a roomy ceiling per address on top.
// Pure, Edge-safe (atob only) — see sessionUser.test.

/**
 * The session cookie's value: `sb-<ref>-auth-token`, or its chunks
 * `.0`, `.1`, … joined in order (@supabase/ssr splits long cookies).
 * @param {{ name: string, value: string }[]} cookies
 * @returns {string | null}
 */
export function sessionCookieValue(cookies) {
  const auth = (cookies || []).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name) && c.value);
  if (auth.length === 0) return null;
  const whole = auth.find((c) => /-auth-token$/.test(c.name));
  if (whole) return whole.value;
  return auth
    .map((c) => ({ i: Number(c.name.split('.').pop()), v: c.value }))
    .sort((a, b) => a.i - b.i)
    .map((c) => c.v)
    .join('');
}

function b64urlDecode(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = t.length % 4 ? '='.repeat(4 - (t.length % 4)) : '';
  const bin = atob(t + pad);
  // UTF-8 safe
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * The player's id (the JWT «sub»), or null when there is no readable session.
 * @param {{ name: string, value: string }[]} cookies
 * @returns {string | null}
 */
export function sessionUserId(cookies) {
  try {
    let raw = sessionCookieValue(cookies);
    if (!raw) return null;
    raw = decodeURIComponent(raw);
    const json = raw.startsWith('base64-') ? b64urlDecode(raw.slice(7)) : raw;
    const session = JSON.parse(json);
    const token = Array.isArray(session) ? session[0] : session?.access_token;
    if (typeof token !== 'string') return null;
    const payload = JSON.parse(b64urlDecode(token.split('.')[1] || ''));
    const sub = payload?.sub;
    return typeof sub === 'string' && /^[0-9a-f-]{36}$/i.test(sub) ? sub : null;
  } catch {
    return null;
  }
}
