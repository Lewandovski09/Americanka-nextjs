-- ============================================================
-- AMERICANKA — Migration 007: Per-format player statistics
-- ============================================================
-- Returns, for a given player, how many tournaments/games they
-- played and won, broken down by tournament format — used by the
-- "compare two players" feature on the rating page.

create or replace function get_player_format_stats(p_player_id uuid)
returns table (
  format_name text,
  tournaments_played bigint,
  tournaments_won bigint,
  games_played bigint,
  games_won bigint
)
language sql
stable
as $$
  with player_tournaments as (
    select t.id as tournament_id, tf.display_name as format_name, t.winner_player_id
    from tournament_players tp
    join tournaments t on t.id = tp.tournament_id
    join tournament_formats tf on tf.id = t.format_id
    where tp.player_id = p_player_id and t.status = 'done'
  ),
  player_games as (
    select
      pt.format_name,
      m.id as match_id,
      case
        when p_player_id = any(m.team_a_players) then m.score_a > m.score_b
        else m.score_b > m.score_a
      end as won
    from matches m
    join player_tournaments pt on pt.tournament_id = m.tournament_id
    where m.played = true
      and (p_player_id = any(m.team_a_players) or p_player_id = any(m.team_b_players))
  )
  select
    pt.format_name,
    count(distinct pt.tournament_id) as tournaments_played,
    count(distinct pt.tournament_id) filter (where pt.winner_player_id = p_player_id) as tournaments_won,
    count(pg.match_id) as games_played,
    count(pg.match_id) filter (where pg.won) as games_won
  from player_tournaments pt
  left join player_games pg on pg.format_name = pt.format_name
  group by pt.format_name;
$$;
