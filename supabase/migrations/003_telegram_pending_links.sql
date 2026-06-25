-- ============================================================
-- AMERICANKA — Telegram pending links
-- ============================================================
-- Captures a Telegram username -> chat_id mapping the moment
-- someone presses "Start" on our bot, BEFORE their players row
-- exists (registration creates the players row only after phone +
-- email verification succeeds). The registration flow reads from
-- this table to find the chat_id to send the verification code to.

create table telegram_pending_links (
  telegram_username text primary key,
  chat_id bigint not null,
  updated_at timestamptz not null default now()
);

-- No RLS needed — this table is only ever touched by server-side
-- code using the service role key (webhook handler + registration
-- route), never directly by browser clients.
alter table telegram_pending_links enable row level security;
-- (No policies defined = no access for anon/authenticated roles,
-- only the service role bypasses RLS entirely.)
