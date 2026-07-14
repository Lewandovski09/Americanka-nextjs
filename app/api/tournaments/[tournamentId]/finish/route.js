import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeStandings } from '@/lib/tournamentEngine';
import { teamAWon } from '@/lib/formats/sets';

export async function POST(request, { params }) {
  const { tournamentId } = params;

  const supabase = createClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  // Guard against double-finishing: elo/stats must be paid out once.
  const { data: tournament } = await supabaseAdmin
    .from('tournaments')
    .select('status')
    .eq('id', tournamentId)
    .maybeSingle();
  if (!tournament) {
    return Response.json({ success: false, error: 'Категорію не знайдено' }, { status: 404 });
  }
  if (tournament.status === 'done') {
    return Response.json({ success: false, error: 'Категорію вже завершено' }, { status: 400 });
  }

  const { data: tournamentPlayers } = await supabaseAdmin
    .from('tournament_players')
    .select('player_id, elo_at_start, players(full_name)')
    .eq('tournament_id', tournamentId);

  const { data: matches } = await supabaseAdmin
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId);

  const playersForEngine = tournamentPlayers.map((tp) => ({
    id: tp.player_id,
    elo_at_start: tp.elo_at_start,
    full_name: tp.players.full_name,
  }));

  const standings = computeStandings(playersForEngine, matches);

  // Apply Elo changes, update tournament counts, record history.
  for (let i = 0; i < standings.length; i++) {
    const row = standings[i];
    const placement = i + 1;

    const { data: currentPlayer } = await supabaseAdmin
      .from('players')
      .select('elo, tournaments_played, tournaments_won')
      .eq('id', row.player.id)
      .single();

    const newElo = (currentPlayer.elo || 1000) + row.eloDelta;

    await supabaseAdmin
      .from('players')
      .update({
        elo: newElo,
        tournaments_played: currentPlayer.tournaments_played + 1,
        tournaments_won: currentPlayer.tournaments_won + (placement === 1 ? 1 : 0),
      })
      .eq('id', row.player.id);

    await supabaseAdmin.from('elo_history').insert({
      player_id: row.player.id,
      tournament_id: tournamentId,
      delta: row.eloDelta,
      elo_before: currentPlayer.elo || 1000,
      elo_after: newElo,
      reason: 'tournament_result',
      placement,
    });
  }

  // Update partner_stats for every pair of teammates across all played matches.
  await updatePartnerStats(supabaseAdmin, matches);

  const winner = standings[0]?.player;

  await supabaseAdmin
    .from('tournaments')
    .update({
      status: 'done',
      finished_at: new Date().toISOString(),
      winner_player_id: winner?.id,
    })
    .eq('id', tournamentId);

  return Response.json({ success: true, winner: winner?.full_name });
}

async function updatePartnerStats(supabaseAdmin, matches) {
  for (const match of matches.filter((m) => m.played)) {
    const aWon = teamAWon(match);
    await recordPartnerPair(supabaseAdmin, match.team_a_players, aWon);
    await recordPartnerPair(supabaseAdmin, match.team_b_players, !aWon);
  }
}

async function recordPartnerPair(supabaseAdmin, teamPlayerIds, won) {
  if (teamPlayerIds.length < 2) return;
  const [p1, p2] = teamPlayerIds;

  for (const [a, b] of [
    [p1, p2],
    [p2, p1],
  ]) {
    const { data: existing } = await supabaseAdmin
      .from('partner_stats')
      .select('games_together, wins_together')
      .eq('player_id', a)
      .eq('partner_id', b)
      .maybeSingle();

    await supabaseAdmin.from('partner_stats').upsert({
      player_id: a,
      partner_id: b,
      games_together: (existing?.games_together || 0) + 1,
      wins_together: (existing?.wins_together || 0) + (won ? 1 : 0),
      last_played_at: new Date().toISOString(),
    });
  }
}
