// Manual finish — the americanka path. A round-robin has no final to
// close itself on, so an admin says when the day is over; every other
// format reaches finishCategory() from the score route instead.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { finishCategory } from '@/lib/server/finishCategory';

export async function POST(request, { params }) {
  const { tournamentId } = params;

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  // Closing a category pays out its results, so it is an admin action —
  // the button was already admin-only, the endpoint behind it was not.
  const { data: me } = await supabaseAdmin
    .from('users')
    .select('is_admin')
    .eq('id', authUser.user.id)
    .maybeSingle();
  if (!me?.is_admin) {
    return Response.json({ success: false, error: 'Тільки для адміністраторів' }, { status: 403 });
  }

  // Places in a round-robin exist only once every game is in, so an
  // early finish would pay out nothing at all — refuse it outright
  // instead of silently closing an empty result.
  const { data: matches } = await supabaseAdmin
    .from('tournament_matches')
    .select('played')
    .eq('category_id', tournamentId);
  if (!matches?.length || matches.some((m) => !m.played)) {
    return Response.json(
      { success: false, error: 'Ще зіграні не всі матчі' },
      { status: 400 }
    );
  }

  const res = await finishCategory(supabaseAdmin, tournamentId);
  if (!res.ok) {
    return Response.json({ success: false, error: res.error }, { status: res.alreadyDone ? 400 : 500 });
  }

  const { data: winner } = res.winnerPlayerId
    ? await supabaseAdmin.from('users').select('full_name').eq('id', res.winnerPlayerId).maybeSingle()
    : { data: null };

  return Response.json({ success: true, winner: winner?.full_name });
}
