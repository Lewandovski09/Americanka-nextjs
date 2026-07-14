// King of the Beach.
//
// Individual registration. Players are split into groups of 4. Within a
// group they play a mini round-robin (2v2, partners rotate so each of
// the 4 partners each of the others once — 3 games). Individuals are
// ranked inside the group by wins, then by point differential.
//
// Progression between rounds (confirmed with the client):
//   • the top 2 of every group always advance;
//   • if that count is not a multiple of 4, the best-ranked 3rd-place
//     finishers are added to round it UP to the next multiple of 4
//     (the deficit is always 0 or 2, since 2×groups is even);
//   • the advancers are re-grouped into fresh groups of 4 and the
//     process repeats until a single group of 4 is left — the final.
//
//   16 → 8 → 4 (final)
//   20 → 12 → 8 → 4       24 → 12 → 8 → 4
//   28 → 16 → 8 → 4       32 → 16 → 8 → 4
//
// Rounds are distinguished by stage = 'kr1', 'kr2', … ; the group
// within a round by `group_index`.

import { teamAWon, pointsDiffA } from './sets';

// 4-player mini round-robin: slot indices 0..3 within one group.
// Everyone partners everyone once (same idea as americano, size 4).
const GROUP4_SCHEDULE = [
  { round: 1, teamA: [0, 1], teamB: [2, 3] },
  { round: 2, teamA: [0, 2], teamB: [1, 3] },
  { round: 3, teamA: [0, 3], teamB: [1, 2] },
];

/**
 * Build one King round: split the (already-ordered) players into groups
 * of 4 and generate each group's mini round-robin.
 *
 * @param {string[]} playerIds - players in the intended group order;
 *   length must be divisible by 4 (sequential slices become groups)
 * @param {number[]} courts - court numbers in use
 * @param {number} roundNo - 1-based King round; encoded as stage 'kr<N>'
 * @returns {{ groups: string[][], matches: object[] }}
 */
export function buildKingRound(playerIds, courts, roundNo) {
  if (playerIds.length % 4 !== 0) {
    throw new Error('King of the Beach: кількість гравців у раунді має бути кратною 4');
  }
  const stage = 'kr' + roundNo;

  const groups = [];
  for (let i = 0; i < playerIds.length; i += 4) {
    groups.push(playerIds.slice(i, i + 4));
  }

  const matches = [];
  groups.forEach((group, groupIndex) => {
    const court = courts[groupIndex % courts.length];
    GROUP4_SCHEDULE.forEach((g) => {
      matches.push({
        stage,
        round_number: g.round,
        group_index: groupIndex,
        court,
        team_a_players: g.teamA.map((slot) => group[slot]),
        team_b_players: g.teamB.map((slot) => group[slot]),
        played: false,
      });
    });
  });

  return { groups, matches };
}

// Round-1 convenience wrapper (kept for the start route).
export function buildKingRound1(playerIds, courts) {
  return buildKingRound(playerIds, courts, 1);
}

/**
 * Player counts of every round for n starters: 16 → [16, 8, 4];
 * 20 → [20, 12, 8, 4]. Deterministic, so the whole tournament's match
 * skeleton is known the moment it starts.
 */
export function kingRoundSizes(n) {
  const sizes = [n];
  while (sizes[sizes.length - 1] > 4) {
    const qualifiers = 2 * (sizes[sizes.length - 1] / 4);
    sizes.push(qualifiers % 4 === 0 ? qualifiers : qualifiers + 2);
  }
  return sizes;
}

/**
 * Placeholder matches (empty team slots) for every round AFTER the
 * first, created up front at category start. The score route fills the
 * team slots as soon as the previous round completes.
 */
export function buildKingPlaceholders(n, courts) {
  const rows = [];
  const sizes = kingRoundSizes(n);
  for (let r = 1; r < sizes.length; r++) {
    const { matches } = buildKingRound(Array(sizes[r]).fill(null), courts, r + 1);
    matches.forEach((m) => rows.push({ ...m, team_a_players: [], team_b_players: [] }));
  }
  return rows;
}

/**
 * Rank the players of a group by wins, then point differential.
 * Returns detailed rows [{ id, wins, diff }] best-first — the stats are
 * needed to compare 3rd-place finishers across different groups.
 */
export function rankGroupDetailed(groupPlayerIds, groupMatches) {
  const stats = Object.fromEntries(groupPlayerIds.map((id) => [id, { id, wins: 0, diff: 0 }]));

  groupMatches
    .filter((m) => m.played)
    .forEach((m) => {
      const aWon = teamAWon(m);
      const diffA = pointsDiffA(m);
      m.team_a_players.forEach((pid) => {
        if (!stats[pid]) return;
        stats[pid].diff += diffA;
        if (aWon) stats[pid].wins += 1;
      });
      m.team_b_players.forEach((pid) => {
        if (!stats[pid]) return;
        stats[pid].diff -= diffA;
        if (!aWon) stats[pid].wins += 1;
      });
    });

  return Object.values(stats).sort((a, b) => b.wins - a.wins || b.diff - a.diff);
}

/** Player IDs of a group, best-first. Top 2 advance. */
export function rankGroup(groupPlayerIds, groupMatches) {
  return rankGroupDetailed(groupPlayerIds, groupMatches).map((s) => s.id);
}

/**
 * Given the current round's per-group rankings (each an ordered array of
 * detailed rows best-first), compute the ordered list of players who
 * advance to the next round:
 *   top 2 of every group, plus the best 3rd places to reach the next
 *   multiple of 4. The returned order is round-robin-dealt so the group
 *   winners are spread across the fresh groups, not stacked together.
 *
 * @param {Array<Array<{id,wins,diff}>>} rankedGroups
 * @returns {string[]} player ids, flattened in fresh-group order
 */
export function kingAdvancers(rankedGroups) {
  const firsts = rankedGroups.map((g) => g[0]).filter(Boolean);
  const seconds = rankedGroups.map((g) => g[1]).filter(Boolean);
  const thirds = rankedGroups.map((g) => g[2]).filter(Boolean);

  const qualifiers = [...firsts, ...seconds];
  const target = Math.ceil(qualifiers.length / 4) * 4;
  const deficit = target - qualifiers.length;
  if (deficit > 0) {
    const bestThirds = [...thirds]
      .sort((a, b) => b.wins - a.wins || b.diff - a.diff)
      .slice(0, deficit);
    qualifiers.push(...bestThirds);
  }

  // Order strong→weak by tier, then deal round-robin into groups of 4.
  const ordered = qualifiers.map((s) => s.id);
  const numGroups = ordered.length / 4;
  const groups = Array.from({ length: numGroups }, () => []);
  ordered.forEach((id, i) => groups[i % numGroups].push(id));
  return groups.flat();
}
