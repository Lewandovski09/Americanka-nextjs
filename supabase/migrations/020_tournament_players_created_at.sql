-- Solo rosters stopped auto-filling `slot_index` at distribution time:
-- the seed is now set by hand on the «Посів» tab, the same way as for
-- pairs. That left `tournament_players` with no notion of order at all,
-- so an unseeded category had nothing sensible to pre-fill the seeding
-- list with (`tournament_teams` has had `created_at` since 009).
--
-- Rows that already exist all get the migration timestamp, so among them
-- the list falls back to the name — they are seeded by hand anyway.

alter table tournament_players
  add column if not exists created_at timestamptz not null default now();
