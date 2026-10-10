import { describe, it, expect } from 'vitest';
import { AMERICANO_6_SCHEDULES, AMERICANO_SCHEDULE, buildAmericano6Matches, americankaSum, americankaGames } from './americano';

type Def = { teamA: number[]; teamB: number[] };
const games = (plan: { matches: Def[] }[]) => plan.flatMap((r) => r.matches);
const key = (a: number, b: number) => [a, b].sort().join('+');

function stats(list: Def[], n: number) {
  const plays = Array(n).fill(0);
  const partners = new Map<string, number>();
  const restRuns: number[] = [];
  let maxRun = 0;
  const run = Array(n).fill(0);
  let prevRest: number[] = [];
  let restTwice = false;
  for (const g of list) {
    const on = [...g.teamA, ...g.teamB];
    on.forEach((p) => plays[p]++);
    partners.set(key(g.teamA[0], g.teamA[1]), (partners.get(key(g.teamA[0], g.teamA[1])) || 0) + 1);
    partners.set(key(g.teamB[0], g.teamB[1]), (partners.get(key(g.teamB[0], g.teamB[1])) || 0) + 1);
    const rest = [...Array(n).keys()].filter((p) => !on.includes(p));
    if (rest.some((p) => prevRest.includes(p))) restTwice = true;
    prevRest = rest;
    for (let p = 0; p < n; p++) {
      run[p] = on.includes(p) ? run[p] + 1 : 0;
      maxRun = Math.max(maxRun, run[p]);
    }
  }
  return { plays, partners, restTwice, maxRun, restRuns };
}

describe('americanka for 6', () => {
  it('9 games: 6 each, everyone partners everyone, 3 repeats never back to back', () => {
    const list = games(AMERICANO_6_SCHEDULES[9]);
    const s = stats(list, 6);
    expect(list.length).toBe(9);
    expect(new Set(s.plays)).toEqual(new Set([6]));
    expect(s.partners.size).toBe(15);
    const twice = [...s.partners].filter(([, c]) => c === 2).map(([k]) => k);
    expect(twice.sort()).toEqual(['0+2', '1+4', '3+5']);
    for (let i = 1; i < list.length; i++) {
      const prev = [key(list[i - 1].teamA[0], list[i - 1].teamA[1]), key(list[i - 1].teamB[0], list[i - 1].teamB[1])];
      expect(prev.includes(key(list[i].teamA[0], list[i].teamA[1]))).toBe(false);
      expect(prev.includes(key(list[i].teamB[0], list[i].teamB[1]))).toBe(false);
    }
    expect(s.restTwice).toBe(false);
    expect(s.maxRun).toBeLessThanOrEqual(3);
  });
  it('6 games: 4 each, no partnership twice, no rest twice in a row', () => {
    const list = games(AMERICANO_6_SCHEDULES[6]);
    const s = stats(list, 6);
    expect(new Set(s.plays)).toEqual(new Set([4]));
    expect([...s.partners.values()].every((c) => c === 1)).toBe(true);
    expect(s.restTwice).toBe(false);
  });
  it('no game repeats in either plan', () => {
    for (const n of [9, 6] as const) {
      const sig = games(AMERICANO_6_SCHEDULES[n]).map((g) => [key(g.teamA[0], g.teamA[1]), key(g.teamB[0], g.teamB[1])].sort().join('|'));
      expect(new Set(sig).size).toBe(sig.length);
    }
  });
  it('8 players: 14 games, everyone partners everyone once and faces everyone exactly twice', () => {
    const list = games(AMERICANO_SCHEDULE);
    const s = stats(list, 8);
    expect(list.length).toBe(14);
    expect([...s.partners.values()].every((c) => c === 1)).toBe(true);
    expect(s.partners.size).toBe(28);
    const opp = new Map<string, number>();
    for (const g of list) for (const a of g.teamA) for (const b of g.teamB) opp.set(key(a, b), (opp.get(key(a, b)) || 0) + 1);
    expect(opp.size).toBe(28);
    expect([...opp.values()].every((c) => c === 2)).toBe(true);
    // each round: all 8 play, nobody twice
    for (const r of AMERICANO_SCHEDULE) {
      const on = r.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
      expect(new Set(on).size).toBe(8);
    }
  });
  it('rows, sums, sizes', () => {
    const rows = buildAmericano6Matches(['a', 'b', 'c', 'd', 'e', 'f'], 3, 6);
    expect(rows.length).toBe(6);
    expect(rows[0]).toMatchObject({ round_number: 1, court: 3, team_a_players: ['c', 'd'], team_b_players: ['e', 'f'] });
    expect(americankaSum(35)).toBe(35);
    expect(americankaSum(21)).toBe(31);
    expect(americankaSum(null)).toBe(31);
    expect(americankaGames(8, 6)).toBe(14);
    expect(americankaGames(6, null)).toBe(9);
    expect(americankaGames(6, 6)).toBe(6);
  });
});
