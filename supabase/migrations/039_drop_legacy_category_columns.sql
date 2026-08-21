-- ============================================================
-- AMERICANKA — Migration 039: drop the legacy category columns
-- ============================================================
--   tournament_categories.category       (skill_category enum) → dropped
--   tournament_categories.category_text  (free text)           → dropped
--
-- Three columns accumulated on this table for one piece of
-- information — what a category is called:
--
--   001  category skill_category not null   -- 'D' | 'C' | 'B' | 'A' | 'Open'
--          Correct at the time: a tournament WAS one category, and the
--          only categories were skill letters.
--   009  category_text text
--          The new formats (mix, single_gender, king_of_beach) label
--          themselves Light/Medium/Pro, which the enum cannot express.
--          Rather than decide, 009 added a second column beside it and
--          wrote the decision down as a TODO: "kept separate … so it
--          doesn't force a decision on D/C/B/A vs Light/Medium/Pro yet.
--          Once confirmed, this can be migrated to a proper enum."
--          It also dropped the NOT NULL on category.
--   011  category_label text
--          The events rewrite needed the same label again, did not use
--          category_text, and added a THIRD column. The 009 decision was
--          never made — it was worked around a second time.
--
-- category_label won. Nothing writes the other two: categoryRow() in
-- lib/server/eventConfig.ts does not emit either, so every category
-- created through the current flow has both NULL.
--
-- MEASURED BEFORE DROPPING, on the live database:
--   всего 3 · есть_category 0 · есть_label 3 · только_старая 0 · есть_category_text 0
-- No row anywhere relies on the fallback. Nothing to migrate first.
--
-- The two readers were both coalesce fallbacks for pre-011 rows that do
-- not exist:
--   • components/CategoryRow.js — {c.category_label || c.category}
--   • get_user_tournament_history — coalesce(t.category_label,
--     t.category::text). Migration 030 exists ONLY because this function
--     originally read `category` alone and a Mix category rendered as
--     «Кат. —». The fallback is the scar from that fix.
--
-- The skill_category TYPE stays: users.category and
-- users.requested_category are the player's own rating letter, are
-- actively written and read, and have nothing to do with this.
--
-- Run AFTER 037 (the table is called `tournaments` before it).

-- ──────────────────────────────────────────────
-- 1. THE FUNCTION FIRST
-- ──────────────────────────────────────────────
-- Ahead of the drop, and not optional. A SQL function with a text body
-- has no recorded dependency on the columns it reads, so dropping
-- `category` would NOT fail here — it would leave
-- get_user_tournament_history quietly broken until the next time
-- somebody opened a profile. Same trap as the renames in 037.
--
-- Identical to the 037 version except that the coalesce is gone.
drop function if exists get_user_tournament_history(uuid);

create function get_user_tournament_history(p_user_id uuid)
returns table (
  category_id uuid,
  tournament_name text,
  format_name text,
  category text,
  gender gender_type,
  status tournament_status,
  scheduled_at timestamptz,
  finished_at timestamptz,
  elo_delta integer,
  placement integer
)
language sql
stable
as $$
  select
    t.id as category_id,
    t.name as tournament_name,
    case te.format_kind
      when 'americanka' then 'Американка'
      when 'single_gender' then 'Чоловічі / Жіночі'
      when 'mix' then 'Мікс'
      when 'king_of_beach' then 'Король пляжу'
      else 'Американка'
    end as format_name,
    t.category_label as category,
    t.gender,
    t.status,
    t.scheduled_at,
    t.finished_at,
    (
      select sum(eh.delta)::integer
      from elo_history eh
      where eh.category_id = t.id and eh.user_id = p_user_id
    ) as elo_delta,
    tpl.place as placement
  from (
    select category_id from tournament_players where user_id = p_user_id
    union
    select category_id from tournament_teams
      where user1_id = p_user_id or user2_id = p_user_id
  ) participated
  join tournament_categories t on t.id = participated.category_id
  left join tournament_events te on te.id = t.event_id
  left join tournament_placements tpl on tpl.category_id = t.id and tpl.user_id = p_user_id
  order by t.scheduled_at desc;
$$;

-- ──────────────────────────────────────────────
-- 2. THE COLUMNS
-- ──────────────────────────────────────────────
-- Named under both spellings of the table so this runs either side of
-- 037; guarded, so a re-run is a no-op.
alter table if exists tournament_categories
  drop column if exists category,
  drop column if exists category_text;

alter table if exists tournaments
  drop column if exists category,
  drop column if exists category_text;
