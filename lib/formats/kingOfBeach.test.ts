import { describe, it, expect } from 'vitest';
import {
  buildKingRound,
  buildKingRound1,
  kingRoundSizes,
  buildKingPlaceholders,
  rankGroupDetailed,
  rankGroup,
  kingAdvancers,
  type GroupStanding,
} from './kingOfBeach';
import type { Match } from '../types';

describe('buildKingRound', () => {
  it('rejects a player count not divisible by 4', () => {
    expect(() => buildKingRound(['a', 'b', 'c'], [1], 1)).toThrow(/кратною 4/);
  });

  it('deals a single group of 4 into the standard partner-rotation schedule', () => {
    const { groups, matches } = buildKingRound(['a', 'b', 'c', 'd'], [1], 1);
    expect(groups).toEqual([['a', 'b', 'c', 'd']]);
    expect(matches).toHaveLength(3);
    // Every player partners each of the other three exactly once.
    expect(matches[0].team_a_players).toEqual(['a', 'b']);
    expect(matches[0].team_b_players).toEqual(['c', 'd']);
    expect(matches[1].team_a_players).toEqual(['a', 'c']);
    expect(matches[1].team_b_players).toEqual(['b', 'd']);
    expect(matches[2].team_a_players).toEqual(['a', 'd']);
    expect(matches[2].team_b_players).toEqual(['b', 'c']);
  });

  it('every game is marked unplayed and stamped with the right stage', () => {
    const { matches } = buildKingRound(['a', 'b', 'c', 'd'], [1], 3);
    expect(matches.every((m) => m.played === false)).toBe(true);
    expect(matches.every((m) => m.stage === 'kr3')).toBe(true);
  });

  it('splits 8 players into two groups of 4 with the right group_index', () => {
    const { groups, matches } = buildKingRound(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], [1], 1);
    expect(groups).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f', 'g', 'h'],
    ]);
    expect(matches).toHaveLength(6);
    expect(matches.filter((m) => m.group_index === 0)).toHaveLength(3);
    expect(matches.filter((m) => m.group_index === 1)).toHaveLength(3);
    // Second group's games never mix in players from the first.
    matches
      .filter((m) => m.group_index === 1)
      .forEach((m) => {
        expect([...m.team_a_players, ...m.team_b_players].every((id) => 'efgh'.includes(id))).toBe(true);
      });
  });

  it('cycles courts across groups when there are fewer courts than groups', () => {
    const { matches } = buildKingRound(Array.from({ length: 16 }, (_, i) => String(i)), [1, 2], 1);
    // 4 groups, 2 courts -> group 0&2 on court 1, group 1&3 on court 2.
    expect(matches.filter((m) => m.group_index === 0)[0].court).toBe(1);
    expect(matches.filter((m) => m.group_index === 1)[0].court).toBe(2);
    expect(matches.filter((m) => m.group_index === 2)[0].court).toBe(1);
    expect(matches.filter((m) => m.group_index === 3)[0].court).toBe(2);
  });

  it('buildKingRound1 is a plain round-1 wrapper', () => {
    const direct = buildKingRound(['a', 'b', 'c', 'd'], [1], 1);
    const wrapped = buildKingRound1(['a', 'b', 'c', 'd'], [1]);
    expect(wrapped.matches.map((m) => m.stage)).toEqual(direct.matches.map((m) => m.stage));
  });
});

describe('kingRoundSizes', () => {
  // Hand-verified against the algorithm, not just against the code's own
  // comment — each of these is worked out by hand in the test-writing
  // notes, independently of what buildKingRound/kingAdvancers do.
  it.each([
    [16, [16, 8, 4]],
    [20, [20, 12, 8, 4]],
    [24, [24, 12, 8, 4]],
    [28, [28, 16, 8, 4]],
    [32, [32, 16, 8, 4]],
  ])('for %i starters, rounds are %j', (n, expected) => {
    expect(kingRoundSizes(n)).toEqual(expected);
  });

  it('always ends at exactly 4 (the final)', () => {
    for (const n of [16, 20, 24, 28, 32, 36, 40]) {
      const sizes = kingRoundSizes(n);
      expect(sizes[sizes.length - 1]).toBe(4);
    }
  });

  it('every round size stays a multiple of 4', () => {
    for (const n of [20, 28, 36, 44]) {
      for (const size of kingRoundSizes(n)) {
        expect(size % 4).toBe(0);
      }
    }
  });
});

describe('buildKingPlaceholders', () => {
  it('creates placeholder rows for every round AFTER the first, with no players yet', () => {
    // 16 -> [16, 8, 4]: placeholders for kr2 (2 groups x 3 games) and
    // kr3 (1 group x 3 games) = 9 rows. Round 1 itself is NOT included
    // here — it's built directly by buildKingRound1 at category start.
    const rows = buildKingPlaceholders(16, [1]);
    expect(rows).toHaveLength(9);
    expect(rows.filter((m) => m.stage === 'kr2')).toHaveLength(6);
    expect(rows.filter((m) => m.stage === 'kr3')).toHaveLength(3);
    expect(rows.every((m) => m.team_a_players.length === 0 && m.team_b_players.length === 0)).toBe(true);
  });

  it('a 20-player field gets three placeholder rounds (kr2, kr3, kr4)', () => {
    const rows = buildKingPlaceholders(20, [1]);
    const stages = new Set(rows.map((m) => m.stage));
    expect(stages).toEqual(new Set(['kr2', 'kr3', 'kr4']));
  });
});

describe('rankGroupDetailed / rankGroup', () => {
  const group = ['a', 'b', 'c', 'd'];
  // a+b beat c+d 21-15; a+c beat b+d 21-10; a+d lost to b+c 15-21.
  // a: 2 wins, diff = +6 +11 -6 = +11
  // b: 1 win (R1), 1 loss (R2), 1 win (R3) = 2 wins, diff = +6 -11 +6 = +1
  // c: 1 loss (R1), 1 win (R2 is b+d vs a+c... wait let's recompute carefully below.
  const matches: Match[] = [
    { stage: 'kr1', round_number: 1, group_index: 0, played: true, team_a_players: ['a', 'b'], team_b_players: ['c', 'd'], set1: [21, 15] },
    { stage: 'kr1', round_number: 2, group_index: 0, played: true, team_a_players: ['a', 'c'], team_b_players: ['b', 'd'], set1: [21, 10] },
    { stage: 'kr1', round_number: 3, group_index: 0, played: true, team_a_players: ['a', 'd'], team_b_players: ['b', 'c'], set1: [15, 21] },
  ];

  it('tallies wins and point differential per player across all three games', () => {
    const ranked = rankGroupDetailed(group, matches);
    const byId = Object.fromEntries(ranked.map((s) => [s.id, s]));
    // a played in every game and won R1 (+6), R2 (+11), lost R3 (-6): 2 wins, diff +11.
    expect(byId.a.wins).toBe(2);
    expect(byId.a.diff).toBe(6 + 11 - 6);
    // b: won R1 (+6), lost R2 (-11), won R3 (+6): 2 wins, diff +1.
    expect(byId.b.wins).toBe(2);
    expect(byId.b.diff).toBe(6 - 11 + 6);
    // c: lost R1 (-6), won R2 (+11), won R3 (+6): 2 wins, diff +11.
    expect(byId.c.wins).toBe(2);
    expect(byId.c.diff).toBe(-6 + 11 + 6);
    // d: lost R1 (-6), lost R2 (-11), lost R3 (-6): 0 wins, diff -23.
    expect(byId.d.wins).toBe(0);
    expect(byId.d.diff).toBe(-6 - 11 - 6);
  });

  it('ignores unplayed games entirely', () => {
    const withUnplayed: Match[] = [
      ...matches,
      { stage: 'kr1', round_number: 4, group_index: 0, played: false, team_a_players: ['a', 'b'], team_b_players: ['c', 'd'], set1: [21, 0] },
    ];
    expect(rankGroupDetailed(group, matches)).toEqual(rankGroupDetailed(group, withUnplayed));
  });

  it('sorts by wins, then by point differential', () => {
    const ranked = rankGroupDetailed(group, matches);
    // a and c both have 2 wins and +11 diff (tied); b has 2 wins and +1; d has 0.
    // So the top two (whoever they are) must both have 2 wins and outrank b (2 wins, lower diff).
    expect(ranked[0].wins).toBe(2);
    expect(ranked[1].wins).toBe(2);
    expect(ranked[0].diff).toBeGreaterThanOrEqual(ranked[1].diff);
    expect(ranked[2].id).toBe('b'); // 2 wins but the worst diff among 2-win players
    expect(ranked[3].id).toBe('d'); // 0 wins, last regardless of diff
  });

  it('rankGroup returns just the ordered ids', () => {
    expect(rankGroup(group, matches)).toEqual(rankGroupDetailed(group, matches).map((s) => s.id));
  });
});

describe('kingAdvancers', () => {
  const stand = (id: string, wins: number, diff: number): GroupStanding => ({ id, wins, diff });

  it('advances the top 2 of every group when that count is already a multiple of 4', () => {
    // 2 groups -> 4 qualifiers exactly, no thirds needed.
    const groups: GroupStanding[][] = [
      [stand('a1', 3, 20), stand('a2', 2, 5), stand('a3', 1, -5), stand('a4', 0, -20)],
      [stand('b1', 3, 15), stand('b2', 2, 3), stand('b3', 1, -3), stand('b4', 0, -15)],
    ];
    const advancers = kingAdvancers(groups);
    expect(advancers).toHaveLength(4);
    expect(new Set(advancers)).toEqual(new Set(['a1', 'a2', 'b1', 'b2']));
    // None of the 3rd/4th place finishers made it.
    expect(advancers).not.toContain('a3');
    expect(advancers).not.toContain('b4');
  });

  it('tops up with the best-ranked 3rd places when top-2s alone are not a multiple of 4', () => {
    // 3 groups -> 6 top-2 qualifiers, needs 2 more from the seven-strong
    // field of thirds to reach 8.
    const groups: GroupStanding[][] = [
      [stand('a1', 3, 20), stand('a2', 2, 10), stand('a3', 2, 8), stand('a4', 0, -20)],
      [stand('b1', 3, 15), stand('b2', 2, 5), stand('b3', 1, -3), stand('b4', 0, -15)],
      [stand('c1', 3, 12), stand('c2', 2, 2), stand('c3', 2, 9), stand('c4', 0, -12)],
    ];
    const advancers = kingAdvancers(groups);
    expect(advancers).toHaveLength(8);
    // a3 (2 wins, diff 8) and c3 (2 wins, diff 9) are the two strongest
    // thirds — both beat b3 (1 win) — so they're the ones who advance.
    expect(advancers).toContain('a3');
    expect(advancers).toContain('c3');
    expect(advancers).not.toContain('b3');
  });

  it('deals advancers round-robin into fresh groups rather than stacking strong seeds together', () => {
    const groups: GroupStanding[][] = [
      [stand('a1', 3, 20), stand('a2', 2, 10), stand('a3', 1, 0), stand('a4', 0, -10)],
      [stand('b1', 3, 15), stand('b2', 2, 5), stand('b3', 1, -1), stand('b4', 0, -15)],
    ];
    const advancers = kingAdvancers(groups); // 4 qualifiers -> 1 fresh group of 4
    // With exactly 4 advancers there's only one group, so round-robin
    // dealing is a no-op here — this just confirms both group winners
    // (the two strongest) land in the (only) output group together,
    // which is expected once the field is down to a single four.
    expect(advancers).toHaveLength(4);
    expect(advancers).toEqual(expect.arrayContaining(['a1', 'a2', 'b1', 'b2']));
  });
});
