-- ============================================================
-- AMERICANKA — Migration 030: category_label + scheduled_at in history
-- ============================================================
-- Two follow-on fixes to get_player_tournament_history from migration
-- 029, found once real data started flowing through it:
--
-- 1. It selected `t.category` — the skill_category (D/C/B/A) column
--    that predates the events system (migration 011). Every category
--    created through the current events flow labels itself via
--    `category_label` instead ('Pro' | 'Medium' | 'Light', see 011's
--    comment: "the label shown on the category tab") — `category` is
--    left over from before events existed and is empty/stale for a
--    tournament created the normal way today. That's why a Mix
--    category showed up as "Кат. —" instead of "Pro" — the function
--    was reading the wrong column, not a missing value.
--
-- 2. Nothing in the return columns carried a date at all for a
--    tournament still in progress (only finished_at, which is null
--    until it's done) — added scheduled_at so the history list always
--    has a real date to show regardless of status.

drop function if exists get_player_tournament_history(uuid);

create function get_player_tournament_history(p_player_id uuid)
returns table (
  tournament_id uuid,
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
    t.id as tournament_id,
    t.name as tournament_name,
    case te.format_kind
      when 'americanka' then 'Американка'
      when 'single_gender' then 'Чоловічі / Жіночі'
      when 'mix' then 'Мікс'
      when 'king_of_beach' then 'Король пляжу'
      else 'Американка'
    end as format_name,
    coalesce(t.category_label, t.category::text) as category,
    t.gender,
    t.status,
    t.scheduled_at,
    t.finished_at,
    eh.delta as elo_delta,
    tpl.place as placement
  from (
    select tournament_id from tournament_players where player_id = p_player_id
    union
    select tournament_id from tournament_teams
      where player1_id = p_player_id or player2_id = p_player_id
  ) participated
  join tournaments t on t.id = participated.tournament_id
  left join tournament_events te on te.id = t.event_id
  left join elo_history eh on eh.tournament_id = t.id and eh.player_id = p_player_id
  left join tournament_placements tpl on tpl.tournament_id = t.id and tpl.player_id = p_player_id
  order by t.scheduled_at desc;
$$;
