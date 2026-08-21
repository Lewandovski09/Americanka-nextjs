// Elo rank, AVP season standing, and current win streak — the three
// numbers behind the header stat cards. Originally written once for
// the home page; profile pages need the exact same three numbers for
// the exact same player, so this is the one place that computes them
// rather than three near-identical copies that could quietly drift
// from each other (exactly the trap TabBtn/OptionBtn were pulled out
// of components/ to avoid, just for a data-fetch instead of a UI bit).

import { teamAWon } from '@/lib/formats/sets';
import type { createClient } from '@/lib/supabase/client';

export interface HeaderStats {
  eloRank: number | null;
  avpStanding: { points: number; rank: number } | null;
  winStreak: number;
}

/**
 * @param supabase - a browser Supabase client (createClient()), not the
 *   admin one — this always runs client-side.
 * @param player - needs at least { id, elo, gender }.
 */
export async function loadPlayerHeaderStats(supabase: ReturnType<typeof createClient>, player: { id: string; elo?: number | null; gender?: string | null }): Promise<HeaderStats> {
  let eloRank: number | null = null;
  let avpStanding: HeaderStats['avpStanding'] = null;
  let winStreak = 0;

  if (!player?.id) return { eloRank, avpStanding, winStreak };

  // Rank within the same gender+category — same pool the rating page's
  // own list is built from, so the number matches what they'd see there.
  if (player.elo != null && player.gender) {
    const { count } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('gender', player.gender)
      .eq('approval_status', 'approved')
      .gt('elo', player.elo);
    eloRank = (count ?? 0) + 1;
  }

  // AVP: current season = newest one, same "newest first" rule
  // rating.js's AVP tab already opens on.
  const { data: season } = await supabase
    .from('avp_seasons')
    .select('id')
    .order('starts_on', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (season) {
    const { data: rows } = await supabase
      .from('avp_standings')
      .select('user_id, points')
      .eq('season_id', season.id)
      .order('points', { ascending: false });

    // Same-gender only — AVP standings, like Elo, are ranked separately
    // by gender everywhere else in the app (AvpSeasonCard.js already
    // does this, with a comment noting exactly why: two different ranks
    // shown for the same season on the same page is worse than either
    // alone). Ranking against everyone combined here is what produced
    // that mismatch — "№5 сезону" in the header against "3-е місце" in
    // the AVP card below, for the same player, same season.
    const ids = (rows || []).map((r) => r.user_id);
    const { data: profiles } = player.gender && ids.length
      ? await supabase.from('users').select('id, gender').in('id', ids)
      : { data: [] };
    const sameGenderIds = new Set((profiles || []).filter((p) => p.gender === player.gender).map((p) => p.id));
    const scopedRows = player.gender ? (rows || []).filter((r) => sameGenderIds.has(r.user_id)) : rows || [];

    const idx = scopedRows.findIndex((r) => r.user_id === player.id);
    avpStanding = idx === -1 ? null : { points: scopedRows[idx].points, rank: idx + 1 };
  }

  // Win streak: most recent played games this player was in, newest
  // first by played_at (not created_at — a bracket's rows are all
  // inserted together at tournament start, so created_at is the same
  // for every game in it and says nothing about play order). Counts
  // consecutive wins from the most recent game back, stopping at the
  // first loss.
  const { data: recent } = await supabase
    .from('tournament_matches')
    .select('team_a_players, team_b_players, set1, set2, set3, played_at')
    .or(`team_a_players.cs.{${player.id}},team_b_players.cs.{${player.id}}`)
    .eq('played', true)
    .order('played_at', { ascending: false })
    .limit(20);

  for (const m of recent || []) {
    const onTeamA = (m.team_a_players || []).includes(player.id);
    const won = teamAWon(m) === onTeamA;
    if (!won) break;
    winStreak++;
  }

  return { eloRank, avpStanding, winStreak };
}
