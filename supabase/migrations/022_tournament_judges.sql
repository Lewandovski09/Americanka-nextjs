-- Judges of an event.
--
-- A judging crew is assembled next to the roster, before the event
-- starts: any number of ordinary judges plus exactly one head judge.
-- The crew belongs to the EVENT, not to a single category — the same
-- people work every league of the day, and a game of any category can
-- be handed to any of them.
--
-- What the roles are allowed to do (enforced in the API routes, which
-- write through the service-role client):
--   judge       — enters scores.
--   head judge  — enters scores, moves a game to another court, and
--                 assigns the judge of a single game.
--   admin       — everything, as before.
--
-- Judges are players (they may also be playing themselves — nothing
-- here forbids it).

create table if not exists tournament_judges (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references tournament_events(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  is_head boolean not null default false,
  created_at timestamptz not null default now(),

  unique (event_id, player_id)
);

-- At most one head judge per event. (A partial unique index, so the
-- many ordinary judges never collide with each other.)
create unique index if not exists tournament_judges_one_head
  on tournament_judges(event_id) where is_head;

create index if not exists idx_tournament_judges_event on tournament_judges(event_id);
create index if not exists idx_tournament_judges_player on tournament_judges(player_id);

-- Who judges THIS game. NULL = nobody assigned yet; the crew still
-- covers the event, this only pins a person to one game.
alter table matches add column if not exists judge_id uuid references players(id) on delete set null;

create index if not exists idx_matches_judge on matches(judge_id);

comment on column matches.judge_id is
  'Player judging this game, set by an admin or the head judge. NULL = not assigned.';

-- ──────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────────
alter table tournament_judges enable row level security;

-- The crew is public — the category page shows who judges each game.
create policy tournament_judges_select_all on tournament_judges
  for select using (true);

-- The roster itself is admin-only; every other judge action goes
-- through an API route on the service-role client.
create policy tournament_judges_admin_write on tournament_judges
  for all using (is_admin()) with check (is_admin());
