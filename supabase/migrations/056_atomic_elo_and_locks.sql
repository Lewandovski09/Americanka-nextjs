-- ============================================================
-- AMERICANKA — Migration 056: atomic Ело changes and double-tap guards
-- ============================================================
-- 1. add_elo(user, sport, delta) — moves a rating by a delta inside the
--    database. The app used to read the rating, add in JavaScript and
--    write it back: two games of the same player entered at the same
--    moment overwrote each other's change. Used by the score route, the
--    tournament delete (rollback) and the archive restore.
-- 2. One archive entry per event — a second «Видалити турнір» while the
--    first is still running now stops instead of taking the Ело off
--    twice.
-- 3. stage_build_locks — the score route builds the next stage (King
--    round, crosses playoff) one request at a time per category; two
--    courts finishing at the same moment no longer create it twice.
--
-- Idempotent.

-- ── 1. add_elo ──
create or replace function add_elo(p_user uuid, p_sport text, p_delta integer, p_start integer default 1200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer;
begin
  if p_sport is null or p_sport = 'beach_volleyball' then
    update users
       set elo = coalesce(elo, p_start) + p_delta,
           category = (case
             when coalesce(elo, p_start) + p_delta >= 1700 then 'A'
             when coalesce(elo, p_start) + p_delta >= 1400 then 'B'
             when coalesce(elo, p_start) + p_delta >= 1100 then 'C'
             else 'D'
           end)::skill_category
     where id = p_user
     returning elo into v;
    return v;
  end if;

  insert into user_ratings (user_id, sport_id, elo, updated_at)
  values (p_user, p_sport, p_start + p_delta, now())
  on conflict (user_id, sport_id)
  do update set elo = user_ratings.elo + p_delta, updated_at = now()
  returning elo into v;
  return v;
end;
$$;

revoke all on function add_elo(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function add_elo(uuid, text, integer, integer) to service_role;

-- ── 2. one archive entry per event ──
-- (if an event was ever archived twice, keep the newest entry)
do $$
begin
  if to_regclass('public.deleted_events') is not null then
    delete from deleted_events d
     using deleted_events n
     where d.event_id = n.event_id and d.deleted_at < n.deleted_at;
    create unique index if not exists uq_deleted_events_event on deleted_events(event_id);
  end if;
end $$;

-- ── 3. stage build locks ──
create table if not exists stage_build_locks (
  category_id uuid primary key references tournament_categories(id) on delete cascade,
  locked_at timestamptz not null default now()
);
alter table stage_build_locks enable row level security;
-- no policies: only the server (service role) touches it

notify pgrst, 'reload schema';
