// Americanka (Americano 2v2, 8 players, 7 rounds).
//
// Every player partners every other player exactly once across the 7
// rounds — no repeated pairings. Two games run in parallel each round.
// Scoring is sum-to-31 (see scoring.js), enforced elsewhere.
//
// The schedule uses SLOT indices 0..7; the concrete player IDs are
// substituted at match-generation time from the registration order.

export const AMERICANO_PLAYER_COUNT = 8;
export const AMERICANO_POINTS_TOTAL = 31;

// [{ round, matches: [{ teamA: [slot, slot], teamB: [slot, slot] }] }]
export const AMERICANO_SCHEDULE = [
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
 * rows (without tournament_id — the caller attaches that).
 *
 * @param {string[]} playerIdsBySlot - playerIdsBySlot[i] = player ID in slot i
 * @param {number[]} courts - court numbers in use, e.g. [1] or [1, 2]
 */
export function buildAmericanoMatches(playerIdsBySlot, courts) {
  const matches = [];
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
