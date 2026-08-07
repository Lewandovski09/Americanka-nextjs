import { describe, it, expect } from 'vitest';
import { expectedScore, categoryForElo, SKILL_CATEGORIES, CATEGORY_STARTING_ELO } from './elo';

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
