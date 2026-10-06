-- ============================================================
-- AMERICANKA — Migration 069: «Заявки приймаються» always goes out
-- ============================================================
-- Before: the message at the opening of applications went out only for
-- tournaments announced in Telegram. Now it goes out for every
-- tournament — announced or not — unless the announcement itself was
-- made after the opening (then it already said «Реєстрація відкрита»).
-- A tournament that opens at once is stamped with its creation time as
-- the opening (app/api/events), so it gets the message too, a minute or
-- two later; the 90-second wait leaves room for the announcement that
-- may be starting right then. Replaces the minute check of 067.
-- Idempotent.

create or replace function public.americanka_registration_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  site text;
begin
  if not exists (
    select 1
      from tournament_events e
     where e.status = 'scheduled'
       and e.registration_open is distinct from false
       and e.registration_opens_at is not null
       and e.registration_opens_at > now() - interval '2 days'
       and e.open_announce_done_at is null
       and (e.registration_closes_at is null or e.registration_closes_at > now())
       and (
         (e.announced_at is not null and e.announced_at < e.registration_opens_at and e.registration_opens_at <= now())
         or (e.announced_at is null and e.registration_opens_at <= now() - interval '90 seconds')
       )
  ) then
    return;
  end if;

  select value into site from app_config where key = 'site_url';
  if site is null or site = '' then
    return;
  end if;

  perform net.http_post(
    url := rtrim(site, '/') || '/api/cron/registration-open',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.americanka_registration_tick() from public, anon, authenticated;

-- Check: one row — the function is there.
select proname from pg_proc where proname = 'americanka_registration_tick';
