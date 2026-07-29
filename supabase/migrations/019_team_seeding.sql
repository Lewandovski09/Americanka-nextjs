-- Manual seeding.
--
-- Until now the bracket seed was derived automatically (combined Elo for
-- pairs, registration order for solo). The admin now sets it by hand on
-- the started event's settings page, so the seed has to live on the
-- roster row itself. `tournament_players` already had `slot_index`;
-- pairs get the same column.
--
-- Nullable on purpose: a pair is created by the distribution step with no
-- seed at all, and stays that way until the admin saves the seeding.
-- (Postgres unique indexes allow many NULLs, so unseeded pairs never
-- collide with each other.)

alter table tournament_teams add column if not exists slot_index integer;

create unique index if not exists tournament_teams_slot_unique
  on tournament_teams(tournament_id, slot_index);

comment on column tournament_teams.slot_index is
  'Seed position within the category (0-based), set by the admin. NULL = not seeded yet.';
