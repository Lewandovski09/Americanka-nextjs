-- ============================================================
-- AMERICANKA — Migration 058: private user columns, pair invitations
-- ============================================================
-- 1. A player's Telegram id is no longer readable from the browser —
--    not by guests, not by other players. Only the server (service role)
--    sees it. Guests (not signed in) also stop seeing logins and the
--    service columns; a signed-in member still sees what the app shows
--    (names, photos, Ело, category, @login, @telegram).
-- 2. pair_invites — «Зіграти разом» with a player who applied alone no
--    longer pairs them up at once: the seeker gets an invitation and
--    accepts or declines it.
--
-- Idempotent.

-- ── 1. column privileges on users ──
revoke select on users from anon, authenticated;

grant select (
  id, login, telegram_username, photo_url, gender, is_admin, elo, category,
  approval_status, approved_at, approved_by, just_registered_notified,
  rating_approved_notified, tournaments_played, tournaments_won, created_at,
  updated_at, requested_category, telegram_linked_at, first_name, last_name,
  city, full_name
) on users to authenticated;

grant select (
  id, photo_url, gender, elo, category, approval_status, tournaments_played,
  tournaments_won, first_name, last_name, city, full_name
) on users to anon;

-- ── 2. pair invitations ──
create table if not exists pair_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references tournament_events(id) on delete cascade,
  category_id uuid references tournament_categories(id) on delete cascade,
  from_user uuid not null references users(id) on delete cascade,
  to_user uuid not null references users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index if not exists idx_pair_invites_to on pair_invites(to_user, status);
create index if not exists idx_pair_invites_event on pair_invites(event_id, status);
create unique index if not exists uq_pair_invites_pending
  on pair_invites(event_id, from_user, to_user) where status = 'pending';

alter table pair_invites enable row level security;

drop policy if exists pair_invites_select_own on pair_invites;
create policy pair_invites_select_own on pair_invites for select
  using (from_user = auth.uid() or to_user = auth.uid() or is_admin());
-- no write policies: invitations are created and answered by the server

notify pgrst, 'reload schema';
