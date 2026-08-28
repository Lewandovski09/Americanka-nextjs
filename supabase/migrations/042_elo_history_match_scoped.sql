-- ============================================================
-- AMERICANKA — Migration 042: elo_history hangs off the MATCH
-- ============================================================
-- elo_history still carries the shape of a model that no longer exists.
-- It was designed for ONE ROW PER TOURNAMENT — hence `tournament_id`
-- (now category_id) and `placement`, "final standing in the tournament".
-- Auto-Ело replaced that with one row per GAME (see migration 031, whose
-- whole subject is the double-counting the old assumption caused), and
-- migration 032/037 added `match_id`. What is left is a table pointing
-- at two different things at once.
--
-- This finishes the move. The game is the only anchor:
--
--   1. `placement` is dropped. Never written by either insert, never
--      selected by either RPC, never read in app code. The real place a
--      player finished lives in tournament_placements, which is exactly
--      where get_user_tournament_history already reads it from (tpl.place).
--
--   2. `category_id` is dropped. Fully derivable — a tournament row
--      always has a match, a match always has a category — so it was
--      only ever a denormalisation that could disagree with match_id.
--
--   3. `match_id` becomes ON DELETE CASCADE, taking over the job
--      category_id was failing at. category_id had NO on-delete rule at
--      all, which is why deleting an event with awarded Ело was blocked
--      by Postgres and had to be worked around in
--      /api/events/[eventId]/delete. Now the chain
--      event → category → match → elo_history cleans itself up.
--
-- The rows with no match — `admin_adjustment` from edit-elo — keep a
-- null match_id and are untouched by the cascade. They are also the
-- reason the column stays nullable.
--
-- NOT DONE HERE, deliberately: the delete route still subtracts the
-- deltas from users.elo before deleting, because Ело is a running total
-- and dropping its history is not the same as undoing it. The cascade
-- only removes the record, never the effect.

-- ──────────────────────────────────────────────
-- 0. PRECONDITION: 039 MUST BE APPLIED ALREADY
-- ──────────────────────────────────────────────
-- Both files recreate get_user_tournament_history, and 039's copy still
-- sums elo_history by eh.category_id. Applied in the wrong order it
-- silently overwrites the version below with one that reads a column
-- this migration has dropped — and, being a text-bodied SQL function,
-- it would not complain until somebody opened a profile. This folder
-- has already drifted out of order three times (028, 032, and
-- tournament_placements), so the check is not theoretical.
--
-- Proxy for "039 ran": it drops tournament_categories.category.
do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.tournament_categories'::regclass
      and attname = 'category'
      and not attisdropped
  ) then
    raise exception 'Migration 039 has not been applied — run 038-041 first, then this file';
  end if;
end;
$$;

-- ──────────────────────────────────────────────
-- 1. THE FUNCTIONS FIRST
-- ──────────────────────────────────────────────
-- Ahead of the drop, and not optional — same trap as migration 039. A
-- SQL function with a text body records no dependency on the columns it
-- reads, so dropping category_id would NOT fail here. It would leave
-- both functions quietly broken until the next time somebody opened a
-- profile.
--
-- Both keep their signature exactly: the category is still reported,
-- just reached through the match instead of stored twice.

-- ── get_user_tournament_history: the «Ело» column on a player's
--    tournament list. Only the elo_delta subquery changes. ──
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
    t.category_label as category,
    t.gender,
    t.status,
    t.scheduled_at,
    t.finished_at,
    (
      -- Sum every game of this category, not one row: auto-Ело writes
      -- per game. The inner join is what replaces eh.category_id.
      select sum(eh.delta)::integer
      from elo_history eh
      join tournament_matches m on m.id = eh.match_id
      where m.category_id = t.id and eh.user_id = p_user_id
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

-- ── get_user_elo_log: the per-game Ело journal on the profile. The
--    match join was already there for opponent_names; the category join
--    now hangs off it, and category_id is read from the match. ──
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
    ) as opponent_names
  from elo_history eh
  left join tournament_matches m on m.id = eh.match_id
  left join tournament_categories t on t.id = m.category_id
  where eh.user_id = p_user_id
  order by eh.created_at desc;
$$;

-- ──────────────────────────────────────────────
-- 2. match_id TAKES OVER THE CASCADE
-- ──────────────────────────────────────────────
-- Rebuilt from ON DELETE SET NULL to ON DELETE CASCADE. SET NULL was the
-- right rule while category_id still anchored the row; with category_id
-- gone it would strand rows that belong to nothing — worse than either
-- alternative. The constraint is found by what it covers rather than by
-- name: it was created by `add column ... references` in migration 037,
-- so Postgres named it, not us.
do $$
declare
  con record;
  col_attnum smallint;
begin
  select attnum into col_attnum
  from pg_attribute
  where attrelid = 'public.elo_history'::regclass
    and attname = 'match_id'
    and not attisdropped;

  if col_attnum is null then
    raise exception 'elo_history has no match_id column — has migration 037 (section 5b) been applied?';
  end if;

  for con in
    select c.conname, c.confdeltype
    from pg_constraint c
    where c.conrelid = 'public.elo_history'::regclass
      and c.contype = 'f'
      and c.conkey = array[col_attnum]
  loop
    if con.confdeltype = 'c' then
      raise notice 'match_id FK % is already ON DELETE CASCADE', con.conname;
    else
      raise notice 'replacing match_id FK % (on delete = %)', con.conname, con.confdeltype;
    end if;
    execute format('alter table public.elo_history drop constraint %I', con.conname);
  end loop;

  execute $ddl$
    alter table public.elo_history
      add constraint elo_history_match_id_fkey
      foreign key (match_id) references public.tournament_matches(id) on delete cascade
  $ddl$;
end;
$$;

-- ──────────────────────────────────────────────
-- 3. THE COLUMNS GO
-- ──────────────────────────────────────────────
-- Dropping category_id takes its foreign key with it — the last
-- reference in this schema with no on-delete rule.
alter table elo_history
  drop column if exists placement,
  drop column if exists category_id;

-- ──────────────────────────────────────────────
-- 3b. WHAT `reason` ACTUALLY HOLDS
-- ──────────────────────────────────────────────
-- Migration 001 documented a third value, 'initial_approval', in a
-- trailing -- comment on the column. Nothing has ever written it:
-- approving a player sets users.elo directly and logs nothing, so the
-- starting rating is invisible here. That comment lived only in the
-- .sql file, which is now history and stays as it is; this puts the
-- truth where a reader of the live schema will find it.
--
-- Consequence worth knowing: the sum of a player's deltas is NOT their
-- rating. It is the distance they have travelled from a starting value
-- the journal never recorded.
comment on column elo_history.reason is
  'tournament_result — one row per game, written by the americanka auto-Ело in /api/matches/[matchId]/score. '
  'admin_adjustment — a manual correction from /api/admin/players/[playerId]/edit-elo; has no match_id. '
  'These are the only two values written. Approval logs nothing.';

-- ──────────────────────────────────────────────
-- 4. INDEX NAMES
-- ──────────────────────────────────────────────
-- Left behind by migration 037, which renamed the column but not this.
do $$
begin
  if to_regclass('public.idx_elo_history_player') is not null
     and to_regclass('public.idx_elo_history_user') is null then
    alter index idx_elo_history_player rename to idx_elo_history_user;
  end if;
end;
$$;

-- ──────────────────────────────────────────────
-- 5. ONE ROW PER PLAYER PER GAME
-- ──────────────────────────────────────────────
-- Auto-Ело is guarded in code by `if (match.played) return`, which is a
-- check-then-act: two score submissions racing each other can both pass
-- it and pay the same game out twice. Partial, because rows with no
-- match (admin_adjustment) must stay unconstrained.
--
-- Guarded rather than plain: if the live table already holds a duplicate
-- from such a race, this says so and moves on instead of failing the
-- whole migration. Check the notice output after running.
do $$
begin
  create unique index if not exists elo_history_one_per_match_user
    on elo_history(match_id, user_id)
    where match_id is not null;
exception when unique_violation then
  raise notice 'DUPLICATE elo_history rows exist for some (match_id, user_id) — index NOT created. Find them with: select match_id, user_id, count(*) from elo_history where match_id is not null group by 1,2 having count(*) > 1;';
end;
$$;
