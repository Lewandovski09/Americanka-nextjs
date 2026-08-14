// Tournament logic that works generically with ANY format stored
// in the `tournament_formats` table — adding a new format (e.g. a
// 12-player or single-elimination variant) requires only a new
// database row, not a code change here.

import { teamAWon, pointsTotals } from './formats/sets';

/**
 * Given a format's schedule (from tournament_formats.schedule) and
 * the ordered list of player IDs assigned to slots 0..N-1, produce
 * the concrete list of matches to create for a new tournament.
 *
 * @param {Array} scheduleJson - the format's schedule, e.g.
 *   [{ round: 1, matches: [{ teamA: [0,1], teamB: [2,3] }, ...] }, ...]
 * @param {string[]} playerIdsBySlot - playerIdsBySlot[i] = player ID
 *   assigned to slot i
 * @param {number[]} courts - which court numbers are in use, e.g. [1] or [1,2]
 */
export function buildMatchesForTournament(scheduleJson, playerIdsBySlot, courts) {
  const matches = [];

  scheduleJson.forEach((roundDef) => {
    roundDef.matches.forEach((matchDef, matchIndexInRound) => {
      const court =
        courts.length === 2
          ? courts[matchIndexInRound % 2]
          : courts[0];

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

/**
 * Compute live standings for a tournament from its matches.
 * Tiebreak order: best point differential (gf - ga) → most points
 * scored → most wins → name (only so the order is stable across
 * reloads, never as a sporting criterion — this is where two players
 * still tied on everything above end up sharing a place, see
 * placeStandings()).
 *
 * @param {Array} players - [{ id, full_name, ... }]
 * @param {Array} matches - rows from the `matches` table
 */
export function computeStandings(players, matches) {
  const stats = {};
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
    const diffA = a.gamesFor - a.gamesAgainst;
    const diffB = b.gamesFor - b.gamesAgainst;
    if (diffB !== diffA) return diffB - diffA;
    if (b.gamesFor !== a.gamesFor) return b.gamesFor - a.gamesFor;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return (a.player.full_name || '').localeCompare(b.player.full_name || '');
  });

  return rows;
}

/**
 * Turn sorted standings into places, sharing a place between rows tied
 * on every criterion computeStandings sorts by (diff, points scored,
 * wins) — e.g. two players level on everything both take 1st, and the
 * next distinct player is 3rd, not 2nd (standard competition ranking).
 * Must be called on rows already in computeStandings' order.
 *
 * @param {Array} rows - the array returned by computeStandings
 */
export function placeStandings(rows) {
  const sameTie = (a, b) =>
    a.gamesFor - a.gamesAgainst === b.gamesFor - b.gamesAgainst &&
    a.gamesFor === b.gamesFor &&
    a.wins === b.wins;

  let place = 0;
  let prev = null;
  return rows.map((r, i) => {
    if (!prev || !sameTie(prev, r)) place = i + 1;
    prev = r;
    return { ...r, place };
  });
}

/**
 * Validate a submitted score against the format's scoring rule.
 * Currently: sum-to-N (e.g. sum to 31), no ties.
 */
export function validateScore(scoreA, scoreB, pointsToWin) {
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
