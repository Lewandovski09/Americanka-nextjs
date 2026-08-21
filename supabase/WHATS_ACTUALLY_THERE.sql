-- ============================================================
-- AMERICANKA — what does the live database actually contain?
-- ============================================================
-- Read-only. Run in the SQL editor.
--
-- The pre-flight says notification_dismissals is missing even though
-- every migration in the folder has been applied. Before creating a
-- second copy of anything, settle which of these is true:
--
--   1. it genuinely is not there — migration 028 silently didn't take;
--   2. it is there, but somewhere the check doesn't look: another
--      schema, or another database entirely (a second Supabase project,
--      a branch, staging vs prod);
--   3. it is there under a different name.
--
-- Query 3 is the one that answers it. The rest is context.

-- ── 1. Which database and schema am I even in? ──
-- Worth a glance: "applied all the migrations" and "ran the pre-flight"
-- are only the same statement if both happened against this row.
select
  current_database() as database,
  current_user       as role,
  current_schemas(true) as search_path;

-- ── 2. Every table in every non-system schema ──
-- The full inventory. Compare it against the migrations folder — this
-- is the list that is actually true.
select
  schemaname as schema,
  tablename  as table,
  case when rowsecurity then 'RLS on' else 'RLS OFF' end as rls
from pg_tables
where schemaname not in ('pg_catalog', 'information_schema')
order by schemaname, tablename;

-- ── 3. Anything notification-shaped, anywhere ──
-- Catches case 2 and case 3 above. Empty result for
-- notification_dismissals = it really was never created.
select
  n.nspname as schema,
  c.relname as name,
  case c.relkind
    when 'r' then 'table' when 'v' then 'view' when 'm' then 'matview'
    when 'p' then 'partitioned table' when 'f' then 'foreign table'
    else c.relkind::text
  end as kind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relname ilike '%notification%'
   or c.relname ilike '%dismiss%'
order by 1, 2;

-- ── 4. Is 028 perhaps recorded as applied while its table is not? ──
-- Only meaningful if the migrations are driven by the Supabase CLI
-- rather than pasted into the editor; the table does not exist
-- otherwise, and the error is expected and harmless.
select version, name
from supabase_migrations.schema_migrations
order by version;
