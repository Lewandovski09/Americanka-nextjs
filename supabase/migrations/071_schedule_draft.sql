-- ============================================================
-- AMERICANKA — Migration 071: the schedule is a draft until published
-- ============================================================
-- After «Запустити» the admin first sees the schedule alone (with the
-- judges), fixes courts and times, and then presses «✅ Розклад готовий —
-- опублікувати»: from then on everyone sees it, and it goes to the
-- Telegram channel and every participant.
--   schedule_published_at — when it was published (empty = draft)
-- Tournaments already started before this migration count as published.
-- Idempotent.

alter table tournament_events add column if not exists schedule_published_at timestamptz;

update tournament_events
   set schedule_published_at = coalesce(started_at, now())
 where status in ('live', 'done')
   and schedule_published_at is null;

notify pgrst, 'reload schema';

-- Check: one row — schedule_published_at, and how many already count as published.
select 'schedule_published_at' as column_name,
       (select count(*) from tournament_events where schedule_published_at is not null) as published;
