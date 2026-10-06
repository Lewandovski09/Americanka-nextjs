import { describe, it, expect } from 'vitest';
import { newPlayerNoticeText } from './ownerNotify';

describe('newPlayerNoticeText', () => {
  it('says who, with the requested category', () => {
    const t = newPlayerNoticeText({ first_name: 'Іван', last_name: '<Петренко>', login: 'ivan', gender: 'M', city: 'Одеса', requested_category: 'C', telegram_username: 'ivan_bv' });
    expect(t.includes('Новий гравець')).toBe(true);
    expect(t.includes('Іван &lt;Петренко&gt;')).toBe(true);
    expect(t.includes('@ivan_bv')).toBe(true);
    expect(t.includes('Чоловік · Одеса')).toBe(true);
    expect(t.includes('Бажана категорія: <b>C</b>')).toBe(true);
  });
  it('works with almost nothing', () => {
    const t = newPlayerNoticeText({ login: 'x' });
    expect(t.includes('x')).toBe(true);
  });
});
