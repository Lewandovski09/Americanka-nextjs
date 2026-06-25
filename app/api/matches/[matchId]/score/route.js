import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateScore } from '@/lib/tournamentEngine';

export async function POST(request, { params }) {
  const { matchId } = params;
  const { scoreA, scoreB } = await request.json();

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: match } = await supabaseAdmin
    .from('matches')
    .select('*, tournaments(format_id)')
    .eq('id', matchId)
    .single();

  if (!match) {
    return Response.json({ success: false, error: 'Матч не знайдено' }, { status: 404 });
  }

  const { data: format } = await supabaseAdmin
    .from('tournament_formats')
    .select('points_to_win')
    .eq('id', match.tournaments.format_id)
    .single();

  const validation = validateScore(scoreA, scoreB, format.points_to_win);
  if (!validation.valid) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('matches')
    .update({
      score_a: scoreA,
      score_b: scoreB,
      played: true,
      played_at: new Date().toISOString(),
    })
    .eq('id', matchId);

  if (error) {
    console.error('[submit-score] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося зберегти рахунок' }, { status: 500 });
  }

  return Response.json({ success: true });
}
