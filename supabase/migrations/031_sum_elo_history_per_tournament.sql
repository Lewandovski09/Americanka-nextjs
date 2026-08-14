-- ============================================================
-- AMERICANKA — Migration 031: sum elo_history per tournament
-- ============================================================
-- Necessary follow-on to auto-Ело for Americanka (see
-- app/api/matches/[matchId]/score/route.js): that feature writes one
-- elo_history row per GAME, where before this only ever existed as at
-- most one row per tournament (an admin's manual adjustment). This
-- function's `left join elo_history eh on eh.tournament_id = t.id and
-- eh.player_id = p_player_id` assumed exactly that one-row shape — with
-- several rows now possible for one tournament, a plain join multiplies
-- the tournament itself into one output row per game, which would
-- duplicate every Americanka tournament in a player's history once for
-- each game they played in it.
--
-- Fix: sum every matching elo_history row into a single number per
-- tournament, so the join stays one row per tournament no matter how
-- many individual game deltas fed into it.

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
    (
      select sum(eh.delta)::integer
      from elo_history eh
      where eh.tournament_id = t.id and eh.player_id = p_player_id
    ) as elo_delta,
    tpl.place as placement
  from (
    select tournament_id from tournament_players where player_id = p_player_id
    union
    select tournament_id from tournament_teams
      where player1_id = p_player_id or player2_id = p_player_id
  ) participated
  join tournaments t on t.id = participated.tournament_id
  left join tournament_events te on te.id = t.event_id
  left join tournament_placements tpl on tpl.tournament_id = t.id and tpl.player_id = p_player_id
  order by t.scheduled_at desc;
$$;
