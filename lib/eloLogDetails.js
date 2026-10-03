// The full story of each game in a player's Ело log: who they played
// WITH and AGAINST, everyone's rating at that moment (elo_before of the
// game), and the score from the player's side. Three requests for the
// whole log, however long it is (matches, their Ело rows, the names).

import { aggregateScore } from '@/lib/formats/sets';

const CHUNK = 100; // ids per request — keeps the URL short

async function inChunks(ids, fetchChunk) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await fetchChunk(ids.slice(i, i + CHUNK));
    out.push(...(data || []));
  }
  return out;
}

const surname = (u) => u?.last_name?.trim() || u?.full_name || '—';

/**
 * @returns {Promise<Record<string, {
 *   partners: { id: string, name: string, elo: number | null }[],
 *   opponents: { id: string, name: string, elo: number | null }[],
 *   opponentsAvg: number | null,
 *   score: string | null,
 *   won: boolean | null,
 * }>>} keyed by match id
 */
export async function loadEloLogDetails(supabase, userId, log) {
  const ids = [...new Set((log || []).map((r) => r.match_id).filter(Boolean))];
  if (ids.length === 0) return {};

  const [matches, history] = await Promise.all([
    inChunks(ids, (part) =>
      supabase.from('tournament_matches').select('id, team_a_players, team_b_players, set1, set2, set3').in('id', part)
    ),
    inChunks(ids, (part) =>
      supabase
        .from('elo_history')
        .select('match_id, user_id, elo_before')
        .eq('reason', 'tournament_result')
        .in('match_id', part)
    ),
  ]);

  const people = [...new Set(matches.flatMap((m) => [...(m.team_a_players || []), ...(m.team_b_players || [])]))];
  const users = await inChunks(people, (part) =>
    supabase.from('users').select('id, full_name, last_name').in('id', part)
  );
  const userById = new Map(users.map((u) => [u.id, u]));
  const before = new Map(history.map((h) => [`${h.match_id}:${h.user_id}`, h.elo_before]));

  const out = {};
  for (const m of matches) {
    const a = m.team_a_players || [];
    const b = m.team_b_players || [];
    const mineIsA = a.includes(userId);
    const mine = mineIsA ? a : b;
    const theirs = mineIsA ? b : a;
    const person = (id) => ({ id, name: surname(userById.get(id)), elo: before.get(`${m.id}:${id}`) ?? null });
    const opponents = theirs.map(person);
    const known = opponents.filter((o) => o.elo != null);
    const agg = aggregateScore(m);
    out[m.id] = {
      partners: mine.filter((id) => id !== userId).map(person),
      opponents,
      opponentsAvg: known.length ? Math.round(known.reduce((s, o) => s + o.elo, 0) / known.length) : null,
      score: agg ? (mineIsA ? `${agg[0]}:${agg[1]}` : `${agg[1]}:${agg[0]}`) : null,
      won: agg ? (mineIsA ? agg[0] > agg[1] : agg[1] > agg[0]) : null,
    };
  }
  return out;
}
