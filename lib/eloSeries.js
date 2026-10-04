// Ело line points for the profile chart (EloTrend): one point per game
// from the game-by-game log (get_user_elo_log), or — for players with no
// log yet — per tournament from the tournament history.

// Turns tournament history (each with elo_delta + finished_at) into a
// chronological series of actual Ело values, working backward from the
// current rating, since the history only stores deltas.
export function buildPoints(history, currentElo) {
  const sorted = (history || [])
    .filter((h) => h.elo_delta !== null && h.elo_delta !== undefined && h.finished_at)
    .slice()
    .sort((a, b) => new Date(a.finished_at) - new Date(b.finished_at));

  const totalDelta = sorted.reduce((s, h) => s + h.elo_delta, 0);
  let running = (currentElo ?? 0) - totalDelta;

  return sorted.map((h) => {
    running += h.elo_delta;
    return { date: new Date(h.finished_at), elo: running, name: h.tournament_name, delta: h.elo_delta };
  });
}

// From the game-by-game Ело log: one point per game, using the real
// rating after it, starting from the rating before the first one.
export function buildPointsFromLog(log) {
  const rows = (log || [])
    .filter((r) => r.created_at && r.elo_after != null)
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (rows.length === 0) return [];
  const first = rows[0];
  const start =
    first.elo_before != null
      ? [{ date: new Date(new Date(first.created_at).getTime() - 60000), elo: first.elo_before, name: 'Старт', delta: 0 }]
      : [];
  return [
    ...start,
    ...rows.map((r) => ({ date: new Date(r.created_at), elo: r.elo_after, name: r.tournament_name, delta: r.delta })),
  ];
}
