-- ============================================================
-- AMERICANKA — Migration 023: AVP season rating
-- ============================================================
-- A seasonal points rating alongside Elo, modelled on the ATP ranking.
-- The two answer different questions and neither replaces the other:
--
--   elo (players.elo)  — how strong a player IS. Admin-set, never
--                        awarded for results, carries across seasons.
--                        Drives the category letter, the seeding and
--                        the `by_rating` registration gate.
--   AVP points         — what a player has ACHIEVED this season.
--                        Awarded automatically when a category
--                        finishes, resets when the season does.
--
-- Every event is worth a TIER — 250 / 500 / 1000 / 2000 — and each
-- place in a category is worth a slice of it. The place→points tables
-- live in code (lib/avp/tiers.js), like the formats do since migration
-- 011; the database stores only what was actually awarded.
--
-- Safe to run once in the Supabase SQL editor.

-- ──────────────────────────────────────────────
-- SEASONS
-- ──────────────────────────────────────────────
-- A season is a config row, not a derivation from the calendar year:
-- the club decides when one starts and ends, and the boundaries are
-- allowed to be untidy.
create table if not exists avp_seasons (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  starts_on date not null,
  ends_on date not null,

  -- ATP counts a player's best 19 results, which rewards showing up at
  -- the right tournaments rather than at the most tournaments. NULL =
  -- count everything. Stored from day one even while unused: once
  -- points have been awarded, switching the total from "sum of all" to
  -- "sum of best N" is not a migration anyone wants to discover late.
  count_best_n integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (ends_on >= starts_on)
);

-- Seasons must not overlap — every event date belongs to exactly one,
-- which is what lets the award side resolve a season without having to
-- choose between two. (A plain gist exclusion on the range: no
-- btree_gist needed, nothing is combined with a scalar here.)
alter table avp_seasons
  drop constraint if exists avp_seasons_no_overlap;
alter table avp_seasons
  add constraint avp_seasons_no_overlap
  exclude using gist (daterange(starts_on, ends_on, '[]') with &&);

drop trigger if exists trg_avp_seasons_updated_at on avp_seasons;
create trigger trg_avp_seasons_updated_at before update on avp_seasons
  for each row execute function touch_updated_at();

-- A season to land in, so the rating works the moment this runs. The
-- boundaries are the club's to change (update the row); this only makes
-- sure points are not silently dropped for want of a season.
insert into avp_seasons (name, starts_on, ends_on)
select 'Сезон 2026', date '2026-01-01', date '2026-12-31'
where not exists (select 1 from avp_seasons);

-- ──────────────────────────────────────────────
-- TIER ON THE EVENT / CATEGORY
-- ──────────────────────────────────────────────
-- Same "default on the event, override on the category" shape the
-- points target already uses (tournaments.points_to_win over
-- tournament_events.points_to_win): Pro and Light on the same day are
-- not worth the same, but most events want one number.
--
-- NULL means the event is out of the rating entirely — a friendly, a
-- practice day, a one-off. That is the default, so nothing already in
-- the database starts awarding points by surprise.
alter table tournament_events add column if not exists avp_tier smallint;
alter table tournaments add column if not exists avp_tier smallint;

alter table tournament_events drop constraint if exists tournament_events_avp_tier_valid;
alter table tournament_events add constraint tournament_events_avp_tier_valid
  check (avp_tier is null or avp_tier in (250, 500, 1000, 2000));

alter table tournaments drop constraint if exists tournaments_avp_tier_valid;
alter table tournaments add constraint tournaments_avp_tier_valid
  check (avp_tier is null or avp_tier in (250, 500, 1000, 2000));

comment on column tournament_events.avp_tier is
  'AVP tier of the event (250/500/1000/2000). NULL = not part of the season rating.';
comment on column tournaments.avp_tier is
  'Per-category override of the event tier. NULL = inherit tournament_events.avp_tier.';

-- ──────────────────────────────────────────────
-- THE LEDGER
-- ──────────────────────────────────────────────
-- One row per player per category — a ledger, not a running total.
-- The reasons that matters:
--   • idempotent — a recalculation deletes this category's rows and
--     writes them again, so re-finishing can't double-pay;
--   • auditable — "where did my 400 come from" is one query, and it is
--     the same query the profile breakdown renders from;
--   • best-N is computable at all (a counter can't be un-summed);
--   • deleting an event repairs the standings by cascade.
-- players.elo has the same shape in elo_history.
create table if not exists avp_points (
  id uuid primary key default uuid_generate_v4(),
  season_id uuid not null references avp_seasons(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,

  -- The category the points came from, and the event above it (kept
  -- denormalised so the breakdown doesn't need a join to group by day).
  tournament_id uuid not null references tournaments(id) on delete cascade,
  event_id uuid references tournament_events(id) on delete cascade,

  tier smallint not null,
  place smallint not null,
  points integer not null,

  awarded_at timestamptz not null default now(),

  -- The idempotency key the recalculation relies on.
  unique (tournament_id, player_id)
);

create index if not exists idx_avp_points_season_player on avp_points(season_id, player_id);
create index if not exists idx_avp_points_player on avp_points(player_id);
create index if not exists idx_avp_points_event on avp_points(event_id);

-- ──────────────────────────────────────────────
-- STANDINGS
-- ──────────────────────────────────────────────
-- The season table, summed from the ledger. A view rather than a cached
-- column on players: the totals then cannot drift from what was
-- actually awarded, and correcting a result needs no second write.
-- (If this ever gets slow, it becomes a materialised view — the
-- readers below don't change.)
create or replace view avp_standings as
  select
    p.season_id,
    p.player_id,
    sum(p.points)::integer as points,
    count(*)::integer      as tournaments_counted,
    max(p.awarded_at)      as last_awarded_at
  from avp_points p
  group by p.season_id, p.player_id;

-- ──────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────────
alter table avp_seasons enable row level security;
alter table avp_points enable row level security;

-- The rating is public — it is a leaderboard.
create policy avp_seasons_select_all on avp_seasons for select using (true);
create policy avp_points_select_all on avp_points for select using (true);

-- Seasons are an admin's to define. Awarded points are nobody's to
-- edit by hand: they are written by finishCategory() through the
-- service-role client, which bypasses RLS. Leaving out an admin write
-- policy is the point — a wrong result is fixed by fixing the result.
create policy avp_seasons_admin_write on avp_seasons
  for all using (is_admin()) with check (is_admin());
