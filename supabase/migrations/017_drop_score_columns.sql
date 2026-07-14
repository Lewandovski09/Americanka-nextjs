-- ============================================================
-- AMERICANKA — Migration 017: drop matches.score_a / score_b
-- ============================================================
-- set1/set2/set3 (migration 016) are now the single source of truth for
-- a match result; the aggregate is derived in code (lib/formats/sets.js)
-- and, for the reporting functions below, by match_won_by_a(). A walkover
-- is stored as a played 1:0 single set.

-- Winner check shared by the reporting functions: single set → its
-- points; two/three sets → sets won.
create or replace function match_won_by_a(p_set1 integer[], p_set2 integer[], p_set3 integer[])
returns boolean
language sql
immutable
as $$
  select case
    when p_set1 is null then false
    when p_set2 is null then p_set1[1] > p_set1[2]
    else
      (case when p_set1[1] > p_set1[2] then 1 else 0 end)
      + (case when p_set2[1] > p_set2[2] then 1 else 0 end)
      + (case when p_set3 is not null and p_set3[1] > p_set3[2] then 1 else 0 end)
      >= 2
  end;
$$;

-- ── Partner / opponent history: return the sets instead of score_a/b ──
-- (return type changes → drop + recreate)
drop function if exists get_partner_match_history(uuid, uuid);

create function get_partner_match_history(p_player_id uuid, p_partner_id uuid)
returns table (
  match_id uuid,
  tournament_id uuid,
  tournament_name text,
  round_number integer,
  set1 integer[],
  set2 integer[],
  set3 integer[],
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
    m.set1,
    m.set2,
    m.set3,
    m.team_a_players,
    m.team_b_players,
    case
      when p_player_id = any(m.team_a_players) then match_won_by_a(m.set1, m.set2, m.set3)
      else not match_won_by_a(m.set1, m.set2, m.set3)
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

drop function if exists get_opponent_match_history(uuid, uuid);

create function get_opponent_match_history(p_player_id uuid, p_opponent_id uuid)
returns table (
  match_id uuid,
  tournament_id uuid,
  tournament_name text,
  round_number integer,
  set1 integer[],
  set2 integer[],
  set3 integer[],
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
    m.set1,
    m.set2,
    m.set3,
    m.team_a_players,
    m.team_b_players,
    case
      when p_player_id = any(m.team_a_players) then match_won_by_a(m.set1, m.set2, m.set3)
      else not match_won_by_a(m.set1, m.set2, m.set3)
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

-- ── Per-format stats: same output, winner now derived from the sets ──
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
    select
      t.id as tournament_id,
      case te.format_kind
        when 'americanka' then 'Американка'
        when 'single_gender' then 'Чоловічі / Жіночі'
        when 'mix' then 'Мікс'
        when 'king_of_beach' then 'Король пляжу'
        else 'Американка'
      end as format_name,
      t.winner_player_id
    from tournament_players tp
    join tournaments t on t.id = tp.tournament_id
    left join tournament_events te on te.id = t.event_id
    where tp.player_id = p_player_id and t.status = 'done'
  ),
  player_games as (
    select
      pt.format_name,
      m.id as match_id,
      case
        when p_player_id = any(m.team_a_players) then match_won_by_a(m.set1, m.set2, m.set3)
        else not match_won_by_a(m.set1, m.set2, m.set3)
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

-- ── Drop the aggregate columns ──
alter table matches
  drop column if exists score_a,
  drop column if exists score_b;
