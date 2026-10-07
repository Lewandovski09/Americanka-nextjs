import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getJudgeRole, loadMatchContext } from '@/lib/server/judges';
import { getAuthUser } from '@/lib/server/authUser';
import { notifyJudge } from '@/lib/server/judgeNotice';

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
  const { data: authUser } = await getAuthUser(supabase);
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

  if (match.tournament_categories?.status === 'done') {
    return Response.json(
      { success: false, error: 'Категорію завершено — суддю змінити не можна' },
      { status: 400 }
    );
  }

  const { playerId } = await request.json();
  let joinedCrew = false; // a fresh face → gets the «Вас призначено суддею» note

  if (playerId) {
    const { data: judgePlayer } = await supabaseAdmin
      .from('users')
      .select('id, approval_status')
      .eq('id', playerId)
      .maybeSingle();
    if (!judgePlayer) {
      return Response.json({ success: false, error: 'Гравця не знайдено' }, { status: 404 });
    }
    // A judge enters scores for the whole event — never someone playing
    // in this very game, and never an unapproved account.
    const inThisGame = [...(match.team_a_players || []), ...(match.team_b_players || [])].includes(playerId);
    if (inThisGame) {
      return Response.json({ success: false, error: 'Гравець цієї гри не може її судити' }, { status: 400 });
    }
    if (judgePlayer.approval_status !== 'approved') {
      return Response.json({ success: false, error: 'Суддею може бути лише підтверджений гравець' }, { status: 400 });
    }
    // Join the crew (as an ordinary judge) if this is a fresh face.
    // Legacy categories have no event to join.
    if (eventId) {
      const { data: already } = await supabaseAdmin
        .from('tournament_judges')
        .select('user_id')
        .eq('event_id', eventId)
        .eq('user_id', playerId)
        .maybeSingle();
      const { error: crewError } = await supabaseAdmin
        .from('tournament_judges')
        .upsert({ event_id: eventId, user_id: playerId }, { onConflict: 'event_id,user_id', ignoreDuplicates: true });
      if (crewError) console.error('[match judge] crew upsert:', crewError.message);
      else joinedCrew = !already;
    }
  }

  const { error } = await supabaseAdmin
    .from('tournament_matches')
    .update({ judge_id: playerId || null })
    .eq('id', matchId);
  if (error) {
    console.error('[match judge]:', error.message);
    return Response.json({ success: false, error: 'Не вдалося призначити суддю' }, { status: 500 });
  }

  if (joinedCrew) await notifyJudge(supabaseAdmin, request, { eventId, userId: playerId });
  return Response.json({ success: true });
}
