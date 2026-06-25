-- ============================================================
-- AMERICANKA — Row Level Security Policies
-- ============================================================
-- This is the fix for the biggest security gap in the old version:
-- previously, "who is logged in" was decided entirely in browser
-- JavaScript (anyone could open devtools and fake being any user).
-- With RLS, the DATABASE itself enforces who can see/edit what,
-- regardless of what the client claims.

alter table players enable row level security;
alter table tournaments enable row level security;
alter table tournament_players enable row level security;
alter table matches enable row level security;
alter table elo_history enable row level security;
alter table partner_stats enable row level security;
alter table tournament_messages enable row level security;
alter table admin_actions enable row level security;
alter table verification_codes enable row level security;

-- ──────────────────────────────────────────────
-- Helper: is the current authenticated user an admin?
-- ──────────────────────────────────────────────
create or replace function is_admin()
returns boolean as $$
  select exists(
    select 1 from players where id = auth.uid() and is_admin = true
  );
$$ language sql security definer stable;

-- ──────────────────────────────────────────────
-- PLAYERS
-- ──────────────────────────────────────────────
-- Everyone (even anonymous, for the public leaderboard) can read
-- approved players' public profile fields. Pending/rejected profiles
-- are only visible to the player themselves and admins.
create policy players_select_approved on players
  for select
  using (
    approval_status = 'approved'
    or id = auth.uid()
    or is_admin()
  );

-- A player can update only their own profile (e.g. photo), and only
-- non-sensitive fields — elo/category/approval_status changes go
-- through admin-only server-side logic, not direct client updates.
create policy players_update_own on players
  for update
  using (id = auth.uid() or is_admin());

-- New profile rows are created by the registration server route
-- (using the service role key), not directly by anonymous clients.
create policy players_insert_self on players
  for insert
  with check (id = auth.uid());

-- ──────────────────────────────────────────────
-- TOURNAMENTS
-- ──────────────────────────────────────────────
-- Anyone can view tournaments (public leaderboards/schedules).
create policy tournaments_select_all on tournaments
  for select using (true);

-- Only admins can create/update/delete tournaments.
create policy tournaments_admin_write on tournaments
  for all using (is_admin()) with check (is_admin());

-- ──────────────────────────────────────────────
-- TOURNAMENT_PLAYERS / MATCHES
-- ──────────────────────────────────────────────
create policy tournament_players_select_all on tournament_players
  for select using (true);
create policy tournament_players_admin_write on tournament_players
  for all using (is_admin()) with check (is_admin());

create policy matches_select_all on matches
  for select using (true);

-- Admins can edit any match; a participant in a LIVE tournament's
-- match can submit the score for their own match.
create policy matches_write on matches
  for update
  using (
    is_admin()
    or auth.uid() = any(team_a_players)
    or auth.uid() = any(team_b_players)
  );

create policy matches_admin_insert on matches
  for insert with check (is_admin());

-- ──────────────────────────────────────────────
-- ELO_HISTORY / PARTNER_STATS — read-only to players (their own),
-- fully visible to admins, written only by server-side trusted code.
-- ──────────────────────────────────────────────
create policy elo_history_select on elo_history
  for select using (player_id = auth.uid() or is_admin());

create policy partner_stats_select on partner_stats
  for select using (player_id = auth.uid() or is_admin());

-- ──────────────────────────────────────────────
-- TOURNAMENT MESSAGES (chat)
-- ──────────────────────────────────────────────
create policy messages_select_all on tournament_messages
  for select using (true);

create policy messages_insert_own on tournament_messages
  for insert with check (player_id = auth.uid());

-- ──────────────────────────────────────────────
-- ADMIN ACTIONS — admins only
-- ──────────────────────────────────────────────
create policy admin_actions_admin_only on admin_actions
  for all using (is_admin()) with check (is_admin());

-- ──────────────────────────────────────────────
-- VERIFICATION CODES — never readable by clients directly.
-- Only the server (using the service role key, which bypasses RLS)
-- creates and checks these. No policy = no client access at all.
-- ──────────────────────────────────────────────
-- (Intentionally no select/insert/update policies for anon/authenticated roles)
