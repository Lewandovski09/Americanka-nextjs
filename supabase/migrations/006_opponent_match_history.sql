-- ============================================================
-- AMERICANKA — Migration 006: Head-to-head (opponent) match history
-- ============================================================
-- Complements get_partner_match_history (same-team games) with a
-- function for games where the two players were on OPPOSING teams.

create or replace function get_opponent_match_history(p_player_id uuid, p_opponent_id uuid)
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
      (p_player_id = any(m.team_a_players) and p_opponent_id = any(m.team_b_players))
      or
      (p_player_id = any(m.team_b_players) and p_opponent_id = any(m.team_a_players))
    )
  order by m.played_at desc;
$$;
