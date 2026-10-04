-- ============================================================
-- AMERICANKA — Migration 055: security hardening
-- ============================================================
-- 1. Nobody creates their own users row any more. Registration has long
--    gone through the server (auth.admin.createUser + service role), but
--    the old «users_insert_self» policy stayed: anyone who signed up
--    directly with Supabase Auth could insert a row with is_admin = true.
--    The guard trigger now also runs on INSERT, as a second lock.
-- 2. Players can no longer write rosters, pairs and applications
--    directly — every one of those writes goes through an API route that
--    checks gender, capacity, «реєстрацію закрито» and partner consent.
--    The old self-insert / self-join / self-update policies let a direct
--    REST call skip all of that.
-- 3. A player can't change their own gender, photo or requested
--    category from the browser either (the profile API, which runs as
--    the server, still can).
-- 4. elo_history becomes readable by everyone signed in or not, like the
--    rest of the results: «Герої місяця», the Ело of everyone in a game
--    and the deltas in a tournament's schedule were visible only to the
--    admin (and each player's own rows), so ordinary players saw broken
--    numbers.
-- 5. The housekeeping function can't be called by anon / authenticated.
--
-- Idempotent. Safe to run more than once.

-- ── 1. users: no self insert ──
drop policy if exists users_insert_self on users;
drop policy if exists players_insert_self on users;

create or replace function enforce_users_self_update()
returns trigger as $$
begin
  if auth.role() = 'service_role' or is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'users rows are created by the server only';
  end if;

  -- An ordinary user editing their own row: these columns snap back to
  -- their stored value (a silent no-op, so a legitimate request touching
  -- other fields still succeeds).
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
  new.gender := old.gender;
  new.photo_url := old.photo_url;
  new.requested_category := old.requested_category;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_users_protect_self_update on users;
create trigger trg_users_protect_self_update
  before insert or update on users
  for each row
  execute function enforce_users_self_update();

-- ── 2. rosters, pairs, applications: server only ──
drop policy if exists tournament_players_self_insert on tournament_players;
drop policy if exists tournament_players_self_delete on tournament_players;
drop policy if exists tournament_teams_self_insert on tournament_teams;
drop policy if exists tournament_teams_self_join on tournament_teams;
drop policy if exists tournament_teams_self_delete on tournament_teams;
drop policy if exists tournament_applications_self_insert on tournament_applications;
drop policy if exists tournament_applications_self_update on tournament_applications;
drop policy if exists tournament_applications_self_delete on tournament_applications;
-- (the same policies under their pre-037 names, in case they survived)
drop policy if exists players_self_insert on tournament_players;
drop policy if exists teams_self_insert on tournament_teams;
drop policy if exists teams_self_join on tournament_teams;
drop policy if exists applications_self_insert on tournament_applications;

-- ── 4. elo_history: readable like every other result ──
drop policy if exists elo_history_select on elo_history;
drop policy if exists elo_history_select_all on elo_history;
create policy elo_history_select_all on elo_history for select using (true);

-- ── 5. housekeeping: server only ──
do $$
begin
  if exists (select 1 from pg_proc where proname = 'cleanup_expired_rows') then
    execute 'revoke all on function cleanup_expired_rows() from public, anon, authenticated';
  end if;
end $$;

notify pgrst, 'reload schema';
