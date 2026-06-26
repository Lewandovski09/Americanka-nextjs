-- ============================================================
-- AMERICANKA — Migration 005: Partner match history function
-- ============================================================
-- Rather than duplicating match data into another table, this
-- function queries `matches` directly to find every game two
-- specific players were on the SAME team together, joined with
-- tournament info. This powers "show me all games I played with
-- this partner".

create or replace function get_partner_match_history(p_player_id uuid, p_partner_id uuid)
returns table (
  match_id uuid,
  tournament_id uuid,
  tournament_name text,
  round_number integer,
  score_a integer,
  score_b integer,
  team_a_players uuid[],
  team_b_players uuid[],
  won boolean,
  played_at timestamptz
)
language sql
stable
as $$
  select
    m.id as match_id,
    m.tournament_id,
    t.name as tournament_name,
    m.round_number,
    m.score_a,
    m.score_b,
    m.team_a_players,
    m.team_b_players,
    case
      when p_player_id = any(m.team_a_players) then m.score_a > m.score_b
      else m.score_b > m.score_a
    end as won,
    m.played_at
  from matches m
  join tournaments t on t.id = m.tournament_id
  where m.played = true
    and (
      (p_player_id = any(m.team_a_players) and p_partner_id = any(m.team_a_players))
      or
      (p_player_id = any(m.team_b_players) and p_partner_id = any(m.team_b_players))
    )
  order by m.played_at desc;
$$;

-- ──────────────────────────────────────────────
-- Tournament history for a player — every tournament they took
-- part in, with their final placement and elo change, for the
-- profile page's "tournament history" section.
-- ──────────────────────────────────────────────
create or replace function get_player_tournament_history(p_player_id uuid)
returns table (
  tournament_id uuid,
  tournament_name text,
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
    t.category,
    t.gender,
    t.status,
    t.finished_at,
    eh.delta as elo_delta,
    eh.placement
  from tournament_players tp
  join tournaments t on t.id = tp.tournament_id
  left join elo_history eh on eh.tournament_id = t.id and eh.player_id = p_player_id
  where tp.player_id = p_player_id
  order by t.scheduled_at desc;
$$;
