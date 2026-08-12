import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

// Step 1 of recovery: hand back a nonce for the Telegram deep link.
// Nobody is identified yet — that only happens once the bot confirms
// which Telegram account is doing this, and the account it maps to is
// looked up by telegram_user_id at the very end (see complete/route.js).

const RESET_TTL_MS = 10 * 60 * 1000; // matches the SSE watch route's own cap

export async function POST() {
  const supabaseAdmin = createAdminClient();

  // Clear expired attempts so the table doesn't grow forever — same
  // housekeeping pattern as register/reserve/route.js.
  await supabaseAdmin.from('password_resets').delete().lt('expires_at', new Date().toISOString());

  const nonce = randomUUID();

  const { error } = await supabaseAdmin.from('password_resets').insert({
    nonce,
    expires_at: new Date(Date.now() + RESET_TTL_MS).toISOString(),
  });

  if (error) {
    console.error('[reset-password-start] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося почати відновлення' }, { status: 500 });
  }

  return Response.json({ success: true, nonce });
}
