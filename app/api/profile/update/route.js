import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { extractTelegramUsername } from '@/lib/telegram';

export async function POST(request) {
  const { firstName, lastName, city, login, telegramUsername, email } = await request.json();

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const userId = authUser.user.id;

  const normalizedLogin = (login || '').trim().toLowerCase();
  const normalizedTelegram = extractTelegramUsername(telegramUsername || '');
  const normalizedEmail = (email || '').trim().toLowerCase();

  if (!normalizedLogin || !normalizedTelegram || !normalizedEmail || !firstName?.trim() || !lastName?.trim() || !city) {
    return Response.json({ success: false, error: "Заповніть всі поля" }, { status: 400 });
  }

  // Check uniqueness against every OTHER player (exclude self).
  const { data: conflicts } = await supabaseAdmin
    .from('players')
    .select('id, login, telegram_username, email')
    .or(`login.eq.${normalizedLogin},telegram_username.eq.${normalizedTelegram},email.eq.${normalizedEmail}`)
    .neq('id', userId);

  if (conflicts && conflicts.length > 0) {
    const taken = [];
    conflicts.forEach((c) => {
      if (c.login === normalizedLogin) taken.push('логін');
      if (c.telegram_username === normalizedTelegram) taken.push('Telegram нікнейм');
      if (c.email === normalizedEmail) taken.push('email');
    });
    return Response.json(
      { success: false, error: `Вже використовується: ${[...new Set(taken)].join(', ')}` },
      { status: 409 }
    );
  }

  // If the email changed, update it in Supabase Auth too, so login still works.
  const { data: currentProfile } = await supabaseAdmin
    .from('players')
    .select('email')
    .eq('id', userId)
    .single();

  if (currentProfile.email !== normalizedEmail) {
    const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: normalizedEmail,
      email_confirm: true,
    });
    if (authUpdateError) {
      console.error('[update-profile] Auth email update failed:', authUpdateError.message);
      return Response.json({ success: false, error: 'Не вдалося оновити email' }, { status: 500 });
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from('players')
    .update({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      city,
      login: normalizedLogin,
      telegram_username: normalizedTelegram,
      email: normalizedEmail,
    })
    .eq('id', userId);

  if (updateError) {
    console.error('[update-profile] error:', updateError.message);
    return Response.json({ success: false, error: 'Не вдалося оновити профіль' }, { status: 500 });
  }

  return Response.json({ success: true });
}
