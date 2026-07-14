-- ============================================================
-- AMERICANKA — Migration 012: match group & stage metadata
-- ============================================================
-- The new formats need matches to carry a bit more structure than the
-- flat round_number the americano round-robin used:
--
--   group_index — which group a match belongs to (King of the Beach
--                 groups of 4; group stage of the pair brackets).
--   stage       — where in the tournament the match sits: 'group',
--                 'round1'.. for King, or 'quarterfinal' / 'semifinal'
--                 / 'final' for playoff brackets. Drives the points
--                 target when the event uses "different score from the
--                 semifinal".
--
-- Both are nullable and default null, so existing americano matches
-- (which only use round_number) are unaffected. Additive & safe to run
-- once on production.

alter table matches
  add column group_index integer,
  add column stage text;

create index idx_matches_group on matches(tournament_id, group_index);
