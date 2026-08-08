import { describe, it, expect } from 'vitest';
import {
  splitIntoGroups,
  roundRobinPairings,
  teamKey,
  stageForCount,
  computeGroupRanking,
  interleavePlaces,
  computeGroupQualifiers,
  currentFrontier,
  buildKnockoutRound,
  knockoutSurvivors,
  buildGroupStage,
  buildTwoGroupStage,
  buildFourGroupStage,
  buildCrossesPlayoff,
  buildByeCrossesPlayoff,
  computePlacements,
} from './brackets';
import type { SeedTeam } from './doubleElim';
import type { Match } from '../types';

const team = (id: string, p1 = `${id}-p1`, p2 = `${id}-p2`): SeedTeam => ({ id, players: [p1, p2] });

describe('splitIntoGroups', () => {
  it('every team appears exactly once across the output groups', () => {
    const teams = Array.from({ length: 13 }, (_, i) => team(`t${i}`));
    const groups = splitIntoGroups(teams, 4);
    const flat = groups.flat();
    expect(flat).toHaveLength(teams.length);
    expect(new Set(flat.map((t) => t.id)).size).toBe(teams.length);
  });

  it('group sizes never differ by more than 1', () => {
    const teams = Array.from({ length: 13 }, (_, i) => team(`t${i}`));
    const sizes = splitIntoGroups(teams, 4).map((g) => g.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('an exact multiple gives perfectly even groups', () => {
    const teams = Array.from({ length: 8 }, (_, i) => team(`t${i}`));
    const groups = splitIntoGroups(teams, 4);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(4);
    expect(groups[1]).toHaveLength(4);
  });

  it('snake-seeds so the top seed and the last seed of a pass land in the same group', () => {
    // With 8 teams into 2 groups of 4, the snake path visits
    // g0,g1,g1,g0,g0,g1,g1,g0 — so seed 0 (strongest) and seed 3 share a
    // group, keeping the very best players spread rather than stacked.
    const teams = Array.from({ length: 8 }, (_, i) => team(`t${i}`));
    const [gA, gB] = splitIntoGroups(teams, 4);
    const idsA = gA.map((t) => t.id);
    const idsB = gB.map((t) => t.id);
    expect(idsA).toEqual(['t0', 't3', 't4', 't7']);
    expect(idsB).toEqual(['t1', 't2', 't5', 't6']);
  });
});

describe('roundRobinPairings', () => {
  it('every pair of teams meets exactly once, for an even count', () => {
    const rounds = roundRobinPairings(6);
    expect(rounds).toHaveLength(5); // n-1 rounds
    const seen = new Set<string>();
    let total = 0;
    rounds.forEach((r) => {
      expect(r.pairs).toHaveLength(3); // n/2 games per round
      r.pairs.forEach(([a, b]) => {
        const key = [a, b].sort().join('-');
        expect(seen.has(key)).toBe(false); // never repeats
        seen.add(key);
        total++;
      });
    });
    expect(total).toBe((6 * 5) / 2); // C(6,2)
  });

  it('gives every team exactly one bye per round for an odd count, still one meeting each', () => {
    const rounds = roundRobinPairings(5);
    expect(rounds).toHaveLength(5); // odd count still needs n rounds (with a bye) to cover everyone
    const seen = new Set<string>();
    let total = 0;
    rounds.forEach((r) => {
      expect(r.pairs).toHaveLength(2); // one team sits out
      r.pairs.forEach(([a, b]) => {
        seen.add([a, b].sort().join('-'));
        total++;
      });
    });
    expect(total).toBe((5 * 4) / 2); // C(5,2)
  });

  it('handles the smallest possible group of 2 (a single game)', () => {
    const rounds = roundRobinPairings(2);
    expect(rounds).toEqual([{ round: 1, pairs: [[0, 1]] }]);
  });
});

describe('teamKey', () => {
  it('is order-independent', () => {
    expect(teamKey(['a', 'b'])).toBe(teamKey(['b', 'a']));
  });

  it('filters out falsy entries and is stable for null/undefined input', () => {
    expect(teamKey([null, 'a', undefined, 'b'])).toBe(teamKey(['a', 'b']));
    expect(teamKey(null)).toBe('');
    expect(teamKey(undefined)).toBe('');
  });
});

describe('stageForCount', () => {
  it('names the standard knockout rounds', () => {
    expect(stageForCount(2)).toBe('final');
    expect(stageForCount(4)).toBe('semifinal');
    expect(stageForCount(8)).toBe('quarterfinal');
  });

  it('falls back to a generic ko_N label for anything else', () => {
    expect(stageForCount(16)).toBe('ko_16');
    expect(stageForCount(3)).toBe('ko_3');
  });
});

describe('computeGroupRanking', () => {
  const teams = [team('A'), team('B'), team('C'), team('D')];
  // Group 0: A vs B (A wins 21-15), C vs D (C wins 21-10)
  // Group 1 (index 1): only relevant to test grouping separation.
  const matches: Match[] = [
    { stage: 'group', group_index: 0, played: true, team_a_players: ['A-p1', 'A-p2'], team_b_players: ['B-p1', 'B-p2'], set1: [21, 15] },
    { stage: 'group', group_index: 0, played: true, team_a_players: ['C-p1', 'C-p2'], team_b_players: ['D-p1', 'D-p2'], set1: [21, 10] },
  ];

  it('ranks teams within a group by wins then point differential', () => {
    const ranked = computeGroupRanking(teams, matches);
    expect(ranked).toHaveLength(1); // only group_index 0 has played matches
    const ids = ranked[0].map((t) => t.id);
    // Both A and C have 1 win; C's diff (+11) beats A's (+6).
    expect(ids).toEqual(['C', 'A', 'B', 'D']);
  });

  it('ignores non-group-stage matches and unplayed matches', () => {
    const withNoise: Match[] = [
      ...matches,
      { stage: 'final', group_index: 0, played: true, team_a_players: ['A-p1', 'A-p2'], team_b_players: ['C-p1', 'C-p2'], set1: [21, 0] },
      { stage: 'group', group_index: 0, played: false, team_a_players: ['B-p1', 'B-p2'], team_b_players: ['D-p1', 'D-p2'], set1: [21, 0] },
    ];
    expect(computeGroupRanking(teams, withNoise)).toEqual(computeGroupRanking(teams, matches));
  });

  it('keeps separate groups separate, ordered by group_index', () => {
    const twoGroups: Match[] = [
      ...matches,
      { stage: 'group', group_index: 1, played: true, team_a_players: ['B-p1', 'B-p2'], team_b_players: ['D-p1', 'D-p2'], set1: [21, 5] },
    ];
    const ranked = computeGroupRanking(teams, twoGroups);
    expect(ranked).toHaveLength(2);
    expect(ranked[1].map((t) => t.id)).toEqual(['B', 'D']);
  });
});

describe('interleavePlaces', () => {
  it('deals a rank across every group before moving to the next rank', () => {
    const groups = [
      [team('A1'), team('A2')],
      [team('B1'), team('B2')],
      [team('C1'), team('C2')],
    ];
    const out = interleavePlaces(groups, [0, 1]);
    expect(out.map((t) => t.id)).toEqual(['A1', 'B1', 'C1', 'A2', 'B2', 'C2']);
  });

  it('skips a group that has no team at that rank (short group)', () => {
    const groups = [[team('A1'), team('A2')], [team('B1')]];
    const out = interleavePlaces(groups, [0, 1]);
    expect(out.map((t) => t.id)).toEqual(['A1', 'B1', 'A2']);
  });
});

describe('computeGroupQualifiers', () => {
  it('is computeGroupRanking cross-seeded to the top N', () => {
    const teams = [team('A'), team('B'), team('C'), team('D')];
    const matches: Match[] = [
      { stage: 'group', group_index: 0, played: true, team_a_players: ['A-p1', 'A-p2'], team_b_players: ['B-p1', 'B-p2'], set1: [21, 15] },
      { stage: 'group', group_index: 1, played: true, team_a_players: ['C-p1', 'C-p2'], team_b_players: ['D-p1', 'D-p2'], set1: [21, 15] },
    ];
    const top1 = computeGroupQualifiers(teams, matches, 1);
    expect(top1.map((t) => t.id)).toEqual(['A', 'C']);
  });
});

describe('currentFrontier', () => {
  it('picks the stage with the fewest distinct teams still in it', () => {
    const matches: Match[] = [
      { stage: 'quarterfinal', played: false, team_a_players: ['a'], team_b_players: ['b'] },
      { stage: 'quarterfinal', played: false, team_a_players: ['c'], team_b_players: ['d'] },
      { stage: 'semifinal', played: false, team_a_players: ['a'], team_b_players: ['c'] },
    ];
    const frontier = currentFrontier(matches);
    expect(frontier?.stage).toBe('semifinal'); // 2 teams vs 4 in the quarterfinal
  });

  it('is null for an empty bracket', () => {
    expect(currentFrontier([])).toBeNull();
  });
});

describe('buildKnockoutRound', () => {
  it('pairs best seed vs worst seed for an even field', () => {
    const teams = [team('1'), team('2'), team('3'), team('4')];
    const rows = buildKnockoutRound(teams, [1]);
    expect(rows).toHaveLength(2);
    expect(rows[0].stage).toBe('semifinal');
    expect(rows[0].team_a_players).toEqual(['1-p1', '1-p2']);
    expect(rows[0].team_b_players).toEqual(['4-p1', '4-p2']); // 1 vs 4
    expect(rows[1].team_a_players).toEqual(['2-p1', '2-p2']);
    expect(rows[1].team_b_players).toEqual(['3-p1', '3-p2']); // 2 vs 3
    expect(rows.every((m) => !m.played)).toBe(true);
  });

  it('gives the odd team out a pre-completed walkover, not a real game', () => {
    const teams = [team('1'), team('2'), team('3')];
    const rows = buildKnockoutRound(teams, [1]);
    expect(rows).toHaveLength(2); // seed1 vs seed3 is the one real game; seed2 (the middle) sits out
    expect(rows[0].team_a_players).toEqual(['1-p1', '1-p2']);
    expect(rows[0].team_b_players).toEqual(['3-p1', '3-p2']);
    const walkover = rows[rows.length - 1];
    expect(walkover.played).toBe(true);
    expect(walkover.set1).toEqual([1, 0]);
    expect(walkover.team_b_players).toEqual([]);
    expect(walkover.team_a_players).toEqual(['2-p1', '2-p2']); // the middle seed, left over once 1 and 3 are paired
  });
});

describe('knockoutSurvivors', () => {
  it('extracts the winner of each match, ordered by round_number, mapped back to the team object', () => {
    const teams = [team('A'), team('B'), team('C'), team('D')];
    const matches: Match[] = [
      { round_number: 2, played: true, team_a_players: ['C-p1', 'C-p2'], team_b_players: ['D-p1', 'D-p2'], set1: [15, 21] }, // D wins
      { round_number: 1, played: true, team_a_players: ['A-p1', 'A-p2'], team_b_players: ['B-p1', 'B-p2'], set1: [21, 15] }, // A wins
    ];
    const survivors = knockoutSurvivors(teams, matches);
    expect(survivors.map((s) => s.id)).toEqual(['A', 'D']); // round 1 first, despite input order
  });

  it('falls back to an id-less stand-in when the winner is not in the known team map', () => {
    const survivors = knockoutSurvivors([], [
      { round_number: 1, played: true, team_a_players: ['x', 'y'], team_b_players: ['z'], set1: [21, 0] },
    ]);
    expect(survivors[0].id).toBeNull();
    expect(survivors[0].players).toEqual(['x', 'y']);
  });
});

describe('buildGroupStage / buildTwoGroupStage / buildFourGroupStage', () => {
  it('generates a full round-robin inside each group, stamped with the group stage', () => {
    const teams = Array.from({ length: 8 }, (_, i) => team(`t${i}`));
    const rows = buildGroupStage(teams, [1], 4);
    // 2 groups of 4 -> C(4,2) = 6 games each = 12 total.
    expect(rows).toHaveLength(12);
    expect(rows.every((m) => m.stage === 'group')).toBe(true);
    expect(new Set(rows.map((m) => m.group_index))).toEqual(new Set([0, 1]));
  });

  it('buildTwoGroupStage always produces exactly two groups', () => {
    const teams = Array.from({ length: 9 }, (_, i) => team(`t${i}`)); // odd, uneven split
    const rows = buildTwoGroupStage(teams, [1]);
    expect(new Set(rows.map((m) => m.group_index)).size).toBe(2);
  });

  it('buildFourGroupStage always produces exactly four groups for 16 teams', () => {
    const teams = Array.from({ length: 16 }, (_, i) => team(`t${i}`));
    const rows = buildFourGroupStage(teams, [1]);
    expect(new Set(rows.map((m) => m.group_index))).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe('buildCrossesPlayoff', () => {
  it('crosses group winners with the OTHER group\'s runner-up, and wires the final/bronze pointers', () => {
    const gA = [team('A1'), team('A2'), team('A3')];
    const gB = [team('B1'), team('B2'), team('B3')];
    const rows = buildCrossesPlayoff([gA, gB], [1]);

    const sf1 = rows.find((m) => m.stage === 'sf' && m.round_number === 1)!;
    const sf2 = rows.find((m) => m.stage === 'sf' && m.round_number === 2)!;
    expect(sf1.team_a_players).toEqual(['A1-p1', 'A1-p2']);
    expect(sf1.team_b_players).toEqual(['B2-p1', 'B2-p2']); // A1 x B2
    expect(sf2.team_a_players).toEqual(['B1-p1', 'B1-p2']);
    expect(sf2.team_b_players).toEqual(['A2-p1', 'A2-p2']); // B1 x A2

    const final = rows.find((m) => m.stage === 'final')!;
    const bronze = rows.find((m) => m.stage === 'p3_4')!;
    expect(sf1.winner_to_match_id).toBe(final.id);
    expect(sf1.winner_to_slot).toBe('a');
    expect(sf2.winner_to_match_id).toBe(final.id);
    expect(sf2.winner_to_slot).toBe('b');
    expect(sf1.loser_to_match_id).toBe(bronze.id);
    expect(sf2.loser_to_match_id).toBe(bronze.id);
    expect(final.is_final).toBe(true);

    // A3 x B3 for 5th-6th place, full placement beyond the semis.
    const p56 = rows.find((m) => m.stage === 'p5_6')!;
    expect(p56.team_a_players).toEqual(['A3-p1', 'A3-p2']);
    expect(p56.team_b_players).toEqual(['B3-p1', 'B3-p2']);
  });

  it('gives a lone unpaired team a walkover placement match, not a missing one', () => {
    const gA = [team('A1'), team('A2'), team('A3')];
    const gB = [team('B1'), team('B2')]; // B has no 3rd place
    const rows = buildCrossesPlayoff([gA, gB], [1]);
    const p56 = rows.find((m) => m.stage === 'p5_6')!;
    expect(p56.played).toBe(true); // walkover
    expect(p56.team_a_players).toEqual(['A3-p1', 'A3-p2']);
    expect(p56.team_b_players).toEqual([]);
  });
});

describe('buildByeCrossesPlayoff', () => {
  it('requires exactly 4 groups', () => {
    expect(() => buildByeCrossesPlayoff([[team('A1')], [team('B1')]], [1])).toThrow(/4 груп/);
  });

  it('wires play-in, quarterfinal byes, and the semis/final/bronze exactly as documented', () => {
    const mk4 = (label: string) => [team(`${label}1`), team(`${label}2`), team(`${label}3`)];
    const [gA, gB, gC, gD] = [mk4('A'), mk4('B'), mk4('C'), mk4('D')];
    const rows = buildByeCrossesPlayoff([gA, gB, gC, gD], [1]);

    // play-in: A3xC2, A2xC3, B2xD3, B3xD2
    const playIn = rows.filter((m) => m.stage === 'play_in').sort((a, b) => (a.round_number ?? 0) - (b.round_number ?? 0));
    expect(playIn.map((m) => [m.team_a_players[0], m.team_b_players[0]])).toEqual([
      ['A3-p1', 'C2-p1'],
      ['A2-p1', 'C3-p1'],
      ['B2-p1', 'D3-p1'],
      ['B3-p1', 'D2-p1'],
    ]);

    // Quarterfinals start with only the group-winner bye seeded (slot a);
    // slot b is filled later by the score route once the play-in resolves.
    const qf = rows.filter((m) => m.stage === 'qf').sort((a, b) => (a.round_number ?? 0) - (b.round_number ?? 0));
    expect(qf.map((m) => m.team_a_players[0])).toEqual(['D1-p1', 'B1-p1', 'C1-p1', 'A1-p1']);
    expect(qf.every((m) => m.team_b_players.length === 0)).toBe(true);

    // Every play-in winner feeds the "b" slot of exactly one qf.
    playIn.forEach((p, i) => {
      expect(p.winner_to_match_id).toBe(qf[i].id);
      expect(p.winner_to_slot).toBe('b');
    });

    const final = rows.find((m) => m.stage === 'final')!;
    const bronze = rows.find((m) => m.stage === 'p3_4')!;
    expect(final.is_final).toBe(true);
    const sf = rows.filter((m) => m.stage === 'sf');
    expect(sf).toHaveLength(2);
    sf.forEach((s) => {
      expect([final.id]).toContain(s.winner_to_match_id);
      expect([bronze.id]).toContain(s.loser_to_match_id);
    });
  });
});

describe('computePlacements', () => {
  it('awards the winner the high place and the loser the low place', () => {
    const matches: Match[] = [
      { stage: 'final', played: true, team_a_players: ['a'], team_b_players: ['b'], set1: [21, 15] },
      { stage: 'p3_4', played: true, team_a_players: ['c'], team_b_players: ['d'], set1: [15, 21] },
    ];
    const places = computePlacements(matches);
    expect(places).toEqual([
      { place: 1, players: ['a'] },
      { place: 2, players: ['b'] },
      { place: 3, players: ['d'] }, // won the 3-4 match
      { place: 4, players: ['c'] },
    ]);
  });

  it('a walkover only awards the winner\'s place, never a phantom loser', () => {
    const matches: Match[] = [
      { stage: 'p5_6', played: true, team_a_players: ['e'], team_b_players: [], set1: [1, 0] },
    ];
    expect(computePlacements(matches)).toEqual([{ place: 5, players: ['e'] }]);
  });

  it('ignores unplayed matches and unrelated stages', () => {
    const matches: Match[] = [
      { stage: 'final', played: false, team_a_players: ['a'], team_b_players: ['b'], set1: [21, 15] },
      { stage: 'group', played: true, team_a_players: ['a'], team_b_players: ['b'], set1: [21, 15] },
    ];
    expect(computePlacements(matches)).toEqual([]);
  });

  it('is null-safe', () => {
    expect(computePlacements(null)).toEqual([]);
    expect(computePlacements(undefined)).toEqual([]);
  });
});
