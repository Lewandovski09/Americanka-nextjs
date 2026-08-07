// How a category's roster is laid out over the seed positions the admin
// edits on the «Посів» tab.
//
// Double Elimination is the one system where a position may stay EMPTY:
// its bracket is a fixed 16/32 grid, so a short field simply leaves holes
// and the builder turns each hole into a round-1 bye. Which places stay
// empty is a real decision (the pair opposite an empty slot walks into
// round 2), so the admin makes it instead of the builder defaulting the
// byes to the top seeds.
//
// Every other system plays exactly the roster it has — no grid, no holes
// — so there the seed stays a dense 1…N list and `seedCapacity` is null.

export interface SeedableCategory {
  bracket_system?: string | null;
  max_participants?: number | string | null;
  [key: string]: unknown;
}

export interface SeedRow {
  slotIndex: number | null;
  [key: string]: unknown;
}

export function seedCapacity(category?: SeedableCategory | null): number | null {
  if (category?.bracket_system !== 'double_elimination') return null;
  const size = Number(category?.max_participants);
  return Number.isInteger(size) && size > 0 ? size : null;
}

/**
 * Lay `rows` out over `capacity` positions.
 *
 * @param rows - roster rows carrying `slotIndex` (number|null), already
 *   in fallback order (see seedRoster / bySeed): the order the unseeded
 *   ones should take.
 * @param capacity - grid size, or null for a dense list.
 * @returns array of length max(capacity, rows.length): the row sitting
 *   at each place, or null for an empty one (a bye).
 */
export function placeIntoSlots<T extends SeedRow>(
  rows: T[],
  capacity: number | null
): (T | null)[] {
  const size = Math.max(capacity || 0, rows.length);
  const slots: (T | null)[] = Array.from({ length: size }, () => null);

  // Saved seeds claim their own place first; anything without one (a new
  // application, or a row whose stored place is out of range now that the
  // bracket size changed) fills the gaps that are left, in order.
  const rest: T[] = [];
  for (const row of rows) {
    const i = row.slotIndex;
    if (Number.isInteger(i) && i !== null && i >= 0 && i < size && slots[i] === null) {
      slots[i as number] = row;
    } else {
      rest.push(row);
    }
  }
  let cursor = 0;
  for (const row of rest) {
    while (slots[cursor] !== null) cursor++;
    slots[cursor] = row;
  }
  return slots;
}
