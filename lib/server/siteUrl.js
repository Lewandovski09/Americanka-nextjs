// The main address in links from Telegram: NEXT_PUBLIC_SITE_URL (set in
// Vercel), otherwise Vercel's production address, then the address of the
// current request. (The hand-over page behind the links finds the address
// where the player is signed in — lib/server/openInApp.)
export function publicSiteUrl(request) {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  if (env) return env;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const host = request?.headers.get('x-forwarded-host') || request?.headers.get('host');
  const proto = request?.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : null;
}

