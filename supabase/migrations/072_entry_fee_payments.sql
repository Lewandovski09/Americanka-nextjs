-- ============================================================
-- AMERICANKA — Migration 072: who has paid the entry fee
-- ============================================================
-- The admin's own checklist on the «Оплата» tab of a tournament's
-- settings: one row per player of an event who has paid. Per event, not
-- per category, so moving a player to another category keeps the mark.
-- Only admins see it (players never do); writes go through
-- /api/events/[eventId]/payments on the service-role client.
-- Idempotent.

create table if not exists tournament_payments (
  event_id  uuid not null references tournament_events(id) on delete cascade,
  user_id   uuid not null references users(id) on delete cascade,
  paid_at   timestamptz not null default now(),
  marked_by uuid references users(id) on delete set null,
  primary key (event_id, user_id)
);

alter table tournament_payments enable row level security;

drop policy if exists tournament_payments_admin_read on tournament_payments;
create policy tournament_payments_admin_read on tournament_payments
  for select using (is_admin());

drop policy if exists tournament_payments_admin_write on tournament_payments;
create policy tournament_payments_admin_write on tournament_payments
  for all using (is_admin()) with check (is_admin());

grant select, insert, update, delete on tournament_payments to authenticated;
grant all on tournament_payments to service_role;

notify pgrst, 'reload schema';

-- Check: one row — the table exists and how many marks it holds.
select 'tournament_payments' as table_name, (select count(*) from tournament_payments) as marks;
