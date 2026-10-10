-- ============================================================
-- AMERICANKA — Migration 074: «🏁 Турнір завершено» in Telegram
-- ============================================================
-- When the last category of a tournament is finished, its results go to
-- the channel and every participant once (lib/server/resultsNotice).
--   results_announced_at — when that happened (empty = not yet)
-- Idempotent.

alter table tournament_events add column if not exists results_announced_at timestamptz;

notify pgrst, 'reload schema';

-- Check: one row — the column exists.
select 'results_announced_at' as column_name,
       exists (select 1 from information_schema.columns
                where table_name = 'tournament_events' and column_name = 'results_announced_at') as ok;
