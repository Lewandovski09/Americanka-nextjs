-- ============================================================
-- AMERICANKA — Migration 037: rename the three core tables
-- ============================================================
--   players     → users
--   tournaments → tournament_categories
--   matches     → tournament_matches
--
-- …and the reference columns that pointed at them, so the names stop
-- lying about what they hold:
--   *.player_id                                    → user_id
--   get_player_* (the three reporting RPCs)        → get_user_*
--   *.tournament_id                                → category_id
--   tournament_teams.player1_id / player2_id       → user1_id / user2_id
--   tournament_categories.winner_player_id         → winner_user_id
--   tournament_applications.assigned_tournament_id → assigned_category_id
--
-- WHY tournament_categories: `tournaments` has not meant "a tournament"
-- since migration 011 split events from their leagues. A row here is
-- ONE category of an event (Pro Ч, Light Ж) — the thing that has a
-- format, a bracket, a roster and a winner. The event above it is
-- tournament_events. Calling the child `tournaments` while its parent
-- is `tournament_events` is what makes every join in this schema read
-- backwards.
--
-- WHAT POSTGRES DOES FOR FREE, AND WHAT IT DOES NOT:
--   • indexes, foreign keys, check constraints, triggers and RLS
--     policies all follow a rename automatically — they reference the
--     table and column by OID/attnum, not by name, so nothing breaks.
--     Their NAMES keep saying "players"/"tournaments" though, so they
--     are renamed below too. That part is cosmetic.
--   • function bodies do NOT follow. Every function here has a text
--     $$ … $$ body, so a rename leaves it pointing at tables that no
--     longer exist, and it fails at CALL time rather than at rename
--     time — silently, until someone opens a profile. All nine are
--     recreated in section 6. That half of this file is not cosmetic.
--
-- IDEMPOTENT BY CONSTRUCTION. Every rename is guarded on "the old name
-- exists and the new one does not", so a half-applied run can just be
-- run again. That matters more than usual here: the migrations folder
-- is NOT a faithful picture of the live database. tournament_placements
-- is written by lib/server/finishCategory.ts and read by
-- app/rating/page.js, but no migration in this repo ever created it —
-- it was made by hand in the SQL editor. Anything else made that way is
-- invisible from here. The guards mean such an object is skipped rather
-- than aborting the run, but they cannot rename what they don't know
-- about: CHECK THE LIVE SCHEMA for other hand-made tables before
-- trusting this to be complete.
--
-- DEPLOY THIS AND THE MATCHING CODE TOGETHER. Between the rename and
-- the deploy every query in the app addresses tables that no longer
-- exist. Nothing is left behind under the old names — a rename is not a
-- gradual migration, and there is no compatibility window.

-- ──────────────────────────────────────────────
-- 0. HELPERS — dropped again at the end of this file
-- ──────────────────────────────────────────────
create or replace function _rn_table(p_old text, p_new text) returns void as $fn$
begin
  if to_regclass('public.' || quote_ident(p_old)) is not null
     and to_regclass('public.' || quote_ident(p_new)) is null then
    execute format('alter table public.%I rename to %I', p_old, p_new);
  end if;
end;
$fn$ language plpgsql;

create or replace function _rn_col(p_table text, p_old text, p_new text) returns void as $fn$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = p_old
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = p_new
  ) then
    execute format('alter table public.%I rename column %I to %I', p_table, p_old, p_new);
  end if;
end;
$fn$ language plpgsql;

create or replace function _rn_constraint(p_table text, p_old text, p_new text) returns void as $fn$
begin
  if exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = p_table and c.conname = p_old
  ) then
    execute format('alter table public.%I rename constraint %I to %I', p_table, p_old, p_new);
  end if;
end;
$fn$ language plpgsql;

create or replace function _rn_index(p_old text, p_new text) returns void as $fn$
begin
  if to_regclass('public.' || quote_ident(p_old)) is not null
     and to_regclass('public.' || quote_ident(p_new)) is null then
    execute format('alter index public.%I rename to %I', p_old, p_new);
  end if;
end;
$fn$ language plpgsql;

create or replace function _rn_policy(p_table text, p_old text, p_new text) returns void as $fn$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = p_table and policyname = p_old
  ) then
    execute format('alter policy %I on public.%I rename to %I', p_old, p_table, p_new);
  end if;
end;
$fn$ language plpgsql;

create or replace function _rn_trigger(p_table text, p_old text, p_new text) returns void as $fn$
begin
  if exists (
    select 1 from pg_trigger tg
    join pg_class t on t.oid = tg.tgrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = p_table and tg.tgname = p_old
  ) then
    execute format('alter trigger %I on public.%I rename to %I', p_old, p_table, p_new);
  end if;
end;
$fn$ language plpgsql;

-- ──────────────────────────────────────────────
-- 1. THE TABLES
-- ──────────────────────────────────────────────
select _rn_table('players', 'users');
select _rn_table('tournaments', 'tournament_categories');
select _rn_table('matches', 'tournament_matches');

-- ──────────────────────────────────────────────
-- 2. THE REFERENCE COLUMNS
-- ──────────────────────────────────────────────
-- player_id → user_id, everywhere it appears.
select _rn_col('avp_points', 'player_id', 'user_id');
select _rn_col('elo_history', 'player_id', 'user_id');
select _rn_col('notification_dismissals', 'player_id', 'user_id');
select _rn_col('partner_stats', 'player_id', 'user_id');
select _rn_col('telegram_links', 'player_id', 'user_id');
select _rn_col('tournament_applications', 'player_id', 'user_id');
select _rn_col('tournament_judges', 'player_id', 'user_id');
select _rn_col('tournament_players', 'player_id', 'user_id');
select _rn_col('tournament_placements', 'player_id', 'user_id');

-- tournament_id → category_id: it names one category, not the event.
select _rn_col('avp_points', 'tournament_id', 'category_id');
select _rn_col('elo_history', 'tournament_id', 'category_id');
select _rn_col('tournament_matches', 'tournament_id', 'category_id');
select _rn_col('tournament_players', 'tournament_id', 'category_id');
select _rn_col('tournament_teams', 'tournament_id', 'category_id');
select _rn_col('tournament_placements', 'tournament_id', 'category_id');

-- The pair slots, and the two columns that carried a table name inside
-- a longer one.
select _rn_col('tournament_teams', 'player1_id', 'user1_id');
select _rn_col('tournament_teams', 'player2_id', 'user2_id');
select _rn_col('tournament_categories', 'winner_player_id', 'winner_user_id');
select _rn_col('tournament_applications', 'assigned_tournament_id', 'assigned_category_id');

-- DELIBERATELY NOT RENAMED:
--   tournament_matches.team_a_players / team_b_players — these name a
--     ROLE in the game ("who played on side A"), not the table the ids
--     come from. team_a_users would read worse, not better.
--   *.partner_id, *.created_by, *.approved_by, tournament_matches.judge_id
--     — same reason: each already says what that person IS in that row.
--   the tables tournament_players / tournament_teams /
--     tournament_applications — they hang off a CATEGORY now, so
--     category_players would be more honest. That is a separate
--     decision with its own blast radius, not something to smuggle in
--     here.

-- ──────────────────────────────────────────────
-- 3. CONSTRAINT NAMES
-- ──────────────────────────────────────────────
-- Carried automatically by the renames above, so this section only
-- stops the names from lying. It is NOT purely cosmetic in two cases:
-- the app names tournament_applications_* and tournament_teams_*
-- explicitly in PostgREST embed hints (app/events/shared.js,
-- app/tournaments/[id]/page.js), so those hints move with this file.
select _rn_constraint('tournament_applications', 'tournament_applications_player_id_fkey', 'tournament_applications_user_id_fkey');
select _rn_constraint('tournament_teams', 'tournament_teams_player1_id_fkey', 'tournament_teams_user1_id_fkey');
select _rn_constraint('tournament_teams', 'tournament_teams_player2_id_fkey', 'tournament_teams_user2_id_fkey');
select _rn_constraint('tournament_teams', 'tournament_teams_different_players', 'tournament_teams_different_users');
select _rn_constraint('partner_stats', 'partner_stats_player_id_fkey', 'partner_stats_user_id_fkey');
select _rn_constraint('avp_points', 'avp_points_player_id_fkey', 'avp_points_user_id_fkey');
select _rn_constraint('elo_history', 'elo_history_player_id_fkey', 'elo_history_user_id_fkey');
select _rn_constraint('tournament_judges', 'tournament_judges_player_id_fkey', 'tournament_judges_user_id_fkey');
select _rn_constraint('tournament_players', 'tournament_players_player_id_fkey', 'tournament_players_user_id_fkey');
select _rn_constraint('telegram_links', 'telegram_links_player_id_fkey', 'telegram_links_user_id_fkey');
select _rn_constraint('notification_dismissals', 'notification_dismissals_player_id_fkey', 'notification_dismissals_user_id_fkey');

-- ──────────────────────────────────────────────
-- 4. INDEX NAMES
-- ──────────────────────────────────────────────
select _rn_index('idx_players_gender', 'idx_users_gender');
select _rn_index('idx_players_approval_status', 'idx_users_approval_status');
select _rn_index('idx_players_elo', 'idx_users_elo');
select _rn_index('idx_matches_tournament', 'idx_tournament_matches_category');
select _rn_index('idx_matches_judge', 'idx_tournament_matches_judge');
select _rn_index('idx_tournaments_status', 'idx_tournament_categories_status');
select _rn_index('idx_tournament_players_player', 'idx_tournament_players_user');
select _rn_index('idx_avp_points_player', 'idx_avp_points_user');
select _rn_index('idx_avp_points_season_player', 'idx_avp_points_season_user');
select _rn_index('idx_tournament_judges_player', 'idx_tournament_judges_user');

-- ──────────────────────────────────────────────
-- 5. TRIGGER AND POLICY NAMES
-- ──────────────────────────────────────────────
select _rn_trigger('users', 'trg_players_updated_at', 'trg_users_updated_at');
select _rn_trigger('users', 'trg_players_protect_self_update', 'trg_users_protect_self_update');
select _rn_trigger('tournament_categories', 'trg_tournaments_updated_at', 'trg_tournament_categories_updated_at');

select _rn_policy('users', 'players_select_approved', 'users_select_approved');
select _rn_policy('users', 'players_update_own', 'users_update_own');
select _rn_policy('users', 'players_insert_self', 'users_insert_self');
select _rn_policy('tournament_categories', 'tournaments_select_all', 'tournament_categories_select_all');
select _rn_policy('tournament_categories', 'tournaments_admin_write', 'tournament_categories_admin_write');
select _rn_policy('tournament_matches', 'matches_select_all', 'tournament_matches_select_all');
select _rn_policy('tournament_matches', 'matches_write', 'tournament_matches_write');
select _rn_policy('tournament_matches', 'matches_admin_insert', 'tournament_matches_admin_insert');

-- ──────────────────────────────────────────────
-- 6. FUNCTION BODIES
-- ──────────────────────────────────────────────
-- The part that actually breaks without this file. Each of these is the
-- latest version from its own migration, with nothing changed but the
-- identifiers: the reader should be able to diff it against the source
-- migration named above it and see only renames.
--
-- is_admin() also picks up an explicit search_path here. It is SECURITY
-- DEFINER and had none, which means it resolved `players` through
-- whatever search_path the caller happened to have — survivable while
-- the table was called players, and a genuinely bad idea now that it is
-- called `users` and there is an `auth.users` one schema away.

-- ── from 002_row_level_security.sql ──
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from public.users where id = auth.uid() and is_admin = true
  );
$$;

-- ── from 025_column_level_self_update_guards.sql ──
-- Renamed with its table: it guards `users` now.
create or replace function enforce_users_self_update()
returns trigger as $$
begin
  if auth.role() = 'service_role' or is_admin() then
    return new;
  end if;

  -- Everything below is an ordinary user editing their own row.
  -- Snapping a column back to its stored value makes changing it a
  -- silent no-op rather than an error — the request still succeeds
  -- for whatever legitimate field it also touched (photo, name, city),
  -- it just can't move any of these.
  new.is_admin := old.is_admin;
  new.elo := old.elo;
  new.category := old.category;
  new.approval_status := old.approval_status;
  new.approved_at := old.approved_at;
  new.approved_by := old.approved_by;
  new.login := old.login;
  new.telegram_user_id := old.telegram_user_id;
  new.telegram_linked_at := old.telegram_linked_at;
  new.telegram_username := old.telegram_username;
  new.tournaments_played := old.tournaments_played;
  new.tournaments_won := old.tournaments_won;
  new.created_at := old.created_at;
  new.id := old.id;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_users_protect_self_update on users;
drop trigger if exists trg_players_protect_self_update on users;
create trigger trg_users_protect_self_update
  before update on users
  for each row
  execute function enforce_users_self_update();

drop function if exists enforce_players_self_update();

create or replace function enforce_teams_self_join()
returns trigger as $$
begin
  if auth.role() = 'service_role' or is_admin() then
    return new;
  end if;

  -- A join fills the open user2_id slot; it never moves the team to a
  -- different category or swaps out the first player.
  new.category_id := old.category_id;
  new.user1_id := old.user1_id;
  new.created_at := old.created_at;

  return new;
end;
$$ language plpgsql;

create or replace function enforce_applications_self_update()
returns trigger as $$
begin
  if auth.role() = 'service_role' or is_admin() then
    return new;
  end if;

  -- status and assigned_category_id are an admin's decision, made by
  -- the placement logic in lib/server/registration.ts. A player may
  -- still edit their own pending request (partner, category ask,
  -- seeking-partner flag) — just not the outcome.
  new.status := old.status;
  new.assigned_category_id := old.assigned_category_id;
  new.event_id := old.event_id;
  new.user_id := old.user_id;
  new.created_at := old.created_at;

  return new;
end;
$$ language plpgsql;

-- ── from 017_drop_score_columns.sql ──
-- The parameter is p_user_id now; the returned reference column is
-- category_id. Both are part of the RPC's public shape, so the .rpc()
-- call sites in app/ move with this file.
drop function if exists get_partner_match_history(uuid, uuid);

create function get_partner_match_history(p_user_id uuid, p_partner_id uuid)
returns table (
  match_id uuid,
  category_id uuid,
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
    m.category_id,
    t.name as tournament_name,
    m.round_number,
    m.set1,
    m.set2,
    m.set3,
    m.team_a_players,
    m.team_b_players,
    case
      when p_user_id = any(m.team_a_players) then match_won_by_a(m.set1, m.set2, m.set3)
      else not match_won_by_a(m.set1, m.set2, m.set3)
    end as won,
    m.played_at
  from tournament_matches m
  join tournament_categories t on t.id = m.category_id
  where m.played = true
    and (
      (p_user_id = any(m.team_a_players) and p_partner_id = any(m.team_a_players))
      or
      (p_user_id = any(m.team_b_players) and p_partner_id = any(m.team_b_players))
    )
  order by m.played_at desc;
$$;

drop function if exists get_opponent_match_history(uuid, uuid);

create function get_opponent_match_history(p_user_id uuid, p_opponent_id uuid)
returns table (
  match_id uuid,
  category_id uuid,
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
    m.category_id,
    t.name as tournament_name,
    m.round_number,
    m.set1,
    m.set2,
    m.set3,
    m.team_a_players,
    m.team_b_players,
    case
      when p_user_id = any(m.team_a_players) then match_won_by_a(m.set1, m.set2, m.set3)
      else not match_won_by_a(m.set1, m.set2, m.set3)
    end as won,
    m.played_at
  from tournament_matches m
  join tournament_categories t on t.id = m.category_id
  where m.played = true
    and (
      (p_user_id = any(m.team_a_players) and p_opponent_id = any(m.team_b_players))
      or
      (p_user_id = any(m.team_b_players) and p_opponent_id = any(m.team_a_players))
    )
  order by m.played_at desc;
$$;

-- The three get_player_* reporting functions become get_user_*, to
-- match the table they read and the p_user_id they now take. Each is
-- dropped under BOTH names: the old one has to go, or PostgREST keeps
-- serving a get_player_* that queries tables which no longer exist, and
-- the failure would only show up the first time somebody opens a
-- profile. The .rpc() call sites in app/ and components/ move with this
-- file.
--
-- get_partner_match_history and get_opponent_match_history keep their
-- names — neither ever said "player" in it.
drop function if exists get_player_format_stats(uuid);
drop function if exists get_user_format_stats(uuid);

create function get_user_format_stats(p_user_id uuid)
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
  with user_categories as (
    select
      t.id as category_id,
      case te.format_kind
        when 'americanka' then 'Американка'
        when 'single_gender' then 'Чоловічі / Жіночі'
        when 'mix' then 'Мікс'
        when 'king_of_beach' then 'Король пляжу'
        else 'Американка'
      end as format_name,
      t.winner_user_id
    from tournament_players tp
    join tournament_categories t on t.id = tp.category_id
    left join tournament_events te on te.id = t.event_id
    where tp.user_id = p_user_id and t.status = 'done'
  ),
  user_games as (
    select
      pc.format_name,
      m.id as match_id,
      case
        when p_user_id = any(m.team_a_players) then match_won_by_a(m.set1, m.set2, m.set3)
        else not match_won_by_a(m.set1, m.set2, m.set3)
      end as won
    from tournament_matches m
    join user_categories pc on pc.category_id = m.category_id
    where m.played = true
      and (p_user_id = any(m.team_a_players) or p_user_id = any(m.team_b_players))
  )
  select
    pc.format_name,
    count(distinct pc.category_id) as tournaments_played,
    count(distinct pc.category_id) filter (where pc.winner_user_id = p_user_id) as tournaments_won,
    count(pg.match_id) as games_played,
    count(pg.match_id) filter (where pg.won) as games_won
  from user_categories pc
  left join user_games pg on pg.format_name = pc.format_name
  group by pc.format_name;
$$;

-- ── from 031_sum_elo_history_per_tournament.sql ──
drop function if exists get_player_tournament_history(uuid);
drop function if exists get_user_tournament_history(uuid);

create function get_user_tournament_history(p_user_id uuid)
returns table (
  category_id uuid,
  tournament_name text,
  format_name text,
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
    t.id as category_id,
    t.name as tournament_name,
    case te.format_kind
      when 'americanka' then 'Американка'
      when 'single_gender' then 'Чоловічі / Жіночі'
      when 'mix' then 'Мікс'
      when 'king_of_beach' then 'Король пляжу'
      else 'Американка'
    end as format_name,
    coalesce(t.category_label, t.category::text) as category,
    t.gender,
    t.status,
    t.scheduled_at,
    t.finished_at,
    (
      select sum(eh.delta)::integer
      from elo_history eh
      where eh.category_id = t.id and eh.user_id = p_user_id
    ) as elo_delta,
    tpl.place as placement
  from (
    select category_id from tournament_players where user_id = p_user_id
    union
    select category_id from tournament_teams
      where user1_id = p_user_id or user2_id = p_user_id
  ) participated
  join tournament_categories t on t.id = participated.category_id
  left join tournament_events te on te.id = t.event_id
  left join tournament_placements tpl on tpl.category_id = t.id and tpl.user_id = p_user_id
  order by t.scheduled_at desc;
$$;

-- ── from 033_get_player_elo_log.sql ──
drop function if exists get_player_elo_log(uuid);
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
  opponent_names text
)
language sql
stable
as $$
  select
    eh.id,
    eh.category_id,
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
    ) as opponent_names
  from elo_history eh
  left join tournament_categories t on t.id = eh.category_id
  left join tournament_matches m on m.id = eh.match_id
  where eh.user_id = p_user_id
  order by eh.created_at desc;
$$;

-- ──────────────────────────────────────────────
-- 7. THE STANDINGS VIEW
-- ──────────────────────────────────────────────
-- A view follows a renamed column in its BODY automatically, but keeps
-- the OUTPUT column name it was defined with — avp_standings would go
-- on serving a column called player_id sourced from users.id, which is
-- exactly the kind of half-rename this migration exists to remove.
-- Recreated from 023_avp_season_rating.sql with the new names.
drop view if exists avp_standings;

create view avp_standings as
  select
    p.season_id,
    p.user_id,
    sum(p.points)::integer as points,
    count(*)::integer      as tournaments_counted,
    max(p.awarded_at)      as last_awarded_at
  from avp_points p
  group by p.season_id, p.user_id;

-- ──────────────────────────────────────────────
-- 8. CLEAN UP THE HELPERS
-- ──────────────────────────────────────────────
drop function _rn_table(text, text);
drop function _rn_col(text, text, text);
drop function _rn_constraint(text, text, text);
drop function _rn_index(text, text);
drop function _rn_policy(text, text, text);
drop function _rn_trigger(text, text, text);
