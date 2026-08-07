import { describe, it, expect } from 'vitest';
import { buildMatchesForTournament, computeStandings, validateScore } from './tournamentEngine';
import type { Match } from './types';

describe('buildMatchesForTournament', () => {
  const schedule = [
    {
      round: 1,
      matches: [
        { teamA: [0, 1], teamB: [2, 3] },
        { teamA: [4, 5], teamB: [6, 7] },
      ],
    },
    { round: 2, matches: [{ teamA: [0, 2], teamB: [1, 3] }] },
  ];
  const playerIds = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

  it('resolves slot indices to actual player ids', () => {
    const matches = buildMatchesForTournament(schedule, playerIds, [1]);
    expect(matches[0].team_a_players).toEqual(['p0', 'p1']);
    expect(matches[0].team_b_players).toEqual(['p2', 'p3']);
  });

  it('marks every generated match as not yet played', () => {
    const matches = buildMatchesForTournament(schedule, playerIds, [1]);
    expect(matches.every((m) => m.played === false)).toBe(true);
  });

  it('carries the round number through unchanged', () => {
    const matches = buildMatchesForTournament(schedule, playerIds, [1]);
    expect(matches.map((m) => m.round_number)).toEqual([1, 1, 2]);
  });

  it('alternates between two courts when two are configured', () => {
    const matches = buildMatchesForTournament(schedule, playerIds, [1, 2]);
    // Two matches in round 1: index 0 -> court[0], index 1 -> court[1]
    expect(matches[0].court).toBe(1);
    expect(matches[1].court).toBe(2);
  });

  it('pins every match to the single configured court', () => {
    const matches = buildMatchesForTournament(schedule, playerIds, [1]);
    expect(matches.every((m) => m.court === 1)).toBe(true);
  });
});

describe('computeStandings', () => {
  const players = [
    { id: 'a', full_name: 'Alice' },
    { id: 'b', full_name: 'Bob' },
    { id: 'c', full_name: 'Cara' },
    { id: 'd', full_name: 'Dan' },
  ];

  it('ignores unplayed matches', () => {
    const matches: Match[] = [
      { played: false, team_a_players: ['a', 'b'], team_b_players: ['c', 'd'], set1: [21, 15] },
    ];
    const rows = computeStandings(players, matches);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });

  it('credits a win to the winning team and a loss to the other', () => {
    const matches: Match[] = [
      { played: true, team_a_players: ['a', 'b'], team_b_players: ['c', 'd'], set1: [21, 15] },
    ];
    const rows = computeStandings(players, matches);
    const byId = Object.fromEntries(rows.map((r) => [r.player.id, r]));
    expect(byId.a.wins).toBe(1);
    expect(byId.b.wins).toBe(1);
    expect(byId.c.wins).toBe(0);
    expect(byId.d.wins).toBe(0);
    expect(byId.a.gamesFor).toBe(21);
    expect(byId.a.gamesAgainst).toBe(15);
  });

  it('sorts by wins, then point differential, then points scored', () => {
    const matches: Match[] = [
      // a+b beat c+d 21-15 (round 1)
      { played: true, team_a_players: ['a', 'b'], team_b_players: ['c', 'd'], set1: [21, 15] },
      // a+c beat b+d 21-10 (round 2) — a now has 2 wins, best diff
      { played: true, team_a_players: ['a', 'c'], team_b_players: ['b', 'd'], set1: [21, 10] },
    ];
    const rows = computeStandings(players, matches);
    expect(rows[0].player.id).toBe('a'); // 2 wins — ranked first
  });

  it('breaks ties alphabetically by name only as a last resort', () => {
    const matches: Match[] = [];
    const rows = computeStandings(players, matches);
    expect(rows.map((r) => r.player.full_name)).toEqual(['Alice', 'Bob', 'Cara', 'Dan']);
  });
});

describe('validateScore', () => {
  it('accepts a valid score summing to the target', () => {
    expect(validateScore(21, 10, 31)).toEqual({ valid: true });
  });

  it('rejects non-integer scores', () => {
    expect(validateScore(21.5, 9.5, 31).valid).toBe(false);
  });

  it('rejects a tied score', () => {
    expect(validateScore(15, 15, 30).valid).toBe(false);
  });

  it('rejects a score that does not sum to the target', () => {
    expect(validateScore(21, 15, 31).valid).toBe(false);
  });
});
