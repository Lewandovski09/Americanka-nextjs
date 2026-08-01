-- ============================================================
-- AMERICANKA — Migration 024: only the crew writes matches
-- ============================================================
-- `matches_write` (migration 002) let any player listed in a match
-- UPDATE that row straight from the browser with the anon key:
--
--   create policy matches_write on matches for update using (
--     is_admin()
--     or auth.uid() = any(team_a_players)
--     or auth.uid() = any(team_b_players)
--   );
--
-- It dates from when a participant submitted their own score and there
-- was nothing else on the row to protect. Since then the score route
-- has grown everything that makes a result trustworthy — the scoring
-- rule for the format, the "already played" and current-stage locks,
-- pushing the winner and loser into the next bracket slots, closing the
-- category and paying out its counters, partner stats and AVP season
-- points. A direct table UPDATE skips every one of those: it can set an
-- impossible score, mark a game played without advancing the bracket,
-- or move a court and a scheduled time.
--
-- The app never used this policy — every client-side query against
-- `matches` is a SELECT; writes have gone through the API routes (on the
-- service-role client, which bypasses RLS) for a long time. So dropping
-- it removes attack surface and no feature.
--
-- Who may write what is now stated in exactly one place, the routes:
--   judge       — enters a score for any game of their event
--   head judge  — also corrects a score, moves a game, assigns a judge
--   admin       — everything
-- which is the role table migration 022 wrote down and nothing enforced
-- for a first score entry.

drop policy if exists matches_write on matches;

-- Inserts stay admin-only for the same reason they always were: brackets
-- are generated server-side. Kept explicit rather than relying on the
-- absence of a policy, so the intent survives the next reader.
drop policy if exists matches_admin_insert on matches;
create policy matches_admin_insert on matches
  for insert with check (is_admin());

-- Reading stays open — the schedule, the bracket and the live scores are
-- public to everyone, signed in or not.
