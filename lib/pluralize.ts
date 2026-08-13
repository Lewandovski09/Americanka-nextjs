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
