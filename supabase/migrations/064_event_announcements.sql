-- ============================================================
-- AMERICANKA — Migration 064: tournament announcements in Telegram
-- ============================================================
-- «Оголосити в Telegram» (on creating a tournament, or later from its
-- settings) posts the tournament card to the club's channel and sends it
-- to every player who connected the bot. These columns keep track of it,
-- so nothing is sent twice — not on a double tap, not when the sending
-- is resumed after the page was closed half-way:
--
--   announced_at          — when the announcement started (the channel
--                           post is made exactly once, by whoever sets it)
--   announce_photo_id     — Telegram's id of the card picture, so the
--                           players' messages reuse it instead of drawing
--                           it again for every message
--   announce_cursor       — the last player (by id) the bot has reached;
--                           sending continues after them
--   announce_sent         — how many players got it
--   announce_done_at      — everyone reachable has got it
--   announce_channel_ok   — whether the channel post went through
--
-- Only the server (service role) writes them. Idempotent.

alter table tournament_events add column if not exists announced_at timestamptz;
alter table tournament_events add column if not exists announce_photo_id text;
alter table tournament_events add column if not exists announce_cursor uuid;
alter table tournament_events add column if not exists announce_sent integer not null default 0;
alter table tournament_events add column if not exists announce_done_at timestamptz;
alter table tournament_events add column if not exists announce_channel_ok boolean;

notify pgrst, 'reload schema';

-- Check: six rows.
select column_name
  from information_schema.columns
 where table_name = 'tournament_events' and column_name like 'announce%'
 order by column_name;
