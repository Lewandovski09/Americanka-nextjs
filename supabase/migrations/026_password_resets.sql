-- ============================================================
-- AMERICANKA — Migration 026: password_resets
-- ============================================================
-- A third nonce table alongside pending_registrations and
-- telegram_links, for the one case neither of those covers: someone
-- locked out (forgot their login or password) who is NOT authenticated
-- and does NOT yet have a player_id to attach to (that's what makes
-- this different from telegram_links, which requires being logged in
-- already — the exact problem this flow exists to solve).
--
-- The recovery proof is the same as everywhere else in this app:
-- controlling the Telegram account already linked to the player row.
-- telegram_user_id is filled in by the webhook once the bot confirms
-- the nonce; which player that belongs to is looked up at the point
-- of finishing the reset, by matching players.telegram_user_id — this
-- table itself never stores a player_id, on purpose, so a leaked nonce
-- reveals nothing about which account it maps to on its own.
--
-- Same trust model as the other two tables: the nonce is a bearer
-- secret, checked server-side with the service-role client. No RLS
-- policy grants anon/authenticated any access at all — only
-- service_role (which bypasses RLS) ever touches this table.

create table password_resets (
  nonce uuid primary key,
  telegram_user_id bigint,
  confirmed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table password_resets enable row level security;
-- No policies created: RLS with zero policies denies every request
-- from anon/authenticated by default. Only the service-role key
-- (which bypasses RLS entirely) can read or write this table — exactly
-- what every route touching it already uses.

create index password_resets_expires_at_idx on password_resets (expires_at);
