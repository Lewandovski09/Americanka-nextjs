import { describe, it, expect } from 'vitest';
import { assignScheduledTimes, slotMinutes } from './schedule';

describe('americanka timing', () => {
  it('a game every 15 minutes per court from the start', () => {
    expect(slotMinutes(31)).toBe(15);
    const rows: any[] = [1, 2, 1, 2, 1, 2].map((court) => ({ court }));
    const timed = assignScheduledTimes(rows, { startAt: '2026-10-10T07:00:00.000Z', targetFor: () => 31 });
    expect(timed.map((r: any) => r.scheduled_at.slice(11, 16))).toEqual(['07:00', '07:00', '07:15', '07:15', '07:30', '07:30']);
  });
  it('one court — strictly one after another', () => {
    const timed = assignScheduledTimes([{ court: 1 }, { court: 1 }, { court: 1 }] as any, { startAt: '2026-10-10T07:00:00.000Z', targetFor: () => 31 });
    expect(timed.map((r: any) => r.scheduled_at.slice(11, 16))).toEqual(['07:00', '07:15', '07:30']);
  });
  it('other formats keep their slots', () => {
    expect(slotMinutes(21)).toBe(45);
    expect(slotMinutes(15)).toBe(30);
  });
});

import { planAmericankaCourts } from './schedule';
describe('americanka: one category — one court', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ court: (i % 2) + 1, round_number: Math.floor(i / 2) + 1, order_index: i })) as any[];
  const START = '2026-10-10T07:00:00.000Z';
  it('each category on its own court, every game 15 min apart', () => {
    const [a, b] = planAmericankaCourts([{ rows: rows(4), startAt: START }, { rows: rows(4), startAt: START }], [1, 2]);
    expect(a.every((r: any) => r.court === 1)).toBe(true);
    expect(b.every((r: any) => r.court === 2)).toBe(true);
    expect(a.map((r: any) => r.scheduled_at.slice(11, 16))).toEqual(['07:00', '07:15', '07:30', '07:45']);
    expect(b.map((r: any) => r.scheduled_at.slice(11, 16))).toEqual(['07:00', '07:15', '07:30', '07:45']);
  });
  it('more categories than courts — the next one waits for the court', () => {
    const [a, , c] = planAmericankaCourts(
      [{ rows: rows(2), startAt: START }, { rows: rows(2), startAt: START }, { rows: rows(2), startAt: START }],
      [1, 2]
    );
    expect(c.every((r: any) => r.court === 1)).toBe(true);
    expect(a.map((r: any) => r.scheduled_at.slice(11, 16))).toEqual(['07:00', '07:15']);
    expect(c.map((r: any) => r.scheduled_at.slice(11, 16))).toEqual(['07:30', '07:45']);
  });
});
