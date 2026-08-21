import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request, { params }) {
  const { playerId } = params;

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: caller } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', authUser.user.id)
    .maybeSingle();

  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін може відхиляти заявки' }, { status: 403 });
  }

  // The login, read before the row disappears — it goes back in the
  // response so the admin sees who was actually deleted.
  const { data: target } = await supabaseAdmin
    .from('players')
    .select('login')
    .eq('id', playerId)
    .maybeSingle();

  if (!target) {
    return Response.json({ success: false, error: 'Гравця не знайдено' }, { status: 404 });
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
