-- ============================================================
-- AMERICANKA — Migration 047: housekeeping
-- ============================================================
-- Small things the audit of 2026-10-03 found. Safe, idempotent, and
-- independent of each other.

-- ──────────────────────────────────────────────
-- 1. tournament_players.elo_at_start — not required any more
-- ──────────────────────────────────────────────
-- Migration 001 made it NOT NULL ("snapshot of elo for tiebreaks"), but
-- nothing has written or read it for a long time: registration inserts
-- (category_id, user_id) only. On a database built from this folder
-- that insert fails; the live one was evidently relaxed by hand. This
-- makes the folder say what the live database already does.
alter table tournament_players alter column elo_at_start drop not null;
comment on column tournament_players.elo_at_start is 'Unused since the events rewrite (011). Kept for old rows only.';

-- ──────────────────────────────────────────────
-- 2. Expired one-time rows
-- ──────────────────────────────────────────────
-- telegram_links, pending_registrations and telegram_processed_updates
-- only ever grew: each is useful for minutes (a link nonce, a
-- registration waiting for the bot, Telegram's duplicate-update guard),
-- then is dead weight forever. password_resets was already trimmed by
-- its own route. One function cleans all four; it is run once here and
-- then daily by pg_cron where the extension is available.
create or replace function cleanup_expired_rows()
returns void
language sql
security definer
set search_path = public
as $$
  delete from telegram_links         where expires_at < now() - interval '1 day';
  delete from pending_registrations  where expires_at < now() - interval '1 day';
  delete from password_resets        where expires_at < now() - interval '1 day';
  -- Telegram retries an update for at most ~24h; a week is plenty.
  delete from telegram_processed_updates where processed_at < now() - interval '7 days';
$$;

revoke all on function cleanup_expired_rows() from public;

select cleanup_expired_rows();

-- Daily at 04:15 UTC. Supabase ships pg_cron; if it is not enabled on
-- this project the schedule is skipped with a notice and the function
-- can be run by hand (select cleanup_expired_rows();) or enabled later
-- under Database → Extensions → pg_cron.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice '047: pg_cron is not available — run select cleanup_expired_rows(); occasionally, or enable pg_cron and re-run this file';
    return;
  end;
  begin
    perform cron.unschedule('americanka-cleanup-expired');
  exception when others then null;
  end;
  perform cron.schedule('americanka-cleanup-expired', '15 4 * * *', 'select public.cleanup_expired_rows()');
  raise notice '047: daily cleanup scheduled (pg_cron)';
end;
$$;
