import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Delete a whole event with everything under it: categories, matches,
// rosters, teams and applications all go via ON DELETE CASCADE. The one
// thing that must survive is awarded rating — elo_history rows reference
// the category without a cascade — so an event where any category has
// already been finished (elo paid out) cannot be deleted.
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
    return Response.json({ success: false, error: 'Тільки адмін може видаляти турніри' }, { status: 403 });
  }

  const { data: event } = await supabaseAdmin
    .from('tournament_events')
    .select('id')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) {
    return Response.json({ success: false, error: 'Подію не знайдено' }, { status: 404 });
  }

  const { data: categories } = await supabaseAdmin
    .from('tournaments')
    .select('id')
    .eq('event_id', eventId);
  const categoryIds = (categories || []).map((c) => c.id);

  if (categoryIds.length > 0) {
    const { count } = await supabaseAdmin
      .from('elo_history')
      .select('id', { count: 'exact', head: true })
      .in('tournament_id', categoryIds);
    if (count > 0) {
      return Response.json(
        { success: false, error: 'За турнір вже нараховано рейтинг — його не можна видалити' },
        { status: 400 }
      );
    }
  }

  const { error } = await supabaseAdmin.from('tournament_events').delete().eq('id', eventId);
  if (error) {
    console.error('[event delete] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося видалити турнір' }, { status: 500 });
  }

  return Response.json({ success: true });
}
