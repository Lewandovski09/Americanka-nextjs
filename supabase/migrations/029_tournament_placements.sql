-- ============================================================
-- AMERICANKA — Migration 029: tournament_placements (catch-up)
-- ============================================================
-- This table was created BY HAND in the SQL editor of the live database
-- and never had a migration (see the header of 037). Every later file
-- reads it — 030, 031, 037, 039, 041, 042 — so a database built from this
-- folder from scratch (a new Supabase project, staging, a second city's
-- instance) died at 030 with
--   ERROR: relation "tournament_placements" does not exist
-- and could not be built at all.
--
-- Number 029 was free, and it sits exactly where the table has to exist.
-- It is created in the PRE-037 shape (tournament_id / player_id against
-- tournaments / players), because 037 renames those columns itself.
--
-- On the live database this whole file is a no-op: the table is already
-- there (by then under the post-037 column names) and `if not exists`
-- skips it. Safe to run anywhere, any number of times.

create table if not exists tournament_placements (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references players(id),
  place integer not null,
  created_at timestamptz not null default now(),
  unique (tournament_id, player_id)
);

alter table tournament_placements enable row level security;

drop policy if exists tournament_placements_select_all on tournament_placements;
create policy tournament_placements_select_all on tournament_placements
  for select using (true);
