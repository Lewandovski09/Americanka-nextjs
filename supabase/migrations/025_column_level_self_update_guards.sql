-- ============================================================
-- AMERICANKA — Migration 025: column-level guards on self-update policies
-- ============================================================
-- An audit of every migration end to end (002 through 024) found three
-- policies that let a signed-in player UPDATE their OWN row — which is
-- the right call for a profile edit or joining an open team — but never
-- restricted WHICH COLUMNS could change. RLS's USING clause only gates
-- which ROWS are touched; without a matching WITH CHECK (or a trigger),
-- nothing stops the same request from also rewriting columns that have
-- nothing to do with "my own profile."
--
-- This is exploitable directly against Supabase's REST API with a
-- player's own ordinary session — no service-role key, no admin
-- access, no bug in the app's UI needed. The app's own client code
-- never sends these payloads, but RLS is the database's line, not the
-- app's; anyone can call the API with whatever body they want.
--
--   players (002)
--     policy: for update using (id = auth.uid() or is_admin())
--     hole:   a player can PATCH their own row and set is_admin=true,
--             elo=<anything>, approval_status='approved', or move
--             their Telegram identity — a straight path to making
--             yourself an admin or top of the rating.
--
--   tournament_teams (009, "self_join")
--     policy: with check (player2_id = auth.uid())
--     hole:   only the joiner's own id is checked. player1_id and
--             tournament_id ride along unchecked in the same request,
--             so a "join" can just as easily relocate someone else's
--             team into a different tournament or swap out who their
--             partner is.
--
--   tournament_applications (011, "self_update")
--     policy: for update using (player_id = auth.uid())
--             with check (player_id = auth.uid())
--     hole:   status and assigned_tournament_id are exactly the two
--             columns that mean "an admin decided this" — self-update
--             lets a player set status='approved' or
--             assigned_tournament_id=<any category> directly,
--             self-approving into a tournament with no admin involved.
--
-- Column-level protection needs a trigger: RLS's WITH CHECK evaluates
-- only the proposed new row, with no built-in way to compare it against
-- the row it's replacing (that's what OLD/NEW are for in a trigger, and
-- triggers are the standard tool for exactly this in Postgres). Server
-- routes are unaffected — they write through the service-role
-- connection (auth.role() = 'service_role'), which every guard below
-- explicitly lets straight through, same as an admin.

-- ──────────────────────────────────────────────
-- PLAYERS
-- ──────────────────────────────────────────────
create or replace function enforce_players_self_update()
returns trigger as $$
begin
  if auth.role() = 'service_role' or is_admin() then
    return new;
  end if;

  -- Everything below is an ordinary player editing their own row.
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

drop trigger if exists trg_players_protect_self_update on players;
create trigger trg_players_protect_self_update
  before update on players
  for each row
  execute function enforce_players_self_update();

-- ──────────────────────────────────────────────
-- TOURNAMENT_TEAMS — the self-join path only
-- ──────────────────────────────────────────────
create or replace function enforce_teams_self_join()
returns trigger as $$
begin
  if auth.role() = 'service_role' or is_admin() then
    return new;
  end if;

  -- A join fills the open player2_id slot; it never moves the team to
  -- a different tournament or swaps out the first player.
  new.tournament_id := old.tournament_id;
  new.player1_id := old.player1_id;
  new.created_at := old.created_at;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_teams_protect_self_join on tournament_teams;
create trigger trg_teams_protect_self_join
  before update on tournament_teams
  for each row
  execute function enforce_teams_self_join();

-- ──────────────────────────────────────────────
-- TOURNAMENT_APPLICATIONS — the self-update path only
-- ──────────────────────────────────────────────
create or replace function enforce_applications_self_update()
returns trigger as $$
begin
  if auth.role() = 'service_role' or is_admin() then
    return new;
  end if;

  -- status and assigned_tournament_id are an admin's decision, made by
  -- the placement logic in lib/server/registration.js. A player may
  -- still edit their own pending request (partner, category ask,
  -- seeking-partner flag) — just not the outcome.
  new.status := old.status;
  new.assigned_tournament_id := old.assigned_tournament_id;
  new.event_id := old.event_id;
  new.player_id := old.player_id;
  new.created_at := old.created_at;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_applications_protect_self_update on tournament_applications;
create trigger trg_applications_protect_self_update
  before update on tournament_applications
  for each row
  execute function enforce_applications_self_update();
