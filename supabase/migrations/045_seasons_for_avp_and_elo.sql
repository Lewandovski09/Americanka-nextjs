-- ============================================================
-- AMERICANKA — Migration 045: separate AVP and Ело seasons
-- ============================================================
-- Two INDEPENDENT season tracks, kept in the same table (avp_seasons —
-- the name stays so the deployed code keeps working mid-deploy):
--
--   kind = 'avp' — AVP points belong to the AVP season whose dates cover
--                  the event's date (avp_points.season_id). Closing one
--                  freezes it: its points stay, new events go to the next.
--   kind = 'elo' — Ело stays one running number per player, and every Ело
--                  season has a table (season_ratings) of where each player
--                  started and finished it. Closing one archives everybody's
--                  final Ело; those rows are never touched again.
--
-- Each track is closed and started ON ITS OWN, from the admin panel:
--     select start_new_season('avp', 'AVP 2027', current_date);
--     select start_new_season('elo', 'Ело 2027', current_date, 'category', '{"D":950,...}');
--
-- NOTHING IS CLOSED BY THIS FILE. The season that is running now keeps
-- running in BOTH tracks: the existing AVP season becomes open-ended
-- (ends_on = NULL — until an admin starts the next one, instead of
-- stopping on Dec 31), and an Ело season with the same name and start
-- date is opened next to it.
--
-- Safe on a database that already ran the first version of this file
-- (single shared season): it is converted in place. Idempotent. Needs 043.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'avp_seasons' and column_name = 'sport_id'
  ) then
    raise exception 'Run migration 043 first';
  end if;
end;
$$;

-- ──────────────────────────────────────────────
-- 1. TWO KINDS OF SEASON, OPEN-ENDED CURRENT ONE
-- ──────────────────────────────────────────────
alter table avp_seasons add column if not exists kind text not null default 'avp';
alter table avp_seasons drop constraint if exists avp_seasons_kind_valid;
alter table avp_seasons add constraint avp_seasons_kind_valid check (kind in ('avp', 'elo'));

comment on table avp_seasons is
  'Seasons. kind=avp: AVP points (avp_points.season_id). kind=elo: Ело season tables (season_ratings). '
  'The two tracks are independent. ends_on NULL = the open, current season of its track.';

alter table avp_seasons alter column ends_on drop not null;
alter table avp_seasons drop constraint if exists avp_seasons_check;
alter table avp_seasons drop constraint if exists avp_seasons_dates_valid;
alter table avp_seasons
  add constraint avp_seasons_dates_valid check (ends_on is null or ends_on >= starts_on);

-- When start_new_season closed it (NULL = open, or closed by hand).
alter table avp_seasons add column if not exists closed_at timestamptz;

-- No overlap WITHIN one track (kind + sport + city). An AVP season and an
-- Ело season may cover the same dates — that is the point.
alter table avp_seasons drop constraint if exists avp_seasons_no_overlap;
alter table avp_seasons
  add constraint avp_seasons_no_overlap
  exclude using gist (
    kind with =,
    sport_id with =,
    (coalesce(city_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (daterange(starts_on, ends_on, '[]')) with &&
  );

-- The AVP season covering today stays running, with no end date. This
-- only REMOVES an end date — it never sets one, so nothing is closed.
update avp_seasons s
set ends_on = null
where s.kind = 'avp'
  and s.city_id is null
  and s.ends_on is not null
  and s.starts_on <= current_date
  and s.ends_on >= current_date
  and not exists (
    select 1 from avp_seasons later
    where later.kind = s.kind and later.sport_id = s.sport_id
      and later.city_id is null and later.starts_on > s.starts_on
  );

-- The current Ело season: opened next to the running AVP season, same
-- name and start date, also open-ended.
insert into avp_seasons (name, starts_on, ends_on, sport_id, kind)
select a.name, a.starts_on, null, a.sport_id, 'elo'
from avp_seasons a
where a.kind = 'avp' and a.city_id is null and a.ends_on is null
  and not exists (
    select 1 from avp_seasons e
    where e.kind = 'elo' and e.sport_id = a.sport_id and e.city_id is null
  );

create index if not exists idx_avp_seasons_track on avp_seasons(kind, sport_id, city_id, starts_on);

-- ──────────────────────────────────────────────
-- 2. SEASON RATINGS — the table of each Ело season
-- ──────────────────────────────────────────────
create table if not exists season_ratings (
  season_id uuid not null references avp_seasons(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  elo_start integer,               -- rating when the season began (or when the player joined it)
  elo_end integer,                 -- frozen at close; NULL while the season is open
  games_played integer not null default 0,
  games_won integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (season_id, user_id)
);

create index if not exists idx_season_ratings_user on season_ratings(user_id);

-- First version of this file pointed season_ratings at the shared
-- (now AVP) season. Move those rows to the matching Ело season.
update season_ratings sr
set season_id = e.id
from avp_seasons a
join avp_seasons e
  on e.kind = 'elo' and e.sport_id = a.sport_id and e.city_id is not distinct from a.city_id
 and e.starts_on = a.starts_on
where sr.season_id = a.id and a.kind = 'avp'
  and not exists (select 1 from season_ratings x where x.season_id = e.id and x.user_id = sr.user_id);
delete from season_ratings sr
using avp_seasons a
where sr.season_id = a.id and a.kind = 'avp';

alter table season_ratings enable row level security;
drop policy if exists season_ratings_select_all on season_ratings;
create policy season_ratings_select_all on season_ratings for select using (true);
drop policy if exists season_ratings_admin_write on season_ratings;
create policy season_ratings_admin_write on season_ratings
  for all using (is_admin()) with check (is_admin());

comment on column elo_history.reason is
  'tournament_result — one row per game (auto-Ело). '
  'admin_adjustment — manual correction from edit-elo; no match_id. '
  'season_reset — reset to the category start value when a new Ело season began; no match_id.';

-- The open season of a track (club-wide), or NULL.
drop function if exists current_season_id(text);
create or replace function current_season_id(p_kind text, p_sport text default primary_sport_id())
returns uuid
language sql
stable
as $$
  select id from avp_seasons
  where kind = p_kind and sport_id = p_sport and city_id is null
    and starts_on <= current_date
    and (ends_on is null or ends_on >= current_date)
  order by starts_on desc
  limit 1;
$$;

-- Starting Ело for the Ело season already running, best effort: today's
-- rating minus every change logged since it began. (History before
-- migration 037 was never written, so for this first season it is an
-- approximation; every later season gets an exact snapshot.)
insert into season_ratings (season_id, user_id, elo_start)
select
  s.id,
  u.id,
  u.elo - coalesce((
    select sum(eh.delta) from elo_history eh
    where eh.user_id = u.id and eh.sport_id = s.sport_id and eh.created_at >= s.starts_on
  ), 0)
from users u
cross join lateral (
  select id, sport_id, starts_on from avp_seasons where id = current_season_id('elo')
) s
where u.elo is not null
on conflict (season_id, user_id) do nothing;

-- A player approved in the middle of an Ело season joins its table with
-- the rating they were approved at.
create or replace function season_join_on_first_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
begin
  if new.elo is not null and (tg_op = 'INSERT' or old.elo is null) then
    sid := current_season_id('elo');
    if sid is not null then
      insert into season_ratings (season_id, user_id, elo_start)
      values (sid, new.id, new.elo)
      on conflict (season_id, user_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_users_season_join on users;
create trigger trg_users_season_join
  after insert or update of elo on users
  for each row execute function season_join_on_first_rating();

-- ──────────────────────────────────────────────
-- 3. start_new_season(kind, …) — one track at a time
-- ──────────────────────────────────────────────
-- p_kind 'avp': closes the open AVP season the day before p_starts_on and
--   opens the next. Points already awarded stay where they are; events
--   dated from p_starts_on on count in the new one (the API repays them).
-- p_kind 'elo': same, and additionally freezes everyone's final Ело into
--   the closing season's table, optionally resets Ело
--   (p_elo_mode = 'category': each player to their category's starting
--   value from p_start_elo, logged as reason = 'season_reset'), and
--   records everyone's starting Ело for the new season.
drop function if exists start_new_season(text, date, text, jsonb, text);
drop function if exists start_new_season(text, text, date, text, jsonb, text);

create function start_new_season(
  p_kind text,
  p_name text,
  p_starts_on date,
  p_elo_mode text default 'carry',
  p_start_elo jsonb default null,
  p_sport text default primary_sport_id()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cur avp_seasons%rowtype;
  new_id uuid;
  is_primary boolean := (p_sport = primary_sport_id());
  r record;
  target integer;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or is_admin()) then
    raise exception 'Тільки адмін може почати новий сезон';
  end if;
  if p_kind not in ('avp', 'elo') then
    raise exception 'Невідомий тип сезону: %', p_kind;
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Вкажіть назву сезону';
  end if;
  if p_starts_on is null then
    raise exception 'Вкажіть дату початку сезону';
  end if;
  -- Not in the future: an Ело close archives everyone's rating AS OF NOW,
  -- so the boundary cannot lie ahead of games still to be played. Same
  -- rule for AVP, so the two buttons behave alike.
  if p_starts_on > current_date then
    raise exception 'Новий сезон можна почати сьогодні або заднім числом, не в майбутньому';
  end if;
  if p_kind = 'avp' then
    p_elo_mode := 'carry';
  elsif p_elo_mode not in ('carry', 'category') then
    raise exception 'Невідомий режим Ело: %', p_elo_mode;
  end if;
  if p_elo_mode = 'category' and (not is_primary or p_start_elo is null) then
    raise exception 'Скидання до стартового Ело доступне лише для основного спорту і потребує таблиці значень';
  end if;
  if exists (
    select 1 from avp_seasons
    where kind = p_kind and sport_id = p_sport and city_id is null and starts_on >= p_starts_on
  ) then
    raise exception 'Вже є сезон, що починається % або пізніше', p_starts_on;
  end if;

  perform pg_advisory_xact_lock(hashtext('start_new_season:' || p_kind || ':' || p_sport));

  select * into cur from avp_seasons
  where kind = p_kind and sport_id = p_sport and city_id is null and starts_on < p_starts_on
  order by starts_on desc
  limit 1;

  if found then
    -- 1. Close the current season the day before the new one starts.
    if cur.ends_on is null or cur.ends_on >= p_starts_on then
      update avp_seasons set ends_on = p_starts_on - 1 where id = cur.id;
      cur.ends_on := p_starts_on - 1;
    end if;

    -- 2. Ело only: freeze everyone's final rating (once).
    if p_kind = 'elo' and cur.closed_at is null then
      insert into season_ratings (season_id, user_id, elo_end, games_played, games_won)
      select cur.id, x.user_id, x.elo, coalesce(g.played, 0), coalesce(g.won, 0)
      from (
        select id as user_id, elo from users where is_primary and elo is not null
        union all
        select user_id, elo from user_ratings where not is_primary and sport_id = p_sport
      ) x
      left join lateral (
        select count(*) as played, count(*) filter (where eh.delta > 0) as won
        from elo_history eh
        where eh.user_id = x.user_id
          and eh.sport_id = p_sport
          and eh.reason = 'tournament_result'
          and eh.created_at >= cur.starts_on
          and eh.created_at < (cur.ends_on + 1)
      ) g on true
      on conflict (season_id, user_id) do update
        set elo_end = excluded.elo_end,
            games_played = excluded.games_played,
            games_won = excluded.games_won;
    end if;

    update avp_seasons set closed_at = coalesce(closed_at, now()) where id = cur.id;
  end if;

  -- 3. Open the new season of this track.
  insert into avp_seasons (name, starts_on, ends_on, sport_id, kind)
  values (btrim(p_name), p_starts_on, null, p_sport, p_kind)
  returning id into new_id;

  if p_kind = 'elo' then
    -- 4. Optional reset to the category starting value.
    if p_elo_mode = 'category' then
      for r in select id, elo, category::text as cat from users where elo is not null loop
        target := (p_start_elo ->> coalesce(r.cat, ''))::integer;
        if target is not null and target <> r.elo then
          insert into elo_history (user_id, delta, elo_before, elo_after, reason, sport_id)
          values (r.id, target - r.elo, r.elo, target, 'season_reset', p_sport);
          update users set elo = target where id = r.id;
        end if;
      end loop;
    end if;

    -- 5. Everyone's starting Ело for the new season.
    insert into season_ratings (season_id, user_id, elo_start)
    select new_id, x.user_id, x.elo
    from (
      select id as user_id, elo from users where is_primary and elo is not null
      union all
      select user_id, elo from user_ratings where not is_primary and sport_id = p_sport
    ) x
    on conflict (season_id, user_id) do update set elo_start = excluded.elo_start;
  end if;

  return new_id;
end;
$$;

revoke all on function start_new_season(text, text, date, text, jsonb, text) from public;
revoke all on function start_new_season(text, text, date, text, jsonb, text) from anon, authenticated;

-- ──────────────────────────────────────────────
-- 4. THE Ело JOURNAL SAYS WHY A ROW EXISTS
-- ──────────────────────────────────────────────
-- Same as 042's get_user_elo_log plus `reason`, so the profile can label
-- a season reset or an admin correction instead of calling it «Турнір».
drop function if exists get_user_elo_log(uuid);
create function get_user_elo_log(p_user_id uuid)
returns table (
  id uuid,
  category_id uuid,
  tournament_name text,
  match_id uuid,
  delta integer,
  elo_before integer,
  elo_after integer,
  created_at timestamptz,
  opponent_names text,
  reason text
)
language sql
stable
as $$
  select
    eh.id,
    m.category_id,
    t.name as tournament_name,
    eh.match_id,
    eh.delta,
    eh.elo_before,
    eh.elo_after,
    eh.created_at,
    (
      select string_agg(u.full_name, ', ')
      from users u
      where m.id is not null and u.id = any(
        case
          when p_user_id = any(m.team_a_players) then m.team_b_players
          else m.team_a_players
        end
      )
    ) as opponent_names,
    eh.reason
  from elo_history eh
  left join tournament_matches m on m.id = eh.match_id
  left join tournament_categories t on t.id = m.category_id
  where eh.user_id = p_user_id
  order by eh.created_at desc;
$$;

notify pgrst, 'reload schema';
