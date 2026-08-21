import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const LINK_TTL_MS = 30 * 60 * 1000;

// Issues a fresh deep-link nonce for the logged-in player. Needed
// whenever the one from registration expired, or a player unlinked
// (blocked the bot) and wants back in — without this, an expired link
// is a dead end.
export async function POST() {
  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();

  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const nonce = randomUUID();

  const { error } = await supabaseAdmin.from('telegram_links').insert({
    nonce,
    user_id: authUser.user.id,
    expires_at: new Date(Date.now() + LINK_TTL_MS).toISOString(),
  });

  if (error) {
    console.error('[telegram-link-new] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося створити посилання' }, { status: 500 });
  }

  return Response.json({ success: true, nonce });
}
