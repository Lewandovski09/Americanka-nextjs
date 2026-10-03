import { describe, it, expect } from 'vitest';
import { pointsForPlace, tierBreakdown, AVP_TIER_IDS, effectiveTier } from './tiers';

describe('AVP payout table', () => {
  it('AVP 500 pays the club table', () => {
    const expected: Array<[number, number]> = [
      [1, 500], [2, 400], [3, 350], [4, 300], [5, 275], [6, 275], [7, 250], [8, 250],
      [9, 150], [12, 150], [13, 100], [16, 100], [17, 0], [32, 0],
    ];
    for (const [place, pts] of expected) expect(pointsForPlace(500, place)).toBe(pts);
  });

  it('AVP 250 pays the club table', () => {
    const expected: Array<[number, number]> = [
      [1, 250], [2, 200], [3, 175], [4, 150], [5, 125], [6, 125], [7, 100], [8, 100],
      [9, 75], [12, 75], [13, 50], [16, 50], [17, 0],
    ];
    for (const [place, pts] of expected) expect(pointsForPlace(250, place)).toBe(pts);
  });

  it('AVP 1000 and 2000 are 2× and 4× AVP 500', () => {
    for (const place of [1, 2, 3, 4, 5, 7, 9, 13, 17]) {
      expect(pointsForPlace(1000, place)).toBe(pointsForPlace(500, place) * 2);
      expect(pointsForPlace(2000, place)).toBe(pointsForPlace(500, place) * 4);
    }
  });

  it('pays nothing for an unknown tier or a nonsense place', () => {
    expect(pointsForPlace(null, 1)).toBe(0);
    expect(pointsForPlace(300, 1)).toBe(0);
    expect(pointsForPlace(500, 0)).toBe(0);
    expect(pointsForPlace(500, NaN)).toBe(0);
  });

  it('never pays a lower place more than a higher one', () => {
    for (const t of AVP_TIER_IDS) {
      for (let place = 1; place < 20; place++) {
        expect(pointsForPlace(t, place)).toBeGreaterThanOrEqual(pointsForPlace(t, place + 1));
      }
    }
  });

  it('describes the blocks for the picker', () => {
    expect(tierBreakdown(500).map((b) => b.label)).toEqual(['1', '2', '3', '4', '5-6', '7-8', '9-12', '13-16']);
    expect(tierBreakdown(null)).toEqual([]);
  });

  it('category tier overrides the event tier', () => {
    expect(effectiveTier({ avp_tier: 500 }, { avp_tier: 250 })).toBe(500);
    expect(effectiveTier({ avp_tier: null }, { avp_tier: 250 })).toBe(250);
    expect(effectiveTier(null, null)).toBeNull();
  });
});
