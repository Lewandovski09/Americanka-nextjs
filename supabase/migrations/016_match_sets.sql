-- ──────────────────────────────────────────────
-- MATCH SETS — per-set scores for first-to formats.
--
-- A match now stores up to three sets as [points_a, points_b] arrays.
-- set1 is required once the match is played; set2/set3 are optional
-- (best-of-3 finals, etc.). Americanka stays single-set (set1 only).
--
-- Migration 017 drops score_a/score_b entirely — the sets become the
-- single source of truth, the aggregate is derived in code.
-- ──────────────────────────────────────────────

alter table matches
  add column set1 integer[],
  add column set2 integer[],
  add column set3 integer[];

-- Existing played matches: their single score becomes set 1.
update matches
set set1 = array[score_a, score_b]
where played and score_a is not null and score_b is not null;

comment on column matches.set1 is 'First set [points_a, points_b]; required when played';
comment on column matches.set2 is 'Second set [points_a, points_b]; optional';
comment on column matches.set3 is 'Third set [points_a, points_b]; optional, only after 1:1';
