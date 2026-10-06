-- ============================================================
-- AMERICANKA — Migration 066: entry fee + the time applications open
-- ============================================================
-- At creation the admin now says:
--   entry_fee              — what one player pays, in hryvnias (0 = free;
--                            empty for tournaments created before this)
--   registration_opens_at  — when applications open (empty = at once).
--                            Until then the app shows «Заявки з …» and
--                            the server refuses applications.
--
-- «Заявки приймаються» in Telegram: when an announced tournament reaches
-- its opening time, the channel and every player in the bot get a second
-- message (migration 067 wakes the server for it every minute). The same
-- bookkeeping as the first announcement (migration 064), so nothing is
-- sent twice:
--   open_announced_at, open_announce_photo_id, open_announce_cursor,
--   open_announce_sent, open_announce_done_at, open_announce_channel_ok
--
-- Only the server (service role) writes them. Idempotent.

alter table tournament_events add column if not exists entry_fee integer;
alter table tournament_events add column if not exists registration_opens_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_events_entry_fee_check') then
    alter table tournament_events
      add constraint tournament_events_entry_fee_check check (entry_fee is null or (entry_fee >= 0 and entry_fee <= 100000));
  end if;
end $$;

alter table tournament_events add column if not exists open_announced_at timestamptz;
alter table tournament_events add column if not exists open_announce_photo_id text;
alter table tournament_events add column if not exists open_announce_cursor uuid;
alter table tournament_events add column if not exists open_announce_sent integer not null default 0;
alter table tournament_events add column if not exists open_announce_done_at timestamptz;
alter table tournament_events add column if not exists open_announce_channel_ok boolean;

-- The minute check (067) looks for tournaments whose opening has come.
create index if not exists tournament_events_registration_opens_idx
  on tournament_events (registration_opens_at)
  where registration_opens_at is not null and open_announce_done_at is null;

notify pgrst, 'reload schema';

-- Check: eight rows.
select column_name
  from information_schema.columns
 where table_name = 'tournament_events'
   and (column_name in ('entry_fee', 'registration_opens_at') or column_name like 'open_announce%')
 order by column_name;
