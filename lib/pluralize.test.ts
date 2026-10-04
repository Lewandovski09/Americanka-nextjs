import { describe, it, expect } from 'vitest';
import { pluralUk, gamesUk, winPluralUk } from './pluralize';

describe('pluralUk', () => {
  const g = (n: number) => pluralUk(n, 'гра', 'гри', 'ігор');
  it('one', () => {
    [1, 21, 101].forEach((n) => expect(g(n)).toBe('гра'));
  });
  it('few', () => {
    [2, 3, 4, 22, 34].forEach((n) => expect(g(n)).toBe('гри'));
  });
  it('many, including 11–14', () => {
    [0, 5, 9, 11, 12, 13, 14, 25, 111, 112].forEach((n) => expect(g(n)).toBe('ігор'));
  });
  it('negative numbers use their size', () => {
    expect(pluralUk(-2, 'очко', 'очки', 'очок')).toBe('очки');
  });
  it('gamesUk prints the number', () => {
    expect(gamesUk(7)).toBe('7 ігор');
    expect(gamesUk(1)).toBe('1 гра');
  });
  it('agrees with winPluralUk', () => {
    for (let n = 0; n < 130; n++) expect(pluralUk(n, 'перемога', 'перемоги', 'перемог')).toBe(winPluralUk(n));
  });
});
