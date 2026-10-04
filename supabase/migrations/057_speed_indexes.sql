-- ============================================================
-- AMERICANKA — Migration 057: indexes for the busiest reads
-- ============================================================
-- • games played since a date («Герої місяця», club statistics, the
--   rating's season numbers): tournament_matches by played_at;
-- • the Ело log by reason and date (the month's gains, the season's);
-- • the home page's «just finished» card: finished events by date;
-- • the placements of first places (winners on the home card).
--
-- Idempotent; building them is quick on a club-sized database.

create index if not exists idx_tournament_matches_played_at
  on tournament_matches (played_at desc)
  where played = true;

create index if not exists idx_elo_history_reason_created
  on elo_history (reason, created_at desc);

create index if not exists idx_tournament_events_finished
  on tournament_events (finished_at desc)
  where status = 'done';

create index if not exists idx_tournament_placements_place
  on tournament_placements (place, category_id);

analyze tournament_matches;
analyze elo_history;
analyze tournament_events;
analyze tournament_placements;
