-- ============================================================
-- AMERICANKA — Migration 067: wake the server when applications open
-- ============================================================
-- Every minute the database checks whether an announced tournament has
-- reached its «registration_opens_at» (066). Only then it calls the site's
-- /api/cron/registration-open, which sends «Заявки приймаються» to the
-- Telegram channel and to the players in the bot. Minutes with nothing to
-- send cost one tiny query and no call at all.
--
-- Uses two standard Supabase extensions: pg_cron (the timer) and pg_net
-- (the call). If the first two lines fail, turn them on in the dashboard
-- (Database → Extensions → pg_cron, pg_net) and run this file again.
--
-- The site address is kept in app_config — change it there if the site
-- moves (update app_config set value = 'https://…' where key = 'site_url').
-- Idempotent: running it again just refreshes everything.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists app_config (
  key text primary key,
  value text not null
);
-- Server-only: no policies, so the browser can neither read nor write it.
alter table app_config enable row level security;
revoke all on app_config from anon, authenticated;

insert into app_config (key, value)
values ('site_url', 'https://americanka-nextjs-fiqe.vercel.app')
on conflict (key) do nothing;

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
       and e.registration_opens_at <= now()
       -- an opening long gone (e.g. this was installed late) is not news
       and e.registration_opens_at > now() - interval '2 days'
       -- only tournaments that were announced before the opening
       and e.announced_at is not null
       and e.announced_at < e.registration_opens_at
       and e.open_announce_done_at is null
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

-- Every minute. Same name again → the job is replaced, not doubled.
select cron.schedule(
  'americanka-registration-open',
  '* * * * *',
  'select public.americanka_registration_tick()'
);

-- Check: one row — americanka-registration-open, * * * * *, active = true.
select jobname, schedule, active from cron.job where jobname = 'americanka-registration-open';
