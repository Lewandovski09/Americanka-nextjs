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

/**
 * The address this player's installed app came from (users.app_origin,
 * migration 065), if it is one of the site's own — links in their
 * personal Telegram messages use it, so Telegram on Android opens them
 * straight in the app. null before the migration or when unknown.
 */
export async function playerAppOrigin(supabaseAdmin, userId, allowed) {
  if (!userId) return null;
  try {
    const { data, error } = await supabaseAdmin.from('users').select('app_origin').eq('id', userId).maybeSingle();
    if (error || !data?.app_origin) return null;
    return allowed.includes(data.app_origin) ? data.app_origin : null;
  } catch {
    return null;
  }
}
