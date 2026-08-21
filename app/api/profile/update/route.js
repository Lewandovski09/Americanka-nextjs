import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Editable profile fields are deliberately just the display ones.
//
// - login is permanent: the Supabase Auth address is derived from it
//   (lib/authIdentity.js), so changing it would point at a different
//   account and lock the player out.
// - telegram_username comes from Telegram on every bot interaction, so
//   accepting it here would only be overwritten.
// - email no longer exists as a column at all.
//
// That leaves nothing unique to check, so this route can't conflict.
export async function POST(request) {
  const { firstName, lastName, city } = await request.json();

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  if (!firstName?.trim() || !lastName?.trim() || !city) {
    return Response.json({ success: false, error: 'Заповніть всі поля' }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      city,
    })
    .eq('id', authUser.user.id);

  if (updateError) {
    console.error('[update-profile] error:', updateError.message);
    return Response.json({ success: false, error: 'Не вдалося оновити профіль' }, { status: 500 });
  }

  return Response.json({ success: true });
}
