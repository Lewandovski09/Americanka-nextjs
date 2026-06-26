-- ============================================================
-- AMERICANKA — Migration 004: Notifications, partner history, requested category
-- ============================================================

-- ──────────────────────────────────────────────
-- Track what category the player requested at registration,
-- separately from the final approved category — so the admin
-- panel can show "requested: B" while letting the admin pick
-- the real one independently.
-- ──────────────────────────────────────────────
alter table players add column requested_category skill_category;

-- ──────────────────────────────────────────────
-- ADMIN NOTIFICATIONS — broadcast messages shown to all players
-- on the home screen, newest first.
-- ──────────────────────────────────────────────
create table admin_notifications (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  body text not null,
  created_by uuid not null references players(id),
  created_at timestamptz not null default now()
);

create index idx_admin_notifications_created on admin_notifications(created_at desc);

alter table admin_notifications enable row level security;

create policy admin_notifications_select_all on admin_notifications
  for select using (true);

create policy admin_notifications_admin_write on admin_notifications
  for all using (is_admin()) with check (is_admin());

-- ──────────────────────────────────────────────
-- Track which notifications a player has already seen, so the
-- "newest first" feed can distinguish unread from read without
-- a separate per-user notifications table duplicating content.
-- ──────────────────────────────────────────────
create table notification_reads (
  player_id uuid not null references players(id) on delete cascade,
  notification_id uuid not null references admin_notifications(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (player_id, notification_id)
);

alter table notification_reads enable row level security;

create policy notification_reads_own on notification_reads
  for all using (player_id = auth.uid()) with check (player_id = auth.uid());
