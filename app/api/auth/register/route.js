import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeLogin, isValidLogin, emailForLogin } from '@/lib/authIdentity';

// How long the user has to tap through to the bot and press Start
// before the link goes stale. Generous on purpose — people get
// interrupted mid-registration.
const LINK_TTL_MS = 30 * 60 * 1000;

export async function POST(request) {
  // Tracked outside the try so the catch below can undo a half-finished
  // registration. Without this, any unexpected throw after createUser
  // left an Auth account with no profile — and since the login maps to
  // exactly one address, that orphan permanently blocked the login with
  // a misleading "не вдалося створити акаунт".
  let supabaseAdmin = null;
  let createdUserId = null;

  try {
    const {
      firstName,
      lastName,
      city,
      login,
      password,
      gender,
      category,
      photoDataUrl, // base64 data URL from the client file input
    } = await request.json();

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

    // The login is permanent: it's the only thing the Auth account
    // address is derived from, so it can never be edited afterwards.
    if (!isValidLogin(normalizedLogin)) {
      return Response.json(
        {
          success: false,
          error: 'Логін: 3–32 символи, лише латинські літери, цифри, точка, дефіс або підкреслення',
        },
        { status: 400 }
      );
    }

    // Telegram is no longer part of this payload: the account is created
    // first, then linked when the player presses Start on the bot with
    // the nonce we hand back below. Nothing about their Telegram is
    // typed by hand any more.
    const syntheticEmail = emailForLogin(normalizedLogin);

    // ── Uniqueness check ──
    // A plain .eq() rather than the old interpolated .or() filter: a
    // comma or dot in the login used to leak into PostgREST's filter
    // syntax and change the query.
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('players')
      .select('id')
      .eq('login', normalizedLogin)
      .limit(1);

    if (lookupError) {
      console.error('[register] Login lookup failed:', lookupError.message);
      return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
    }

    if (existing && existing.length > 0) {
      return Response.json({ success: false, error: 'Цей логін вже зареєстрований' }, { status: 409 });
    }

    // ── Create the Supabase Auth user (handles password hashing) ──
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: syntheticEmail,
      password,
      email_confirm: true, // synthetic address — nothing to actually confirm
    });

    if (authError) {
      console.error('[register] Auth user creation failed:', authError.message);

      // The address is derived from the login, so "this email is taken"
      // can only mean "this login is taken" — most often by an orphaned
      // Auth user left behind by an earlier failed attempt. Say so
      // instead of the generic message, which sent people hunting for a
      // server problem that isn't there.
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
    const userId = createdUserId;

    // ── Upload the profile photo to Supabase Storage ──
    const photoUrl = await uploadProfilePhoto(supabaseAdmin, userId, photoDataUrl);

    // ── Create the player profile row (full_name is generated in DB) ──
    const { error: profileError } = await supabaseAdmin.from('players').insert({
      id: userId,
      login: normalizedLogin,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      city,
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

    // ── Issue the one-time Telegram link ──
    const nonce = randomUUID();
    const { error: linkError } = await supabaseAdmin.from('telegram_links').insert({
      nonce,
      player_id: userId,
      expires_at: new Date(Date.now() + LINK_TTL_MS).toISOString(),
    });

    if (linkError) {
      // Non-fatal: the account is complete and usable. Report success
      // without a nonce — the client signs in and the "Підключіть
      // Telegram" banner on the home page offers a fresh link. Failing
      // here used to strand the player on an account they had never
      // signed into and could no longer register again.
      console.error('[register] Failed to create telegram link:', linkError.message);
      return Response.json({ success: true, userId, nonce: null });
    }

    return Response.json({ success: true, userId, nonce });
  } catch (err) {
    console.error('[register] Unexpected error:', err.message);

    if (createdUserId && supabaseAdmin) {
      const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(createdUserId);
      if (rollbackError) {
        // Worth shouting about: the login is now unusable until someone
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
