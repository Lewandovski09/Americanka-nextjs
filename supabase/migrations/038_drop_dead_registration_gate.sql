-- ============================================================
-- AMERICANKA — Migration 038: drop the dead registration gate
-- ============================================================
--   tournament_categories.elo_min / elo_max  → dropped
--   tournament_events.registration_mode      → dropped
--   type registration_mode                   → dropped
--
-- All three are leftovers of a registration flow that was designed in
-- migration 011 and never finished.
--
-- THE ORIGINAL IDEA was three ways into a category, chosen per event:
--   admin_assign — players apply to a pool, an admin distributes them
--   by_rating    — players self-register, but only into the category
--                  whose [elo_min, elo_max) contains their Elo
--   free         — players self-register wherever they like
-- elo_min/elo_max existed to make `by_rating` possible.
--
-- WHAT ACTUALLY SHIPPED is admin_assign, and only admin_assign. The
-- create-event route hardcoded `registration_mode: 'admin_assign'` with
-- a comment saying the column was "kept for schema stability", and no
-- code ever read it back — not one branch anywhere switched on it. An
-- enum with three values of which one is written and none are read is
-- not a configuration point, it is a decoration.
--
-- elo_min/elo_max were worse than unused: they were COMPUTED. Every
-- event create and update ran computeEloBands(), which queried the
-- lowest and highest Elo in the club, split that spread evenly between
-- the selected leagues, and wrote the result to every category row. The
-- apply route then ignored it completely — it even selected the
-- applicant's elo and never compared it to anything. So the numbers were
-- real, freshly computed, stored, shown to nobody and enforced nowhere.
-- The events settings screen fetched both columns and rendered neither.
--
-- The dangerous part of that is not the wasted query. It is that a
-- column called elo_min sitting on a category reads like a rule, and the
-- next person to touch registration would reasonably assume the gate
-- works. Deleting it says plainly what is true: distribution is manual,
-- and the admin's judgement is the only gate.
--
-- IF A RATING GATE COMES BACK, it should be recomputed from
-- SKILL_CATEGORIES (lib/elo.ts), which is the club's actual notion of a
-- rating band, rather than from this "spread the current min..max evenly
-- across whichever leagues happen to be selected" heuristic — that one
-- moved every band whenever a single new player joined at either end.
--
-- Run AFTER 037: the columns live on tournament_categories, which is
-- called `tournaments` before it. Guarded anyway, so a re-run is a
-- no-op.

-- ──────────────────────────────────────────────
-- THE COLUMNS
-- ──────────────────────────────────────────────
-- Named under both spellings so this works whether or not 037 has run.
alter table if exists tournament_categories
  drop column if exists elo_min,
  drop column if exists elo_max;

alter table if exists tournaments
  drop column if exists elo_min,
  drop column if exists elo_max;

alter table if exists tournament_events
  drop column if exists registration_mode;

-- ──────────────────────────────────────────────
-- THE TYPE
-- ──────────────────────────────────────────────
-- Only after its one column is gone. Plain `drop type` rather than
-- `cascade`: if anything else still depends on it, this should fail
-- loudly instead of quietly dropping that too.
drop type if exists registration_mode;
