-- ============================================================
-- AMERICANKA — Migration 051: «Шукаю пару» — partner-search notices
-- ============================================================
-- Pair formats («Чоловічі / Жіночі», «Мікс»): a player who has no
-- partner may post a notice in a category — «шукаю напарника /
-- напарницю», with an optional short note. Everyone sees the notices of
-- the category; only the author can post, edit or take theirs down.
--
-- Posting is allowed while the category is still before its start, only
-- in pair formats, only for approved players, and in a men's / women's
-- category only for a player of that gender (a mix takes anyone).
-- Taking a notice down is always allowed (author or admin).
--
-- Notices are not applications: the application (alone or with a
-- partner) is filed as before. The app hides a notice once its author
-- has a partner, and the apply route deletes it when the pair forms.
--
-- Idempotent.

create table if not exists partner_ads (
  category_id uuid not null references tournament_categories(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (category_id, user_id)
);

create index if not exists idx_partner_ads_category on partner_ads(category_id);

alter table partner_ads enable row level security;

drop policy if exists partner_ads_select_all on partner_ads;
create policy partner_ads_select_all on partner_ads for select using (true);

-- May `p_user` post a notice in `p_category`? security definer: it has
-- to read the event and the user whatever the caller's read rights.
create or replace function partner_ad_allowed(p_category uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from tournament_categories c
    join tournament_events e on e.id = c.event_id
    join users u on u.id = p_user
    where c.id = p_category
      and c.status = 'scheduled'
      and e.format_kind in ('single_gender', 'mix')
      and u.approval_status = 'approved'
      and (e.format_kind = 'mix' or c.gender is null or c.gender = u.gender)
  );
$$;

drop policy if exists partner_ads_insert_own on partner_ads;
create policy partner_ads_insert_own on partner_ads for insert
  with check (user_id = auth.uid() and partner_ad_allowed(category_id, user_id));

drop policy if exists partner_ads_update_own on partner_ads;
create policy partner_ads_update_own on partner_ads for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and partner_ad_allowed(category_id, user_id));

drop policy if exists partner_ads_delete_own on partner_ads;
create policy partner_ads_delete_own on partner_ads for delete
  using (user_id = auth.uid() or is_admin());

notify pgrst, 'reload schema';
