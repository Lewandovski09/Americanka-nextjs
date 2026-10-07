import { describe, it, expect } from 'vitest';
import { acceptNoticeText } from './acceptNotice';

describe('acceptNoticeText', () => {
  const event = { name: 'Осінній <кубок>', scheduled_at: '2026-10-10T07:00:00Z' };
  it('says where they were placed', () => {
    const t = acceptNoticeText({ event, category: { gender: 'F', category_label: 'Light' }, partnerName: 'Олена' });
    expect(t.includes('Вашу заявку прийнято!')).toBe(true);
    expect(t.includes('Осінній &lt;кубок&gt;')).toBe(true);
    expect(t.includes('Категорія: <b>Ж · Light</b>')).toBe(true);
    expect(t.includes('Напарник: Олена')).toBe(true);
  });
  it('reserve', () => {
    const t = acceptNoticeText({ event, category: { gender: 'M', category_label: 'Pro' }, reserve: true });
    expect(t.includes('резерв')).toBe(true);
  });
});
