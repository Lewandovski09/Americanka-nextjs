import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteAddresses } from '@/lib/server/openInApp';

// The installed app reports the address it runs on (components/RegisterSW),
// so the bot can link this player to it (migration 065). The address is
// the one this request came to — not something the browser can make up —
// and must be one of the site's own.
export async function POST(request) {
  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) return Response.json({ success: false }, { status: 401 });

  const origin = new URL(request.url).origin;
  const host = request.headers.get('x-forwarded-host');
  const real = host ? `https://${host}` : origin;
  if (!siteAddresses().includes(real)) return Response.json({ success: false, error: 'unknown address' }, { status: 400 });

  const { error } = await createAdminClient()
    .from('users')
    .update({ app_origin: real, app_origin_at: new Date().toISOString() })
    .eq('id', authUser.user.id);
  if (error) {
    // before migration 065 — nothing to store yet
    console.error('[app-origin]', error.message);
    return Response.json({ success: false }, { status: 500 });
  }
  return Response.json({ success: true });
}
