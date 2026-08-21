import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeLogin, isValidLogin } from '@/lib/authIdentity';

// Step 1 of registration: reserve the login and hand back a nonce for
// the Telegram deep link. No account exists yet — that happens in
// /api/auth/register once the bot has confirmed this nonce.

const RESERVATION_TTL_MS = 30 * 60 * 1000;

export async function POST(request) {
  try {
    const { login } = await request.json();
    const normalizedLogin = normalizeLogin(login);

    if (!isValidLogin(normalizedLogin)) {
      return Response.json(
        {
          success: false,
          error: 'Логін: 3–32 символи, лише латинські літери, цифри, точка, дефіс або підкреслення',
        },
        { status: 400 }
      );
    }

    const supabaseAdmin = createAdminClient();

    const { data: existingPlayer, error: lookupError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('login', normalizedLogin)
      .limit(1);

    if (lookupError) {
      console.error('[reserve] Login lookup failed:', lookupError.message);
      return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
    }

    if (existingPlayer && existingPlayer.length > 0) {
      return Response.json({ success: false, error: 'Цей логін вже зареєстрований' }, { status: 409 });
    }

    // Clear expired reservations so an abandoned attempt can't hold a
    // login hostage for the rest of time.
    await supabaseAdmin
      .from('pending_registrations')
      .delete()
      .lt('expires_at', new Date().toISOString());

    // Drop any live reservation for this same login before making a new
    // one. In practice this is the same person retrying — starting over
    // has to work, and a reservation grants nothing on its own.
    await supabaseAdmin.from('pending_registrations').delete().eq('login', normalizedLogin);

    const nonce = randomUUID();

    const { error: insertError } = await supabaseAdmin.from('pending_registrations').insert({
      nonce,
      login: normalizedLogin,
      expires_at: new Date(Date.now() + RESERVATION_TTL_MS).toISOString(),
    });

    if (insertError) {
      console.error('[reserve] Failed to create reservation:', insertError.message);
      return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
    }

    return Response.json({ success: true, nonce });
  } catch (err) {
    console.error('[reserve] Unexpected error:', err.message);
    return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
  }
}
