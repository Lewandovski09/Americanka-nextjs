import { createAdminClient } from '@/lib/supabase/admin';
import { extractTelegramUsername } from '@/lib/telegram';

// Checks login/email/Telegram username uniqueness BEFORE the user
// goes through Telegram + email verification, so they find out
// about a conflict immediately instead of after wasting time on
// both verification steps.
export async function POST(request) {
  try {
    const { login, telegramUsername } = await request.json();

    const supabaseAdmin = createAdminClient();
    const normalizedLogin = (login || '').trim().toLowerCase();
    const normalizedTelegram = extractTelegramUsername(telegramUsername || '');

    const { data: existing, error } = await supabaseAdmin
      .from('players')
      .select('login, telegram_username')
      .or(`login.eq.${normalizedLogin},telegram_username.eq.${normalizedTelegram}`);

    if (error) {
      console.error('[check-availability] error:', error.message);
      return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
    }

    const conflicts = [];
    (existing || []).forEach((p) => {
      if (p.login === normalizedLogin) conflicts.push('логін');
      if (p.telegram_username === normalizedTelegram) conflicts.push('Telegram нікнейм');
    });

    if (conflicts.length > 0) {
      return Response.json({
        success: false,
        error: `Вже зареєстровано: ${conflicts.join(', ')}`,
      });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('[check-availability] Unexpected error:', err.message);
    return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
  }
}
