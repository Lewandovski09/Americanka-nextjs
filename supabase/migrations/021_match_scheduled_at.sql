-- Planned start time of a single game.
--
-- Until now the time was never stored: the category page projected it on
-- every render (each court runs its own queue from the category start,
-- one game blocks its court for 30/45 min). That made the time unstable —
-- it silently moved whenever the category's start time changed — and left
-- nothing for the admin to correct when the day slipped.
--
-- It is now written at setup time, exactly like `court`, by the same pass
-- that hands out the courts, and can be edited per game afterwards.
--
-- NULL = a game created before this column existed; the page falls back
-- to the old projection for those.

alter table matches add column if not exists scheduled_at timestamptz;

comment on column matches.scheduled_at is
  'Planned start of the game, set when the category starts and editable by an admin. NULL = fall back to the projected schedule.';
