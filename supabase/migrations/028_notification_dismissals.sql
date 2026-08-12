-- ============================================================
-- AMERICANKA — Migration 028: notification_dismissals
-- ============================================================
-- Before this, the only way to stop seeing an announcement was the
-- admin's own "×" — which does not hide it, it deletes the row for
-- every player at once (app/page.js's dismissAnnouncement). A regular
-- player had no way to clear an announcement for themselves without
-- removing it for the whole club.
--
-- This is the standard "read receipt" pattern: dismissing doesn't
-- touch admin_notifications at all, it just records that THIS player
-- has seen THIS announcement. The home page then filters out any
-- notification with a matching row here. The admin's existing "delete
-- for everyone" behaviour is untouched — the two are independent, and
-- a hard delete still cascades away any dismissal rows for it, since
-- there is nothing left to have dismissed.

create table notification_dismissals (
  notification_id uuid not null references admin_notifications(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (notification_id, player_id)
);

alter table notification_dismissals enable row level security;

-- A player may only ever record their OWN dismissal — never mark an
-- announcement as read on someone else's behalf, and never read who
-- else has dismissed what (that's not privacy-sensitive exactly, but
-- there's no legitimate reason for a player to query it either).
create policy notification_dismissals_insert_own on notification_dismissals
  for insert with check (player_id = auth.uid());

create policy notification_dismissals_select_own on notification_dismissals
  for select using (player_id = auth.uid());
