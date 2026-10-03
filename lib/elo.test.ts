import { describe, it, expect } from 'vitest';
import {
  expectedScore,
  categoryForElo,
  SKILL_CATEGORIES,
  CATEGORY_STARTING_ELO,
  MAX_PAIR_SHARE,
  weakerShare,
  pairDeltas,
  matchDeltas,
  AUTO_K,
} from './elo';

describe('expectedScore', () => {
  it('gives 50% when both ratings are equal', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 5);
  });

  it('favors the higher-rated player', () => {
    expect(expectedScore(1600, 1400)).toBeGreaterThan(0.5);
    expect(expectedScore(1400, 1600)).toBeLessThan(0.5);
  });

  it('is symmetric: A vs B + B vs A sums to 1', () => {
    const a = expectedScore(1720, 1330);
    const b = expectedScore(1330, 1720);
    expect(a + b).toBeCloseTo(1, 10);
  });
});

describe('categoryForElo', () => {
  it('returns null for missing ratings', () => {
    expect(categoryForElo(null)).toBeNull();
    expect(categoryForElo(undefined)).toBeNull();
  });

  it('maps ratings to the documented D/C/B/A bands', () => {
    expect(categoryForElo(800)).toBe(SKILL_CATEGORIES[0]); // D
    expect(categoryForElo(1099)).toBe(SKILL_CATEGORIES[0]); // D
    expect(categoryForElo(1100)).toBe(SKILL_CATEGORIES[1]); // C
    expect(categoryForElo(1399)).toBe(SKILL_CATEGORIES[1]); // C
    expect(categoryForElo(1400)).toBe(SKILL_CATEGORIES[2]); // B
    expect(categoryForElo(1699)).toBe(SKILL_CATEGORIES[2]); // B
    expect(categoryForElo(1700)).toBe(SKILL_CATEGORIES[3]); // A
    expect(categoryForElo(2500)).toBe(SKILL_CATEGORIES[3]); // A, no cap above range
  });

  it('every category starting Elo lands back in its own band', () => {
    // Catches drift if someone edits one table but not the other.
    for (const cat of SKILL_CATEGORIES) {
      const startingElo = CATEGORY_STARTING_ELO[cat.id];
      // Non-null assertion, not a loosened check: categoryForElo only
      // returns null for a missing rating, and startingElo is always a
      // real number here. If that ever stopped being true this line
      // should throw, not silently compare against undefined.
      expect(categoryForElo(startingElo)!.id).toBe(cat.id);
    }
  });
});

describe('weakerShare', () => {
  it('splits evenly when partners are equal', () => {
    expect(weakerShare(1500, 1500, true)).toBeCloseTo(0.5, 10);
    expect(weakerShare(1500, 1500, false)).toBeCloseTo(0.5, 10);
  });

  it('reproduces the spec example: 1800 + 1200 → 70/30', () => {
    // average 1500, gap 600 → 600/1500 = 40% → shift 20%
    expect(weakerShare(1200, 1800, true)).toBeCloseTo(0.7, 10);
    expect(weakerShare(1200, 1800, false)).toBeCloseTo(0.3, 10);
  });

  it('favours the weaker player in both directions', () => {
    expect(weakerShare(1200, 1600, true)).toBeGreaterThan(0.5); // more of a win
    expect(weakerShare(1200, 1600, false)).toBeLessThan(0.5); // less of a loss
  });

  it('never exceeds MAX_PAIR_SHARE, however wide the gap', () => {
    expect(weakerShare(800, 2200, true)).toBe(MAX_PAIR_SHARE);
    expect(weakerShare(800, 2200, false)).toBe(1 - MAX_PAIR_SHARE);
  });

  it('binds the cap exactly when the gap reaches half the average', () => {
    // 900 + 1500: average 1200, gap 600 = 50% → shift 25% → exactly 0.75
    expect(weakerShare(900, 1500, true)).toBeCloseTo(MAX_PAIR_SHARE, 10);
  });

  it('measures the gap against the pair average, not a fixed scale', () => {
    // Same 600-point gap, higher average → a narrower split. This is the
    // documented consequence of normalising by the average.
    const low = weakerShare(1200, 1800, true);
    const high = weakerShare(1700, 2300, true);
    expect(high).toBeLessThan(low);
    expect(high).toBeCloseTo(0.65, 10); // 600/2000 = 30% → shift 15%
  });
});

describe('pairDeltas', () => {
  it('adds back up to the team delta exactly, whatever the split', () => {
    for (const teamDelta of [-31, -20, -7, -1, 0, 1, 7, 20, 31]) {
      for (const [a, b] of [
        [1200, 1800],
        [1500, 1500],
        [2200, 800],
        [1340, 1355],
      ]) {
        const [d1, d2] = pairDeltas(a, b, teamDelta);
        expect(d1 + d2).toBe(teamDelta);
        expect(Number.isInteger(d1)).toBe(true);
        expect(Number.isInteger(d2)).toBe(true);
      }
    }
  });

  it('gives the weaker player more of a win and less of a loss', () => {
    const [weakWin, strongWin] = pairDeltas(1200, 1800, 20);
    expect(weakWin).toBe(14); // 70% of 20
    expect(strongWin).toBe(6);

    const [weakLoss, strongLoss] = pairDeltas(1200, 1800, -20);
    expect(weakLoss).toBe(-6); // 30% of -20
    expect(strongLoss).toBe(-14);
  });

  it('does not depend on the order the partners are passed in', () => {
    const [a, b] = pairDeltas(1200, 1800, 20);
    const [c, d] = pairDeltas(1800, 1200, 20);
    expect([c, d]).toEqual([b, a]);
  });

  it('splits evenly between equal partners', () => {
    expect(pairDeltas(1500, 1500, 20)).toEqual([10, 10]);
    expect(pairDeltas(1500, 1500, -20)).toEqual([-10, -10]);
  });
});

describe('matchDeltas', () => {
  it('reproduces the worked example from the spec', () => {
    // A = 1200 + 1500 → 1350, B = 1500 + 1400 → 1450.
    // E_A = 0.36 → team delta on an A win = round(55 * 0.64) = round(35.2) = 35.
    expect(AUTO_K).toBe(55);
    const [a1, a2, b1, b2] = matchDeltas([1200, 1500], [1500, 1400], true);
    expect(a1).toBe(21); // 1200 — weaker of A, takes 61.1% of the +35 (21.4)
    expect(a2).toBe(14); // 1500 — stronger of A
    expect(b1).toBe(-19); // 1500 — stronger of B, carries the larger share of the loss
    expect(b2).toBe(-16); // 1400 — weaker of B, 46.6% of the -35 (-16.3)
  });

  it('always sums to zero across the four players', () => {
    const cases: [[number, number], [number, number]][] = [
      [
        [1200, 1500],
        [1500, 1400],
      ],
      [
        [800, 2200],
        [1500, 1500],
      ],
      [
        [1000, 1000],
        [1900, 1900],
      ],
      [
        [1333, 1477],
        [1211, 1688],
      ],
    ];
    for (const [teamA, teamB] of cases) {
      for (const aWon of [true, false]) {
        const deltas = matchDeltas(teamA, teamB, aWon);
        expect(deltas.reduce((s, d) => s + d, 0)).toBe(0);
      }
    }
  });

  it('mirrors itself when the result flips', () => {
    // Losing the same match costs the team exactly what winning it paid,
    // because the expected score is the same either way.
    // Equal teams: 55 * 0.5 = 27.5 → 28 either way (half away from zero),
    // split 14/14 inside each pair.
    const win = matchDeltas([1500, 1500], [1500, 1500], true);
    const loss = matchDeltas([1500, 1500], [1500, 1500], false);
    expect(win).toEqual([14, 14, -14, -14]);
    expect(loss).toEqual([-14, -14, 14, 14]);
  });

  it('pays the same amount whichever side is listed as team A', () => {
    // With an odd K, plain Math.round would give 28 one way and 27 the other.
    const aWins = matchDeltas([1300, 1400], [1350, 1350], true);
    const bWins = matchDeltas([1350, 1350], [1300, 1400], false);
    expect(aWins[0] + aWins[1]).toBe(bWins[2] + bWins[3]);
    expect(aWins[2] + aWins[3]).toBe(bWins[0] + bWins[1]);
  });

  it('pays an underdog team more than a favourite for the same win', () => {
    const underdog = matchDeltas([1200, 1200], [1700, 1700], true);
    const favourite = matchDeltas([1700, 1700], [1200, 1200], true);
    expect(underdog[0] + underdog[1]).toBeGreaterThan(favourite[0] + favourite[1]);
  });
});
