// Ukrainian plural for "перемога" — 11-14 always take the "many" form
// regardless of the last digit (the usual Slavic exception), otherwise
// it follows the last digit: 1 → перемога, 2-4 → перемоги, else → перемог.
export function winPluralUk(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'перемог';
  if (mod10 === 1) return 'перемога';
  if (mod10 >= 2 && mod10 <= 4) return 'перемоги';
  return 'перемог';
}

/**
 * Ukrainian plural for any noun: pluralUk(n, 'гра', 'гри', 'ігор').
 * 11–14 always take the «many» form; otherwise the last digit decides.
 */
export function pluralUk(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  const mod10 = a % 10;
  const mod100 = a % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** «7 ігор», «1 гра», «3 гри». */
export const gamesUk = (n: number): string => `${n} ${pluralUk(n, 'гра', 'гри', 'ігор')}`;
