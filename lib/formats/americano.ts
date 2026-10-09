// Americanka (Americano 2v2): 8 players in 7 rounds — or 6 players in a
// 9-game or a 6-game plan (below).
//
// Every player partners every other player exactly once across the 7
// rounds — no repeated pairings. Two games run in parallel each round.
// Scoring is sum-to-31 (see scoring.js), enforced elsewhere.
//
// The schedule uses SLOT indices 0..7; the concrete player IDs are
// substituted at match-generation time from the registration order.

import type { Match, ScheduleRoundDef } from '../types';

export const AMERICANO_PLAYER_COUNT = 8;
export const AMERICANO_POINTS_TOTAL = 31;

// The sum a game is played to — the organizer picks it per tournament.
export const AMERICANKA_SUMS = [29, 31, 35] as const;
export function americankaSum(points: unknown): number {
  const n = Number(points);
  return (AMERICANKA_SUMS as readonly number[]).includes(n) ? n : AMERICANO_POINTS_TOTAL;
}

// Category sizes and, for 6 players, the length of the plan.
export const AMERICANKA_SIZES = [8, 6] as const;
export const AMERICANKA_GAMES_6 = [9, 6] as const;
/** How many games a category plays: 8 players — 14; 6 players — 9 (default) or 6. */
export function americankaGames(size: unknown, games: unknown): number {
  if (Number(size) !== 6) return 14;
  return Number(games) === 6 ? 6 : 9;
}

// A 6-player category keeps its plan in tournament_categories.bracket_system
// (a plain text column americanka otherwise leaves empty — no migration):
//   'am6_9' — 9 games, 'am6_6' — 6 games; 8 players — null.
export const AMERICANKA_PLAN_9 = 'am6_9';
export const AMERICANKA_PLAN_6 = 'am6_6';
/** The stored plan for a category of `size` players playing `games` games. */
export function americankaPlanFor(size: unknown, games: unknown): string | null {
  if (Number(size) !== 6) return null;
  return americankaGames(6, games) === 6 ? AMERICANKA_PLAN_6 : AMERICANKA_PLAN_9;
}
/** Games in a stored plan: 'am6_6' → 6, 'am6_9' → 9, anything else → null. */
export function gamesOfPlan(plan: unknown): 6 | 9 | null {
  if (plan === AMERICANKA_PLAN_6) return 6;
  if (plan === AMERICANKA_PLAN_9) return 9;
  return null;
}
/** «9 ігор» / «6 ігор» for a stored plan, or null. */
export function planLabel(plan: unknown): string | null {
  const g = gamesOfPlan(plan);
  return g ? `${g} ігор` : null;
}

// [{ round, matches: [{ teamA: [slot, slot], teamB: [slot, slot] }] }]
export const AMERICANO_SCHEDULE: ScheduleRoundDef[] = [
  { round: 1, matches: [{ teamA: [0, 1], teamB: [2, 3] }, { teamA: [4, 5], teamB: [6, 7] }] },
  { round: 2, matches: [{ teamA: [0, 2], teamB: [4, 6] }, { teamA: [1, 3], teamB: [5, 7] }] },
  { round: 3, matches: [{ teamA: [0, 3], teamB: [5, 6] }, { teamA: [1, 2], teamB: [4, 7] }] },
  { round: 4, matches: [{ teamA: [0, 4], teamB: [1, 6] }, { teamA: [2, 5], teamB: [3, 7] }] },
  { round: 5, matches: [{ teamA: [0, 5], teamB: [2, 7] }, { teamA: [1, 4], teamB: [3, 6] }] },
  { round: 6, matches: [{ teamA: [0, 6], teamB: [3, 5] }, { teamA: [1, 7], teamB: [2, 4] }] },
  { round: 7, matches: [{ teamA: [0, 7], teamB: [1, 5] }, { teamA: [2, 6], teamB: [3, 4] }] },
];

/**
 * Turn the fixed schedule + the ordered player IDs into concrete match
 * rows (without category_id — the caller attaches that).
 *
 * @param playerIdsBySlot - playerIdsBySlot[i] = player ID in slot i
 * @param courts - court numbers in use, e.g. [1] or [1, 2]
 */
export function buildAmericanoMatches(playerIdsBySlot: string[], courts: number[]): Match[] {
  const matches: Match[] = [];
  AMERICANO_SCHEDULE.forEach((roundDef) => {
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

// ── 6 players: one game at a time (4 play, 2 rest) ──
// Both plans: everyone plays the same number of games, nobody rests two
// games in a row or plays more than three in a row, no game is ever
// repeated. One game per round.
//
// 9 games — 6 each, ~2 h 15 min at 15 min a game. Everyone partners every
// other player; with 6 games and only 5 partners, three partnerships
// (one per player — slots 0+2, 1+4, 3+5) have to come twice, and they
// never come in two games in a row.
// 6 games — 4 each, ~1 h 30 min. No partnership repeats; everyone misses
// one possible partner.
export const AMERICANO_6_SCHEDULES: Record<9 | 6, ScheduleRoundDef[]> = {
  9: [
    { round: 1, matches: [{ teamA: [0, 2], teamB: [1, 5] }] },
    { round: 2, matches: [{ teamA: [1, 4], teamB: [3, 5] }] },
    { round: 3, matches: [{ teamA: [0, 4], teamB: [1, 2] }] },
    { round: 4, matches: [{ teamA: [0, 5], teamB: [3, 4] }] },
    { round: 5, matches: [{ teamA: [0, 2], teamB: [1, 3] }] },
    { round: 6, matches: [{ teamA: [2, 4], teamB: [3, 5] }] },
    { round: 7, matches: [{ teamA: [0, 1], teamB: [4, 5] }] },
    { round: 8, matches: [{ teamA: [0, 3], teamB: [2, 5] }] },
    { round: 9, matches: [{ teamA: [1, 4], teamB: [2, 3] }] },
  ],
  6: [
    { round: 1, matches: [{ teamA: [2, 3], teamB: [4, 5] }] },
    { round: 2, matches: [{ teamA: [0, 1], teamB: [3, 4] }] },
    { round: 3, matches: [{ teamA: [0, 3], teamB: [2, 5] }] },
    { round: 4, matches: [{ teamA: [0, 2], teamB: [1, 4] }] },
    { round: 5, matches: [{ teamA: [1, 2], teamB: [3, 5] }] },
    { round: 6, matches: [{ teamA: [0, 4], teamB: [1, 5] }] },
  ],
};

/**
 * The match rows for 6 players.
 * @param playerIdsBySlot - 6 player IDs in slot order
 * @param court - the court the category plays on
 * @param games - 9 or 6
 */
export function buildAmericano6Matches(playerIdsBySlot: string[], court: number, games: number): Match[] {
  const plan = AMERICANO_6_SCHEDULES[games === 6 ? 6 : 9];
  return plan.map((roundDef) => {
    const m = roundDef.matches[0];
    return {
      round_number: roundDef.round,
      court,
      team_a_players: m.teamA.map((slot) => playerIdsBySlot[slot]),
      team_b_players: m.teamB.map((slot) => playerIdsBySlot[slot]),
      played: false,
    };
  });
}
