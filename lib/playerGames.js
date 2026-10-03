// Every played game of one player — one request through
// tournament_match_players (migration 049), plus one for the names of
// everyone they played with. Everything per-season on the profile is
// computed from this list in memory: the «N ігор · X% перемог» summary
// and the partner table, for any season or for all time, without
// another query.

import { teamAWon } from '@/lib/formats/sets';

/**
 * @returns {{ games: { won: boolean, played_at: string, partners: string[] }[], people: Record<string, object> }}
 */
export async function loadPlayerGames(supabase, userId) {
  const { data, error } = await supabase
    .from('tournament_match_players')
    .select('side, tournament_matches!inner(played, played_at, set1, set2, set3, team_a_players, team_b_players)')
    .eq('user_id', userId)
    .eq('tournament_matches.played', true);
  if (error) {
    console.error('[loadPlayerGames]', error.message);
    return { games: [], people: {} };
  }

  const games = (data || [])
    .filter((r) => r.tournament_matches)
    .map((r) => {
      const m = r.tournament_matches;
      const aWon = teamAWon(m);
      const mine = (r.side === 'A' ? m.team_a_players : m.team_b_players) || [];
      return {
        won: r.side === 'A' ? aWon : !aWon,
        played_at: m.played_at,
        partners: mine.filter((id) => id && id !== userId),
      };
    });

  const ids = [...new Set(games.flatMap((g) => g.partners))];
  const people = {};
  if (ids.length > 0) {
    const { data: rows } = await supabase.from('users').select('id, full_name, photo_url').in('id', ids);
    (rows || []).forEach((p) => {
      people[p.id] = p;
    });
  }
  return { games, people };
}

/**
 * Partner table in the shape PlayerHistoryAccordion reads (the same as
 * the partner_stats rows it used to get): most games together first.
 */
export function partnerStatsFrom(games, people) {
  const by = new Map();
  for (const g of games) {
    for (const pid of g.partners) {
      const row = by.get(pid) || { partner_id: pid, games_together: 0, wins_together: 0 };
      row.games_together += 1;
      if (g.won) row.wins_together += 1;
      by.set(pid, row);
    }
  }
  return [...by.values()]
    .map((r) => ({ ...r, partner: people[r.partner_id] || { id: r.partner_id, full_name: '—' } }))
    .sort((a, b) => b.games_together - a.games_together || b.wins_together - a.wins_together);
}
