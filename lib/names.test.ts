import { describe, it, expect } from 'vitest';
import { surname } from './names';

describe('surname', () => {
  it('uses the last name', () => {
    expect(surname({ last_name: 'Кудріч', full_name: 'Дмитро Кудріч' })).toBe('Кудріч');
  });
  it('falls back to the full name for a one-word profile', () => {
    expect(surname({ last_name: '  ', full_name: 'Андрій' })).toBe('Андрій');
  });
  it('a dash when nothing is known', () => {
    expect(surname(null)).toBe('—');
  });
});
