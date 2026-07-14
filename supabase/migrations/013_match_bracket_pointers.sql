-- ============================================================
-- AMERICANKA — Migration 013: event-driven bracket pointers
-- ============================================================
-- For skeleton-based brackets (currently Double Elimination) the whole
-- bracket is created up front as empty placeholder matches, wired
-- together: when a match is decided, its winner flows into one match
-- slot and its loser into another. This makes brackets fill themselves
-- as scores come in — no manual "advance" step.
--
--   winner_to_match_id / winner_to_slot — where the winner goes ('a'|'b')
--   loser_to_match_id  / loser_to_slot  — where the loser goes (double
--                                         elimination's lower bracket)
--   is_final — the deciding match; when it is played the category ends.
--
-- These are plain internal-wiring columns (no FK — they reference other
-- rows in the same matches table, populated in one batch). All nullable
-- and default null, so every existing match and the group-based brackets
-- (which keep using the round-by-round /advance route) are unaffected.
-- Additive & safe to run once on production.

alter table matches
  add column winner_to_match_id uuid,
  add column winner_to_slot text,
  add column loser_to_match_id uuid,
  add column loser_to_slot text,
  add column is_final boolean not null default false;
