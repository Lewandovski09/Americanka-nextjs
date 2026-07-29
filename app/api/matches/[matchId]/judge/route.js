import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getJudgeRole, loadMatchContext } from '@/lib/server/judges';

// Who judges ONE game. Set by an admin or by the head judge — they are
// the two people who run the day and shuffle the crew between courts.
//
// The judge is picked from the whole player list, not only from the
// event's crew: somebody who happens to be free gets handed a game on
// the spot. Such a pick joins the crew as an ordinary judge, so the
// «Судді» tab keeps showing everyone who is actually judging.
//
// body: { playerId } — null/empty clears the assignment.
export async function POST(request, { params }) {
  const { matchId } = params;

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const ctx = await loadMatchContext(supabaseAdmin, matchId);
  if (!ctx) return Response.json({ success: false, error: 'Матч не знайдено' }, { status: 404 });
  const { match, eventId } = ctx;

  const role = await getJudgeRole(supabaseAdmin, authUser.user.id, eventId);
  if (!role.isAdmin && !role.isHeadJudge) {
    return Response.json(
      { success: false, error: 'Суддю призначає адмін або головний суддя' },
      { status: 403 }
    );
  }

  if (match.tournaments?.status === 'done') {
    return Response.json(
      { success: false, error: 'Категорію завершено — суддю змінити не можна' },
      { status: 400 }
    );
  }

  const { playerId } = await request.json();

  if (playerId) {
    const { data: judgePlayer } = await supabaseAdmin
      .from('players')
      .select('id')
      .eq('id', playerId)
      .maybeSingle();
    if (!judgePlayer) {
      return Response.json({ success: false, error: 'Гравця не знайдено' }, { status: 404 });
    }
    // Join the crew (as an ordinary judge) if this is a fresh face.
    // Legacy categories have no event to join.
    if (eventId) {
      const { error: crewError } = await supabaseAdmin
        .from('tournament_judges')
        .upsert({ event_id: eventId, player_id: playerId }, { onConflict: 'event_id,player_id', ignoreDuplicates: true });
      if (crewError) console.error('[match judge] crew upsert:', crewError.message);
    }
  }

  const { error } = await supabaseAdmin
    .from('matches')
    .update({ judge_id: playerId || null })
    .eq('id', matchId);
  if (error) {
    console.error('[match judge]:', error.message);
    return Response.json({ success: false, error: 'Не вдалося призначити суддю' }, { status: 500 });
  }

  return Response.json({ success: true });
}
