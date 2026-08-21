-- ============================================================
-- AMERICANKA — Migration 041: tournament_placements, properly declared
-- ============================================================
-- Two things, both about the one table in this database that no
-- migration ever created.
--
-- tournament_placements is written by recordPlacements() in
-- lib/server/finishCategory.ts and read by app/rating/page.js and
-- get_user_tournament_history — but it was made by hand in the SQL
-- editor, so the repo has never described it. A fresh database built
-- from this folder would not have it, and nobody could tell what its
-- constraints are without opening the live catalog.
--
-- 1. DECLARE IT, so the folder finally matches the database. Guarded
--    with `if not exists`, so on the live database this section does
--    nothing at all — the real table, with whatever extra columns it
--    may carry, is left exactly as it is. This is for the next fresh
--    database, not for this one.
--
-- 2. FIX ITS FOREIGN KEY to the category. If the hand-made one was left
--    at the default NO ACTION, a placement row BLOCKS deletion of the
--    event above it: /api/events/[eventId]/delete checks that no rating
--    was awarded and then deletes the event, and Postgres refuses on a
--    reference the route never knew about — surfacing as a bare «Не
--    вдалося видалити турнір». Same class of trap as
--    tournament_messages in migration 036.
--
--    CASCADE is the right rule here: a placement is a fact ABOUT a
--    category. Delete the category and the fact has no subject left.
--    That is already how avp_points behaves.
--
-- NOT CHANGED: the user_id reference. Migration 008 decided deliberately
-- that rows recording what a player DID should block deleting that
-- player («a player with tournament history should not silently vanish
-- from results»), and a placement is exactly such a row. Rejecting a new
-- registration is unaffected — such a player has no placements.

-- ──────────────────────────────────────────────
-- 1. THE TABLE (no-op where it already exists)
-- ──────────────────────────────────────────────
-- Columns taken from recordPlacements(): category_id, user_id, place.
create table if not exists tournament_placements (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid not null references tournament_categories(id) on delete cascade,
  user_id uuid not null references users(id),
  place integer not null,
  created_at timestamptz not null default now(),

  -- One placement per player per category; recordPlacements clears the
  -- category and rewrites it, so this can only ever be hit by a
  -- concurrent double-finish.
  unique (category_id, user_id)
);

create index if not exists idx_tournament_placements_category on tournament_placements(category_id);
create index if not exists idx_tournament_placements_user on tournament_placements(user_id);

-- ──────────────────────────────────────────────
-- 2. THE FOREIGN KEY
-- ──────────────────────────────────────────────
-- Rebuilt unconditionally to ON DELETE CASCADE. The existing constraint
-- is found by what it references rather than by name — it was created by
-- hand, so its name is not knowable from here.
do $$
declare
  con record;
  col_attnum smallint;
begin
  if to_regclass('public.tournament_placements') is null then
    raise notice 'tournament_placements is absent — section 1 should have created it';
    return;
  end if;

  select attnum into col_attnum
  from pg_attribute
  where attrelid = 'public.tournament_placements'::regclass
    and attname = 'category_id'
    and not attisdropped;

  if col_attnum is null then
    raise exception 'tournament_placements has no category_id column — has migration 037 been applied?';
  end if;

  for con in
    select c.conname, c.confdeltype
    from pg_constraint c
    where c.conrelid = 'public.tournament_placements'::regclass
      and c.contype = 'f'
      and c.conkey = array[col_attnum]
  loop
    if con.confdeltype = 'c' then
      raise notice 'category_id FK % is already ON DELETE CASCADE', con.conname;
    else
      raise notice 'replacing category_id FK % (on delete = %)', con.conname, con.confdeltype;
    end if;
    execute format('alter table public.tournament_placements drop constraint %I', con.conname);
  end loop;

  execute $ddl$
    alter table public.tournament_placements
      add constraint tournament_placements_category_id_fkey
      foreign key (category_id) references public.tournament_categories(id) on delete cascade
  $ddl$;
end;
$$;
