import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

// Admin opens or closes registration for an event. Closing stops new
// applications without starting the event, so the admin can finish
// distributing the queue and the reserve.
export async function POST(request, { params }) {
  const { eventId } = params;
  const supabase = createClient();
  const { data: authUser } = await getAuthUser(supabase);
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: caller } = await adminRow(supabaseAdmin, authUser.user.id);
  if (!caller?.is_admin) {
    return Response.json({ success: false, error: 'Тільки адмін' }, { status: 403 });
  }

  const { open } = await request.json();

  const { error } = await supabaseAdmin
    .from('tournament_events')
    .update({ registration_open: !!open })
    .eq('id', eventId);
  if (error) {
    console.error('[registration] update error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося оновити реєстрацію' }, { status: 500 });
  }

  return Response.json({ success: true, open: !!open });
}
