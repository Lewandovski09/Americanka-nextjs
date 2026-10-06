import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

// Deleting via auth.admin.deleteUser (not a plain players delete) is
// what matters here: players.id references auth.users(id) on delete
// cascade, so removing the AUTH user is what actually cascades away
// the players row, their applications, and any tournament_players/
// tournament_teams rows an admin had already distributed them into.
// A players-table-only delete would leave an orphaned, unusable auth
// account behind.

export async function POST() {
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: me } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!me?.is_admin) {
    return Response.json({ success: false, error: 'Тільки для адміністраторів' }, { status: 403 });
  }

  const { data: bots } = await supabaseAdmin.from('users').select('id, login').like('login', 'testbot\\_%');

  let removed = 0;
  const errors = [];
  for (const bot of bots || []) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(bot.id);
    if (error) errors.push(`${bot.login}: ${error.message}`);
    else removed++;
  }

  return Response.json({ success: errors.length === 0, removed, errors });
}
