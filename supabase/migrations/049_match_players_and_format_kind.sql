-- ============================================================
-- AMERICANKA — Migration 049: who played a match, as real rows;
--                              format names live in code only
-- ============================================================
-- 1. tournament_match_players — one row per player per match, with a
--    real foreign key to users. tournament_matches.team_a_players /
--    team_b_players (uuid arrays) stay as they are: every generator and
--    the score route write them, and rewriting all of that buys nothing.
--    A trigger keeps this table in step with the arrays on every insert
--    and update, so:
--      • a match can no longer name a player who does not exist — the
--        foreign key refuses the write;
--      • a player who has played cannot be deleted by accident (RESTRICT);
--      • "every match of player X" is an index lookup instead of a scan
--        of every match's arrays.
--
-- 2. Format NAMES are no longer spelled out in SQL. The profile RPCs
--    return format_kind ('americanka', 'mix', …) and the app turns it into
--    a label through lib/formats — one place to rename a format.
--
-- 3. get_user_format_stats is also FIXED. It joined games to tournaments
--    by format name, not by tournament, so a player's games were counted
--    once per tournament of that format (3 americankas × 7 games = 63
--    "games"), and it ignored pair formats entirely (it only looked at
--    tournament_players). Wins now come from tournament_placements, so
--    BOTH halves of a winning pair count the win.
--
-- Idempotent. Run after deploying the code from the same patch (the old
-- code reads format_name and simply falls back to Americanka meanwhile).

-- ──────────────────────────────────────────────
-- 1. tournament_match_players
-- ──────────────────────────────────────────────
create table if not exists tournament_match_players (
  match_id uuid not null references tournament_matches(id) on delete cascade,
  user_id uuid not null references users(id) on delete restrict,
  side char(1) not null check (side in ('A', 'B')),
  position smallint not null,
  primary key (match_id, user_id)
);

create index if not exists idx_match_players_user on tournament_match_players(user_id, match_id);

alter table tournament_match_players enable row level security;
drop policy if exists tournament_match_players_select_all on tournament_match_players;
create policy tournament_match_players_select_all on tournament_match_players for select using (true);
-- No write policy: only the trigger below (security definer) writes here.

create or replace function sync_match_players()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.team_a_players is not distinct from old.team_a_players
     and new.team_b_players is not distinct from old.team_b_players then
    return new;
  end if;

  delete from tournament_match_players where match_id = new.id;

  insert into tournament_match_players (match_id, user_id, side, position)
  select new.id, x.u, 'A', x.ord - 1
  from unnest(coalesce(new.team_a_players, '{}')) with ordinality as x(u, ord)
  where x.u is not null
  on conflict (match_id, user_id) do nothing;

  insert into tournament_match_players (match_id, user_id, side, position)
  select new.id, x.u, 'B', x.ord - 1
  from unnest(coalesce(new.team_b_players, '{}')) with ordinality as x(u, ord)
  where x.u is not null
  on conflict (match_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_matches_sync_players on tournament_matches;
create trigger trg_matches_sync_players
  after insert or update of team_a_players, team_b_players on tournament_matches
  for each row execute function sync_match_players();

-- Backfill every existing match. Ids that no longer exist in users are
-- skipped and reported instead of failing the whole migration.
do $$
declare
  n_rows int; n_orphans int;
begin
  insert into tournament_match_players (match_id, user_id, side, position)
  select m.id, x.u, 'A', x.ord - 1
  from tournament_matches m, unnest(m.team_a_players) with ordinality as x(u, ord)
  where x.u is not null and exists (select 1 from users u where u.id = x.u)
  on conflict (match_id, user_id) do nothing;

  insert into tournament_match_players (match_id, user_id, side, position)
  select m.id, x.u, 'B', x.ord - 1
  from tournament_matches m, unnest(m.team_b_players) with ordinality as x(u, ord)
  where x.u is not null and exists (select 1 from users u where u.id = x.u)
  on conflict (match_id, user_id) do nothing;

  select count(*) into n_rows from tournament_match_players;
  select count(*) into n_orphans
  from tournament_matches m, unnest(m.team_a_players || m.team_b_players) as x(u)
  where x.u is not null and not exists (select 1 from users u where u.id = x.u);

  raise notice '049: % match-player rows; % array entries point at no user (should be 0)', n_rows, n_orphans;
end;
$$;

-- ──────────────────────────────────────────────
-- 2. Partner / opponent history through the new table
-- ──────────────────────────────────────────────
-- Same columns as before (037), so the profile code is unchanged.
drop function if exists get_partner_match_history(uuid, uuid);
create function get_partner_match_history(p_user_id uuid, p_partner_id uuid)
returns table (
  match_id uuid, category_id uuid, tournament_name text, round_number integer,
  set1 integer[], set2 integer[], set3 integer[],
  team_a_players uuid[], team_b_players uuid[], won boolean, played_at timestamptz
)
language sql
stable
as $$
  select m.id, m.category_id, t.name, m.round_number, m.set1, m.set2, m.set3,
         m.team_a_players, m.team_b_players,
         case when me.side = 'A' then match_won_by_a(m.set1, m.set2, m.set3)
              else not match_won_by_a(m.set1, m.set2, m.set3) end,
         m.played_at
  from tournament_match_players me
  join tournament_match_players mate
    on mate.match_id = me.match_id and mate.user_id = p_partner_id and mate.side = me.side
  join tournament_matches m on m.id = me.match_id
  join tournament_categories t on t.id = m.category_id
  where me.user_id = p_user_id and m.played
  order by m.played_at desc;
$$;

drop function if exists get_opponent_match_history(uuid, uuid);
create function get_opponent_match_history(p_user_id uuid, p_opponent_id uuid)
returns table (
  match_id uuid, category_id uuid, tournament_name text, round_number integer,
  set1 integer[], set2 integer[], set3 integer[],
  team_a_players uuid[], team_b_players uuid[], won boolean, played_at timestamptz
)
language sql
stable
as $$
  select m.id, m.category_id, t.name, m.round_number, m.set1, m.set2, m.set3,
         m.team_a_players, m.team_b_players,
         case when me.side = 'A' then match_won_by_a(m.set1, m.set2, m.set3)
              else not match_won_by_a(m.set1, m.set2, m.set3) end,
         m.played_at
  from tournament_match_players me
  join tournament_match_players opp
    on opp.match_id = me.match_id and opp.user_id = p_opponent_id and opp.side <> me.side
  join tournament_matches m on m.id = me.match_id
  join tournament_categories t on t.id = m.category_id
  where me.user_id = p_user_id and m.played
  order by m.played_at desc;
$$;

-- ──────────────────────────────────────────────
-- 3. Profile stats: format_kind instead of a name, and counted right
-- ──────────────────────────────────────────────
drop function if exists get_user_format_stats(uuid);
create function get_user_format_stats(p_user_id uuid)
returns table (
  format_kind text,
  tournaments_played bigint,
  tournaments_won bigint,
  games_played bigint,
  games_won bigint
)
language sql
stable
as $$
  with cats as (
    select t.id as category_id, coalesce(te.format_kind::text, 'americanka') as format_kind
    from tournament_categories t
    left join tournament_events te on te.id = t.event_id
    where t.status = 'done'
      and t.id in (
        select category_id from tournament_players where user_id = p_user_id
        union
        select category_id from tournament_teams where user1_id = p_user_id or user2_id = p_user_id
      )
  ),
  games as (
    select c.format_kind,
           case when mp.side = 'A' then match_won_by_a(m.set1, m.set2, m.set3)
                else not match_won_by_a(m.set1, m.set2, m.set3) end as won
    from cats c
    join tournament_matches m on m.category_id = c.category_id and m.played
    join tournament_match_players mp on mp.match_id = m.id and mp.user_id = p_user_id
  )
  select k.format_kind,
         (select count(*) from cats c where c.format_kind = k.format_kind),
         (select count(*) from cats c
            join tournament_placements p on p.category_id = c.category_id and p.user_id = p_user_id and p.place = 1
            where c.format_kind = k.format_kind),
         (select count(*) from games g where g.format_kind = k.format_kind),
         (select count(*) from games g where g.format_kind = k.format_kind and g.won)
  from (select distinct format_kind from cats) k;
$$;

drop function if exists get_user_tournament_history(uuid);
create function get_user_tournament_history(p_user_id uuid)
returns table (
  category_id uuid,
  tournament_name text,
  format_kind text,
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
    t.id,
    t.name,
    coalesce(te.format_kind::text, 'americanka'),
    t.category_label,
    t.gender,
    t.status,
    t.scheduled_at,
    t.finished_at,
    (
      select sum(eh.delta)::integer
      from elo_history eh
      join tournament_matches m on m.id = eh.match_id
      where m.category_id = t.id and eh.user_id = p_user_id
    ),
    tpl.place
  from (
    select category_id from tournament_players where user_id = p_user_id
    union
    select category_id from tournament_teams where user1_id = p_user_id or user2_id = p_user_id
  ) participated
  join tournament_categories t on t.id = participated.category_id
  left join tournament_events te on te.id = t.event_id
  left join tournament_placements tpl on tpl.category_id = t.id and tpl.user_id = p_user_id
  order by t.scheduled_at desc;
$$;

notify pgrst, 'reload schema';
