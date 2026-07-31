-- ============================================================
-- AMERICANKA — registration is finished by Telegram, not before it
-- ============================================================

-- Previously the account was created first and Telegram was linked
-- afterwards. Now nothing exists until the player presses START in the
-- bot: this table holds the reservation in between.

-- Deliberately absent: password and photo. They stay in the browser and
-- reach the server only on the final call that creates the account, so
-- a plaintext password is never written anywhere.

-- `login` is unique here as well as in players — that's what stops two
-- people from reserving the same login while both are in the bot.

create table if not exists pending_registrations (
  nonce text primary key,
  login text not null unique,
  telegram_user_id bigint,
  telegram_username text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists pending_registrations_expires_idx
  on pending_registrations (expires_at);

-- Server-side only (service role bypasses RLS); enabling it with no
-- policies means no browser client can read or write the table.
alter table pending_registrations enable row level security;

-- telegram_links stays: it serves players who ALREADY have an account
-- and need to re-link (expired link, or they blocked the bot).
