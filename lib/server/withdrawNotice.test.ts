import { describe, it, expect } from 'vitest';
import { withdrawNoticeText } from './withdrawNotice';

const event = { id: 'e', name: 'Осінній <кубок>', scheduled_at: '2026-10-10T07:00:00Z' };

describe('withdrawNoticeText', () => {
  it('a pair leaving together', () => {
    const t = withdrawNoticeText({
      player: { full_name: 'Іван Петренко', elo: 1300 },
      partner: { full_name: 'Олег Коваль', elo: 1250 },
      withPartner: true,
      event,
      category: { gender: 'M', category_label: 'Light' },
      where: 'roster',
      roster: { taken: 7, total: 8 },
      isPair: true,
    });
    expect(t.includes('Пара <b>Іван Петренко</b> (Ело 1300) і <b>Олег Коваль</b> (Ело 1250)')).toBe(true);
    expect(t.includes('Осінній &lt;кубок&gt;')).toBe(true);
    expect(t.includes('Категорія: <b>Ч · Light</b>')).toBe(true);
    expect(t.includes('у складі ліги')).toBe(true);
    expect(t.includes('7/8 пар')).toBe(true);
  });

  it('one player leaving, the partner stays', () => {
    const t = withdrawNoticeText({
      player: { full_name: 'Іван Петренко' },
      partner: { full_name: 'Олег Коваль' },
      withPartner: false,
      event,
      category: null,
      requestedLabel: 'Pro',
      where: 'queue',
      isPair: true,
    });
    expect(t.includes('👤 <b>Іван Петренко</b>')).toBe(true);
    expect(t.includes('Олег Коваль</b> залишається')).toBe(true);
    expect(t.includes('Pro (бажана, ще не розподілено)')).toBe(true);
    expect(t.includes('у заявках')).toBe(true);
  });
});
