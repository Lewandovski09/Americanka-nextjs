import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request) {
  // telegramUsername is deliberately NOT accepted any more: it is
  // written from what Telegram reports on every interaction, so letting
  // the profile form overwrite it would just be silently undone.
  const { firstName, lastName, city, login, email } = await request.json();

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const userId = authUser.user.id;

  const normalizedLogin = (login || '').trim().toLowerCase();
  const normalizedEmail = (email || '').trim().toLowerCase();

  if (!normalizedLogin || !normalizedEmail || !firstName?.trim() || !lastName?.trim() || !city) {
    return Response.json({ success: false, error: "Заповніть всі поля" }, { status: 400 });
  }

  // Check uniqueness against every OTHER player (exclude self).
  // Two .eq() queries instead of one interpolated .or(): a comma or dot
  // in the login/email used to leak into PostgREST's filter syntax.
  const [{ data: loginConflicts }, { data: emailConflicts }] = await Promise.all([
    supabaseAdmin.from('players').select('id').eq('login', normalizedLogin).neq('id', userId),
    supabaseAdmin.from('players').select('id').eq('email', normalizedEmail).neq('id', userId),
  ]);

  const taken = [];
  if (loginConflicts && loginConflicts.length > 0) taken.push('логін');
  if (emailConflicts && emailConflicts.length > 0) taken.push('email');

  if (taken.length > 0) {
    return Response.json(
      { success: false, error: `Вже використовується: ${taken.join(', ')}` },
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
      email: normalizedEmail,
    })
    .eq('id', userId);

  if (updateError) {
    console.error('[update-profile] error:', updateError.message);
    return Response.json({ success: false, error: 'Не вдалося оновити профіль' }, { status: 500 });
  }

  return Response.json({ success: true });
}
