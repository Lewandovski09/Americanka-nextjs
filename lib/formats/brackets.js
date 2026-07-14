// Bracket systems for the pair formats (single_gender / mix).
//
// Three systems the admin can choose from:
//   double_elimination              — see doubleElim.js
//   groups_crosses_1_2              — 2 groups, top-2 cross over
//   groups_top1_bye_top23_crosses   — 2 groups, top-3; 1st bye, 2-3 cross
//
// The two group systems share the round-robin group stage below and then
// build a FULL-PLACEMENT playoff skeleton (buildCrossesPlayoff /
// buildByeCrossesPlayoff) once the groups are complete — every pair ends
// up with an exact place, like the paper ЧУ Masters brackets.

import { randomUUID } from 'crypto';
import { teamAWon, pointsTotals } from './sets';

/**
 * Split N teams into balanced groups of the given size (default 4),
 * seeded so the strongest teams are spread across groups.
 *
 * @param {Array} teams - [{ id, seed }] best-first
 * @param {number} groupSize
 * @returns {Array<Array>} groups of teams
 */
export function splitIntoGroups(teams, groupSize = 4) {
  const groupCount = Math.ceil(teams.length / groupSize);
  const groups = Array.from({ length: groupCount }, () => []);
  // Snake seeding: 0,1,2,..,n-1,n-1,..,1,0 so groups stay balanced.
  let dir = 1;
  let g = 0;
  teams.forEach((team) => {
    groups[g].push(team);
    if (dir === 1 && g === groupCount - 1) dir = -1;
    else if (dir === -1 && g === 0) dir = 1;
    else g += dir;
  });
  return groups;
}

/**
 * Round-robin pairings (indices) for a group of teams.
 * Standard circle method.
 */
export function roundRobinPairings(teamCount) {
  const idx = [...Array(teamCount).keys()];
  if (teamCount % 2 === 1) idx.push(null); // bye
  const n = idx.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = idx[i];
      const b = idx[n - 1 - i];
      if (a !== null && b !== null) pairs.push([a, b]);
    }
    // rotate, keeping the first element fixed
    idx.splice(1, 0, idx.pop());
    rounds.push({ round: r + 1, pairs });
  }
  return rounds;
}

/**
 * Build the GROUP STAGE matches shared by the three group-based
 * systems (groups_playoff, groups_crosses_1_2,
 * groups_top1_playoff_top23_crosses). Each team plays every other team
 * in its group once. The playoff / crosses phase is generated later,
 * once every group match has a result (Stage 4b).
 *
 * @param {Array} teams - [{ id, players: [p1, p2] }] (player2 may be
 *   absent for a solo-standing team; both ids are passed through)
 * @param {number[]} courts
 * @param {number} groupSize
 * @returns {object[]} match rows (without tournament_id)
 */
// Stable identity for a team based on its player ids (order-independent),
// used to map a match side back to its tournament_teams row.
export function teamKey(players) {
  return [...(players || [])].filter(Boolean).map(String).sort().join('|');
}

export function stageForCount(n) {
  if (n === 2) return 'final';
  if (n === 4) return 'semifinal';
  if (n === 8) return 'quarterfinal';
  return `ko_${n}`;
}

/**
 * Rank the qualifiers coming out of the group stage.
 * @param {Array} teams - [{ id, players }]
 * @param {Array} groupMatches - played group-stage match rows
 * @param {number} topN - how many advance from each group (default 2)
 * @returns {Array} seeded qualifier teams: all group winners (in group
 *   order), then all runners-up, etc. — so a winner meets a runner-up
 *   of another group first.
 */
// Rank every group internally (best first) from its played matches.
// Returns an array of groups (in group_index order), each an ordered
// array of team objects.
export function computeGroupRanking(teams, groupMatches) {
  const keyToTeam = new Map(teams.map((t) => [teamKey(t.players), t]));
  const groups = new Map(); // groupIndex -> Map(teamId -> {team, wins, diff})

  groupMatches
    .filter((m) => m.stage === 'group' && m.played)
    .forEach((m) => {
      const gi = m.group_index ?? 0;
      if (!groups.has(gi)) groups.set(gi, new Map());
      const g = groups.get(gi);
      const tA = keyToTeam.get(teamKey(m.team_a_players));
      const tB = keyToTeam.get(teamKey(m.team_b_players));
      const aWon = teamAWon(m);
      const [ptsA, ptsB] = pointsTotals(m);
      for (const [team, gf, ga, won] of [
        [tA, ptsA, ptsB, aWon],
        [tB, ptsB, ptsA, !aWon],
      ]) {
        if (!team) continue;
        if (!g.has(team.id)) g.set(team.id, { team, wins: 0, diff: 0 });
        const s = g.get(team.id);
        s.wins += won ? 1 : 0;
        s.diff += gf - ga;
      }
    });

  return [...groups.keys()]
    .sort((a, b) => a - b)
    .map((gi) => [...groups.get(gi).values()].sort((a, b) => b.wins - a.wins || b.diff - a.diff).map((s) => s.team));
}

// Interleave the given place indices across groups so a group winner
// meets another group's runner-up first (cross seeding). e.g.
// ranks [0,1] → [A1, B1, C1, …, A2, B2, C2, …].
export function interleavePlaces(rankedByGroup, ranks) {
  const out = [];
  for (const rank of ranks) {
    for (const group of rankedByGroup) {
      if (group[rank]) out.push(group[rank]);
    }
  }
  return out;
}

// Backwards-compatible: seeded top-N qualifiers (cross seeded).
export function computeGroupQualifiers(teams, groupMatches, topN = 2) {
  const ranked = computeGroupRanking(teams, groupMatches);
  return interleavePlaces(
    ranked,
    Array.from({ length: topN }, (_, i) => i)
  );
}

// The current "frontier" round of a knockout bracket = the stage with
// the fewest distinct teams still involved (rounds shrink each time).
export function currentFrontier(koMatches) {
  const byStage = new Map();
  koMatches.forEach((m) => {
    if (!byStage.has(m.stage)) byStage.set(m.stage, []);
    byStage.get(m.stage).push(m);
  });
  let frontier = null;
  let fewest = Infinity;
  for (const [stage, ms] of byStage) {
    const set = new Set();
    ms.forEach((m) => {
      const ka = teamKey(m.team_a_players);
      const kb = teamKey(m.team_b_players);
      if (ka) set.add(ka);
      if (kb) set.add(kb);
    });
    if (set.size < fewest) {
      fewest = set.size;
      frontier = { stage, ms };
    }
  }
  return frontier;
}

/**
 * Build one knockout round from a seeded list of teams. Pairs best vs
 * worst (i vs n-1-i). An odd team out gets a walkover (a pre-completed
 * 1:0 match) so it advances without a real game — this needs no extra
 * schema and keeps "round complete" detection uniform.
 */
export function buildKnockoutRound(orderedTeams, courts) {
  const m = orderedTeams.length;
  const stage = stageForCount(m);
  const rows = [];
  let slot = 0;

  for (let i = 0; i < Math.floor(m / 2); i++) {
    const a = orderedTeams[i];
    const b = orderedTeams[m - 1 - i];
    rows.push({
      round_number: slot + 1,
      stage,
      court: courts[slot % courts.length],
      team_a_players: a.players.filter(Boolean),
      team_b_players: b.players.filter(Boolean),
      played: false,
    });
    slot++;
  }

  if (m % 2 === 1) {
    const bye = orderedTeams[Math.floor(m / 2)];
    rows.push({
      round_number: slot + 1,
      stage,
      court: courts[slot % courts.length],
      team_a_players: bye.players.filter(Boolean),
      team_b_players: [],
      set1: [1, 0],
      played: true,
      played_at: new Date().toISOString(),
    });
  }

  return rows;
}

/**
 * Winners of a completed knockout round, ordered by slot (round_number),
 * ready to seed the next round.
 */
export function knockoutSurvivors(teams, roundMatches) {
  const keyToTeam = new Map(teams.map((t) => [teamKey(t.players), t]));
  return [...roundMatches]
    .sort((a, b) => a.round_number - b.round_number)
    .map((m) => {
      const winnerPlayers = teamAWon(m) ? m.team_a_players : m.team_b_players;
      return keyToTeam.get(teamKey(winnerPlayers)) || { id: null, players: winnerPlayers };
    });
}

export function buildGroupStage(teams, courts, groupSize = 4) {
  const seeded = teams.map((t, i) => ({ ...t, seed: i }));
  const groups = splitIntoGroups(seeded, groupSize);

  const matches = [];
  let courtCursor = 0;
  groups.forEach((group, groupIndex) => {
    roundRobinPairings(group.length).forEach((round) => {
      round.pairs.forEach(([a, b]) => {
        const teamA = group[a];
        const teamB = group[b];
        matches.push({
          round_number: round.round,
          group_index: groupIndex,
          stage: 'group',
          court: courts[courtCursor++ % courts.length],
          team_a_players: teamA.players.filter(Boolean),
          team_b_players: teamB.players.filter(Boolean),
          played: false,
        });
      });
    });
  });

  return matches;
}

// ── Two-group systems (crosses) ───────────────────────────────
//
// Both group crosses systems run EXACTLY two groups. Teams are snake-
// seeded (best-first) so the two group winners land in different groups;
// an odd count leaves one group one team larger.

export function buildTwoGroupStage(teams, courts) {
  const groupSize = Math.ceil(teams.length / 2); // ceil → exactly 2 groups
  return buildGroupStage(teams, courts, groupSize);
}

// Format 3 (ЧУ Masters file): exactly 16 pairs → 4 snake-seeded groups of 4.
export function buildFourGroupStage(teams, courts) {
  return buildGroupStage(teams, courts, 4);
}

// Serialize playoff nodes ({ id, stage, round, a, b, winnerTo, loserTo,
// isFinal, walkover }) into match rows the score route can propagate.
function serializePlayoff(nodes, courts) {
  const now = new Date().toISOString();
  return nodes.map((n, i) => ({
    id: n.id,
    stage: n.stage,
    round_number: n.round,
    group_index: null,
    court: courts[i % courts.length],
    team_a_players: n.a?.players?.filter(Boolean) || [],
    team_b_players: n.b?.players?.filter(Boolean) || [],
    winner_to_match_id: n.winnerTo?.id || null,
    winner_to_slot: n.winnerTo?.slot || null,
    loser_to_match_id: n.loserTo?.id || null,
    loser_to_slot: n.loserTo?.slot || null,
    is_final: !!n.isFinal,
    set1: n.walkover ? [1, 0] : null,
    played: !!n.walkover,
    ...(n.walkover ? { played_at: now } : {}),
  }));
}

const mkNode = (stage, round, extra = {}) => ({
  id: randomUUID(),
  stage,
  round,
  a: null,
  b: null,
  winnerTo: null,
  loserTo: null,
  isFinal: false,
  walkover: false,
  ...extra,
});

// Rank-vs-rank placement matches for the teams that did NOT reach the
// playoff: A's k-th team plays B's k-th team for places (2k+1, 2k+2).
// `startIndex` is the first group rank that misses the playoff (2 for a
// top-2 system, 3 for a top-3 system). An odd total leaves the larger
// group's last team without an opponent → a walkover into that place.
function placementNodes(gA, gB, startIndex) {
  const nodes = [];
  const maxLen = Math.max(gA.length, gB.length);
  for (let i = startIndex; i < maxLen; i++) {
    const a = gA[i];
    const b = gB[i];
    const stage = `p${2 * i + 1}_${2 * i + 2}`;
    if (a && b) nodes.push(mkNode(stage, 1, { a, b }));
    else if (a || b) nodes.push(mkNode(stage, 1, { a: a || b, walkover: true }));
  }
  return nodes;
}

// FORMAT 2 — top-2 of each group cross over.
//   sf1: A1 × B2 ,  sf2: B1 × A2  → final (1-2) + bronze (3-4)
//   then A3×B3 (5-6), A4×B4 (7-8), …  for full placement.
export function buildCrossesPlayoff(rankedGroups, courts) {
  const [gA, gB] = rankedGroups;
  const [A1, A2] = gA;
  const [B1, B2] = gB;

  const sf1 = mkNode('sf', 1, { a: A1, b: B2 });
  const sf2 = mkNode('sf', 2, { a: B1, b: A2 });
  const final = mkNode('final', 1, { isFinal: true });
  const bronze = mkNode('p3_4', 1);

  sf1.winnerTo = { id: final.id, slot: 'a' };
  sf1.loserTo = { id: bronze.id, slot: 'a' };
  sf2.winnerTo = { id: final.id, slot: 'b' };
  sf2.loserTo = { id: bronze.id, slot: 'b' };

  return serializePlayoff([sf1, sf2, final, bronze, ...placementNodes(gA, gB, 2)], courts);
}

// FORMAT 3 — "Групи: 1-е бай, 2-3 хрести", 1:1 with the ЧУ Masters file.
// 16 pairs, 4 groups (A,B,C,D) of 4, top-3 advance. Group winners get a bye
// to the quarterfinals; 2nd/3rd cross in a play-in. Groups are paired
// (A↔C, B↔D). Placement is by elimination round WITH TIES — only the final
// (1-2) and the 3rd-place match (3-4) are played out; the four QF losers
// share 5th, the four play-in losers share 9th and the four group-4th share
// 13th (see computeFilePlaces on the client).
//
//   play-in:  A3×C2 , A2×C3 , B2×D3 , B3×D2
//   qf:       D1×W(A3C2) , B1×W(A2C3) , C1×W(B2D3) , A1×W(B3D2)
//   sf:       W(qf1)×W(qf2) , W(qf3)×W(qf4)
//   final:    W(sf1)×W(sf2)     bronze: L(sf1)×L(sf2)
export function buildByeCrossesPlayoff(rankedGroups, courts) {
  if (rankedGroups.length < 4) {
    throw new Error('Для формату «1-е бай, 2-3 хрести» потрібно 4 групи (16 пар)');
  }
  const [gA, gB, gC, gD] = rankedGroups;
  const [A1, A2, A3] = gA;
  const [B1, B2, B3] = gB;
  const [C1, C2, C3] = gC;
  const [D1, D2, D3] = gD;

  // Play-in: 2nd/3rd cross between paired groups (A↔C, B↔D).
  const p1 = mkNode('play_in', 1, { a: A3, b: C2 });
  const p2 = mkNode('play_in', 2, { a: A2, b: C3 });
  const p3 = mkNode('play_in', 3, { a: B2, b: D3 });
  const p4 = mkNode('play_in', 4, { a: B3, b: D2 });

  // Quarterfinals: group winners (byes) meet the play-in winners.
  const q1 = mkNode('qf', 1, { a: D1 });
  const q2 = mkNode('qf', 2, { a: B1 });
  const q3 = mkNode('qf', 3, { a: C1 });
  const q4 = mkNode('qf', 4, { a: A1 });

  const s1 = mkNode('sf', 1);
  const s2 = mkNode('sf', 2);
  const final = mkNode('final', 1, { isFinal: true });
  const bronze = mkNode('p3_4', 1);

  p1.winnerTo = { id: q1.id, slot: 'b' };
  p2.winnerTo = { id: q2.id, slot: 'b' };
  p3.winnerTo = { id: q3.id, slot: 'b' };
  p4.winnerTo = { id: q4.id, slot: 'b' };

  q1.winnerTo = { id: s1.id, slot: 'a' };
  q2.winnerTo = { id: s1.id, slot: 'b' };
  q3.winnerTo = { id: s2.id, slot: 'a' };
  q4.winnerTo = { id: s2.id, slot: 'b' };

  s1.winnerTo = { id: final.id, slot: 'a' };
  s1.loserTo = { id: bronze.id, slot: 'a' };
  s2.winnerTo = { id: final.id, slot: 'b' };
  s2.loserTo = { id: bronze.id, slot: 'b' };

  return serializePlayoff([p1, p2, p3, p4, q1, q2, q3, q4, s1, s2, final, bronze], courts);
}

// Derive the final placement table from played playoff matches. Each
// 'final' / 'pX_Y' match awards place X to its winner and Y to its loser
// (a walkover awards only X). Returns [{ place, players }] best-first.
export function computePlacements(matches) {
  const places = [];
  for (const m of matches || []) {
    if (!m.played) continue;
    let hi;
    let lo;
    if (m.stage === 'final') {
      hi = 1;
      lo = 2;
    } else {
      const g = /^p(\d+)_(\d+)$/.exec(m.stage || '');
      if (!g) continue;
      hi = Number(g[1]);
      lo = Number(g[2]);
    }
    const aWon = teamAWon(m);
    const winner = aWon ? m.team_a_players : m.team_b_players;
    const loser = aWon ? m.team_b_players : m.team_a_players;
    if (winner?.length) places.push({ place: hi, players: winner });
    if (loser?.length) places.push({ place: lo, players: loser });
  }
  return places.sort((a, b) => a.place - b.place);
}
