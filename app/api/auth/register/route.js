import { createAdminClient } from '@/lib/supabase/admin';
import { extractTelegramUsername } from '@/lib/telegram';

export async function POST(request) {
  try {
    const {
      fullName,
      login,
      password,
      telegramUsername,
      gender,
      category,
      photoDataUrl, // base64 data URL from the client file input
    } = await request.json();

    if (!fullName || !login || !password || !telegramUsername || !gender || !category) {
      return Response.json({ success: false, error: "Заповніть всі обов'язкові поля" }, { status: 400 });
    }
    if (!photoDataUrl) {
      return Response.json({ success: false, error: "Фото профілю обов'язкове" }, { status: 400 });
    }
    if (password.length < 4) {
      return Response.json({ success: false, error: 'Пароль має містити мінімум 4 символи' }, { status: 400 });
    }

    const supabaseAdmin = createAdminClient();
    const normalizedLogin = login.trim().toLowerCase();
    const normalizedTelegram = extractTelegramUsername(telegramUsername);
    // Registration is Telegram-only now — there's no real email to
    // collect or verify, but Supabase Auth still needs *some* email
    // to identify the account internally, so we synthesize one from
    // the (already-unique) login.
    const normalizedEmail = `${normalizedLogin}@americanka.app`;

    // ── Uniqueness checks (login, telegram username) ──
    const { data: existing } = await supabaseAdmin
      .from('players')
      .select('id')
      .or(`login.eq.${normalizedLogin},telegram_username.eq.${normalizedTelegram}`)
      .limit(1);

    if (existing && existing.length > 0) {
      return Response.json(
        { success: false, error: 'Логін або Telegram вже зареєстровані' },
        { status: 409 }
      );
    }

    // ── Create the Supabase Auth user (handles password hashing) ──
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true, // synthetic address — nothing to actually confirm
    });

    if (authError) {
      console.error('[register] Auth user creation failed:', authError.message);
      return Response.json({ success: false, error: 'Не вдалося створити акаунт' }, { status: 500 });
    }

    const userId = authUser.user.id;

    // ── Upload the profile photo to Supabase Storage ──
    const photoUrl = await uploadProfilePhoto(supabaseAdmin, userId, photoDataUrl);

    // ── Create the player profile row ──
    const initials = fullName
      .split(' ')
      .map((w) => w[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase();

    const { error: profileError } = await supabaseAdmin.from('players').insert({
      id: userId,
      login: normalizedLogin,
      full_name: fullName,
      telegram_username: normalizedTelegram,
      email: normalizedEmail,
      photo_url: photoUrl,
      gender,
      approval_status: 'pending',
      requested_category: category, // what the player asked for; admin sets the real category/elo on approval
    });

    if (profileError) {
      console.error('[register] Player profile creation failed:', profileError.message);
      // Roll back the auth user so we don't leave an orphaned account.
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return Response.json({ success: false, error: 'Не вдалося створити профіль' }, { status: 500 });
    }

    return Response.json({ success: true, userId, email: normalizedEmail });
  } catch (err) {
    console.error('[register] Unexpected error:', err.message);
    return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
  }
}

async function uploadProfilePhoto(supabaseAdmin, userId, dataUrl) {
  const matches = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!matches) return null;

  const mimeType = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');
  const ext = mimeType.split('/')[1] || 'jpg';
  const path = `${userId}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from('player-photos')
    .upload(path, buffer, { contentType: mimeType, upsert: true });

  if (error) {
    console.error('[register] Photo upload failed:', error.message);
    return null;
  }

  const { data: publicUrlData } = supabaseAdmin.storage.from('player-photos').getPublicUrl(path);
  return publicUrlData.publicUrl;
}
