import { describe, it, expect } from 'vitest';
import { kyivDay } from './dates';

describe('kyivDay', () => {
  it('keeps a plain date as it is', () => {
    expect(kyivDay('2026-08-01')).toBe('2026-08-01');
  });
  it('puts a night game in the Kyiv day, not the UTC one', () => {
    // 22:30 UTC on 31 July = 01:30 on 1 August in Kyiv (summer, UTC+3)
    expect(kyivDay('2026-07-31T22:30:00Z')).toBe('2026-08-01');
  });
  it('an evening game stays on its day', () => {
    expect(kyivDay('2026-07-31T17:00:00Z')).toBe('2026-07-31');
  });
  it('winter time (UTC+2)', () => {
    expect(kyivDay('2026-12-31T22:30:00Z')).toBe('2027-01-01');
    expect(kyivDay('2026-12-31T21:30:00Z')).toBe('2026-12-31');
  });
});
