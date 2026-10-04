-- ============================================================
-- AMERICANKA — Migration 050: «Хто виграє?» — votes for the favourite
-- ============================================================
-- One vote per person per category. The choice is a participant of that
-- category: a player (tournament_players.user_id) in solo formats, a pair
-- (tournament_teams.id) in pair formats. A vote can be changed — or
-- withdrawn — freely until the category starts; after that the database
-- refuses any change, so the result is frozen at the start.
-- A participant who leaves the roster simply drops out of the tally (the
-- app counts only votes for current participants).
--
-- Idempotent.

create table if not exists tournament_votes (
  category_id uuid not null references tournament_categories(id) on delete cascade,
  voter_id uuid not null references users(id) on delete cascade,
  choice_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (category_id, voter_id)
);

create index if not exists idx_tournament_votes_category on tournament_votes(category_id);

alter table tournament_votes enable row level security;

-- Everyone may see the poll.
drop policy if exists tournament_votes_select_all on tournament_votes;
create policy tournament_votes_select_all on tournament_votes for select using (true);

-- Is the poll of this category still open, and is `choice` one of its
-- participants? security definer: the check must see the roster whatever
-- the caller's own read rights.
create or replace function vote_choice_allowed(p_category uuid, p_choice uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from tournament_categories c where c.id = p_category and c.status = 'scheduled')
     and (
       exists (select 1 from tournament_players tp where tp.category_id = p_category and tp.user_id = p_choice)
       or exists (select 1 from tournament_teams tt where tt.category_id = p_category and tt.id = p_choice)
     );
$$;

create or replace function vote_poll_open(p_category uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from tournament_categories c where c.id = p_category and c.status = 'scheduled');
$$;

drop policy if exists tournament_votes_insert_own on tournament_votes;
create policy tournament_votes_insert_own on tournament_votes for insert
  with check (voter_id = auth.uid() and vote_choice_allowed(category_id, choice_id));

drop policy if exists tournament_votes_update_own on tournament_votes;
create policy tournament_votes_update_own on tournament_votes for update
  using (voter_id = auth.uid() and vote_poll_open(category_id))
  with check (voter_id = auth.uid() and vote_choice_allowed(category_id, choice_id));

drop policy if exists tournament_votes_delete_own on tournament_votes;
create policy tournament_votes_delete_own on tournament_votes for delete
  using (voter_id = auth.uid() and vote_poll_open(category_id));

notify pgrst, 'reload schema';
