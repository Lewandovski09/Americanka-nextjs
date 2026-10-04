-- ============================================================
-- AMERICANKA — Migration 060: the photo bucket, locked down
-- ============================================================
-- Player avatars and tournament photos live in the public bucket
-- «player-photos». Reading is public (the app shows them to everyone);
-- WRITING is done only by the server with the service key, which
-- bypasses storage policies anyway — so no browser should be allowed to
-- upload, replace or delete files there.
--
-- 1. Any storage policy that lets anon / signed-in users write into
--    «player-photos» is removed.
-- 2. The bucket accepts only images, up to 8 MB.
-- 3. The last query lists what is left, for a look.
--
-- Idempotent. Each step is protected: a step this project's database
-- doesn't allow is reported as a NOTICE and skipped, not an error.

do $$
declare
  p record;
begin
  for p in
    select policyname, cmd
      from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ilike '%player-photos%'
  loop
    begin
      execute format('drop policy %I on storage.objects', p.policyname);
      raise notice 'dropped storage policy % (%)', p.policyname, p.cmd;
    exception when others then
      raise notice 'could not drop policy %: %', p.policyname, sqlerrm;
    end;
  end loop;
end $$;

do $$
begin
  update storage.buckets
     set public = true,
         file_size_limit = 8 * 1024 * 1024,
         allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
   where id = 'player-photos';
exception when others then
  raise notice 'could not update the bucket: %', sqlerrm;
end $$;

-- What is left on the photo bucket (expect: no INSERT / UPDATE / DELETE
-- rows that mention player-photos).
select policyname, cmd, roles
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by policyname;
