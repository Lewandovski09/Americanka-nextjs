import { describe, it, expect } from 'vitest';
import { judgeNoticeText } from './judgeNotice';

const data = {
  title: 'Американка',
  name: 'Осінній <кубок>',
  dateLabel: 'Субота, 10 жовтня о 10:00',
  venue: 'Ланжерон',
  city: 'Одеса',
  scoring: 'Рахунок до суми 31',
  scheduleLabel: '9 жовтня о 20:00',
  organizer: { telegram: '@one_gogi', phone: '067 187 44 10' },
  categories: [{ label: 'Light', genderLabel: 'Чоловіки', bracketLabel: null }],
};

describe('judgeNoticeText', () => {
  it('a judge gets the full picture', () => {
    const t = judgeNoticeText({ data, headName: 'Олег', otherJudges: ['Іра'] });
    for (const s of [
      'Вас призначено суддею',
      'Осінній &lt;кубок&gt;',
      'Субота, 10 жовтня',
      'Локація: Ланжерон, Одеса',
      'суми 31',
      'Розклад — 9 жовтня',
      '<b>Light</b> · Чоловіки',
      'Головний суддя: Олег',
      'Також судять: Іра',
      '@one_gogi',
      '067 187 44 10',
    ])
      expect(t.includes(s)).toBe(true);
  });
  it('the head judge', () => {
    const t = judgeNoticeText({ data, isHead: true, otherJudges: ['Іра', 'Петро'] });
    expect(t.includes('головним суддею')).toBe(true);
    expect(t.includes('Судді: Іра, Петро')).toBe(true);
    expect(t.includes('призначаєте суддю')).toBe(true);
  });
});
