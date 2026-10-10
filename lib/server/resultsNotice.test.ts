import { describe, it, expect } from 'vitest';
import { resultsText, resultsKeyboard } from './resultsNotice';

const data = {
  title: 'Americanka',
  name: 'Коли не турнір?',
  dateLabel: 'Субота, 10 жовтня 2026 р. о 11:15',
  venue: 'Beach 13',
  city: 'Одеса',
  categories: [
    { id: 'c1', label: 'Pro', gender: 'M', podium: [{ place: 1, name: 'Олексій Курдюков' }, { place: 2, name: 'Гіоргій' }, { place: 3, name: 'Кирило <Іщенко>' }] },
    { id: 'c2', label: 'Light', gender: 'F', podium: [] },
  ],
};

describe('results notice', () => {
  it('text: winners with medals, escaped', () => {
    const t = resultsText(data);
    for (const s of ['Турнір завершено', 'Коли не турнір?', 'Beach 13, Одеса', '<b>Ч · Pro</b>', '🥇 Олексій Курдюков', '🥈 Гіоргій', '🥉 Кирило &lt;Іщенко&gt;', '<b>Ж · Light</b>', 'результати — у застосунку'])
      expect(t.includes(s)).toBe(true);
    expect(t.length < 1024).toBe(true);
  });
  it('a button per category', () => {
    const kb = resultsKeyboard(data, 'https://x.vercel.app');
    expect(kb.inline_keyboard.length).toBe(2);
    expect(kb.inline_keyboard[0][0].text).toBe('🏆 Ч · Pro — результати');
    expect(kb.inline_keyboard[0][0].url.includes(encodeURIComponent('/tournaments/c1'))).toBe(true);
  });
});
