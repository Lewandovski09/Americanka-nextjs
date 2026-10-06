import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

export async function POST(request, { params }) {
  const { playerId } = params;

  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: caller } = await adminRow(supabaseAdmin, authUser.user.id);

  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін може відхиляти заявки' }, { status: 403 });
  }

  // The login, read before the row disappears — it goes back in the
  // response so the admin sees who was actually deleted.
  const { data: target } = await supabaseAdmin
    .from('users')
    .select('login, is_admin')
    .eq('id', playerId)
    .maybeSingle();

  if (!target) {
    return Response.json({ success: false, error: 'Гравця не знайдено' }, { status: 404 });
  }
  // An admin account is never deleted from here (a mis-tap would lock
  // the club out of its own admin).
  if (target.is_admin) {
    return Response.json({ success: false, error: 'Адміністратора не можна видалити звідси' }, { status: 400 });
  }

  // Deleting the auth user cascades to the players row (FK with ON DELETE
  // CASCADE), so this is the whole rejection: no row is left behind.
  const { error } = await supabaseAdmin.auth.admin.deleteUser(playerId);

  if (error) {
    console.error('[reject-player] delete failed:', error.message);
    return Response.json(
      {
        success: false,
        // Surfaced verbatim: the usual cause is the player already having
        // tournament history, and the admin needs to know that.
        error: `Не вдалося видалити гравця: ${error.message}`,
      },
      { status: 500 }
    );
  }

  return Response.json({ success: true, deleted: target.login });
}
