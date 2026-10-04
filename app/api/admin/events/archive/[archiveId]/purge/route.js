import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// «Видалити назавжди» — removes a tournament from the archive of deleted
// tournaments (migration 052). Its rating was already rolled back when it
// was deleted, so nothing else changes.
export async function POST(request, { params }) {
  const { archiveId } = params;

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }
  const supabaseAdmin = createAdminClient();
  const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', authUser.user.id).maybeSingle();
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  }

  const { error } = await supabaseAdmin.from('deleted_events').delete().eq('id', archiveId);
  if (error) {
    console.error('[archive purge]', error.message);
    return Response.json({ success: false, error: 'Не вдалося видалити з архіву' }, { status: 500 });
  }
  return Response.json({ success: true });
}
