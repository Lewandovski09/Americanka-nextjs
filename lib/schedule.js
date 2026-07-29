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

// A game holds its court for half an hour when the sets go to 15, and for
// three quarters otherwise (до 21, and американка's sum-to-31).
export function slotMinutes(pointsTarget) {
  return pointsTarget <= 15 ? 30 : 45;
}

/**
 * Stamp `scheduled_at` onto freshly built match rows.
 *
 * @param {object[]} rows - match rows carrying at least `court`
 * @param {string} startAt - ISO time the first game of each court starts at
 * @param {(row: object) => number} targetFor - points target of a row (drives its slot length)
 * @param {Record<number, number>} cursors - where each court's queue already
 *   stands (epoch ms), for rows appended to a running category. Mutated.
 * @returns {object[]} new rows with `scheduled_at` (unchanged if startAt is unusable)
 */
export function assignScheduledTimes(rows, { startAt, targetFor, cursors = {} }) {
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
 * @returns {Record<number, number>} court → epoch ms the court frees up
 */
export function cursorsFromMatches(matches, targetFor) {
  const cursors = {};
  for (const m of matches || []) {
    if (!m.scheduled_at) continue;
    const court = m.court || 1;
    const end = new Date(m.scheduled_at).getTime() + slotMinutes(targetFor(m)) * 60000;
    if (Number.isNaN(end)) continue;
    if (cursors[court] == null || end > cursors[court]) cursors[court] = end;
  }
  return cursors;
}
