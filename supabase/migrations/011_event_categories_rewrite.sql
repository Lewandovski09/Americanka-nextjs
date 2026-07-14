-- ============================================================
-- AMERICANKA — Migration 011: Events + Categories (formats-in-code)
-- ============================================================
-- We are moving tournament FORMATS out of the database and into
-- application code (lib/formats/*). The DB now only stores DATA:
--
--   tournament_events   — the "event" the admin creates (a day):
--                         format kind, venue, points rules, how
--                         registration works.
--   tournaments         — REPURPOSED as a single CATEGORY / bracket
--                         inside an event (e.g. "Men · Pro"). Keeps
--                         its own matches / players / chat / elo, so
--                         all the existing detail-page machinery is
--                         reused unchanged.
--   tournament_applications
--                       — event-level pending pool: a player (or a
--                         pair) submits an application; depending on
--                         the event's registration_mode it is either
--                         auto-placed into a category or waits for an
--                         admin to distribute it.
--
-- This migration is ADDITIVE — it creates new tables and columns and
-- relaxes a couple of NOT NULLs. It does NOT drop tournament_formats
-- yet (the currently-deployed code still reads it); that removal is a
-- separate, later migration once the new code is live.
--
-- Safe to run once on production in the Supabase SQL Editor. Runs as a
-- single transaction: on any error everything rolls back.

-- ──────────────────────────────────────────────
-- ENUMS
-- ──────────────────────────────────────────────

-- How players get into the categories of an event.
create type registration_mode as enum (
  'admin_assign', -- players apply to a pool; admin distributes them into categories
  'by_rating',    -- players self-register, but only into the category matching their elo range
  'free'          -- players self-register into any category they choose
);

-- Whether the points target changes deeper in the bracket.
create type tournament_points_mode as enum (
  'whole',          -- same points target for the whole tournament
  'from_semifinal'  -- switch to final_points_to_win from the semifinal onward
);

do $$ begin
  -- Application lifecycle. Guarded in case a re-run partially applied.
  create type application_status as enum ('pending', 'assigned', 'rejected', 'withdrawn');
exception when duplicate_object then null; end $$;

-- ──────────────────────────────────────────────
-- TOURNAMENT_EVENTS — the thing the admin creates
-- ──────────────────────────────────────────────
create table tournament_events (
  id uuid primary key default uuid_generate_v4(),
  name text not null,

  -- Which family of format this event is. The concrete rules
  -- (schedule, bracket generation, scoring) live in lib/formats/*,
  -- keyed by this value — NOT in the database.
  format_kind tournament_format_type not null,

  location tournament_location not null,
  courts integer[] not null default '{1}',
  scheduled_at timestamptz not null,

  -- Scoring config for the whole event. Americanka ignores these
  -- (it is always sum-to-31, enforced in code).
  points_to_win integer not null default 21,       -- 15 or 21 (first-to, win by 2)
  points_mode tournament_points_mode not null default 'whole',
  final_points_to_win integer,                     -- used when points_mode = 'from_semifinal'

  registration_mode registration_mode not null default 'admin_assign',

  status tournament_status not null default 'scheduled',
  started_at timestamptz,
  finished_at timestamptz,

  created_by uuid not null references players(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_tournament_events_status on tournament_events(status);
create index idx_tournament_events_scheduled on tournament_events(scheduled_at desc);

create trigger trg_tournament_events_updated_at before update on tournament_events
  for each row execute function touch_updated_at();

-- ──────────────────────────────────────────────
-- TOURNAMENTS — now a CATEGORY inside an event
-- ──────────────────────────────────────────────
alter table tournaments
  -- Legacy Americankas created before this migration have no event;
  -- new categories always belong to one.
  add column event_id uuid references tournament_events(id) on delete cascade,
  -- 'Pro' | 'Medium' | 'Light' (the label shown on the category tab).
  add column category_label text,
  -- Optional elo gate used by registration_mode = 'by_rating'
  -- (a player may only join a category whose [elo_min, elo_max)
  -- contains their elo). Null = no gate.
  add column elo_min integer,
  add column elo_max integer;

-- Format is now defined in code, not by a formats row, so the old
-- hard FK must become optional. Existing rows keep their value.
alter table tournaments alter column format_id drop not null;

create index idx_tournaments_event on tournaments(event_id);

-- ──────────────────────────────────────────────
-- TOURNAMENT_APPLICATIONS — event-level pending pool
-- ──────────────────────────────────────────────
-- One row per application. For solo formats (americanka,
-- king_of_beach) partner_id is null. For pair formats
-- (single_gender, mix) player_id is the applicant and partner_id is
-- the chosen partner, or null while still "looking for a partner".
create table tournament_applications (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references tournament_events(id) on delete cascade,

  player_id uuid not null references players(id) on delete cascade,
  partner_id uuid references players(id) on delete cascade,
  seeking_partner boolean not null default false,

  -- What the applicant asked for (their own elo drives 'by_rating').
  requested_category text,

  status application_status not null default 'pending',
  -- Which category (tournaments row) the application was placed into.
  assigned_tournament_id uuid references tournaments(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A player can only have one live application per event.
  unique (event_id, player_id)
);

create index idx_applications_event on tournament_applications(event_id, status);
create index idx_applications_player on tournament_applications(player_id);

create trigger trg_applications_updated_at before update on tournament_applications
  for each row execute function touch_updated_at();

-- ──────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────────
alter table tournament_events enable row level security;

create policy tournament_events_select_all on tournament_events
  for select using (true);

create policy tournament_events_admin_write on tournament_events
  for all using (is_admin()) with check (is_admin());

alter table tournament_applications enable row level security;

-- Everyone can see who has applied (needed for the "find a partner"
-- and category-distribution screens).
create policy tournament_applications_select_all on tournament_applications
  for select using (true);

-- A player may create / edit / withdraw their OWN application.
create policy tournament_applications_self_insert on tournament_applications
  for insert with check (player_id = auth.uid());

create policy tournament_applications_self_update on tournament_applications
  for update using (player_id = auth.uid()) with check (player_id = auth.uid());

create policy tournament_applications_self_delete on tournament_applications
  for delete using (player_id = auth.uid());

-- Admins can do anything (distribute, reject, reassign).
create policy tournament_applications_admin_write on tournament_applications
  for all using (is_admin()) with check (is_admin());
