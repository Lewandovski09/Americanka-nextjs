-- ============================================================
-- AMERICANKA — drop email/phone and the code-verification machinery
-- ============================================================
-- Telegram is now the only contact channel and the only verification
-- mechanism, so everything built for SMS and email is dead weight:
--
--   phone                — never written by any code path; the only
--                          values were seeded test numbers.
--   email                — was a queryable mirror of auth.users.email.
--                          The Auth address is now derived from the
--                          login (see lib/authIdentity.js), so storing
--                          it duplicates a value we can compute.
--   verification_codes   — the 4-digit code flow is replaced by the
--                          deep-link nonce in telegram_links.
--   telegram_pending_links — replaced by telegram_links (migration 004).
--
-- IRREVERSIBLE: these DROPs delete data. Run it together with the
-- deploy that removes the matching code, not before.

alter table players drop column if exists phone;
alter table players drop column if exists email;

drop table if exists verification_codes;
drop table if exists telegram_pending_links;

-- The enum only existed for verification_codes.channel.
drop type if exists verification_channel;

-- Uniqueness now rests on exactly two things: the login the player
-- chooses once at registration, and the Telegram account they link.
-- Both already carry unique constraints (players.login from migration
-- 001, players.telegram_user_id from 004) — this block only verifies
-- they are actually there, so a missing one fails loudly here instead
-- of silently allowing duplicates later.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'players'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) like '%(login)%'
  ) then
    raise exception 'players.login is missing its UNIQUE constraint';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'players'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) like '%(telegram_user_id)%'
  ) then
    raise exception 'players.telegram_user_id is missing its UNIQUE constraint — run 004 first';
  end if;
end $$;
