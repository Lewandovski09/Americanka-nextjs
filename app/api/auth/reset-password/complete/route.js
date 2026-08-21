import { createAdminClient } from '@/lib/supabase/admin';

// Step 3 (final): the browser already saw `confirmed: true` from the
// watch route. This is the only place that actually looks up WHICH
// player the confirmed Telegram account belongs to and changes
// anything — see password_resets migration for why that lookup is
// deferred this late rather than done at confirm time.

export async function POST(request) {
  try {
    const { nonce, newPassword } = await request.json();

    if (!nonce || typeof newPassword !== 'string' || newPassword.length < 6) {
      return Response.json(
        { success: false, error: 'Пароль має бути щонайменше 6 символів' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createAdminClient();

    const { data: reset, error: resetError } = await supabaseAdmin
      .from('password_resets')
      .select('confirmed_at, expires_at, telegram_user_id')
      .eq('nonce', nonce)
      .maybeSingle();

    if (resetError) {
      console.error('[reset-password-complete] lookup failed:', resetError.message);
      return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
    }
    if (!reset || !reset.confirmed_at) {
      return Response.json({ success: false, error: 'Telegram ще не підтверджено' }, { status: 400 });
    }
    if (new Date(reset.expires_at) < new Date()) {
      return Response.json({ success: false, error: 'Посилання застаріло' }, { status: 400 });
    }

    const { data: player, error: playerError } = await supabaseAdmin
      .from('users')
      .select('id, login')
      .eq('telegram_user_id', reset.telegram_user_id)
      .maybeSingle();

    if (playerError) {
      console.error('[reset-password-complete] player lookup failed:', playerError.message);
      return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
    }
    if (!player) {
      // The account existed at confirm time but was deleted since —
      // extremely unlikely, but a real account is required to set a
      // password on.
      return Response.json({ success: false, error: 'Акаунт не знайдено' }, { status: 404 });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(player.id, {
      password: newPassword,
    });

    if (updateError) {
      console.error('[reset-password-complete] password update failed:', updateError.message);
      return Response.json({ success: false, error: 'Не вдалося встановити пароль' }, { status: 500 });
    }

    // One-time: this nonce cannot be replayed to set the password
    // again once the person has what they came for.
    await supabaseAdmin.from('password_resets').delete().eq('nonce', nonce);

    return Response.json({ success: true, login: player.login });
  } catch (err) {
    console.error('[reset-password-complete] Unexpected error:', err.message);
    return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
  }
}
