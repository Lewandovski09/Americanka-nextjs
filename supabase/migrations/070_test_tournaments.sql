-- ============================================================
-- AMERICANKA — Migration 070: test tournaments
-- ============================================================
-- «Тестовий турнір» at creation: nothing about such a tournament goes to
-- Telegram — no announcement, no «Заявки приймаються», no schedule, no
-- invitations, no withdrawal notes. The minute check (067/069) skips it
-- too. Idempotent.

alter table tournament_events add column if not exists is_test boolean not null default false;

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
       and not e.is_test
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

notify pgrst, 'reload schema';

-- Check: one row — is_test.
select column_name from information_schema.columns where table_name = 'tournament_events' and column_name = 'is_test';
