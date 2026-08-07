import { describe, it, expect } from 'vitest';
import { setsOf, aggregateScore, teamAWon, pointsTotals, pointsDiffA, scoreLabel } from './sets';
import type { MatchSets } from '../types';

// Explicit MatchSets annotation, not inference: without it TS widens
// `[21, 15]` to plain `number[]` at the point of declaration (it has no
// reason yet to know it's headed for a 2-tuple), and every call site
// below would then fail to match setsOf/teamAWon's MatchSets parameter.
const singleSet: MatchSets = { set1: [21, 15], set2: null, set3: null };
const bestOfThree: MatchSets = { set1: [21, 18], set2: [15, 21], set3: [15, 10] };
const unplayed: MatchSets = { set1: null, set2: null, set3: null };
const walkover: MatchSets = { set1: [1, 0], set2: null, set3: null };

describe('setsOf', () => {
  it('collects only the filled sets, in order', () => {
    expect(setsOf(singleSet)).toEqual([[21, 15]]);
    expect(setsOf(bestOfThree)).toEqual([[21, 18], [15, 21], [15, 10]]);
    expect(setsOf(unplayed)).toEqual([]);
  });
});

describe('aggregateScore', () => {
  it('is null for an unplayed match', () => {
    expect(aggregateScore(unplayed)).toBeNull();
  });

  it('is the raw points for a single-set match', () => {
    expect(aggregateScore(singleSet)).toEqual([21, 15]);
  });

  it('is sets won for a multi-set match, not summed points', () => {
    // team A: 21-18 win, 15-21 loss, 15-10 win → 2 sets to 1
    expect(aggregateScore(bestOfThree)).toEqual([2, 1]);
  });
});

describe('teamAWon', () => {
  it('is false for an unplayed match (never treated as a loss elsewhere)', () => {
    expect(teamAWon(unplayed)).toBe(false);
  });

  it('reads the winner off aggregate sets, not raw points', () => {
    expect(teamAWon(singleSet)).toBe(true);
    expect(teamAWon(bestOfThree)).toBe(true);
    expect(teamAWon(walkover)).toBe(true);
  });

  it('flips for team B', () => {
    const bFlipped: MatchSets = { set1: [15, 21] };
    expect(teamAWon(bFlipped)).toBe(false);
  });
});

describe('pointsTotals / pointsDiffA', () => {
  it('sums every set, unlike aggregateScore', () => {
    expect(pointsTotals(bestOfThree)).toEqual([51, 49]);
    expect(pointsDiffA(bestOfThree)).toBe(2);
  });

  it('is [0, 0] / 0 for an unplayed match', () => {
    expect(pointsTotals(unplayed)).toEqual([0, 0]);
    expect(pointsDiffA(unplayed)).toBe(0);
  });
});

describe('scoreLabel', () => {
  it('is null for an unplayed match', () => {
    expect(scoreLabel(unplayed)).toBeNull();
  });

  it('is a plain score for a single set', () => {
    expect(scoreLabel(singleSet)).toBe('21:15');
  });

  it('shows sets-won plus the per-set breakdown for multi-set matches', () => {
    expect(scoreLabel(bestOfThree)).toBe('2:1 (21:18, 15:21, 15:10)');
  });
});
