// Start a new season of ONE track (migration 045). AVP and Ело seasons are
// independent: each has its own button and is closed / started on its own.
//   kind 'avp' — closes the open AVP season the day before, opens the next;
//                awarded points stay in the season they were earned in.
//   kind 'elo' — closes the open Ело season, freezes everyone's final Ело
//                into season_ratings, opens the next and — in 'category'
//                mode — resets Ело to each player's category start value.
// One call to start_new_season() does it atomically. Closed seasons are
// never touched again and stay viewable on the rating page.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { CATEGORY_STARTING_ELO } from '@/lib/elo';
import { recalcAvpForCategory } from '@/lib/server/avpAward';

export async function POST(request) {
  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const { data: me } = await supabaseAdmin.from('users').select('is_admin').eq('id', authUser.user.id).maybeSingle();
  if (!me?.is_admin) {
    return Response.json({ success: false, error: 'Тільки для адміністраторів' }, { status: 403 });
  }

  const { kind, name, startsOn, eloMode } = await request.json();
  // AVP and Ело are separate season tracks (045): each is started on its own.
  if (kind !== 'avp' && kind !== 'elo') {
    return Response.json({ success: false, error: 'Невідомий тип сезону' }, { status: 400 });
  }
  const trimmed = String(name || '').trim();
  if (!trimmed) return Response.json({ success: false, error: 'Вкажіть назву сезону' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startsOn || ''))) {
    return Response.json({ success: false, error: 'Вкажіть дату початку' }, { status: 400 });
  }
  const mode = kind === 'elo' && eloMode === 'category' ? 'category' : 'carry';

  const { data: seasonId, error } = await supabaseAdmin.rpc('start_new_season', {
    p_kind: kind,
    p_name: trimmed,
    p_starts_on: startsOn,
    p_elo_mode: mode,
    // The starting values live in lib/elo.ts only; the database is told them.
    p_start_elo: mode === 'category' ? CATEGORY_STARTING_ELO : null,
  });
  if (error) {
    console.error('[season start]', error.message);
    // start_new_season raises human-readable (Ukrainian) messages.
    return Response.json({ success: false, error: error.message || 'Не вдалося почати сезон' }, { status: 400 });
  }

  if (kind === 'elo') return Response.json({ success: true, seasonId, recalculated: 0 });

  // An AVP season started «заднім числом» moves events dated on/after its
  // start into it — repay those categories so their AVP points follow.
  // From a day earlier: recalculation is idempotent, so catching a few
  // extra categories is harmless, while a timezone edge missing one is not.
  const from = new Date(`${startsOn}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const { data: events } = await supabaseAdmin
    .from('tournament_events')
    .select('id, tournament_categories(id, status)')
    .gte('scheduled_at', from.toISOString());
  let recalculated = 0;
  for (const ev of events || []) {
    for (const c of ev.tournament_categories || []) {
      if (c.status !== 'done') continue;
      const res = await recalcAvpForCategory(supabaseAdmin, c.id);
      if (!res.ok) console.error('[season start] avp recalc:', res.error);
      else recalculated++;
    }
  }

  return Response.json({ success: true, seasonId, recalculated });
}
