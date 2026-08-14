-- ============================================================
-- AMERICANKA — Migration 033: get_player_elo_log
-- ============================================================
-- One row per elo_history entry (per game, now that auto-Ело writes
-- one row per Americanka game rather than one per tournament) with the
-- tournament name and opponent names resolved, for a "what happened to
-- my rating, game by game" view. Complements
-- get_player_tournament_history, which stays tournament-level (summed)
-- for the tournament list itself — this is specifically for the
-- separate, granular Ело journal.

create function get_player_elo_log(p_player_id uuid)
returns table (
  id uuid,
  tournament_id uuid,
  tournament_name text,
  match_id uuid,
  delta integer,
  elo_before integer,
  elo_after integer,
  created_at timestamptz,
  opponent_names text
)
language sql
stable
as $$
  select
    eh.id,
    eh.tournament_id,
    t.name as tournament_name,
    eh.match_id,
    eh.delta,
    eh.elo_before,
    eh.elo_after,
    eh.created_at,
    (
      select string_agg(p.full_name, ', ')
      from players p
      where m.id is not null and p.id = any(
        case
          when p_player_id = any(m.team_a_players) then m.team_b_players
          else m.team_a_players
        end
      )
    ) as opponent_names
  from elo_history eh
  left join tournaments t on t.id = eh.tournament_id
  left join matches m on m.id = eh.match_id
  where eh.player_id = p_player_id
  order by eh.created_at desc;
$$;
