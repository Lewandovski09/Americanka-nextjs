-- ============================================================
-- AMERICANKA — Migration 053: the archive of deleted tournaments is the
-- OWNER's only
-- ============================================================
-- «Архів видалених» (migration 052) was visible to every admin. Now only
-- the owner of the app sees it and can restore from it. Any admin may
-- still delete a tournament — it simply goes to the owner's archive.
--
-- The owner is kept in a separate table, not as a column on users: a
-- player may edit their own users row, an admin may edit anyone's, and
-- neither must be able to make themselves the owner. app_owners has no
-- write policies at all — it is changed only here, in the SQL Editor.
--
-- Idempotent.

create table if not exists app_owners (
  user_id uuid primary key references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table app_owners enable row level security;

-- One may see only oneself in it (enough for the app to ask «am I?»).
drop policy if exists app_owners_select_self on app_owners;
create policy app_owners_select_self on app_owners for select using (user_id = auth.uid());

create or replace function is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from app_owners where user_id = auth.uid());
$$;

grant execute on function is_owner() to authenticated;

-- The owner: Чомахашвілі Гіоргій. Matched by surname in any spelling
-- the profile may use; check the result of the query at the bottom.
insert into app_owners (user_id)
select id
from users
where lower(full_name) like '%чомахашвил%'
   or lower(full_name) like '%чомахашвіл%'
   or lower(full_name) like '%chomakhashvili%'
on conflict (user_id) do nothing;

-- The archive: the owner only.
drop policy if exists deleted_events_admin_select on deleted_events;
drop policy if exists deleted_events_owner_select on deleted_events;
create policy deleted_events_owner_select on deleted_events for select using (is_owner());

notify pgrst, 'reload schema';
