import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeLogin, isValidLogin, emailForLogin } from '@/lib/authIdentity';

// Step 2 of registration: create the account.
//
// This only runs once the bot has confirmed the nonce issued by
// /api/auth/register/reserve — so an account can never exist without a
// linked Telegram. The password and photo arrive here for the first
// time, straight from the browser; neither is ever stored anywhere in
// between.

export async function POST(request) {
  // Tracked outside the try so the catch can undo a half-finished
  // registration. Without this, an unexpected throw after createUser
  // left an Auth account with no profile — and since the login maps to
  // exactly one address, that orphan permanently blocked the login.
  let supabaseAdmin = null;
  let createdUserId = null;

  try {
    const {
      nonce,
      firstName,
      lastName,
      city,
      login,
      password,
      gender,
      category,
      photoDataUrl, // base64 data URL from the client file input
    } = await request.json();

    if (!nonce) {
      return Response.json({ success: false, error: 'Немає підтвердження Telegram' }, { status: 400 });
    }
    if (!firstName?.trim() || !lastName?.trim() || !city || !login || !password || !gender || !category) {
      return Response.json({ success: false, error: "Заповніть всі обов'язкові поля" }, { status: 400 });
    }
    if (!photoDataUrl) {
      return Response.json({ success: false, error: "Фото профілю обов'язкове" }, { status: 400 });
    }
    if (password.length < 4) {
      return Response.json({ success: false, error: 'Пароль має містити мінімум 4 символи' }, { status: 400 });
    }

    supabaseAdmin = createAdminClient();
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

    // ── The reservation must exist, be confirmed, and still be alive ──
    const { data: pending, error: pendingError } = await supabaseAdmin
      .from('pending_registrations')
      .select('*')
      .eq('nonce', nonce)
      .maybeSingle();

    if (pendingError) {
      console.error('[register] Reservation lookup failed:', pendingError.message);
      return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
    }

    if (!pending) {
      return Response.json(
        { success: false, error: 'Реєстрацію не знайдено. Почніть спочатку.' },
        { status: 404 }
      );
    }

    if (new Date(pending.expires_at) < new Date()) {
      return Response.json(
        { success: false, error: 'Час реєстрації вичерпано. Почніть спочатку.' },
        { status: 410 }
      );
    }

    if (!pending.confirmed_at || !pending.telegram_user_id) {
      return Response.json(
        { success: false, error: 'Спочатку підтвердіть Telegram — натисніть START у боті' },
        { status: 409 }
      );
    }

    // The login is baked into the reservation the bot confirmed, so it
    // can't be swapped for someone else's at the last moment.
    if (pending.login !== normalizedLogin) {
      return Response.json({ success: false, error: 'Логін не збігається з підтвердженим' }, { status: 409 });
    }

    // ── Uniqueness: login and Telegram account ──
    const [{ data: loginTaken }, { data: telegramTaken }] = await Promise.all([
      supabaseAdmin.from('players').select('id').eq('login', normalizedLogin).limit(1),
      supabaseAdmin.from('players').select('id').eq('telegram_user_id', pending.telegram_user_id).limit(1),
    ]);

    if (loginTaken && loginTaken.length > 0) {
      return Response.json({ success: false, error: 'Цей логін вже зареєстрований' }, { status: 409 });
    }

    if (telegramTaken && telegramTaken.length > 0) {
      return Response.json(
        { success: false, error: 'Цей Telegram вже привʼязаний до іншого акаунта' },
        { status: 409 }
      );
    }

    // ── Create the Supabase Auth user (handles password hashing) ──
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: emailForLogin(normalizedLogin),
      password,
      email_confirm: true, // synthetic address — nothing to actually confirm
    });

    if (authError) {
      console.error('[register] Auth user creation failed:', authError.message);

      // The address is derived from the login, so "email taken" can only
      // mean "login taken" — usually by an orphan from an earlier failed
      // attempt. Say that instead of a generic server error.
      const emailTaken =
        authError.code === 'email_exists' || /already been registered/i.test(authError.message || '');

      return Response.json(
        {
          success: false,
          error: emailTaken ? 'Цей логін вже зареєстрований' : 'Не вдалося створити акаунт',
        },
        { status: emailTaken ? 409 : 500 }
      );
    }

    createdUserId = authUser.user.id;

    // ── Upload the profile photo to Supabase Storage ──
    const photoUrl = await uploadProfilePhoto(supabaseAdmin, createdUserId, photoDataUrl);

    // ── Create the player profile, already linked to Telegram ──
    const { error: profileError } = await supabaseAdmin.from('players').insert({
      id: createdUserId,
      login: normalizedLogin,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      city,
      photo_url: photoUrl,
      gender,
      approval_status: 'pending',
      requested_category: category, // admin sets the real category/elo on approval
      telegram_user_id: pending.telegram_user_id,
      telegram_username: pending.telegram_username,
      telegram_linked_at: pending.confirmed_at,
    });

    if (profileError) {
      console.error('[register] Player profile creation failed:', profileError.message);
      await supabaseAdmin.auth.admin.deleteUser(createdUserId);
      return Response.json({ success: false, error: 'Не вдалося створити профіль' }, { status: 500 });
    }

    // The reservation has done its job. Failing to delete it is
    // harmless — it expires on its own.
    await supabaseAdmin.from('pending_registrations').delete().eq('nonce', nonce);

    return Response.json({ success: true, userId: createdUserId });
  } catch (err) {
    console.error('[register] Unexpected error:', err.message);

    if (createdUserId && supabaseAdmin) {
      const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(createdUserId);
      if (rollbackError) {
        // Worth shouting about: the login stays unusable until someone
        // deletes this account by hand in the Supabase dashboard.
        console.error('[register] ROLLBACK FAILED, orphaned auth user:', createdUserId, rollbackError.message);
      } else {
        console.log('[register] Rolled back orphaned auth user:', createdUserId);
      }
    }

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
