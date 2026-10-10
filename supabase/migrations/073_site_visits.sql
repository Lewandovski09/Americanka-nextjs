-- ============================================================
-- AMERICANKA — Migration 073: who visits the app (admin → Огляд)
-- ============================================================
-- One row per device per hour: the app sends a short «I'm here» at
-- most every few minutes (components/VisitTracker). A device is a random
-- id kept on the phone; once the player is logged in, the row also
-- carries their id, so a person counts once a day even on two phones.
-- Admins are left out of the numbers.
--
--   track_visit(p_visitor)  — called by every visitor (also logged-out)
--   visit_stats(p_days)     — admins only: the numbers for the panel
-- Rows older than ~13 months are dropped by visit_stats itself.
-- Idempotent.

create table if not exists site_visits (
  hour     timestamptz not null,           -- the hour (UTC) of the visit
  visitor  text        not null,           -- the device id
  user_id  uuid references users(id) on delete set null,
  hits     integer     not null default 1, -- «I'm here» pings in that hour
  last_at  timestamptz not null default now(),
  primary key (hour, visitor)
);
create index if not exists site_visits_last_at on site_visits (last_at);

alter table site_visits enable row level security;
-- no policies: only the two functions below touch the table
revoke all on site_visits from anon, authenticated;

create or replace function track_visit(p_visitor text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_visitor is null or p_visitor !~ '^[A-Za-z0-9-]{8,64}$' then
    return;
  end if;
  insert into site_visits (hour, visitor, user_id)
  values (date_trunc('hour', now()), p_visitor, auth.uid())
  on conflict (hour, visitor) do update
    set hits    = least(site_visits.hits + 1, 10000),
        last_at = now(),
        user_id = coalesce(excluded.user_id, site_visits.user_id);
end $$;

revoke all on function track_visit(text) from public;
grant execute on function track_visit(text) to anon, authenticated;

create or replace function visit_stats(p_days integer default 30)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  days int := greatest(7, least(coalesce(p_days, 30), 120));
  result json;
begin
  if not is_admin() then
    raise exception 'admins only';
  end if;

  delete from site_visits where hour < now() - interval '400 days';

  with v as (
    select s.hour,
           s.last_at,
           (s.hour at time zone 'Europe/Kyiv')::date as day,
           extract(hour from s.hour at time zone 'Europe/Kyiv')::int as h,
           coalesce(s.user_id::text, 'd:' || s.visitor) as who,
           s.user_id is not null as player,
           s.hits
      from site_visits s
      left join users u on u.id = s.user_id
     where s.hour >= now() - make_interval(days => days + 1)
       and coalesce(u.is_admin, false) = false
  ),
  today as (select (now() at time zone 'Europe/Kyiv')::date as d),
  daily as (
    select g.day::date as day,
           count(distinct v.who) filter (where v.player)     as players,
           count(distinct v.who) filter (where not v.player) as guests
      from generate_series((select d from today) - (days - 1), (select d from today), interval '1 day') g(day)
      left join v on v.day = g.day::date
     group by g.day
     order by g.day
  ),
  hourly as (
    select g.h,
           count(distinct (v.day, v.who)) as visits
      from generate_series(0, 23) g(h)
      left join v on v.h = g.h and v.day > (select d from today) - 7
     group by g.h
     order by g.h
  )
  select json_build_object(
    'online',   (select count(distinct who) from v where last_at > now() - interval '5 minutes'),
    'today',    (select count(distinct who) from v where day = (select d from today)),
    'week',     (select count(distinct who) from v where day > (select d from today) - 7),
    'month',    (select count(distinct who) from v where day > (select d from today) - 30),
    'players_month', (select count(distinct who) from v where player and day > (select d from today) - 30),
    'daily',    (select json_agg(json_build_object('day', day, 'players', players, 'guests', guests) order by day) from daily),
    'hours',    (select json_agg(visits order by h) from hourly)
  ) into result;
  return result;
end $$;

revoke all on function visit_stats(integer) from public;
grant execute on function visit_stats(integer) to authenticated;

notify pgrst, 'reload schema';

-- Check: one row — the table and both functions exist.
select to_regclass('public.site_visits') is not null as table_ok,
       exists (select 1 from pg_proc where proname = 'track_visit') as track_ok,
       exists (select 1 from pg_proc where proname = 'visit_stats') as stats_ok;
