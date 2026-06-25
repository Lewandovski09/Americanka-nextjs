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

  await supabaseAdmin.from('admin_actions').insert({
    admin_id: authUser.user.id,
    action_type: 'reject_player',
    target_player_id: playerId,
  });

  // Deleting the auth user cascades to the players row (FK with ON DELETE CASCADE).
  const { error } = await supabaseAdmin.auth.admin.deleteUser(playerId);

  if (error) {
    console.error('[reject-player] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося видалити гравця' }, { status: 500 });
  }

  return Response.json({ success: true });
}
