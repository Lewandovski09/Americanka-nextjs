import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Admin opens or closes registration for an event. Closing stops new
// applications without starting the event, so the admin can finish
// distributing the queue and the reserve.
export async function POST(request, { params }) {
  const { eventId } = params;
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
