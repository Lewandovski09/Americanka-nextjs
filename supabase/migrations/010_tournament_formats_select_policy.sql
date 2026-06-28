-- ============================================================
-- AMERICANKA — Migration 010: Public read policy for tournament_formats
-- ============================================================
-- tournament_formats has RLS enabled but no SELECT policy, which
-- silently hides the whole reference table from anon/authenticated
-- roles: the create-tournament screen can't list formats, and the
-- tournament detail page reads back `tournament_formats` as null
-- (crashing on `.round_count`). The formats are non-sensitive
-- reference data — every other reference table is world-readable —
-- so allow everyone to SELECT them. Writes stay admin-only (handled
-- via the service-role key in the API, which bypasses RLS).

-- Make sure RLS is on (no-op if already enabled) so the policy is
-- the single source of truth for read access.
alter table tournament_formats enable row level security;

create policy tournament_formats_select_all on tournament_formats
  for select using (true);
