-- ============================================================
-- AMERICANKA — Migration 059: statistics counted in the database
-- ============================================================
-- The rating page, «Герої місяця» and the profile header used to
-- download whole tables (every game of the season, every Ело change,
-- every user, every place) and count in the browser — slower with every
-- tournament, and past PostgREST's 1000-row page some numbers silently
-- went wrong. These functions return the finished numbers instead.
--
-- All are plain (security invoker) reads of tables that are public to
-- the app anyway; days are taken in Kyiv time.
--
-- Idempotent.

-- Did team A win? Same rule as lib/formats/sets.ts teamAWon: one set →
-- its points (a tie counts for A, like the app); several → sets won.
create or replace function match_a_won(s1 integer[], s2 integer[], s3 integer[])
returns boolean
language sql
immutable
as $$
  select case
    when s1 is null then false
    when s2 is null and s3 is null then s1[1] >= s1[2]
    else
      ((case when s1[1] > s1[2] then 1 else 0 end)
       + (case when s2 is not null and s2[1] > s2[2] then 1 else 0 end)
       + (case when s3 is not null and s3[1] > s3[2] then 1 else 0 end))
      >=
      ((case when s1[2] > s1[1] then 1 else 0 end)
       + (case when s2 is not null and s2[2] > s2[1] then 1 else 0 end)
       + (case when s3 is not null and s3[2] > s3[1] then 1 else 0 end))
  end;
$$;

-- Every game of every player since a moment: won or not, newest first.
create or replace function player_games_since(p_from timestamptz, p_to timestamptz default null)
returns table (user_id uuid, played_at timestamptz, won boolean, format_kind text)
language sql
stable
as $$
  select mp.user_id,
         m.played_at,
         case when mp.side = 'A' then match_a_won(m.set1, m.set2, m.set3)
              else not match_a_won(m.set1, m.set2, m.set3) end,
         coalesce(e.format_kind::text, 'americanka')
    from tournament_matches m
    join tournament_match_players mp on mp.match_id = m.id
    left join tournament_categories c on c.id = m.category_id
    left join tournament_events e on e.id = c.event_id
   where m.played = true
     and m.played_at >= p_from
     and (p_to is null or m.played_at < p_to);
$$;

-- «Турн.» on the Ело tab: Americanka tournaments each player has a place in.
create or replace function americanka_tournament_counts()
returns table (user_id uuid, n integer)
language sql
stable
as $$
  select tp.user_id, count(*)::integer
    from tournament_placements tp
    join tournament_categories c on c.id = tp.category_id
    join tournament_events e on e.id = c.event_id
   where e.format_kind = 'americanka'
   group by tp.user_id;
$$;

-- Club leaderboards of a season (dates in Kyiv time; p_to inclusive):
-- current win streaks (≥ 2), game wins outside Americanka, Ело gained.
create or replace function club_stats(p_from date, p_to date default null)
returns jsonb
language sql
stable
as $$
  with bounds as (
    select (p_from::timestamp at time zone 'Europe/Kyiv') as t0,
           case when p_to is null then null else ((p_to + 1)::timestamp at time zone 'Europe/Kyiv') end as t1
  ),
  g as (
    select pg.* from bounds, player_games_since(bounds.t0, bounds.t1) pg
  ),
  ranked as (
    select user_id, won,
           sum(case when won then 0 else 1 end) over (partition by user_id order by played_at desc
             rows between unbounded preceding and current row) as losses_so_far
      from g
  ),
  streaks as (
    select user_id, count(*)::integer as streak
      from ranked where losses_so_far = 0
     group by user_id having count(*) >= 2
     order by streak desc limit 50
  ),
  wins as (
    select user_id, count(*)::integer as wins
      from g where won and format_kind <> 'americanka'
     group by user_id order by wins desc limit 50
  ),
  gains as (
    select eh.user_id, sum(eh.delta)::integer as gain
      from elo_history eh, bounds
     where eh.reason = 'tournament_result'
       and eh.created_at >= bounds.t0
       and (bounds.t1 is null or eh.created_at < bounds.t1)
     group by eh.user_id having sum(eh.delta) > 0
     order by gain desc limit 50
  )
  select jsonb_build_object(
    'streaks', coalesce((select jsonb_agg(jsonb_build_object('playerId', user_id, 'streak', streak) order by streak desc) from streaks), '[]'),
    'wins',    coalesce((select jsonb_agg(jsonb_build_object('playerId', user_id, 'wins', wins) order by wins desc) from wins), '[]'),
    'gains',   coalesce((select jsonb_agg(jsonb_build_object('playerId', user_id, 'gain', gain) order by gain desc) from gains), '[]')
  );
$$;

-- «Герої місяця»: the podium (most Ело gained), the hottest current
-- streak (≥ 3), the player with most tournament wins, newcomers, games.
create or replace function heroes_month(p_days integer default 30)
returns jsonb
language sql
stable
as $$
  with since as (select now() - make_interval(days => p_days) as t0),
  podium as (
    select eh.user_id, sum(eh.delta)::integer as gain
      from elo_history eh, since
     where eh.reason = 'tournament_result' and eh.created_at >= since.t0
     group by eh.user_id having sum(eh.delta) > 0
     order by gain desc limit 3
  ),
  g as (select pg.* from since, player_games_since(since.t0) pg),
  ranked as (
    select user_id,
           sum(case when won then 0 else 1 end) over (partition by user_id order by played_at desc
             rows between unbounded preceding and current row) as losses_so_far
      from g
  ),
  streak as (
    select user_id, count(*)::integer as n from ranked where losses_so_far = 0
     group by user_id having count(*) >= 3 order by n desc limit 1
  ),
  champ as (
    select tp.user_id, count(*)::integer as n
      from tournament_placements tp
      join tournament_categories c on c.id = tp.category_id, since
     where tp.place = 1 and c.status = 'done' and c.finished_at >= since.t0
     group by tp.user_id order by n desc limit 1
  )
  select jsonb_build_object(
    'podium', coalesce((select jsonb_agg(jsonb_build_object('id', user_id, 'gain', gain) order by gain desc) from podium), '[]'),
    'streak', (select jsonb_build_object('id', user_id, 'n', n) from streak),
    'champ',  (select jsonb_build_object('id', user_id, 'n', n) from champ),
    'newPlayers', (select count(*) from users, since where approval_status = 'approved' and created_at >= since.t0),
    'games', (select count(*) from tournament_matches, since where played = true and played_at >= since.t0)
  );
$$;

-- A player's AVP place in a season among the same gender, plus how many
-- are in that table — for the profile header and «Турніри · AVP».
create or replace function avp_rank(p_season uuid, p_user uuid)
returns table (points integer, rank integer, field integer)
language sql
stable
as $$
  with me as (select gender from users where id = p_user),
  board as (
    select s.user_id, s.points,
           rank() over (order by s.points desc)::integer as r
      from avp_standings s
      join users u on u.id = s.user_id
     where s.season_id = p_season and u.gender = (select gender from me)
  )
  select b.points, b.r, (select count(*)::integer from board)
    from board b where b.user_id = p_user
  union all
  select null, null, (select count(*)::integer from board)
   where not exists (select 1 from board where user_id = p_user);
$$;

-- A player's current win streak (all formats), newest game first.
create or replace function player_win_streak(p_user uuid)
returns integer
language sql
stable
as $$
  with g as (
    select case when mp.side = 'A' then match_a_won(m.set1, m.set2, m.set3)
                else not match_a_won(m.set1, m.set2, m.set3) end as won,
           m.played_at
      from tournament_match_players mp
      join tournament_matches m on m.id = mp.match_id
     where mp.user_id = p_user and m.played = true
     order by m.played_at desc
     limit 50
  ),
  r as (
    select won, sum(case when won then 0 else 1 end) over (order by played_at desc
             rows between unbounded preceding and current row) as l
      from g
  )
  select count(*)::integer from r where l = 0;
$$;

grant execute on function match_a_won(integer[], integer[], integer[]) to anon, authenticated;
grant execute on function player_games_since(timestamptz, timestamptz) to anon, authenticated;
grant execute on function americanka_tournament_counts() to anon, authenticated;
grant execute on function club_stats(date, date) to anon, authenticated;
grant execute on function heroes_month(integer) to anon, authenticated;
grant execute on function avp_rank(uuid, uuid) to anon, authenticated;
grant execute on function player_win_streak(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
