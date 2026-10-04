-- ============================================================
-- AMERICANKA — Migration 052: archive of deleted tournaments
-- ============================================================
-- Deleting a tournament used to be final. Now, right before the delete,
-- the whole event is copied into `deleted_events` as one JSON snapshot:
-- the event, its categories, judges, applications, rosters, pairs,
-- matches, places, AVP points, the Ело history of its games, votes and
-- «Шукаю пару» notices. The delete itself works exactly as before (Ело
-- rolled back, everything else by cascade), so ratings, profiles and
-- statistics are never confused by a deleted tournament.
--
-- «Відновити» puts the snapshot back row by row (same ids) and the app
-- re-applies the Ело of its games — the tournament returns as it was.
--
-- Only the admin sees the archive. Both functions are callable only by
-- the server (service_role), never from the browser.
--
-- Idempotent.

create table if not exists deleted_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  name text,
  format_kind text,
  scheduled_at timestamptz,
  event_status text,
  categories_count integer not null default 0,
  matches_count integer not null default 0,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references users(id) on delete set null,
  snapshot jsonb not null
);

create index if not exists idx_deleted_events_deleted_at on deleted_events(deleted_at desc);

alter table deleted_events enable row level security;

drop policy if exists deleted_events_admin_select on deleted_events;
create policy deleted_events_admin_select on deleted_events for select using (is_admin());
-- No insert / update / delete policies: only the server writes here.

-- The tables a tournament consists of, in the order they can be put
-- back (parents first). tournament_match_players is not listed: a
-- trigger on tournament_matches rebuilds it on insert.
create or replace function event_archive_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'tournament_events',
    'tournament_categories',
    'tournament_judges',
    'tournament_teams',
    'tournament_players',
    'tournament_applications',
    'tournament_matches',
    'tournament_placements',
    'avp_points',
    'elo_history',
    'tournament_votes',
    'partner_ads'
  ];
$$;

-- Everything of one event as { table: [rows] }.
create or replace function archive_event_snapshot(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cats uuid[];
  mids uuid[];
  out jsonb := '{}'::jsonb;
  rows jsonb;
  t text;
begin
  select coalesce(array_agg(id), '{}') into cats from tournament_categories where event_id = p_event;
  select coalesce(array_agg(id), '{}') into mids from tournament_matches where category_id = any(cats);

  foreach t in array event_archive_tables() loop
    if to_regclass(t) is null then
      continue;
    end if;
    execute case t
      when 'tournament_events' then format('select jsonb_agg(to_jsonb(x)) from %I x where x.id = $1', t)
      when 'tournament_judges' then format('select jsonb_agg(to_jsonb(x)) from %I x where x.event_id = $1', t)
      when 'tournament_applications' then format('select jsonb_agg(to_jsonb(x)) from %I x where x.event_id = $1', t)
      when 'tournament_categories' then format('select jsonb_agg(to_jsonb(x)) from %I x where x.event_id = $1', t)
      when 'avp_points' then format('select jsonb_agg(to_jsonb(x)) from %I x where x.event_id = $1 or x.category_id = any($2)', t)
      when 'elo_history' then format('select jsonb_agg(to_jsonb(x)) from %I x where x.match_id = any($3)', t)
      else format('select jsonb_agg(to_jsonb(x)) from %I x where x.category_id = any($2)', t)
    end
    into rows
    using p_event, cats, mids;
    out := out || jsonb_build_object(t, coalesce(rows, '[]'::jsonb));
  end loop;
  return out;
end;
$$;

-- Puts a snapshot back. Only the columns the snapshot has are written
-- (a column added later keeps its default); generated columns are
-- skipped. One transaction: on any error nothing is restored.
create or replace function restore_event_snapshot(p_snapshot jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  cols text;
  data jsonb;
begin
  foreach t in array event_archive_tables() loop
    data := p_snapshot -> t;
    if to_regclass(t) is null or data is null or jsonb_array_length(data) = 0 then
      continue;
    end if;
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into cols
      from pg_attribute a
     where a.attrelid = to_regclass(t)
       and a.attnum > 0
       and not a.attisdropped
       and a.attgenerated = ''
       and a.attname in (select jsonb_object_keys(data -> 0));
    if cols is null then
      continue;
    end if;
    execute format(
      'insert into %I (%s) select %s from jsonb_populate_recordset(null::%I, $1)',
      t, cols, cols, t
    ) using data;
  end loop;
end;
$$;

revoke all on function archive_event_snapshot(uuid) from public, anon, authenticated;
revoke all on function restore_event_snapshot(jsonb) from public, anon, authenticated;
grant execute on function archive_event_snapshot(uuid) to service_role;
grant execute on function restore_event_snapshot(jsonb) to service_role;

notify pgrst, 'reload schema';
