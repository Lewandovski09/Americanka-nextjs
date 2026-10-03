// Elo rank, AVP season standing, and current win streak — the three
// numbers behind the header stat cards. Originally written once for
// the home page; profile pages need the exact same three numbers for
// the exact same player, so this is the one place that computes them
// rather than three near-identical copies that could quietly drift
// from each other (exactly the trap TabBtn/OptionBtn were pulled out
// of components/ to avoid, just for a data-fetch instead of a UI bit).

import { teamAWon } from '@/lib/formats/sets';
import type { createClient } from '@/lib/supabase/client';
import { loadClubSeasons } from './seasons';

export interface SeasonRef {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string | null;
}

export interface HeaderStats {
  eloRank: number | null;
  avpStanding: { points: number; rank: number } | null;
  winStreak: number;
  /** The seasons these numbers belong to — shown on the cards. */
  avpSeason: SeasonRef | null;
  eloSeason: SeasonRef | null;
  /** Ело change since the current Ело season opened (null = unknown). */
  eloSeasonDelta: number | null;
}

/**
 * @param supabase - a browser Supabase client (createClient()), not the
 *   admin one — this always runs client-side.
 * @param player - needs at least { id, elo, gender }.
 *
 * Every query below is independent once the seasons are known (and those
 * are cached for the whole tab), so they all run at once — this used to
 * be six requests one after another.
 */
export async function loadPlayerHeaderStats(supabase: ReturnType<typeof createClient>, player: { id: string; elo?: number | null; gender?: string | null }): Promise<HeaderStats> {
  const empty: HeaderStats = { eloRank: null, avpStanding: null, winStreak: 0, avpSeason: null, eloSeason: null, eloSeasonDelta: null };
  if (!player?.id) return empty;

  const seasons = await loadClubSeasons(supabase);
  const avpSeason = (seasons.avp as SeasonRef | null) || null;
  const eloSeason = (seasons.elo as SeasonRef | null) || null;
  const none = Promise.resolve({ data: null, count: null } as any);

  const [rankRes, standingsRes, sameGenderRes, recentRes, startRes] = await Promise.all([
    // Rank within the same gender — the pool the rating page's list is
    // built from, so the number matches what they'd see there.
    player.elo != null && player.gender
      ? supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('gender', player.gender)
          .eq('approval_status', 'approved')
          .gt('elo', player.elo)
      : none,
    avpSeason
      ? supabase.from('avp_standings').select('user_id, points').eq('season_id', avpSeason.id).order('points', { ascending: false })
      : none,
    // AVP is ranked by gender everywhere else in the app (AvpSeasonCard,
    // the AVP tab) — the header must agree with them.
    avpSeason && player.gender ? supabase.from('users').select('id').eq('gender', player.gender) : none,
    // Win streak: newest played games first by played_at (a bracket's
    // rows are all inserted together, so created_at says nothing about
    // play order); counted back to the first loss.
    supabase
      .from('tournament_matches')
      .select('team_a_players, team_b_players, set1, set2, set3, played_at')
      .or(`team_a_players.cs.{${player.id}},team_b_players.cs.{${player.id}}`)
      .eq('played', true)
      .order('played_at', { ascending: false })
      .limit(20),
    eloSeason
      ? supabase.from('season_ratings').select('elo_start').eq('season_id', eloSeason.id).eq('user_id', player.id).maybeSingle()
      : none,
  ]);

  const eloRank = player.elo != null && player.gender ? (rankRes.count ?? 0) + 1 : null;

  let avpStanding: HeaderStats['avpStanding'] = null;
  if (avpSeason) {
    const rows: { user_id: string; points: number }[] = standingsRes.data || [];
    const same = player.gender ? new Set((sameGenderRes.data || []).map((p: { id: string }) => p.id)) : null;
    const scoped = same ? rows.filter((r) => same.has(r.user_id)) : rows;
    const idx = scoped.findIndex((r) => r.user_id === player.id);
    avpStanding = idx === -1 ? null : { points: scoped[idx].points, rank: idx + 1 };
  }

  let winStreak = 0;
  for (const m of recentRes.data || []) {
    const onTeamA = (m.team_a_players || []).includes(player.id);
    const won = teamAWon(m) === onTeamA;
    if (!won) break;
    winStreak++;
  }

  const start = startRes.data?.elo_start;
  const eloSeasonDelta = start != null && player.elo != null ? player.elo - start : null;

  return { eloRank, avpStanding, winStreak, avpSeason, eloSeason, eloSeasonDelta };
}
