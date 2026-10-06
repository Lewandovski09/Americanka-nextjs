// The address players open from Telegram. It must be the address the app
// was INSTALLED from — an installed app only takes over links of its own
// address (and the sign-in lives there too). Set NEXT_PUBLIC_SITE_URL to
// it in Vercel; otherwise Vercel's production address, then the address
// of the current request.
export function publicSiteUrl(request) {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  if (env) return env;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const host = request?.headers.get('x-forwarded-host') || request?.headers.get('host');
  const proto = request?.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : null;
}
