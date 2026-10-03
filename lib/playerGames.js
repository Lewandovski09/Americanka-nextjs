// Every played game of one player as [{ won, played_at }] — one request
// through tournament_match_players (migration 049). The profile summary
// («N ігор · X% перемог») is computed from this, so it can be shown for
// the current season or for all time without another query.

import { teamAWon } from '@/lib/formats/sets';

export async function loadPlayerGames(supabase, userId) {
  const { data, error } = await supabase
    .from('tournament_match_players')
    .select('side, tournament_matches!inner(played, played_at, set1, set2, set3)')
    .eq('user_id', userId)
    .eq('tournament_matches.played', true);
  if (error) {
    console.error('[loadPlayerGames]', error.message);
    return [];
  }
  return (data || [])
    .filter((r) => r.tournament_matches)
    .map((r) => {
      const m = r.tournament_matches;
      const aWon = teamAWon(m);
      return { won: r.side === 'A' ? aWon : !aWon, played_at: m.played_at };
    });
}
