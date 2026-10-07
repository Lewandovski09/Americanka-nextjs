import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthUser, adminRow } from '@/lib/server/authUser';

// «💰 Оплатив внесок» — the admin's own mark per player of an event
// (migration 072). Players never see it.
//
// body: { userId, paid: boolean }
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

  const { userId, paid } = await request.json().catch(() => ({}));
  if (!userId) return Response.json({ success: false, error: 'Оберіть гравця' }, { status: 400 });

  const { data: event } = await supabaseAdmin.from('tournament_events').select('id').eq('id', eventId).maybeSingle();
  if (!event) return Response.json({ success: false, error: 'Подію не знайдено' }, { status: 404 });

  const q = paid
    ? supabaseAdmin
        .from('tournament_payments')
        .upsert({ event_id: eventId, user_id: userId, paid_at: new Date().toISOString(), marked_by: authUser.user.id }, { onConflict: 'event_id,user_id' })
    : supabaseAdmin.from('tournament_payments').delete().eq('event_id', eventId).eq('user_id', userId);
  const { error } = await q;
  if (error) {
    console.error('[payments]:', error.message);
    const missing = /tournament_payments/.test(error.message || '') && /exist|schema cache/i.test(error.message || '');
    return Response.json(
      { success: false, error: missing ? 'Спершу виконайте SQL 072 у Supabase' : 'Не вдалося зберегти' },
      { status: 500 }
    );
  }
  return Response.json({ success: true, paid: !!paid });
}
