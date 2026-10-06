-- ============================================================
-- AMERICANKA — Migration 068: when applications close, when the schedule is out
-- ============================================================
--   registration_closes_at — applications stop by themselves at this
--                            moment (empty = until the admin closes them
--                            or starts the tournament)
--   schedule_at            — when the schedule will be ready; players see
--                            it on the poster and in the app
--   schedule_announced_at  — set once the «Розклад готовий» messages went
--                            out (on «Запустити»), so they go only once
-- Only the server (service role) writes them. Idempotent.

alter table tournament_events add column if not exists registration_closes_at timestamptz;
alter table tournament_events add column if not exists schedule_at timestamptz;
alter table tournament_events add column if not exists schedule_announced_at timestamptz;

notify pgrst, 'reload schema';

-- Check: three rows.
select column_name
  from information_schema.columns
 where table_name = 'tournament_events'
   and column_name in ('registration_closes_at', 'schedule_at', 'schedule_announced_at')
 order by column_name;
