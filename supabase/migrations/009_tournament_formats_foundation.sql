-- ============================================================
-- AMERICANKA — Migration 009: Tournament formats foundation
-- ============================================================
-- Stage 1 of the multi-format tournament system. This migration
-- only lays the DATA foundation (new columns/tables + the RLS
-- needed for players to register themselves) — it does NOT
-- generate brackets/groups. That's Stage 3, built once this
-- foundation is confirmed correct.
--
-- New format families this unlocks:
--   - 'single_gender'  → Чоловічі / Жіночі (pairs, same gender)
--   - 'mix'            → Мікс (pairs, one M + one F)
--   - 'king_of_beach'  → Король пляжу (solo, progressive groups)
-- The existing 'americanka' format (round-robin, 8 fixed players,
-- admin-assigned slots) is untouched and keeps working exactly as
-- before — these are pure additions.

-- ──────────────────────────────────────────────
-- ENUMS
-- ──────────────────────────────────────────────
create type tournament_format_type as enum ('americanka', 'single_gender', 'mix', 'king_of_beach');

create type tournament_bracket_system as enum (
  'double_elimination',
  'groups_playoff',
  'groups_crosses_1_2',
  'groups_top1_playoff_top23_crosses'
);

-- ──────────────────────────────────────────────
-- TOURNAMENT_FORMATS — tag the engine family, seed the 3 new formats
-- ──────────────────────────────────────────────
alter table tournament_formats add column format_type tournament_format_type not null default 'americanka';

update tournament_formats set format_type = 'americanka' where code = 'americano_2v2_8p';

-- These three don't have a fixed schedule like Americanka — their
-- actual pairings/groups are generated at runtime (Stage 3), so
-- player_count/round_count/schedule are unused placeholders for them.
insert into tournament_formats (code, display_name, description, player_count, team_size, round_count, points_to_win, schedule, format_type)
values
  ('single_gender_pairs', 'Чоловічі / Жіночі', 'Парний формат окремо для чоловіків і жінок. Кількість учасників і система турніру обираються при створенні.', 0, 2, 0, 21, '[]'::jsonb, 'single_gender'),
  ('mix_pairs', 'Мікс', 'Змішані пари: один чоловік + одна жінка. Кількість учасників і система турніру обираються при створенні.', 0, 2, 0, 21, '[]'::jsonb, 'mix'),
  ('king_of_the_beach', 'Король пляжу', 'Індивідуальна реєстрація, групи по 4 гравці, прогресивний відбір по раундах.', 0, 1, 0, 21, '[]'::jsonb, 'king_of_beach');

-- ──────────────────────────────────────────────
-- TOURNAMENTS — flexible per-tournament settings for the new formats
-- ──────────────────────────────────────────────
alter table tournaments
  add column max_participants integer,            -- 12/16/24 for pairs, 16/20/24/28/32 for king_of_beach
  add column bracket_system tournament_bracket_system, -- only for single_gender / mix
  add column points_to_win integer,                -- overrides the format default when set (e.g. 15 or 21)
  add column final_points_to_win integer,          -- if set, semifinal+final play to this instead (e.g. group/early rounds to 15, final to 21)
  add column category_text text;                   -- free-text category label for the new formats (kept separate from the existing `category` enum so it doesn't force a decision on D/C/B/A vs Light/Medium/Pro yet)

-- The new formats use category_text instead of the skill_category
-- enum (Americanka keeps using `category` exactly as before).
alter table tournaments alter column category drop not null;

-- Mix tournaments aren't single-gender, so they leave this null
-- rather than forcing a third enum value into the M/F gender_type
-- (which several existing UI assumptions treat as strictly binary).
alter table tournaments alter column gender drop not null;

comment on column tournaments.category_text is
  'Free-text category for single_gender/mix/king_of_beach tournaments. The existing skill_category enum (D/C/B/A/Open) is still used for Americanka — this column exists because the exact category naming for the new formats (e.g. Light/Medium/Pro) is still being decided. Once confirmed, this can be migrated to a proper enum.';

-- ──────────────────────────────────────────────
-- TOURNAMENT_PLAYERS — allow self-registration (slot assigned later)
-- ──────────────────────────────────────────────
alter table tournament_players alter column slot_index drop not null;

create policy tournament_players_self_insert on tournament_players
  for insert
  with check (
    player_id = auth.uid()
    and exists (select 1 from tournaments t where t.id = tournament_id and t.status = 'scheduled')
  );

create policy tournament_players_self_delete on tournament_players
  for delete
  using (
    player_id = auth.uid()
    and exists (select 1 from tournaments t where t.id = tournament_id and t.status = 'scheduled')
  );

-- ──────────────────────────────────────────────
-- TOURNAMENT_TEAMS — pair-based registration (single_gender, mix)
-- A row with player2_id = null means "waiting for a partner" and
-- shows up in the in-app partner search for that tournament.
-- ──────────────────────────────────────────────
create table tournament_teams (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player1_id uuid not null references players(id),
  player2_id uuid references players(id),
  created_at timestamptz not null default now(),

  constraint tournament_teams_different_players check (player2_id is null or player1_id <> player2_id),
  unique (tournament_id, player1_id),
  unique (tournament_id, player2_id)
);

create index idx_tournament_teams_tournament on tournament_teams(tournament_id);

alter table tournament_teams enable row level security;

create policy tournament_teams_select_all on tournament_teams
  for select using (true);

create policy tournament_teams_admin_write on tournament_teams
  for all using (is_admin()) with check (is_admin());

-- A player creates their own team row (solo — waiting for a partner
-- — or already paired, if they register together in one step).
create policy tournament_teams_self_insert on tournament_teams
  for insert
  with check (
    player1_id = auth.uid()
    and exists (select 1 from tournaments t where t.id = tournament_id and t.status = 'scheduled')
  );

-- Either half of a pair can withdraw the whole team registration
-- while registration is still open.
create policy tournament_teams_self_delete on tournament_teams
  for delete
  using (
    (player1_id = auth.uid() or player2_id = auth.uid())
    and exists (select 1 from tournaments t where t.id = tournament_id and t.status = 'scheduled')
  );

-- A second player can join an open ("waiting for partner") team by
-- filling the empty player2_id slot with their own id.
create policy tournament_teams_self_join on tournament_teams
  for update
  using (
    player2_id is null
    and player1_id <> auth.uid()
    and exists (select 1 from tournaments t where t.id = tournament_id and t.status = 'scheduled')
  )
  with check (
    player2_id = auth.uid()
  );
