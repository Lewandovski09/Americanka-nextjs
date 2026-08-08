import { describe, it, expect } from 'vitest';
import { buildDoubleElimination, isPowerOfTwo, type SeedTeam } from './doubleElim';
import type { Match } from '../types';

const mkTeam = (n: number): SeedTeam => ({ id: `T${n}`, players: [`T${n}-p1`, `T${n}-p2`] });
const field = (n: number): SeedTeam[] => Array.from({ length: n }, (_, i) => mkTeam(i + 1));

describe('isPowerOfTwo', () => {
  it('is true for 2, 4, 8, 16, 32', () => {
    [2, 4, 8, 16, 32].forEach((n) => expect(isPowerOfTwo(n)).toBe(true));
  });

  it('is false for non-powers, and for anything below 2', () => {
    [0, 1, 3, 6, 7, 15, 31, 33].forEach((n) => expect(isPowerOfTwo(n)).toBe(false));
  });
});

describe('buildDoubleElimination — validation', () => {
  it('rejects a bracket size that is not a power of two', () => {
    expect(() => buildDoubleElimination([mkTeam(1), mkTeam(2)], [1], 15)).toThrow(/8, 16 або 32/);
  });

  it('rejects a bracket size below 8', () => {
    expect(() => buildDoubleElimination([mkTeam(1), mkTeam(2)], [1], 4)).toThrow(/8, 16 або 32/);
  });

  it('rejects fewer than 2 real teams', () => {
    expect(() => buildDoubleElimination([mkTeam(1)], [1], 8)).toThrow(/Невірна кількість пар/);
    expect(() => buildDoubleElimination([null, null, null], [1], 8)).toThrow(/Невірна кількість пар/);
  });

  it('rejects more teams than the chosen bracket size', () => {
    expect(() => buildDoubleElimination(field(10), [1], 8)).toThrow(/Невірна кількість пар/);
  });

  it('accepts the minimum: exactly 2 real teams padded with empty places', () => {
    const teams = [mkTeam(1), null, null, null, null, null, null, mkTeam(2)];
    expect(() => buildDoubleElimination(teams, [1], 8)).not.toThrow();
  });
});

// Every count below (total matches, per-stage breakdown, exact round-1
// pairings) was checked by actually running the algorithm — see the
// session notes — not derived by hand. That matters here specifically
// because the seeding/bye-collapse logic is exactly the kind of code
// where a plausible-looking hand trace can be subtly wrong.
describe('buildDoubleElimination — known match counts (matches the doc comment: 16→30, 24→46, 32→62)', () => {
  it.each([
    [8, 14],
    [16, 30],
    [32, 62],
  ])('a full field of %i pairs produces %i matches total', (p, expectedTotal) => {
    const rows = buildDoubleElimination(field(p), [1], p);
    expect(rows).toHaveLength(expectedTotal);
  });

  it('24 pairs seeded into a 32-bracket produces 46 matches (byes collapsed away)', () => {
    const rows = buildDoubleElimination(field(24), [1], 32);
    expect(rows).toHaveLength(46);
  });
});

describe('buildDoubleElimination — structural integrity (holds for any valid field)', () => {
  const scenarios: [string, (SeedTeam | null)[], number[], number][] = [
    ['8-pair full field', field(8), [1], 8],
    ['16-pair full field', field(16), [1], 16],
    ['32-pair full field', field(32), [1], 32],
    ['12 real pairs in a 16-bracket', field(12), [1], 16],
    ['24 real pairs in a 32-bracket', field(24), [1], 32],
    [
      'sparse seed column with gaps',
      [mkTeam(1), null, null, mkTeam(4), null, null, mkTeam(7), null, null, mkTeam(10), null, null, mkTeam(13), null, null, mkTeam(16)],
      [1, 2],
      16,
    ],
  ];

  it.each(scenarios)('%s: every winner/loser pointer resolves to a real match, no self-loops', (_label, teams, courts, size) => {
    const rows = buildDoubleElimination(teams, courts, size);
    const ids = new Set(rows.map((m) => m.id));
    rows.forEach((m) => {
      if (m.winner_to_match_id) {
        expect(ids.has(m.winner_to_match_id as string)).toBe(true);
        expect(m.winner_to_match_id).not.toBe(m.id);
      }
      if (m.loser_to_match_id) {
        expect(ids.has(m.loser_to_match_id as string)).toBe(true);
        expect(m.loser_to_match_id).not.toBe(m.id);
      }
    });
  });

  it.each(scenarios)('%s: exactly one final and one 3rd-place match, nothing else marked is_final', (_label, teams, courts, size) => {
    const rows = buildDoubleElimination(teams, courts, size);
    expect(rows.filter((m) => m.stage === 'final')).toHaveLength(1);
    expect(rows.filter((m) => m.stage === 'p3_4')).toHaveLength(1);
    expect(rows.filter((m) => m.is_final)).toHaveLength(1);
    expect(rows.find((m) => m.is_final)?.stage).toBe('final');
  });

  it.each(scenarios)('%s: round_number is dense (1..N) within every stage — the bracket UI sorts on it', (_label, teams, courts, size) => {
    const rows = buildDoubleElimination(teams, courts, size);
    const byStage = new Map<string, number[]>();
    rows.forEach((m) => {
      const stage = m.stage as string;
      if (!byStage.has(stage)) byStage.set(stage, []);
      byStage.get(stage)!.push(m.round_number as number);
    });
    byStage.forEach((nums) => {
      const sorted = [...nums].sort((a, b) => a - b);
      expect(sorted).toEqual(Array.from({ length: sorted.length }, (_, i) => i + 1));
    });
  });

  it.each(scenarios)('%s: wb/lb round numbers are renumbered densely from 1, with no gaps from collapsed byes', (_label, teams, courts, size) => {
    const rows = buildDoubleElimination(teams, courts, size);
    for (const prefix of ['wb', 'lb']) {
      const rounds = [...new Set(rows.filter((m) => (m.stage as string).startsWith(prefix)).map((m) => Number((m.stage as string).slice(2))))].sort((a, b) => a - b);
      expect(rounds).toEqual(Array.from({ length: rounds.length }, (_, i) => i + 1));
    }
  });

  it.each(scenarios)('%s: every match plays out on one of the provided courts, cycling in play order', (_label, teams, courts, size) => {
    const rows = buildDoubleElimination(teams, courts, size);
    rows.forEach((m, i) => expect(m.court).toBe(courts[i % courts.length]));
  });

  it.each(scenarios)('%s: nothing is marked played, and every set is empty — this only builds the skeleton', (_label, teams, courts, size) => {
    const rows = buildDoubleElimination(teams, courts, size);
    expect(rows.every((m) => m.played === false)).toBe(true);
    expect(rows.every((m) => m.set1 === null)).toBe(true);
  });
});

describe('buildDoubleElimination — exact round-1 seeding (verified by running the algorithm, not by hand)', () => {
  it('an 8-pair field pairs 1v8, 5v4, 3v6, 7v2 — the documented seed order', () => {
    const rows = buildDoubleElimination(field(8), [1], 8);
    const wb1 = rows.filter((m) => m.stage === 'wb1').sort((a, b) => (a.round_number as number) - (b.round_number as number));
    const pairs = wb1.map((m) => [(m.team_a_players as string[])[0], (m.team_b_players as string[])[0]]);
    expect(pairs).toEqual([
      ['T1-p1', 'T8-p1'],
      ['T5-p1', 'T4-p1'],
      ['T3-p1', 'T6-p1'],
      ['T7-p1', 'T2-p1'],
    ]);
  });

  it('a 16-pair field pairs 1v16, 9v8, 5v12, 13v4, 3v14, 11v6, 7v10, 15v2', () => {
    const rows = buildDoubleElimination(field(16), [1], 16);
    const wb1 = rows.filter((m) => m.stage === 'wb1').sort((a, b) => (a.round_number as number) - (b.round_number as number));
    const pairs = wb1.map((m) => [(m.team_a_players as string[])[0], (m.team_b_players as string[])[0]]);
    expect(pairs).toEqual([
      ['T1-p1', 'T16-p1'],
      ['T9-p1', 'T8-p1'],
      ['T5-p1', 'T12-p1'],
      ['T13-p1', 'T4-p1'],
      ['T3-p1', 'T14-p1'],
      ['T11-p1', 'T6-p1'],
      ['T7-p1', 'T10-p1'],
      ['T15-p1', 'T2-p1'],
    ]);
    // The two overall favourites are on opposite sides of the draw and
    // can therefore only meet in the final — the whole point of seeding.
    const seed1Match = wb1.find((m) => (m.team_a_players as string[])[0] === 'T1-p1' || (m.team_b_players as string[])[0] === 'T1-p1');
    const seed2Match = wb1.find((m) => (m.team_a_players as string[])[0] === 'T2-p1' || (m.team_b_players as string[])[0] === 'T2-p1');
    expect(seed1Match).not.toBe(seed2Match);
  });

  it('seed 1 never meets seed 2 in round 1 at any tested bracket size', () => {
    for (const p of [8, 16, 32]) {
      const rows = buildDoubleElimination(field(p), [1], p);
      const wb1 = rows.filter((m) => m.stage === 'wb1');
      const together = wb1.some(
        (m) =>
          ((m.team_a_players as string[]).includes('T1-p1') && (m.team_b_players as string[]).includes('T2-p1')) ||
          ((m.team_a_players as string[]).includes('T2-p1') && (m.team_b_players as string[]).includes('T1-p1'))
      );
      expect(together).toBe(false);
    }
  });
});

describe('buildDoubleElimination — bracketSize defaults to teams.length when omitted', () => {
  it('a bare 16-team field with no explicit bracketSize behaves like an explicit 16-bracket', () => {
    const withDefault = buildDoubleElimination(field(16), [1]);
    const explicit = buildDoubleElimination(field(16), [1], 16);
    expect(withDefault).toHaveLength(explicit.length);
    expect(withDefault.map((m) => m.stage)).toEqual(explicit.map((m) => m.stage));
  });
});
