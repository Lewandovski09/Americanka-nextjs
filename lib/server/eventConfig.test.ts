import { describe, it, expect } from 'vitest';
import { getFormat, FIRST_TO_OPTIONS } from '@/lib/formats';
import { capacityFor, categoryRow, resolveScoring, validateCategory } from './eventConfig';

const am = getFormat('americanka')!;
const ev = { id: 'e1', name: 'Кубок', points_to_win: 35, courts: [1], scheduled_at: '2026-10-10T08:15:00Z' };

describe('americanka config', () => {
  it('8 or 6 players; nothing sent → 8', () => {
    expect(capacityFor(am, { categoryLabel: 'Pro', gender: 'M', maxParticipants: 6 })).toBe(6);
    expect(capacityFor(am, { categoryLabel: 'Pro', gender: 'M', maxParticipants: 8 })).toBe(8);
    expect(capacityFor(am, { categoryLabel: 'Pro', gender: 'M' })).toBe(8);
    expect(String(validateCategory(am, { categoryLabel: 'Pro', gender: 'M', maxParticipants: 7 })).includes('Кількість')).toBe(true);
    expect(validateCategory(am, { categoryLabel: 'Pro', gender: 'M' })).toBe(null);
  });
  it('row: sum and the 6-player plan', () => {
    const r6 = categoryRow(am, ev, { categoryLabel: 'Pro', gender: 'M', maxParticipants: 6, gamesCount: 6 });
    expect(r6).toMatchObject({ max_participants: 6, bracket_system: 'am6_6', points_to_win: 35 });
    const r6d = categoryRow(am, ev, { categoryLabel: 'Pro', gender: 'M', maxParticipants: 6 });
    expect(r6d.bracket_system).toBe('am6_9');
    const r8 = categoryRow(am, { ...ev, points_to_win: 21 }, { categoryLabel: 'Pro', gender: 'M', maxParticipants: 8, gamesCount: 6 });
    expect(r8).toMatchObject({ max_participants: 8, bracket_system: null, points_to_win: 31 });
  });
  it('scoring: 29 / 31 / 35, anything else → 31', () => {
    expect(resolveScoring(am, { pointsToWin: 29 }, FIRST_TO_OPTIONS).points).toBe(29);
    expect(resolveScoring(am, { pointsToWin: 35 }, FIRST_TO_OPTIONS).points).toBe(35);
    expect(resolveScoring(am, { pointsToWin: 21 }, FIRST_TO_OPTIONS).points).toBe(31);
    expect(resolveScoring(am, {}, FIRST_TO_OPTIONS).points).toBe(31);
  });
});
