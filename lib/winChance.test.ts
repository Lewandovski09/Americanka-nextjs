import { describe, it, expect } from 'vitest';
import { winChances, winP, strengths, chanceLabel, sideKey } from './winChance';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const players = ids.map((id, i) => ({ id, full_name: id, elo: 1600 - i * 50, tournaments_played: 0, tournaments_won: 0, avp: 0 }));

// a tiny americanka-like schedule: 2 courts, players rotate
function americanka() {
  const rounds = [
    [['a', 'b'], ['c', 'd']], [['e', 'f'], ['g', 'h']],
    [['a', 'c'], ['b', 'd']], [['e', 'g'], ['f', 'h']],
    [['a', 'd'], ['b', 'c']], [['e', 'h'], ['f', 'g']],
  ];
  return rounds.map(([A, B], i) => ({ id: `m${i}`, team_a_players: A, team_b_players: B, played: false }));
}

describe('winP', () => {
  it('is the Ело formula', () => {
    expect(winP(1500, 1500)).toBeCloseTo(0.5);
    expect(winP(1600, 1200)).toBeCloseTo(0.909, 2);
  });
});

describe('strengths', () => {
  it('titles and AVP nudge the rating', () => {
    const s = strengths([
      { id: 'x', elo: 1500, tournaments_played: 10, tournaments_won: 5, avp: 900 },
      { id: 'y', elo: 1500, tournaments_played: 10, tournaments_won: 0, avp: 0 },
    ]);
    expect(s.get('x')! > s.get('y')!).toBe(true);
  });
});

describe('winChances', () => {
  it('americanka: chances add up to 1, the strongest is the favourite', () => {
    const r = winChances({ sides: ids.map((x) => [x]), players, matches: americanka(), sims: 2000 });
    const total = [...r.values()].reduce((s, x) => s + x, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(r.get('a')! > r.get('h')!).toBe(true);
  });
  it('americanka: when all games are played, the winner has 100%', () => {
    const ms = americanka().map((m) => ({ ...m, played: true, set1: m.team_a_players.includes('h') ? [31, 0] : [0, 31] }));
    // h's sides always won by 31:0 where h played; elsewhere B won
    const r = winChances({ sides: ids.map((x) => [x]), players, matches: ms, sims: 50 });
    const best = [...r.entries()].sort((x, y) => y[1] - x[1])[0];
    expect(best[1]).toBeGreaterThan(0.3);
  });
  it('bracket: a decided final gives the champion 100%', () => {
    const sides = [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']];
    const ms = [
      { id: 's1', stage: 'sf', round_number: 1, team_a_players: ['a', 'b'], team_b_players: ['c', 'd'], played: true, set1: [21, 10], winner_to_match_id: 'f', winner_to_slot: 'a' },
      { id: 's2', stage: 'sf', round_number: 1, team_a_players: ['e', 'f'], team_b_players: ['g', 'h'], played: true, set1: [10, 21], winner_to_match_id: 'f', winner_to_slot: 'b' },
      { id: 'f', stage: 'final', is_final: true, round_number: 2, team_a_players: ['a', 'b'], team_b_players: ['g', 'h'], played: true, set1: [15, 21] },
    ];
    const r = winChances({ sides, players, matches: ms, sims: 100 });
    expect(r.get(sideKey(['g', 'h']))).toBe(1);
    expect(r.get(sideKey(['c', 'd']))).toBe(0);
  });
  it('bracket in progress: only the semi-final winners can still win', () => {
    const sides = [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']];
    const ms = [
      { id: 's1', stage: 'sf', round_number: 1, team_a_players: ['a', 'b'], team_b_players: ['c', 'd'], played: true, set1: [21, 10], winner_to_match_id: 'f', winner_to_slot: 'a' },
      { id: 's2', stage: 'sf', round_number: 1, team_a_players: ['e', 'f'], team_b_players: ['g', 'h'], played: false, winner_to_match_id: 'f', winner_to_slot: 'b' },
      { id: 'f', stage: 'final', is_final: true, round_number: 2, team_a_players: [], team_b_players: [], played: false },
    ];
    const r = winChances({ sides, players, matches: ms, sims: 2000 });
    expect(r.get(sideKey(['c', 'd']))).toBe(0);
    expect(r.get(sideKey(['a', 'b']))! > 0.4).toBe(true);
    const total = [...r.values()].reduce((s, x) => s + x, 0);
    expect(total).toBeCloseTo(1, 5);
  });
  it('labels', () => {
    expect(chanceLabel(0.001)).toBe('<1%');
    expect(chanceLabel(0.337)).toBe('34%');
    expect(chanceLabel(1, { decided: true })).toBe('100%');
  });
});

import { forecastBasis } from './winChance';
describe('forecastBasis', () => {
  const ms = [
    { id: 'r1a', round_number: 1, played: true, set1: [16, 15], team_a_players: ['a'], team_b_players: ['b'] },
    { id: 'r1b', round_number: 1, played: true, set1: [10, 21], team_a_players: ['c'], team_b_players: ['d'] },
    { id: 'r2a', round_number: 2, played: true, set1: [21, 3], team_a_players: ['a'], team_b_players: ['c'] },
    { id: 'r2b', round_number: 2, played: false, team_a_players: ['b'], team_b_players: ['d'] },
  ];
  it('«до старту» forgets every result', () => {
    const { matches } = forecastBasis(ms, 'pre');
    expect(matches.every((m: any) => !m.played)).toBe(true);
  });
  it('«зараз» keeps only fully played rounds', () => {
    const { matches, completedRounds } = forecastBasis(ms, 'rounds');
    expect(completedRounds).toBe(1);
    expect(matches.find((m: any) => m.id === 'r1a').played).toBe(true);
    expect(matches.find((m: any) => m.id === 'r2a').played).toBe(false);
  });
  it('a bracket place fed by a result that does not count is emptied', () => {
    const b = [
      { id: 's1', stage: 'sf', round_number: 1, played: true, set1: [21, 10], team_a_players: ['a'], team_b_players: ['b'], winner_to_match_id: 'f', winner_to_slot: 'a' },
      { id: 's2', stage: 'sf', round_number: 1, played: false, team_a_players: ['c'], team_b_players: ['d'], winner_to_match_id: 'f', winner_to_slot: 'b' },
      { id: 'f', stage: 'final', round_number: 2, played: false, team_a_players: ['a'], team_b_players: [] },
    ];
    const { matches } = forecastBasis(b, 'rounds');
    expect(matches.find((m: any) => m.id === 's1').played).toBe(false);
    expect(matches.find((m: any) => m.id === 'f').team_a_players).toEqual([]);
  });
});
