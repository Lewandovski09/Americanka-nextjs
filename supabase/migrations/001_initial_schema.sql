-- ============================================================
-- AMERICANKA — Database Schema (PostgreSQL / Supabase)
-- ============================================================
-- Design goals:
-- 1. Tournament FORMATS are data, not code — new formats (4-team
--    round robin, single elimination, etc.) can be added later
--    without touching application code, by inserting rows here.
-- 2. Strict separation of male/female ratings & leaderboards
--    (per repeated project requirement).
-- 3. Every important action (score entry, rating change, approval)
--    is auditable via timestamps and history tables.
-- 4. No plaintext passwords — Supabase Auth handles credentials;
--    this schema only stores the app-specific profile data.

-- ──────────────────────────────────────────────
-- EXTENSIONS
-- ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ──────────────────────────────────────────────
-- ENUMS
-- ──────────────────────────────────────────────
create type gender_type as enum ('M', 'F');
create type skill_category as enum ('D', 'C', 'B', 'A', 'Open');
create type tournament_status as enum ('scheduled', 'live', 'done', 'cancelled');
create type tournament_location as enum ('beach13', 'dynamo_sc');
create type verification_channel as enum ('telegram', 'email');
create type approval_status as enum ('pending', 'approved', 'rejected');

-- ──────────────────────────────────────────────
-- PLAYERS (extends Supabase auth.users with app-specific profile)
-- ──────────────────────────────────────────────
create table players (
  id uuid primary key references auth.users(id) on delete cascade,
  login text unique not null,
  full_name text not null,
  phone text unique,
  telegram_username text unique,
  telegram_chat_id bigint unique, -- set once the user has messaged the bot, used to push codes/notifications
  email text unique,
  photo_url text,
  gender gender_type not null,
  is_admin boolean not null default false,

  -- Rating fields — null until admin approves
  elo integer,
  category skill_category,

  -- Approval workflow
  approval_status approval_status not null default 'pending',
  approved_at timestamptz,
  approved_by uuid references players(id),

  -- One-time notification flags (so the app shows a popup only once)
  just_registered_notified boolean not null default false,
  rating_approved_notified boolean not null default false,

  tournaments_played integer not null default 0,
  tournaments_won integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_players_gender on players(gender);
create index idx_players_approval_status on players(approval_status);
create index idx_players_elo on players(elo);

-- ──────────────────────────────────────────────
-- VERIFICATION CODES (phone via Telegram, email)
-- Short-lived, single-use codes used during registration/login.
-- ──────────────────────────────────────────────
create table verification_codes (
  id uuid primary key default uuid_generate_v4(),
  channel verification_channel not null,
  identifier text not null, -- telegram chat_id (as text) or email address
  code text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_verification_codes_lookup on verification_codes(channel, identifier, consumed_at);

-- ──────────────────────────────────────────────
-- TOURNAMENT FORMATS — configurable, not hardcoded
-- Each format describes how many players, how many rounds,
-- team size, and the rotation schedule (pairings per round).
-- New formats are added via INSERT, no code changes needed.
-- ──────────────────────────────────────────────
create table tournament_formats (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,             -- e.g. 'americano_2v2_8p'
  display_name text not null,            -- e.g. 'Американка 2x2 (8 гравців)'
  description text,
  player_count integer not null,         -- total players required, e.g. 8
  team_size integer not null default 2,  -- players per team, e.g. 2 for beach volleyball doubles
  round_count integer not null,          -- e.g. 7
  -- The rotation schedule: which player-index plays with/against whom each round.
  -- Stored as JSON so it's data-driven and can express any rotation pattern.
  -- Shape: [{ "round": 1, "matches": [{ "teamA": [0,1], "teamB": [2,3] }, ...] }, ...]
  schedule jsonb not null,
  points_to_win integer not null default 31, -- sum-to-31 scoring rule
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed the current 8-player / 7-round Americano 2v2 format
insert into tournament_formats (code, display_name, description, player_count, team_size, round_count, points_to_win, schedule)
values (
  'americano_2v2_8p',
  'Американка 2x2 (8 гравців)',
  'Класичний формат американки: 8 гравців, 7 раундів, по 2 ігри на раунд, рахунок до 31.',
  8, 2, 7, 31,
  '[
    {"round":1,"matches":[{"teamA":[0,1],"teamB":[2,3]},{"teamA":[4,5],"teamB":[6,7]}]},
    {"round":2,"matches":[{"teamA":[0,2],"teamB":[4,6]},{"teamA":[1,3],"teamB":[5,7]}]},
    {"round":3,"matches":[{"teamA":[0,3],"teamB":[5,6]},{"teamA":[1,2],"teamB":[4,7]}]},
    {"round":4,"matches":[{"teamA":[0,4],"teamB":[1,6]},{"teamA":[2,5],"teamB":[3,7]}]},
    {"round":5,"matches":[{"teamA":[0,5],"teamB":[2,7]},{"teamA":[1,4],"teamB":[3,6]}]},
    {"round":6,"matches":[{"teamA":[0,6],"teamB":[3,5]},{"teamA":[1,7],"teamB":[2,4]}]},
    {"round":7,"matches":[{"teamA":[0,7],"teamB":[1,5]},{"teamA":[2,6],"teamB":[3,4]}]}
  ]'::jsonb
);

-- ──────────────────────────────────────────────
-- TOURNAMENTS
-- ──────────────────────────────────────────────
create table tournaments (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  format_id uuid not null references tournament_formats(id),
  category skill_category not null,
  gender gender_type not null,
  status tournament_status not null default 'scheduled',

  location tournament_location not null,
  courts integer[] not null default '{1}', -- which court numbers are used, e.g. [1] or [1,2]

  scheduled_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,

  winner_player_id uuid references players(id),

  created_by uuid not null references players(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_tournaments_status on tournaments(status);
create index idx_tournaments_gender_category on tournaments(gender, category);

-- ──────────────────────────────────────────────
-- TOURNAMENT PLAYERS (which 8 players are in this tournament, and their slot index)
-- The slot index (0-7) maps to the format's schedule JSON.
-- ──────────────────────────────────────────────
create table tournament_players (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references players(id),
  slot_index integer not null, -- position in the format schedule (0-based)
  elo_at_start integer not null, -- snapshot of elo when tournament began, used for tiebreaks

  unique(tournament_id, player_id),
  unique(tournament_id, slot_index)
);

-- ──────────────────────────────────────────────
-- MATCHES (one row per game within a tournament round)
-- ──────────────────────────────────────────────
create table matches (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round_number integer not null,
  court integer not null default 1,

  team_a_players uuid[] not null, -- array of player_id (length = team_size)
  team_b_players uuid[] not null,

  score_a integer,
  score_b integer,
  played boolean not null default false,
  played_at timestamptz,

  created_at timestamptz not null default now()
);

create index idx_matches_tournament on matches(tournament_id);

-- ──────────────────────────────────────────────
-- ELO HISTORY — full audit trail of every rating change
-- ──────────────────────────────────────────────
create table elo_history (
  id uuid primary key default uuid_generate_v4(),
  player_id uuid not null references players(id) on delete cascade,
  tournament_id uuid references tournaments(id),
  delta integer not null,
  elo_before integer not null,
  elo_after integer not null,
  reason text not null default 'tournament_result', -- 'tournament_result' | 'admin_adjustment' | 'initial_approval'
  placement integer, -- final standing in the tournament (1st, 2nd, ...), null for non-tournament changes
  created_at timestamptz not null default now()
);

create index idx_elo_history_player on elo_history(player_id);

-- ──────────────────────────────────────────────
-- PARTNER STATS (denormalized, for fast "who do you play with most" lookups)
-- Updated whenever a tournament finishes.
-- ──────────────────────────────────────────────
create table partner_stats (
  player_id uuid not null references players(id) on delete cascade,
  partner_id uuid not null references players(id) on delete cascade,
  games_together integer not null default 0,
  wins_together integer not null default 0,
  last_played_at timestamptz,

  primary key (player_id, partner_id)
);

-- ──────────────────────────────────────────────
-- TOURNAMENT CHAT
-- ──────────────────────────────────────────────
create table tournament_messages (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references players(id),
  text text not null,
  created_at timestamptz not null default now()
);

create index idx_messages_tournament on tournament_messages(tournament_id, created_at);

-- ──────────────────────────────────────────────
-- ADMIN ACTION LOG (audit trail — who approved/rejected/edited what)
-- ──────────────────────────────────────────────
create table admin_actions (
  id uuid primary key default uuid_generate_v4(),
  admin_id uuid not null references players(id),
  action_type text not null, -- 'approve_player' | 'reject_player' | 'edit_elo' | 'create_tournament' | ...
  target_player_id uuid references players(id),
  target_tournament_id uuid references tournaments(id),
  details jsonb,
  created_at timestamptz not null default now()
);

-- ──────────────────────────────────────────────
-- updated_at auto-touch trigger
-- ──────────────────────────────────────────────
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_players_updated_at before update on players
  for each row execute function touch_updated_at();

create trigger trg_tournaments_updated_at before update on tournaments
  for each row execute function touch_updated_at();
