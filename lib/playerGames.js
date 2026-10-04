// Every played game of one player — one request through
// tournament_match_players (migration 049), plus one for the names of
// everyone they played with. Everything per-season on the profile is
// computed from this list in memory: the «N ігор · X% перемог» summary
// and the partner table, for any season or for all time, without
// another query.

import { teamAWon, pointsTotals, scoreLabel } from '@/lib/formats/sets';
import { memoize } from '@/lib/clientCache';

/**
 * @returns {{ games: { won: boolean, played_at: string, partners: string[], opponents: string[],
 *   pointsFor: number, pointsAgainst: number, score: string | null }[], people: Record<string, object> }}
 */
export async function loadPlayerGames(supabase, userId) {
  const { data, error } = await supabase
    .from('tournament_match_players')
    .select('side, tournament_matches!inner(id, category_id, round_number, court, stage, played, played_at, set1, set2, set3, team_a_players, team_b_players)')
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
      const isA = r.side === 'A';
      const mine = (isA ? m.team_a_players : m.team_b_players) || [];
      const theirs = (isA ? m.team_b_players : m.team_a_players) || [];
      const [pa, pb] = pointsTotals(m);
      // The score from this player's side: «25:6», or «2:1 (…)» in sets.
      const label = scoreLabel(isA ? m : { set1: flip(m.set1), set2: flip(m.set2), set3: flip(m.set3) });
      return {
        match_id: m.id,
        category_id: m.category_id,
        round: m.round_number,
        court: m.court,
        stage: m.stage,
        won: isA ? aWon : !aWon,
        played_at: m.played_at,
        partners: mine.filter((id) => id && id !== userId),
        opponents: theirs.filter(Boolean),
        pointsFor: isA ? pa : pb,
        pointsAgainst: isA ? pb : pa,
        score: label,
      };
    });

  // Names for partners AND opponents (the «Напарники й суперники» card).
  const ids = [...new Set(games.flatMap((g) => [...g.partners, ...g.opponents]))];
  const people = {};
  if (ids.length > 0) {
    const { data: rows } = await supabase.from('users').select('id, full_name, last_name, photo_url, gender').in('id', ids);
    (rows || []).forEach((p) => {
      people[p.id] = p;
    });
  }
  return { games, people };
}

// A set [a, b] seen from the other side.
function flip(set) {
  return Array.isArray(set) ? [set[1], set[0]] : set;
}

/**
 * Partner table (ProfileTabs «Напарники», FormCard), in the shape of
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

/**
 * loadPlayerGames, shared for a minute across the app: the home page's
 * «Твоя форма», the profile and a player's page ask for the same list,
 * and it used to be downloaded once for each of them.
 */
export function loadPlayerGamesShared(supabase, userId) {
  return memoize(`games:${userId}`, 60 * 1000, () => loadPlayerGames(supabase, userId));
}
