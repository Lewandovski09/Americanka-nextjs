// Per-set match scores — the single source of truth for a match result.
//
// A played match stores 1–3 sets in set1/set2/set3 (each [points_a,
// points_b]); there are no aggregate score columns in the DB. Everything
// that needs a winner, a points diff or a display label derives it from
// the sets through these helpers. A walkover is stored as a played 1:0
// single set.
//
// Plain JS with no imports so it is safe in both server routes and
// client components.

/** The filled sets of a match, in order: [[a,b], ...] (0–3 entries). */
export function setsOf(m) {
  return [m.set1, m.set2, m.set3].filter((s) => Array.isArray(s) && s.length === 2);
}

/**
 * Aggregate score [a, b]: a single-set match yields its points
 * (21:15 → [21, 15]); a multi-set match yields sets won (→ [2, 1]).
 * null when the match has no recorded sets.
 */
export function aggregateScore(m) {
  const sets = setsOf(m);
  if (sets.length === 0) return null;
  if (sets.length === 1) return [sets[0][0], sets[0][1]];
  return [sets.filter((s) => s[0] > s[1]).length, sets.filter((s) => s[1] > s[0]).length];
}

/** Did team A win? (false when no sets are recorded) */
export function teamAWon(m) {
  const agg = aggregateScore(m);
  return agg ? agg[0] >= agg[1] : false;
}

/** Total points [for_a, for_b] summed across every set. */
export function pointsTotals(m) {
  return setsOf(m).reduce((acc, s) => [acc[0] + s[0], acc[1] + s[1]], [0, 0]);
}

/** Team A's points differential summed across every set. */
export function pointsDiffA(m) {
  const [a, b] = pointsTotals(m);
  return a - b;
}

/** Display label: '21:15' or '2:1 (21:15, 15:21, 15:10)'. null if unplayed. */
export function scoreLabel(m) {
  const agg = aggregateScore(m);
  if (!agg) return null;
  const sets = setsOf(m);
  if (sets.length === 1) return `${agg[0]}:${agg[1]}`;
  return `${agg[0]}:${agg[1]} (${sets.map((s) => s.join(':')).join(', ')})`;
}
