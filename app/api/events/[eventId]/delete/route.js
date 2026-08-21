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
    .from('users')
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
    .from('tournament_categories')
    .select('id')
    .eq('event_id', eventId);
  const categoryIds = (categories || []).map((c) => c.id);

  if (categoryIds.length > 0) {
    // BOTH ratings, not just Ело.
    //
    // This guard was written when elo_history was the only ledger, and
    // it quietly stopped covering the common case once AVP arrived
    // (migration 023). Ело is only ever written automatically for
    // americanka — every other format leaves elo_history empty — while
    // AVP points are awarded to every finished category that has a tier.
    // So a finished mix or pair event passed the Ело check, and its
    // avp_points rows then went with the event through ON DELETE
    // CASCADE: the season standings changed retroactively, silently,
    // through a button whose refusal message promises the opposite.
    const [{ count: eloCount }, { count: avpCount }] = await Promise.all([
      supabaseAdmin.from('elo_history').select('id', { count: 'exact', head: true }).in('category_id', categoryIds),
      supabaseAdmin.from('avp_points').select('id', { count: 'exact', head: true }).in('category_id', categoryIds),
    ]);

    if (eloCount > 0 || avpCount > 0) {
      // Name which one, so the admin knows what is holding the event:
      // AVP can be released by clearing the event's tier and recalcing
      // (see /api/admin/avp/recalc), Ело cannot be undone at all.
      const what = eloCount > 0 && avpCount > 0 ? 'Ело та очки AVP' : eloCount > 0 ? 'Ело' : 'очки AVP';
      return Response.json(
        { success: false, error: `За турнір вже нараховано ${what} — його не можна видалити` },
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
