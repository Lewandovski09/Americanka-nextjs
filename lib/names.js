// How a person is called in short lists, the schedule and the bracket:
// by surname, the way a game is called out on court. `last_name` is NOT
// NULL but may be empty (a one-word profile), so the full name stands in.
export function surname(u) {
  return u?.last_name?.trim() || u?.full_name || '—';
}
