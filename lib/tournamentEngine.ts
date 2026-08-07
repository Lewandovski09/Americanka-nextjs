// Tournament logic that works generically with ANY format stored
// in the `tournament_formats` table — adding a new format (e.g. a
// 12-player or single-elimination variant) requires only a new
// database row, not a code change here.

import { teamAWon, pointsTotals } from './formats/sets';
import type { Match, Player, ScheduleRoundDef } from './types';

/**
 * Given a format's schedule (from tournament_formats.schedule) and
 * the ordered list of player IDs assigned to slots 0..N-1, produce
 * the concrete list of matches to create for a new tournament.
 *
 * @param scheduleJson - the format's schedule, e.g.
 *   [{ round: 1, matches: [{ teamA: [0,1], teamB: [2,3] }, ...] }, ...]
 * @param playerIdsBySlot - playerIdsBySlot[i] = player ID assigned to slot i
 * @param courts - which court numbers are in use, e.g. [1] or [1,2]
 */
export function buildMatchesForTournament(
  scheduleJson: ScheduleRoundDef[],
  playerIdsBySlot: string[],
  courts: number[]
): Match[] {
  const matches: Match[] = [];

  scheduleJson.forEach((roundDef) => {
    roundDef.matches.forEach((matchDef, matchIndexInRound) => {
      const court = courts.length === 2 ? courts[matchIndexInRound % 2] : courts[0];

      matches.push({
        round_number: roundDef.round,
        court,
        team_a_players: matchDef.teamA.map((slot) => playerIdsBySlot[slot]),
        team_b_players: matchDef.teamB.map((slot) => playerIdsBySlot[slot]),
        played: false,
      });
    });
  });

  return matches;
}

export interface StandingsRow {
  player: Player;
  wins: number;
  gamesFor: number;
  gamesAgainst: number;
  played: number;
}

/**
 * Compute live standings for a tournament from its matches.
 * Tiebreak order: most wins → best point differential (gf - ga) →
 * most points scored → name (only so the order is stable across
 * reloads, never as a sporting criterion).
 */
export function computeStandings(players: Player[], matches: Match[]): StandingsRow[] {
  const stats: Record<string, StandingsRow> = {};
  players.forEach((p) => {
    stats[p.id] = {
      player: p,
      wins: 0,
      gamesFor: 0,
      gamesAgainst: 0,
      played: 0,
    };
  });

  matches
    .filter((m) => m.played)
    .forEach((m) => {
      const aWon = teamAWon(m);
      const [ptsA, ptsB] = pointsTotals(m);

      m.team_a_players.forEach((pid) => {
        if (!stats[pid]) return;
        stats[pid].gamesFor += ptsA;
        stats[pid].gamesAgainst += ptsB;
        stats[pid].played += 1;
        if (aWon) stats[pid].wins += 1;
      });

      m.team_b_players.forEach((pid) => {
        if (!stats[pid]) return;
        stats[pid].gamesFor += ptsB;
        stats[pid].gamesAgainst += ptsA;
        stats[pid].played += 1;
        if (!aWon) stats[pid].wins += 1;
      });
    });

  const rows = Object.values(stats);

  rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const diffA = a.gamesFor - a.gamesAgainst;
    const diffB = b.gamesFor - b.gamesAgainst;
    if (diffB !== diffA) return diffB - diffA;
    if (b.gamesFor !== a.gamesFor) return b.gamesFor - a.gamesFor;
    return (a.player.full_name || '').localeCompare(b.player.full_name || '');
  });

  return rows;
}

/**
 * Validate a submitted score against the format's scoring rule.
 * Currently: sum-to-N (e.g. sum to 31), no ties.
 */
export function validateScore(
  scoreA: number,
  scoreB: number,
  pointsToWin: number
): { valid: boolean; error?: string } {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) {
    return { valid: false, error: 'Рахунок має бути числом' };
  }
  if (scoreA === scoreB) {
    return { valid: false, error: 'Рахунок не може бути рівним' };
  }
  if (scoreA + scoreB !== pointsToWin) {
    return { valid: false, error: `Сума рахунку має дорівнювати ${pointsToWin}` };
  }
  return { valid: true };
}
