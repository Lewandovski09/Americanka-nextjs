-- ============================================================
-- AMERICANKA — Migration 008: Add format breakdown to player
-- tournament history.
-- ============================================================
-- The profile page now shows tournaments/placements broken down
-- by format AND category (e.g. "AMERICANKA 2x2 — 5 tournaments,
-- 3 in category B, 2 in category A"). get_player_tournament_history
-- already returns category/placement per tournament but not the
-- format name, so this adds it via tournament_formats.
--
-- Function return type is changing, so it must be dropped first —
-- Postgres won't let CREATE OR REPLACE change a function's result
-- columns.

drop function if exists get_player_tournament_history(uuid);

create function get_player_tournament_history(p_player_id uuid)
returns table (
  tournament_id uuid,
  tournament_name text,
  format_name text,
  category skill_category,
  gender gender_type,
  status tournament_status,
  finished_at timestamptz,
  elo_delta integer,
  placement integer
)
language sql
stable
as $$
  select
    t.id as tournament_id,
    t.name as tournament_name,
    tf.display_name as format_name,
    t.category,
    t.gender,
    t.status,
    t.finished_at,
    eh.delta as elo_delta,
    eh.placement
  from tournament_players tp
  join tournaments t on t.id = tp.tournament_id
  left join tournament_formats tf on tf.id = t.format_id
  left join elo_history eh on eh.tournament_id = t.id and eh.player_id = p_player_id
  where tp.player_id = p_player_id
  order by t.scheduled_at desc;
$$;
