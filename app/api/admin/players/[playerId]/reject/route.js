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

  // Grab the details for the audit trail before the row disappears.
  const { data: target } = await supabaseAdmin
    .from('players')
    .select('login, full_name')
    .eq('id', playerId)
    .maybeSingle();

  if (!target) {
    return Response.json({ success: false, error: 'Гравця не знайдено' }, { status: 404 });
  }

  // Deleting the auth user cascades to the players row (FK with ON DELETE
  // CASCADE). This has to happen BEFORE the audit row is written:
  // admin_actions.target_player_id points at players, so logging first
  // made the delete fail on that very reference — which is why rejecting
  // silently did nothing.
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

  // Player-independent audit record — the id is kept in details rather
  // than as a foreign key, since the row it pointed to is now gone.
  const { error: auditError } = await supabaseAdmin.from('admin_actions').insert({
    admin_id: authUser.user.id,
    action_type: 'reject_player',
    details: { player_id: playerId, login: target.login, full_name: target.full_name },
  });

  if (auditError) {
    // Non-fatal: the player is already deleted, which is what was asked.
    console.error('[reject-player] audit insert failed:', auditError.message);
  }

  return Response.json({ success: true, deleted: target.login });
}
