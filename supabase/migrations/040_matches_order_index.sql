-- ============================================================
-- AMERICANKA — Migration 040: tournament_matches.order_index
-- ============================================================
-- Games were reordering themselves in the «Таблиця» tab whenever a score
-- was entered. Reported on a live americanka; reproducible on any
-- format.
--
-- THE CAUSE is that the display order was never actually stored. The
-- page fetches with `.order('round_number')` and nothing else, and an
-- americanka round holds TWO games — so within a round the order was
-- whatever the scan happened to return. Postgres does not promise one:
-- an UPDATE writes a new row version elsewhere in the heap, so the game
-- whose score was just entered came back in a different position next
-- time, and swapped places with its round-mate.
--
-- Worse than cosmetic, because the game NUMBER is derived from that
-- order (gameNoById in app/tournaments/[id]/page.js) and is what judges
-- and players call a game by. «Гра №5» could become «Гра №6» because
-- somebody entered a score in an unrelated game of the same round.
--
-- Neither existing column can stand in as a tiebreaker:
--   • court     — only distinguishes them when the category runs on two
--                 courts; on one court both games share court 1.
--   • created_at— every match of a category is inserted in one
--                 statement, and the default now() is the TRANSACTION
--                 timestamp, so all rows carry the identical value.
--   • id        — random uuid: stable, but it would order the round by
--                 nothing at all, and would change the numbering that
--                 tournaments already in progress are using.
--
-- So the order gets its own column. It is written from the position in
-- the generated array (see commitCategoryStart in
-- lib/server/startCategory.ts), which is the order every format's
-- generator already intends — americanka rounds, bracket rows, King
-- groups alike.

alter table tournament_matches
  add column if not exists order_index integer;

comment on column tournament_matches.order_index is
  'Position of this game in its category''s generated schedule, 0-based. Written at start from the insert array; the display order and the game number both follow it.';

-- ──────────────────────────────────────────────
-- BACKFILL
-- ──────────────────────────────────────────────
-- The original insert order of existing rows is not recoverable — that
-- is the whole bug — so this reconstructs the best deterministic
-- approximation: round, then court, then id. For a two-court americanka
-- that IS the generated order (the generator alternates courts within a
-- round, court[0] first). For a one-court category the order within a
-- round is arbitrary, but from now on it is FIXED, which is what was
-- actually broken.
--
-- Guarded on null so a re-run cannot renumber a category that has
-- already been stamped.
with ordered as (
  select
    id,
    row_number() over (
      partition by category_id
      order by round_number, court, id
    ) - 1 as idx
  from tournament_matches
  where order_index is null
)
update tournament_matches m
set order_index = ordered.idx
from ordered
where m.id = ordered.id;
