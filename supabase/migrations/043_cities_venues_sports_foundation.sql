-- ============================================================
-- AMERICANKA — Migration 043: cities, venues, sports (foundation)
-- ============================================================
-- Until now the schema could describe exactly one club in one city
-- playing one sport, and every one of those "ones" was welded in:
--
--   • VENUE was a Postgres ENUM (tournament_location = beach13 |
--     dynamo_sc). A third court = a migration + edits in five UI files
--     that each carried their own copy of the label and court-range maps.
--     There was no notion of a CITY at all.
--   • SPORT did not exist. users.elo is one number per person, so the
--     first padel / beach-tennis event would have mixed its results into
--     the volleyball rating with no way to separate them afterwards.
--   • AVP SEASONS had a GLOBAL no-overlap constraint: a second city (or
--     a second sport) physically could not have its own 2026 season.
--   • format_kind and bracket_system were ENUMs duplicating the code
--     registry in lib/formats — two places to change for one new format.
--     They had already drifted: the code writes
--     'groups_top1_bye_top23_crosses', a value migration 009 never put
--     into tournament_bracket_system.
--
-- This file turns each of those into DATA with real foreign keys, and is
-- written so that THE CURRENTLY DEPLOYED CODE KEEPS WORKING right after
-- it runs (nothing is renamed; every new NOT NULL column has a default;
-- the venue codes stay exactly 'beach13' / 'dynamo_sc'). Deploy the new
-- code whenever convenient, then run 044 to drop the one legacy column.
--
-- Model after this file:
--
--   sports ─┬─< tournament_events >── venues >── cities
--           ├─< user_ratings  (one Ело per user PER SPORT)
--           ├─< elo_history.sport_id
--           ├─< avp_seasons   (scoped by sport + optional city)
--           └─< venue_sports  >── venues
--
-- Idempotent: safe to re-run.

create extension if not exists btree_gist;

-- ──────────────────────────────────────────────
-- 1. SPORTS
-- ──────────────────────────────────────────────
-- Identity lives here (so ratings, seasons and events can reference it);
-- BEHAVIOUR (which formats a sport offers, its division names, team
-- size) lives in lib/sports.ts, keyed by the same id — same split as
-- formats: the DB stores data, the code stores rules.
create table if not exists sports (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into sports (id, name, sort_order)
values ('beach_volleyball', 'Пляжний волейбол', 0)
on conflict (id) do nothing;

-- The sport every pre-043 row belongs to, and the one whose rating is
-- still mirrored in users.elo (section 6). One definition, used by the
-- column defaults and triggers below.
create or replace function primary_sport_id()
returns text language sql immutable as $$ select 'beach_volleyball'::text $$;

-- ──────────────────────────────────────────────
-- 2. CITIES
-- ──────────────────────────────────────────────
-- A city the club OPERATES in (has venues / runs seasons) — not the
-- free-text users.city a player types into their profile, which stays
-- as it is. timezone is stored now because a second city in another
-- zone is exactly when "18:00" starts meaning two different things.
create table if not exists cities (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  region text,
  country_code text not null default 'UA' check (country_code ~ '^[A-Z]{2}$'),
  timezone text not null default 'Europe/Kyiv',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- (An expression index rather than UNIQUE NULLS NOT DISTINCT, which needs
-- Postgres 15 — older Supabase projects still run 14.)
create unique index if not exists cities_unique_name
  on cities (country_code, name, coalesce(region, ''));

insert into cities (name, region)
values ('Одеса', 'Одеська обл.')
on conflict do nothing;

-- ──────────────────────────────────────────────
-- 3. VENUES (+ which sports each one hosts)
-- ──────────────────────────────────────────────
-- `code` is the stable key events point at. It keeps the old enum
-- values verbatim, so existing rows and the deployed code see no change.
-- `courts` is the list of court numbers the venue has — what the
-- create/settings forms used to hardcode as COURT_RANGES.
create table if not exists venues (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  city_id uuid not null references cities(id) on delete restrict,
  name text not null,
  address text,
  courts integer[] not null default '{1}' check (cardinality(courts) > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_venues_city on venues(city_id);

drop trigger if exists trg_venues_updated_at on venues;
create trigger trg_venues_updated_at before update on venues
  for each row execute function touch_updated_at();

insert into venues (code, city_id, name, address, courts, sort_order)
select v.code, c.id, v.name, v.address, v.courts, v.sort_order
from (values
  ('beach13',   'Beach 13',  'Станція Фонтана, Одеса', '{1,2,3,4,5,6}'::integer[], 0),
  ('dynamo_sc', 'Dynamo SC', 'Одеса',                  '{1,2}'::integer[],         1)
) as v(code, name, address, courts, sort_order)
cross join lateral (
  select id from cities where name = 'Одеса' and country_code = 'UA' order by created_at limit 1
) c
on conflict (code) do nothing;

create table if not exists venue_sports (
  venue_id uuid not null references venues(id) on delete cascade,
  sport_id text not null references sports(id) on delete cascade,
  primary key (venue_id, sport_id)
);

insert into venue_sports (venue_id, sport_id)
select id, primary_sport_id() from venues
on conflict do nothing;

-- ──────────────────────────────────────────────
-- 4. EVENTS POINT AT A VENUE (enum → FK)
-- ──────────────────────────────────────────────
-- Column name `location` is kept on purpose: renaming it would break the
-- deployed code between this migration and the deploy. Its meaning is
-- now "venues.code", enforced by a real foreign key; the city is
-- reached through the venue (one source of truth — an event cannot
-- disagree with its own venue about which city it is in).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tournament_events'
      and column_name = 'location' and udt_name = 'tournament_location'
  ) then
    alter table tournament_events alter column location type text using location::text;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tournament_categories'
      and column_name = 'location' and udt_name = 'tournament_location'
  ) then
    alter table tournament_categories alter column location type text using location::text;
  end if;
end;
$$;

-- The live database has drifted from this folder before (see 037). If it
-- holds a venue code nobody knows about, give it a placeholder venue in
-- Odesa instead of failing the whole migration — and say so loudly.
do $$
declare
  r record;
begin
  for r in
    select distinct e.location from tournament_events e
    where e.location is not null and not exists (select 1 from venues v where v.code = e.location)
  loop
    insert into venues (code, city_id, name, courts)
    select r.location, c.id, r.location, '{1,2,3,4,5,6}'
    from cities c where c.name = 'Одеса' and c.country_code = 'UA'
    order by c.created_at limit 1;
    insert into venue_sports (venue_id, sport_id)
    select id, primary_sport_id() from venues where code = r.location
    on conflict do nothing;
    raise notice '043: unknown venue code % found on events — created a placeholder venue, rename/fix it in table venues', r.location;
  end loop;
end;
$$;

alter table tournament_events drop constraint if exists tournament_events_location_fkey;
alter table tournament_events
  add constraint tournament_events_location_fkey
  foreign key (location) references venues(code) on update cascade on delete restrict;

comment on column tournament_events.location is
  'venues.code of the venue this event is held at. The city is venues.city_id.';

-- The category-level copy of the venue was written once at creation and
-- never updated when the event moved (/api/events/[id]/basics changes
-- the event only), so it silently drifted. New code neither writes nor
-- reads it; it is relaxed here and DROPPED in 044, after the deploy.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tournament_categories' and column_name = 'location'
  ) then
    alter table tournament_categories alter column location drop not null;
    comment on column tournament_categories.location is
      'DEPRECATED (043) — read tournament_events.location. Dropped by 044.';
  end if;
end;
$$;

do $$ begin
  drop type if exists tournament_location;
exception when dependent_objects_still_exist then
  raise notice '043: type tournament_location is still used by something hand-made — left in place';
end $$;

-- ──────────────────────────────────────────────
-- 5. EVENTS BELONG TO A SPORT; format enums → text
-- ──────────────────────────────────────────────
alter table tournament_events
  add column if not exists sport_id text not null default 'beach_volleyball'
  references sports(id) on delete restrict;

create index if not exists idx_tournament_events_sport on tournament_events(sport_id, scheduled_at desc);
create index if not exists idx_tournament_events_location on tournament_events(location);

-- Formats and bracket systems are defined in lib/formats (the registry
-- is the validator — see eventConfig.ts). The enums were a second copy
-- that already disagreed with it; text removes the second copy.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tournament_events'
      and column_name = 'format_kind' and data_type = 'USER-DEFINED'
  ) then
    alter table tournament_events alter column format_kind type text using format_kind::text;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tournament_categories'
      and column_name = 'bracket_system' and data_type = 'USER-DEFINED'
  ) then
    alter table tournament_categories alter column bracket_system type text using bracket_system::text;
  end if;
end;
$$;

do $$ begin
  drop type if exists tournament_format_type;
exception when dependent_objects_still_exist then
  raise notice '043: type tournament_format_type is still used by something hand-made — left in place';
end $$;
do $$ begin
  drop type if exists tournament_bracket_system;
exception when dependent_objects_still_exist then
  raise notice '043: type tournament_bracket_system is still used by something hand-made — left in place';
end $$;

-- ──────────────────────────────────────────────
-- 6. RATINGS PER SPORT
-- ──────────────────────────────────────────────
-- user_ratings is the rating of a user IN A SPORT. For the primary sport
-- it is, for now, a MIRROR of users.elo: every existing writer (score
-- route, approve, edit-elo, event delete) keeps writing users.elo and
-- the trigger below copies it here. Writing the primary sport's row
-- directly is refused, so the two can never disagree. Every OTHER sport
-- is written here directly (lib/server/ratings.ts).
--
-- The road from here: move the readers to user_ratings, then flip the
-- mirror and drop users.elo. Nothing in that road needs a data fix.
create table if not exists user_ratings (
  user_id uuid not null references users(id) on delete cascade,
  sport_id text not null references sports(id) on delete cascade,
  elo integer not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, sport_id)
);

create index if not exists idx_user_ratings_sport_elo on user_ratings(sport_id, elo desc);

-- The guard below would refuse this backfill on a re-run, so it is
-- removed first and recreated right after.
drop trigger if exists trg_user_ratings_guard_mirror on user_ratings;

insert into user_ratings (user_id, sport_id, elo)
select id, primary_sport_id(), elo from users where elo is not null
on conflict (user_id, sport_id) do update set elo = excluded.elo, updated_at = now();

create or replace function sync_primary_rating_from_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.elo is null then
    delete from user_ratings where user_id = new.id and sport_id = primary_sport_id();
  elsif tg_op = 'INSERT' or new.elo is distinct from old.elo then
    insert into user_ratings (user_id, sport_id, elo, updated_at)
    values (new.id, primary_sport_id(), new.elo, now())
    on conflict (user_id, sport_id) do update set elo = excluded.elo, updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_users_sync_primary_rating on users;
create trigger trg_users_sync_primary_rating
  after insert or update of elo on users
  for each row execute function sync_primary_rating_from_users();

create or replace function guard_primary_rating_mirror()
returns trigger
language plpgsql
as $$
begin
  -- Depth 1 = a statement aimed at user_ratings itself. The mirror
  -- trigger above runs at depth 2, and is the only allowed writer.
  if pg_trigger_depth() = 1
     and coalesce(new.sport_id, old.sport_id) = primary_sport_id() then
    raise exception 'user_ratings for % mirrors users.elo — update users.elo instead', primary_sport_id();
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_user_ratings_guard_mirror on user_ratings;
create trigger trg_user_ratings_guard_mirror
  before insert or update or delete on user_ratings
  for each row execute function guard_primary_rating_mirror();

alter table user_ratings enable row level security;
drop policy if exists user_ratings_select_all on user_ratings;
create policy user_ratings_select_all on user_ratings for select using (true);

-- Every Ело change names its sport. Old rows (and old code, which does
-- not send it) get the primary sport by default — which is what they are.
alter table elo_history
  add column if not exists sport_id text not null default 'beach_volleyball'
  references sports(id) on delete cascade;

create index if not exists idx_elo_history_user_sport on elo_history(user_id, sport_id, created_at desc);

-- ──────────────────────────────────────────────
-- 7. AVP SEASONS: per sport, optionally per city
-- ──────────────────────────────────────────────
-- city_id NULL = a season for every city of that sport (today's one).
-- A city may run its own season alongside; lib/server/avpAward.ts picks
-- the city's own season first and falls back to the city-less one.
-- Overlap is now forbidden only WITHIN the same (sport, city) pair.
alter table avp_seasons
  add column if not exists sport_id text not null default 'beach_volleyball'
    references sports(id) on delete restrict,
  add column if not exists city_id uuid references cities(id) on delete restrict;

alter table avp_seasons drop constraint if exists avp_seasons_no_overlap;
alter table avp_seasons
  add constraint avp_seasons_no_overlap
  exclude using gist (
    sport_id with =,
    (coalesce(city_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (daterange(starts_on, ends_on, '[]')) with &&
  );

create index if not exists idx_avp_seasons_scope on avp_seasons(sport_id, city_id, starts_on);

-- ──────────────────────────────────────────────
-- 8. RLS FOR THE NEW REFERENCE TABLES
-- ──────────────────────────────────────────────
-- Readable by everyone (the forms and lists need them before login);
-- writable by admins only. The app writes through the service role.
alter table sports enable row level security;
alter table cities enable row level security;
alter table venues enable row level security;
alter table venue_sports enable row level security;

drop policy if exists sports_select_all on sports;
create policy sports_select_all on sports for select using (true);
drop policy if exists sports_admin_write on sports;
create policy sports_admin_write on sports for all using (is_admin()) with check (is_admin());

drop policy if exists cities_select_all on cities;
create policy cities_select_all on cities for select using (true);
drop policy if exists cities_admin_write on cities;
create policy cities_admin_write on cities for all using (is_admin()) with check (is_admin());

drop policy if exists venues_select_all on venues;
create policy venues_select_all on venues for select using (true);
drop policy if exists venues_admin_write on venues;
create policy venues_admin_write on venues for all using (is_admin()) with check (is_admin());

drop policy if exists venue_sports_select_all on venue_sports;
create policy venue_sports_select_all on venue_sports for select using (true);
drop policy if exists venue_sports_admin_write on venue_sports;
create policy venue_sports_admin_write on venue_sports for all using (is_admin()) with check (is_admin());

-- ──────────────────────────────────────────────
-- 9. SANITY REPORT (read the NOTICE output)
-- ──────────────────────────────────────────────
do $$
declare
  n_events int; n_orphans int; n_ratings int; n_users int;
begin
  select count(*) into n_events from tournament_events;
  select count(*) into n_orphans from tournament_events e
    where not exists (select 1 from venues v where v.code = e.location);
  select count(*) into n_ratings from user_ratings where sport_id = primary_sport_id();
  select count(*) into n_users from users where elo is not null;
  raise notice '043: % events, % without a venue (must be 0); % users with Ело, % mirrored ratings (must match)',
    n_events, n_orphans, n_users, n_ratings;
end;
$$;

-- Make PostgREST see the new tables and foreign keys right away.
notify pgrst, 'reload schema';
