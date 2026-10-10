import { describe, it, expect } from 'vitest';
import { kyivDay, kyivTime, atKyivTime, toKyivInput, fromKyivInput } from './dates';

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


describe('Kyiv clock', () => {
  it('11:15 Kyiv in summer (UTC+3) and winter (UTC+2)', () => {
    expect(kyivTime('2026-10-10T08:15:00Z')).toBe('11:15');
    expect(kyivTime('2026-12-10T09:15:00Z')).toBe('11:15');
  });
  it('setting a time keeps the Kyiv day', () => {
    expect(atKyivTime('2026-10-10T08:15:00Z', 12, 30).toISOString()).toBe('2026-10-10T09:30:00.000Z');
    expect(atKyivTime('2026-12-10T09:15:00Z', 0, 15).toISOString()).toBe('2026-12-09T22:15:00.000Z');
  });
  it('datetime-local round trip in Kyiv time', () => {
    expect(toKyivInput('2026-10-10T08:15:00Z')).toBe('2026-10-10T11:15');
    expect(fromKyivInput('2026-10-10T11:15')).toBe('2026-10-10T08:15:00.000Z');
    expect(fromKyivInput('')).toBe('');
  });
  it('the day the clocks go back (25 Oct 2026)', () => {
    expect(fromKyivInput('2026-10-25T12:00')).toBe('2026-10-25T10:00:00.000Z');
    expect(fromKyivInput('2026-10-24T12:00')).toBe('2026-10-24T09:00:00.000Z');
  });
});
