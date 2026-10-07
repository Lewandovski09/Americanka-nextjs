// Planned start times for the games of a category.
//
// The model is a queue per court: a game blocks its court for one slot,
// and the next game on that court starts when the previous one ends. So
// with two courts a 9:00 slot holds games 1–2 and game 3 starts at 9:30
// on court 1.
//
// The rows are walked in the order the format builders emit them — the
// very order the courts were handed out in (`courts[i % courts.length]`
// and friends) — so the time and the court of a game always agree.

import type { Match } from './types';

// A game holds its court for half an hour when the sets go to 15, and for
// three quarters when they go to 21. Американка (sum-to-31) is a quick
// game: the first starts at the tournament's start time and every next
// one on the court 15 minutes later.
export const AMERICANKA_SLOT_MIN = 15;

export function slotMinutes(pointsTarget: number): number {
  if (pointsTarget === 31) return AMERICANKA_SLOT_MIN;
  return pointsTarget <= 15 ? 30 : 45;
}

export type CourtCursors = Record<number, number>;

export interface AssignScheduledTimesOptions {
  /** ISO time the first game of each court starts at. */
  startAt: string | null | undefined;
  /** Points target of a row (drives its slot length). */
  targetFor: (row: Match) => number;
  /** Where each court's queue already stands (epoch ms). Mutated. */
  cursors?: CourtCursors;
}

/**
 * Stamp `scheduled_at` onto freshly built match rows.
 *
 * @returns new rows with `scheduled_at` (unchanged if startAt is unusable)
 */
export function assignScheduledTimes<T extends Match>(
  rows: T[],
  { startAt, targetFor, cursors = {} }: AssignScheduledTimesOptions
): T[] {
  const startMs = startAt ? new Date(startAt).getTime() : NaN;
  if (Number.isNaN(startMs)) return rows;

  return rows.map((row) => {
    const court = row.court || 1;
    const at = cursors[court] ?? startMs;
    cursors[court] = at + slotMinutes(targetFor(row)) * 60000;
    return { ...row, scheduled_at: new Date(at).toISOString() };
  });
}

/**
 * Where each court's queue stands after the games that already exist —
 * used when a later phase (the crosses playoff) is appended to a category
 * that is already underway, so it lines up behind the group stage.
 *
 * @returns court → epoch ms the court frees up
 */
export function cursorsFromMatches(
  matches: Match[] | null | undefined,
  targetFor: (row: Match) => number
): CourtCursors {
  const cursors: CourtCursors = {};
  for (const m of matches || []) {
    if (!m.scheduled_at) continue;
    const court = m.court || 1;
    const end = new Date(m.scheduled_at).getTime() + slotMinutes(targetFor(m)) * 60000;
    if (Number.isNaN(end)) continue;
    if (cursors[court] == null || end > cursors[court]) cursors[court] = end;
  }
  return cursors;
}

export interface CourtPlanGroup<T extends Match> {
  rows: T[];
  /** ISO start time of this category. */
  startAt: string | null | undefined;
}

/**
 * Americanka: one category — one court. The categories (in the order
 * given) take the event's courts in turn; every game of a category is on
 * its court, one after another, AMERICANKA_SLOT_MIN apart, from the
 * category's start. With more categories than courts, a court's next
 * category goes on after the previous one has finished there.
 *
 * @returns the same groups with `court` and `scheduled_at` set
 */
export function planAmericankaCourts<T extends Match>(groups: CourtPlanGroup<T>[], courts: number[]): T[][] {
  const pool = courts && courts.length ? courts : [1];
  const cursors: CourtCursors = {};
  return groups.map((g, i) => {
    const court = pool[i % pool.length];
    const ordered = [...g.rows].sort(
      (a, b) =>
        ((a as Match & { round_number?: number }).round_number || 0) - ((b as Match & { round_number?: number }).round_number || 0) ||
        ((a as Match & { order_index?: number }).order_index || 0) - ((b as Match & { order_index?: number }).order_index || 0)
    );
    const startMs = g.startAt ? new Date(g.startAt).getTime() : NaN;
    const withCourt = ordered.map((r) => ({ ...r, court }));
    if (Number.isNaN(startMs)) return withCourt;
    // the court is free at the later of: this category's start, or when the previous one there ends
    cursors[court] = Math.max(cursors[court] ?? startMs, startMs);
    return assignScheduledTimes(withCourt, { startAt: g.startAt, targetFor: () => 31, cursors });
  });
}
